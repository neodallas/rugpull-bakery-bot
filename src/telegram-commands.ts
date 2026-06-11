import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, type PublicClient } from "viem";
import type { Config } from "./types.js";

type Update = {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
};

type GetUpdatesResponse = {
  ok: boolean;
  result?: Update[];
};

let offset = 0;
let shouldStop = false;

export function stopTelegramCommands(): void {
  shouldStop = true;
}

export async function startTelegramCommands(
  cfg: Config,
  publicClient: PublicClient,
  dataDir: string,
): Promise<void> {
  if (!cfg.telegram.chatId || !cfg.telegram.botToken) return;
  const expectedChatId = Number(cfg.telegram.chatId);

  while (!shouldStop) {
    try {
      const url =
        `https://api.telegram.org/bot${cfg.telegram.botToken}` +
        `/getUpdates?offset=${offset}&timeout=30`;
      const res = await fetch(url);
      if (!res.ok) {
        await sleep(5000);
        continue;
      }
      const data = (await res.json()) as GetUpdatesResponse;
      if (!data.ok || !Array.isArray(data.result)) {
        await sleep(5000);
        continue;
      }
      for (const update of data.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || msg.chat.id !== expectedChatId) continue;
        const cmd = msg.text.trim().split(/\s+/)[0]?.toLowerCase();
        try {
          if (cmd === "/status") {
            await sendReply(cfg, buildStatus(dataDir));
          } else if (cmd === "/balance") {
            await sendReply(cfg, await buildBalance(cfg, publicClient));
          } else if (cmd === "/log") {
            await sendReply(cfg, buildLog(dataDir));
          } else if (cmd === "/help" || cmd === "/start") {
            await sendReply(
              cfg,
              "Commands:\n/status — gas, bakes, kill switch\n/balance — current AGW ETH balance\n/log — last 15 events",
            );
          }
        } catch {
          // never crash the polling loop on handler errors
        }
      }
    } catch {
      await sleep(5000);
    }
  }
}

async function sendReply(cfg: Config, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.telegram.chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // swallow — never crash polling
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildStatus(dataDir: string): string {
  const safetyPath = join(dataDir, "safety.json");
  if (!existsSync(safetyPath)) return "No safety state yet.";
  const safety = JSON.parse(readFileSync(safetyPath, "utf8"));
  const cfg = JSON.parse(readFileSync("config.json", "utf8"));
  const gasSpent = Number(formatEther(BigInt(safety.gasSpentWei ?? "0")));
  const budget = Number(cfg.maxGasPerDay);
  const pct = budget > 0 ? (gasSpent / budget) * 100 : 0;
  const remaining = Math.max(0, budget - gasSpent);
  const avgPerBakeEth = 0.0000075;
  const bakesLeft = Math.floor(remaining / avgPerBakeEth);
  const killed = safety.killSwitchUntil != null && Date.now() < safety.killSwitchUntil;

  return [
    "📊 Status",
    "",
    `clan: ${cfg.clanId}`,
    `threshold: ${cfg.minMultiplier}x`,
    "",
    `gas spent:     ${gasSpent.toFixed(8)} ETH`,
    `gas budget:    ${budget} ETH`,
    `used:          ${pct.toFixed(2)}%`,
    `remaining:     ~${bakesLeft.toLocaleString()} bakes`,
    "",
    `bakes today:   ${safety.bakeCountToday ?? 0}`,
    `bakes/hour:    ${safety.bakeCountThisHour ?? 0}`,
    `consec fails:  ${safety.consecutiveFailedTx ?? 0}`,
    "",
    `kill switch:   ${killed ? "TRIPPED — " + safety.killSwitchReason : "ok"}`,
  ].join("\n");
}

async function buildBalance(cfg: Config, publicClient: PublicClient): Promise<string> {
  const bal = await publicClient.getBalance({ address: cfg.agwOwnerAddress });
  const eth = formatEther(bal);
  return [
    "💰 AGW balance",
    "",
    `${eth} ETH`,
    `(${bal.toString()} wei)`,
    "",
    `address: ${cfg.agwOwnerAddress}`,
  ].join("\n");
}

function buildLog(dataDir: string): string {
  const logPath = join(dataDir, "events.jsonl");
  if (!existsSync(logPath)) return "No log yet.";
  const raw = readFileSync(logPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim()).slice(-15);
  const formatted = lines.map((l) => {
    try {
      const e = JSON.parse(l) as Record<string, unknown>;
      const tsRaw = typeof e.ts === "string" ? e.ts : "";
      const ts = tsRaw ? tsRaw.slice(11, 19) : "??:??:??";
      const lvl = String(e.level ?? "").padEnd(5);
      const msg = String(e.msg ?? "");
      const extra = typeof e.reason === "string" ? ` — ${e.reason}` : "";
      return `${ts} ${lvl} ${msg}${extra}`;
    } catch {
      return l.slice(0, 100);
    }
  });
  return "📜 Last 15 events:\n\n" + formatted.join("\n");
}
