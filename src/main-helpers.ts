import type { createSafetyCaps } from "./safety-caps.js";

type Sender = { send: (t: string) => Promise<void> };
type Warner = { warn: (m: string, f?: Record<string, unknown>) => void };

const THREE_DAYS_S = 3 * 24 * 60 * 60;
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Gap 2 — session expiry warning
// ---------------------------------------------------------------------------

export type ExpiryWarner = {
  maybeWarn: (sessionConfig: { expiresAt: bigint }, tg: Sender, log: Warner) => Promise<void>;
};

/**
 * Tracks the last UTC date an expiry warning was sent so we alert at most
 * once per day (both for "approaching expiry" and "already expired" — the
 * latter re-alerts daily until rotated, since it is a critical condition).
 */
export function createExpiryWarner(): ExpiryWarner {
  let lastWarnDate = "";

  return {
    maybeWarn: async (sessionConfig, tg, log) => {
      const now = Math.floor(Date.now() / 1000);
      const expires = Number(sessionConfig.expiresAt);
      const today = todayUtc();

      if (expires <= now) {
        // Already expired — alert daily until rotated.
        if (lastWarnDate === today) return;
        lastWarnDate = today;
        const hoursSince = Math.floor((now - expires) / 3600);
        log.warn("session key EXPIRED", { hoursSince });
        await tg.send(`Session key EXPIRED ~${hoursSince}h ago — rotate immediately, bot cannot sign`);
        return;
      }

      if (expires - now > THREE_DAYS_S) return;
      if (lastWarnDate === today) return;
      lastWarnDate = today;
      const hoursLeft = Math.floor((expires - now) / 3600);
      log.warn("session key expiry approaching", { hoursLeft });
      await tg.send(`Session key expires in ~${hoursLeft}h — rotate soon`);
    },
  };
}

// ---------------------------------------------------------------------------
// Gap 3 — daily UTC summary
// ---------------------------------------------------------------------------

type SafetySnapshot = ReturnType<ReturnType<typeof createSafetyCaps>["snapshot"]>;

export type DailySummaryTracker = {
  /** Call once per tick, near the top — emits the previous day's summary on date rollover. */
  maybeEmit: (safety: ReturnType<typeof createSafetyCaps>, tg: Sender) => Promise<void>;
  /** Call once per tick, near the bottom — refreshes the snapshot so it reflects end-of-tick state. */
  recordSnapshot: (safety: ReturnType<typeof createSafetyCaps>) => void;
};

/**
 * Emits a daily summary message when the UTC date rolls over. The snapshot
 * used for the summary is refreshed at the END of every tick (via
 * `recordSnapshot`) so that the final bake/cleanup of a day is included —
 * capturing it at the start of the tick would exclude that tick's own action.
 */
export function createDailySummaryTracker(): DailySummaryTracker {
  let lastSeenDate = todayUtc();
  let snapshot: SafetySnapshot | null = null;

  return {
    maybeEmit: async (safety, tg) => {
      const today = todayUtc();
      if (today === lastSeenDate) return;
      const prev = snapshot;
      lastSeenDate = today;
      // Refresh for the new day so the next rollover has a baseline.
      snapshot = safety.snapshot();
      if (!prev || prev.bakeCountToday === undefined) return;
      await tg.send(
        `Daily summary ${prev.dateUtc}: ${prev.bakeCountToday} bakes, gas ${prev.gasSpentWei} wei, vrf ${prev.vrfSpentWei} wei`,
      );
    },
    recordSnapshot: (safety) => {
      // Refresh on every tick — the last call before midnight wins.
      snapshot = safety.snapshot();
    },
  };
}

// ---------------------------------------------------------------------------
// Heartbeat — periodic "I'm alive" signal independent of daily summary
// ---------------------------------------------------------------------------

export type Heartbeat = {
  maybeBeat: (
    state: { blockNumber: bigint; effectiveMultiplierBps: number; ethWei: bigint },
    tg: Sender,
  ) => Promise<void>;
};

/** Sends an "alive" message at most once per HEARTBEAT_INTERVAL_MS. */
export function createHeartbeat(): Heartbeat {
  let lastBeatAtMs = 0;

  return {
    maybeBeat: async (state, tg) => {
      const now = Date.now();
      if (now - lastBeatAtMs < HEARTBEAT_INTERVAL_MS) return;
      lastBeatAtMs = now;
      await tg.send(
        `alive — block ${state.blockNumber}, mult ${(state.effectiveMultiplierBps / 100).toFixed(2)}%, eth ${state.ethWei} wei`,
      );
    },
  };
}
