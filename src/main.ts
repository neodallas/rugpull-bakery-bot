import "dotenv/config";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfigFromDisk, isDryRun } from "./config.js";
import { getAgentJson } from "./agent-json.js";
import { createLogger } from "./logger.js";
import { createSafetyCaps } from "./safety-caps.js";
import { decide } from "./decision-engine.js";
import { createStateReader, assertChainId, PartialReadError } from "./state-reader.js";
import { createSessionSigner } from "./session-key.js";
import { createExecutor, isInvalidSessionError } from "./executor.js";
import { createTelegramNotifier } from "./telegram-notifier.js";
import { recordSweeperCleanup } from "./sweeper-cooldown.js";
import { readPending, clearPending } from "./pending-tx.js";

const DATA_DIR = "data";
const KILL_FLAG_PATH = join(DATA_DIR, "kill.flag");
const SAFETY_PATH = join(DATA_DIR, "safety.json");
const LOG_PATH = join(DATA_DIR, "events.jsonl");

let shouldStop = false;
process.on("SIGTERM", () => { shouldStop = true; });
process.on("SIGINT", () => { shouldStop = true; });
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
  process.exit(1);
});

// Gap 2 — session expiry warning
const THREE_DAYS_S = 3 * 24 * 60 * 60;
let lastExpiryWarnDate = "";
async function maybeWarnExpiry(
  sessionConfig: { expiresAt: bigint },
  tg: { send: (t: string) => Promise<void> },
  log: { warn: (m: string, f?: Record<string, unknown>) => void },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expires = Number(sessionConfig.expiresAt);
  if (expires - now > THREE_DAYS_S) return;
  const today = new Date().toISOString().slice(0, 10);
  if (lastExpiryWarnDate === today) return;
  lastExpiryWarnDate = today;
  const hoursLeft = Math.max(0, Math.floor((expires - now) / 3600));
  log.warn("session key expiry approaching", { hoursLeft });
  await tg.send(`Session key expires in ~${hoursLeft}h — rotate soon`);
}

// Gap 3 — daily UTC summary
let lastSeenDate = new Date().toISOString().slice(0, 10);
let summarySnapshot: ReturnType<typeof createSafetyCaps>["snapshot"] extends () => infer R ? R : never = {} as never;
async function maybeEmitDailySummary(
  safety: ReturnType<typeof createSafetyCaps>,
  tg: { send: (t: string) => Promise<void> },
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (today === lastSeenDate) {
    summarySnapshot = safety.snapshot();
    return;
  }
  const prev = summarySnapshot;
  lastSeenDate = today;
  summarySnapshot = safety.snapshot();
  if (!prev || prev.bakeCountToday === undefined) return;
  await tg.send(
    `Daily summary ${prev.dateUtc}: ${prev.bakeCountToday} bakes, gas ${prev.gasSpentWei} wei, vrf ${prev.vrfSpentWei} wei`,
  );
}

