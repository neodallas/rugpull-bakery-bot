import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSafetyCaps } from "../src/safety-caps.js";
import type { Config } from "../src/types.js";

const cfg: Pick<
  Config,
  "maxGasPerDayWei" | "maxVrfPerDayWei" | "maxBakesPerHour" | "maxFailedTxConsecutive"
> = {
  maxGasPerDayWei: 10_000_000_000_000_000n,
  maxVrfPerDayWei: 1_000_000_000_000_000n,
  maxBakesPerHour: 30,
  maxFailedTxConsecutive: 5,
};

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "safety-"));
  path = join(dir, "safety.json");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("safety-caps", () => {
  it("starts with empty counters when no file exists", () => {
    const caps = createSafetyCaps(path, cfg);
    const s = caps.snapshot();
    expect(s.gasSpentWei).toBe(0n);
    expect(s.killSwitchUntil).toBeNull();
  });

  it("trips kill switch when daily gas cap exceeded", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: cfg.maxGasPerDayWei, vrfPaidWei: 0n });
    expect(caps.isKilled()).toBe(true);
  });

  it("trips kill switch after N consecutive failed unexpected tx", () => {
    const caps = createSafetyCaps(path, cfg);
    for (let i = 0; i < cfg.maxFailedTxConsecutive; i++) {
      caps.recordTxResult({ ok: false, reason: "weird", expected: false });
    }
    expect(caps.isKilled()).toBe(true);
  });

  it("expected reverts do not bump failure counter", () => {
    const caps = createSafetyCaps(path, cfg);
    for (let i = 0; i < 100; i++) {
      caps.recordTxResult({ ok: false, reason: "BakeTooSoon", expected: true });
    }
    expect(caps.isKilled()).toBe(false);
  });

  it("successful tx resets failure counter", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: false, reason: "weird", expected: false });
    caps.recordTxResult({ ok: false, reason: "weird", expected: false });
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 1n, vrfPaidWei: 0n });
    expect(caps.snapshot().consecutiveFailedTx).toBe(0);
  });

  it("resets daily counters on UTC date rollover", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 5n, vrfPaidWei: 0n });
    vi.setSystemTime(new Date("2026-06-06T00:00:01Z"));
    const reloaded = createSafetyCaps(path, cfg);
    expect(reloaded.snapshot().gasSpentWei).toBe(0n);
    expect(reloaded.snapshot().dateUtc).toBe("2026-06-06");
  });

  it("can be tripped manually via kill flag file", () => {
    const caps = createSafetyCaps(path, cfg);
    writeFileSync(join(dir, "kill.flag"), "manual");
    expect(caps.isKilled(join(dir, "kill.flag"))).toBe(true);
  });

  it("persists state atomically (tmp + rename)", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 100n, vrfPaidWei: 0n });
    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.gasSpentWei).toBe("100");
  });

  it("caps maxBakesPerHour and trips kill switch on anomaly", () => {
    const caps = createSafetyCaps(path, cfg);
    for (let i = 0; i < cfg.maxBakesPerHour + 1; i++) {
      caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 1n, vrfPaidWei: 0n });
    }
    expect(caps.isKilled()).toBe(true);
  });

  it("calls onCorruption when safety.json is unparseable", () => {
    writeFileSync(path, "{not valid json");
    let called = false;
    let capturedErr: Error | null = null;
    createSafetyCaps(path, cfg, (err) => {
      called = true;
      capturedErr = err;
    });
    expect(called).toBe(true);
    expect(capturedErr).toBeInstanceOf(Error);
  });

  it("still starts with fresh counters after corruption (does not throw)", () => {
    writeFileSync(path, "{not valid json");
    const caps = createSafetyCaps(path, cfg, () => {});
    const s = caps.snapshot();
    expect(s.gasSpentWei).toBe(0n);
    expect(s.bakeCountToday).toBe(0);
  });

  it("does not call onCorruption when safety.json is valid", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 5n, vrfPaidWei: 0n });
    let called = false;
    createSafetyCaps(path, cfg, () => { called = true; });
    expect(called).toBe(false);
  });
});
