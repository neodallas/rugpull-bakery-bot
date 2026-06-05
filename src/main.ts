import "dotenv/config";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfigFromDisk } from "./config.js";
import { getAgentJson } from "./agent-json.js";
import { createLogger } from "./logger.js";
import { createSafetyCaps } from "./safety-caps.js";
import { decide } from "./decision-engine.js";
import { createStateReader, assertChainId } from "./state-reader.js";
import { createSessionSigner } from "./session-key.js";
import { createExecutor } from "./executor.js";
import { createTelegramNotifier } from "./telegram-notifier.js";

const DATA_DIR = "data";
const KILL_FLAG_PATH = join(DATA_DIR, "kill.flag");
const SAFETY_PATH = join(DATA_DIR, "safety.json");
const LOG_PATH = join(DATA_DIR, "events.jsonl");

async function main(): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const log = createLogger(LOG_PATH);
  const cfg = loadConfigFromDisk();

  const sessionPath = process.env.SESSION_CONFIG_PATH ?? "data/session.json";
  if (!existsSync(sessionPath)) {
    throw new Error(`SessionConfig file missing at ${sessionPath} — complete onboarding first.`);
  }
  const sessionConfig = JSON.parse(readFileSync(sessionPath, "utf8")) as Parameters<typeof createSessionSigner>[1];

  const safety = createSafetyCaps(SAFETY_PATH, cfg);
  const tg = createTelegramNotifier(cfg.telegram);
  const reader = createStateReader(cfg);
  const signer = createSessionSigner(cfg, sessionConfig);

  await assertChainId(reader.publicClient);
  const agent = await getAgentJson();
  if (agent.chainId !== 2741) {
    throw new Error(`/agent.json chainId mismatch: ${agent.chainId}`);
  }

  const executor = createExecutor({
    cfg,
    publicClient: reader.publicClient,
    signer,
    agentContracts: {
      boostManager: agent.contracts.boostManager,
      playerRegistry: agent.contracts.playerRegistry,
    },
    log,
  });

  log.info("bot up", { clanId: cfg.clanId, agwOwner: cfg.agwOwnerAddress });
  await tg.send(`Rugpull bot started, clan ${cfg.clanId}`);

  let killAnnouncedAt = 0;
  let backoffMs = 0;

  while (true) {
    try {
      if (safety.isKilled(KILL_FLAG_PATH)) {
        const snap = safety.snapshot();
        if (Date.now() - killAnnouncedAt > 60 * 60 * 1000) {
          killAnnouncedAt = Date.now();
          await tg.send(`KILL SWITCH active. Reason: ${snap.killSwitchReason}`);
          log.warn("kill switch active", { reason: snap.killSwitchReason });
        }
        await sleep(5 * 60 * 1000);
        continue;
      }

      const state = await reader.read();
      const action = decide(state, cfg);

      if (action.kind === "sleep") {
        log.info("sleep", { reason: action.reason, multiplierBps: state.effectiveMultiplierBps });
        if (action.reason === "low ETH") {
          await tg.send(`ETH balance low: ${state.ethWei} wei`);
        }
        backoffMs = 0;
        await sleep(cfg.pollIntervalMs);
        continue;
      }

      const estGas = 200_000n * (await reader.publicClient.getGasPrice());
      const estVrf = action.kind === "cleanup" ? state.vrfFeeWei : 0n;
      const pre = safety.preflight(estGas, estVrf);
      if (!pre.ok) {
        log.info("preflight blocked", { reason: pre.reason });
        await sleep(cfg.pollIntervalMs);
        continue;
      }

      const result = await executor.execute(action, {
        clanId: cfg.clanId,
        cleanupBoostTypeId: state.cleanupCrewBoostTypeId,
        vrfFeeWei: state.vrfFeeWei,
      });
      safety.recordTxResult(result);

      if (!result.ok && !result.expected) {
        await tg.send(`Unexpected tx failure: ${result.reason}`);
      }
      if (result.ok && action.kind === "cleanup") {
        await tg.send(`Sweeper cleanup sent: ${result.txHash}`);
      }

      backoffMs = 0;
      await sleep(cfg.pollIntervalMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("tick error", { msg });
      backoffMs = Math.min(60_000, backoffMs === 0 ? 1000 : backoffMs * 2);
      await sleep(backoffMs);
    }
  }
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
