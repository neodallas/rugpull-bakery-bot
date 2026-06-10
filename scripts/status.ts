import { existsSync, readFileSync, statSync } from "node:fs";
import { formatEther } from "viem";

const SAFETY_PATH = "data/safety.json";
const EVENTS_PATH = "data/events.jsonl";
const CONFIG_PATH = "config.json";

type SafetyState = {
  dateUtc: string;
  gasSpentWei: string;
  vrfSpentWei: string;
  bakeCountToday: number;
  bakeCountThisHour: number;
  consecutiveFailedTx: number;
  killSwitchUntil: number | null;
  killSwitchReason: string | null;
};

type Config = {
  clanId: number;
  minMultiplier: number;
  maxGasPerDay: string;
  maxFailedTxConsecutive: number;
};

type Event = {
  ts: string;
  level: string;
  msg: string;
  [k: string]: unknown;
};

function fmtEth(weiStr: string): string {
  try {
    return formatEther(BigInt(weiStr));
  } catch {
    return "0";
  }
}

function fmtPct(num: number): string {
  return num.toFixed(2) + "%";
}

function fmtAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function readEvents(): Event[] {
  if (!existsSync(EVENTS_PATH)) return [];
  const raw = readFileSync(EVENTS_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const out: Event[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return out;
}

function main(): void {
  const safety: SafetyState = existsSync(SAFETY_PATH)
    ? JSON.parse(readFileSync(SAFETY_PATH, "utf8"))
    : {
        dateUtc: "—",
        gasSpentWei: "0",
        vrfSpentWei: "0",
        bakeCountToday: 0,
        bakeCountThisHour: 0,
        consecutiveFailedTx: 0,
        killSwitchUntil: null,
        killSwitchReason: null,
      };

  const cfg: Config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

  const gasSpentEth = Number(fmtEth(safety.gasSpentWei));
  const gasBudgetEth = Number(cfg.maxGasPerDay);
  const gasPct = gasBudgetEth > 0 ? (gasSpentEth / gasBudgetEth) * 100 : 0;
  const remainingBudget = Math.max(0, gasBudgetEth - gasSpentEth);
  const avgGasPerBakeEth = 0.0000075;
  const remainingBakes = Math.floor(remainingBudget / avgGasPerBakeEth);

  const events = readEvents();
  const txOk = events.filter((e) => e.msg === "tx ok");
  const txFail = events.filter((e) => e.msg === "tx failed" || e.msg === "tx reverted");
  const bakesOk = txOk.filter((e) => e.description === "bake");
  const cleanupsOk = txOk.filter((e) => e.description === "cleanup");
  const lastTick = [...events].reverse().find((e) => e.msg === "sleep" || e.msg === "dry-run tick");
  const lastBake = [...bakesOk].pop();
  const startupEvent = events.find((e) => e.msg === "bot up" || e.msg === "startup mode");

  const killActive = safety.killSwitchUntil != null && Date.now() < safety.killSwitchUntil;
  const startTime = startupEvent ? startupEvent.ts : null;
  const fileStartTime = existsSync(EVENTS_PATH) ? new Date(statSync(EVENTS_PATH).birthtime).toISOString() : null;

  const lastMultiplierBps = lastTick ? Number(lastTick["multiplierBps"] ?? 0) : 0;
  const lastReason = lastTick ? String(lastTick["reason"] ?? lastTick["actionKind"] ?? "") : "";
  const activeBoosts = lastTick ? Number(lastTick["activeBoostsCount"] ?? 0) : 0;
  const activeRugs = lastTick ? Number(lastTick["activeRugsCount"] ?? 0) : 0;

  const lines = [
    "=".repeat(60),
    "Rugpull Bakery Bot — Status",
    "=".repeat(60),
    "",
    "Configuration",
    `  clanId             ${cfg.clanId}`,
    `  threshold          ${cfg.minMultiplier}x  (${cfg.minMultiplier * 10000} bps)`,
    "",
    "Gas (lifetime)",
    `  spent              ${gasSpentEth.toFixed(8)} ETH`,
    `  budget             ${gasBudgetEth.toFixed(8)} ETH`,
    `  used               ${fmtPct(gasPct)}`,
    `  remaining          ${remainingBudget.toFixed(8)} ETH  (~${remainingBakes.toLocaleString()} bakes left)`,
    "",
    "Activity",
    `  bakes successful   ${bakesOk.length} total`,
    `  cleanups           ${cleanupsOk.length} total`,
    `  bakes today        ${safety.bakeCountToday}`,
    `  bakes this hour    ${safety.bakeCountThisHour}`,
    `  tx failed          ${txFail.length} total  (${safety.consecutiveFailedTx} consecutive now)`,
    "",
    "Last tick",
    `  when               ${lastTick ? fmtAgo(lastTick.ts) : "—"}`,
    `  decision           ${lastReason || "—"}`,
    `  multiplier         ${(lastMultiplierBps / 10000).toFixed(2)}x  (${lastMultiplierBps} bps)`,
    `  active boosts      ${activeBoosts}`,
    `  active rugs        ${activeRugs}`,
    "",
    "Last bake",
    lastBake
      ? `  when               ${fmtAgo(String(lastBake.ts))}`
      : "  when               never",
    lastBake && typeof lastBake["txHash"] === "string"
      ? `  txHash             ${lastBake["txHash"]}`
      : "",
    "",
    "Kill switch",
    killActive
      ? `  STATUS             TRIPPED — ${safety.killSwitchReason}`
      : "  STATUS             ok",
    killActive && safety.killSwitchUntil
      ? `  auto-reset at      ${new Date(safety.killSwitchUntil).toISOString()}`
      : "",
    "",
    "Bot started",
    startTime
      ? `  this run           ${fmtAgo(startTime)}  (${startTime})`
      : "  this run           —",
    fileStartTime
      ? `  events log start   ${fmtAgo(fileStartTime)}  (rotated daily)`
      : "",
    "=".repeat(60),
  ];
  console.log(lines.filter((l) => l !== "").join("\n"));
}

main();
