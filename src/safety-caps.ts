import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Config, SafetyState, TxResult } from "./types.js";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000);
}

function freshState(): SafetyState {
  return {
    dateUtc: todayUtc(),
    gasSpentWei: 0n,
    vrfSpentWei: 0n,
    bakeCountToday: 0,
    bakeCountThisHour: 0,
    hourBucket: hourBucket(),
    consecutiveFailedTx: 0,
    killSwitchUntil: null,
    killSwitchReason: null,
  };
}

function loadOrFresh(path: string, onCorruption?: (err: Error) => void): SafetyState {
  if (!existsSync(path)) return freshState();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      dateUtc: raw.dateUtc,
      gasSpentWei: BigInt(raw.gasSpentWei ?? "0"),
      vrfSpentWei: BigInt(raw.vrfSpentWei ?? "0"),
      bakeCountToday: raw.bakeCountToday ?? 0,
      bakeCountThisHour: raw.bakeCountThisHour ?? 0,
      hourBucket: raw.hourBucket ?? hourBucket(),
      consecutiveFailedTx: raw.consecutiveFailedTx ?? 0,
      killSwitchUntil: raw.killSwitchUntil ?? null,
      killSwitchReason: raw.killSwitchReason ?? null,
    };
  } catch (err) {
    if (onCorruption) {
      onCorruption(err instanceof Error ? err : new Error(String(err)));
    }
    return freshState();
  }
}

function persist(path: string, s: SafetyState): void {
  const json = JSON.stringify(
    s,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
  const tmp = path + ".tmp";
  writeFileSync(tmp, json);
  renameSync(tmp, path);
}

export type SafetyCaps = {
  snapshot: () => SafetyState;
  isKilled: (killFlagPath?: string) => boolean;
  preflight: (estGasWei: bigint, estVrfWei: bigint) => { ok: boolean; reason?: string };
  recordTxResult: (r: TxResult) => void;
  trip: (reason: string) => void;
};

export function createSafetyCaps(
  path: string,
  cfg: Pick<
    Config,
    "maxGasPerDayWei" | "maxVrfPerDayWei" | "maxBakesPerHour" | "maxFailedTxConsecutive"
  >,
  onCorruption?: (err: Error) => void
): SafetyCaps {
  let state = loadOrFresh(path, onCorruption);

  function rolloverIfNeeded(): void {
    const today = todayUtc();
    if (state.dateUtc !== today) {
      state = freshState();
      persist(path, state);
      return;
    }
    const hb = hourBucket();
    if (state.hourBucket !== hb) {
      state.hourBucket = hb;
      state.bakeCountThisHour = 0;
      persist(path, state);
    }
  }

  function save() { persist(path, state); }

  function trip(reason: string) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    state.killSwitchUntil = tomorrow.getTime();
    state.killSwitchReason = reason;
    save();
  }

  return {
    snapshot: () => {
      rolloverIfNeeded();
      return { ...state };
    },
    isKilled: (killFlagPath?: string) => {
      rolloverIfNeeded();
      if (killFlagPath && existsSync(killFlagPath)) return true;
      if (state.killSwitchUntil && Date.now() < state.killSwitchUntil) return true;
      if (state.killSwitchUntil && Date.now() >= state.killSwitchUntil) {
        state.killSwitchUntil = null;
        state.killSwitchReason = null;
        save();
      }
      return false;
    },
    preflight: (estGasWei, estVrfWei) => {
      rolloverIfNeeded();
      if (state.gasSpentWei + estGasWei > cfg.maxGasPerDayWei) {
        return { ok: false, reason: "daily gas cap would be exceeded" };
      }
      if (state.vrfSpentWei + estVrfWei > cfg.maxVrfPerDayWei) {
        return { ok: false, reason: "daily VRF cap would be exceeded" };
      }
      if (state.bakeCountThisHour >= cfg.maxBakesPerHour) {
        return { ok: false, reason: "hourly bake cap reached" };
      }
      return { ok: true };
    },
    recordTxResult: (r) => {
      rolloverIfNeeded();
      if (r.ok) {
        state.gasSpentWei += r.gasUsedWei;
        state.vrfSpentWei += r.vrfPaidWei;
        state.bakeCountToday += 1;
        state.bakeCountThisHour += 1;
        state.consecutiveFailedTx = 0;
        if (state.gasSpentWei >= cfg.maxGasPerDayWei) {
          trip("daily gas cap exceeded");
        }
        if (state.bakeCountThisHour > cfg.maxBakesPerHour) {
          trip("hourly bake anomaly");
        }
      } else if (!r.expected) {
        state.consecutiveFailedTx += 1;
        if (state.consecutiveFailedTx >= cfg.maxFailedTxConsecutive) {
          trip(`${cfg.maxFailedTxConsecutive} consecutive failed tx`);
        }
      }
      save();
    },
    trip,
  };
}