async function main(): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const log = createLogger(LOG_PATH);
  const cfg = loadConfigFromDisk();
  const dryRun = isDryRun();
  log.info("startup mode", { dryRun });

  const safety = createSafetyCaps(SAFETY_PATH, cfg);
  const tg = createTelegramNotifier(cfg.telegram);
  const reader = createStateReader(cfg);

  await assertChainId(reader.publicClient);
  const agent = await getAgentJson();
  if (agent.network.chainId !== 2741) {
    throw new Error(`/agent.json chainId mismatch: ${agent.network.chainId}`);
  }

  let sessionConfig: Parameters<typeof createSessionSigner>[1] | null = null;
  let executor: ReturnType<typeof createExecutor> | null = null;

  if (!dryRun) {
    const sessionPath = process.env.SESSION_CONFIG_PATH ?? "data/session.json";
    if (!existsSync(sessionPath)) {
      throw new Error(`SessionConfig file missing at ${sessionPath} — complete onboarding first.`);
    }
    sessionConfig = JSON.parse(readFileSync(sessionPath, "utf8")) as Parameters<typeof createSessionSigner>[1];
    const signer = createSessionSigner(cfg, sessionConfig);
    executor = createExecutor({
      cfg,
      publicClient: reader.publicClient,
      signer,
      agentContracts: {
        boostManager: agent.contracts.boostManager,
        bakery: agent.contracts.bakery,
      },
      log,
      dataDir: DATA_DIR,
    });
  }

  log.info("bot up", { clanId: cfg.clanId, agwOwner: cfg.agwOwnerAddress });
  const startupMsg = dryRun
    ? `Rugpull bot started in DRY-RUN mode (no tx will be sent), clan ${cfg.clanId}`
    : `Rugpull bot started, clan ${cfg.clanId}`;
  await tg.send(startupMsg);

  if (!dryRun) {
    const pending = readPending(DATA_DIR);
    if (pending) {
      log.warn("found pending tx from previous run", { kind: pending.kind, txHash: pending.txHash });
      try {
        const receipt = await reader.publicClient.waitForTransactionReceipt({ hash: pending.txHash, confirmations: 1, timeout: 60_000 });
        if (receipt.status === "success") {
          log.info("pending tx resolved ok", { txHash: pending.txHash, blockNumber: receipt.blockNumber });
          await tg.send(`Recovered pending ${pending.kind} after restart: ${pending.txHash}`);
        } else {
          log.warn("pending tx resolved reverted", { txHash: pending.txHash });
          await tg.send(`Pending ${pending.kind} reverted after restart: ${pending.txHash}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("pending tx unresolved (timeout or dropped)", { txHash: pending.txHash, msg });
        await tg.send(`Pending ${pending.kind} could not be resolved (may have been dropped): ${pending.txHash}`);
      } finally {
        clearPending(DATA_DIR);
      }
    }
  }

  let killAnnouncedAt = 0;
  let backoffMs = 0;

  while (true) {
    try {
      if (shouldStop) {
        log.info("shutting down");
        await tg.send("Rugpull bot shutting down");
        break;
      }

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

      await maybeEmitDailySummary(safety, tg);
      if (!dryRun && sessionConfig) await maybeWarnExpiry(sessionConfig, tg, log);

      const state = await reader.read();
      const action = decide(state, cfg);

      if (action.kind === "sleep") {
        log.info("sleep", {
          reason: action.reason,
          multiplierBps: state.effectiveMultiplierBps,
          activeRugsCount: state.activeRugs.length,
          activeBoostsCount: state.activeBoosts.length,
        });
        if (action.reason === "low ETH") {
          await tg.send(`ETH balance low: ${state.ethWei} wei`);
        }
        backoffMs = 0;
        await sleep(cfg.pollIntervalMs);
        continue;
      }

      if (dryRun) {
        log.info("dry-run tick", {
          actionKind: action.kind,
          multiplierBps: state.effectiveMultiplierBps,
          activeRugsCount: state.activeRugs.length,
          activeBoostsCount: state.activeBoosts.length,
          blocksSinceLastBake: Number(state.blockNumber - state.lastBakeBlock),
          ethWei: state.ethWei,
        });
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

      const result = await executor!.execute(action, {
        clanId: cfg.clanId,
        cleanupBoostTypeId: state.cleanupCrewBoostTypeId,
        vrfFeeWei: state.vrfFeeWei,
      });
      safety.recordTxResult(result);

      if (!result.ok && isInvalidSessionError(result.reason)) {
        safety.trip("invalid session key detected");
        await tg.send(`CRITICAL: session key appears invalid (${result.reason}). Bot stopped.`);
        log.error("invalid session key", { reason: result.reason });
      }

      if (!result.ok && !result.expected) {
        await tg.send(`Unexpected tx failure: ${result.reason}`);
      }
      if (result.ok && action.kind === "cleanup") {
        recordSweeperCleanup(DATA_DIR, Math.floor(Date.now() / 1000));
        await tg.send(`Sweeper cleanup sent: ${result.txHash}`);
      }

      backoffMs = 0;
      await sleep(cfg.pollIntervalMs);
    } catch (err) {
      if (err instanceof PartialReadError) {
        log.warn("partial read", { failures: err.failures });
        backoffMs = 0;
        await sleep(cfg.pollIntervalMs);
        continue;
      }
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
