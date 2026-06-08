import { describe, expect, it, vi } from "vitest";
import { createDailySummaryTracker, createExpiryWarner, createHeartbeat } from "../src/main-helpers.js";

function fakeSender() {
  const sent: string[] = [];
  return { sent, tg: { send: async (t: string) => { sent.push(t); } } };
}

function fakeWarner() {
  const warnings: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
  return { warnings, log: { warn: (msg: string, fields?: Record<string, unknown>) => { warnings.push({ msg, fields }); } } };
}

describe("createExpiryWarner", () => {
  it("alerts EXPIRED (not '0h left') when the key is already expired", async () => {
    const warner = createExpiryWarner();
    const { sent, tg } = fakeSender();
    const { log } = fakeWarner();
    const now = Math.floor(Date.now() / 1000);

    await warner.maybeWarn({ expiresAt: BigInt(now - 3600) }, tg, log);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("EXPIRED");
    expect(sent[0]).not.toContain("0h left");
    expect(sent[0]).not.toContain("expires in ~0h");
  });

  it("warns 'expires in ~48h' when ~2 days remain", async () => {
    const warner = createExpiryWarner();
    const { sent, tg } = fakeSender();
    const { log } = fakeWarner();
    const now = Math.floor(Date.now() / 1000);

    await warner.maybeWarn({ expiresAt: BigInt(now + 2 * 86400) }, tg, log);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("expires in ~48h");
  });

  it("stays silent when expiry is more than 3 days away", async () => {
    const warner = createExpiryWarner();
    const { sent, tg } = fakeSender();
    const { log } = fakeWarner();
    const now = Math.floor(Date.now() / 1000);

    await warner.maybeWarn({ expiresAt: BigInt(now + 10 * 86400) }, tg, log);

    expect(sent).toHaveLength(0);
  });

  it("only alerts once per UTC day for the same warner instance", async () => {
    const warner = createExpiryWarner();
    const { sent, tg } = fakeSender();
    const { log } = fakeWarner();
    const now = Math.floor(Date.now() / 1000);

    await warner.maybeWarn({ expiresAt: BigInt(now - 3600) }, tg, log);
    await warner.maybeWarn({ expiresAt: BigInt(now - 3600) }, tg, log);

    expect(sent).toHaveLength(1);
  });
});

describe("createDailySummaryTracker", () => {
  it("does not emit on the first tick (no previous snapshot yet)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const tracker = createDailySummaryTracker();
    const { sent, tg } = fakeSender();
    const safety = { snapshot: () => ({ dateUtc: "2026-06-05", bakeCountToday: 3, gasSpentWei: 1n, vrfSpentWei: 0n }) } as never;

    await tracker.maybeEmit(safety, tg);
    expect(sent).toHaveLength(0);
    vi.useRealTimers();
  });

  it("emits the previous day's snapshot when the UTC date rolls over", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const tracker = createDailySummaryTracker();
    const { sent, tg } = fakeSender();

    let snap = { dateUtc: "2026-06-05", bakeCountToday: 5, gasSpentWei: 100n, vrfSpentWei: 7n };
    const safety = { snapshot: () => snap } as never;

    // End-of-day snapshot recorded (e.g. last bake of the day).
    tracker.recordSnapshot(safety);

    // New day rolls in.
    vi.setSystemTime(new Date("2026-06-06T00:05:00Z"));
    snap = { dateUtc: "2026-06-06", bakeCountToday: 0, gasSpentWei: 0n, vrfSpentWei: 0n };
    await tracker.maybeEmit(safety, tg);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Daily summary 2026-06-05");
    expect(sent[0]).toContain("5 bakes");
    expect(sent[0]).toContain("gas 100 wei");
    expect(sent[0]).toContain("vrf 7 wei");
    vi.useRealTimers();
  });

  it("includes the final tick's action in the summary (snapshot taken at end of tick)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const tracker = createDailySummaryTracker();
    const { tg } = fakeSender();

    // Tick 1: 4 bakes so far — captured at bottom of tick.
    let snap = { dateUtc: "2026-06-05", bakeCountToday: 4, gasSpentWei: 80n, vrfSpentWei: 0n };
    const safety = { snapshot: () => snap } as never;
    tracker.recordSnapshot(safety);

    // Tick 2 (last tick before midnight): a 5th bake happens, recorded at bottom of THIS tick too.
    snap = { dateUtc: "2026-06-05", bakeCountToday: 5, gasSpentWei: 100n, vrfSpentWei: 0n };
    tracker.recordSnapshot(safety);

    // Roll over to the next day — emits using the snapshot from the LAST recordSnapshot call.
    vi.setSystemTime(new Date("2026-06-06T00:01:00Z"));
    const { sent, tg: tg2 } = fakeSender();
    snap = { dateUtc: "2026-06-06", bakeCountToday: 0, gasSpentWei: 0n, vrfSpentWei: 0n };
    await tracker.maybeEmit(safety, tg2);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("5 bakes");
    expect(sent[0]).not.toContain("4 bakes");
    void tg; // unused sender from setup; kept for symmetry with helper
    vi.useRealTimers();
  });
});

describe("createHeartbeat", () => {
  it("sends an alive message on the first call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const heartbeat = createHeartbeat();
    const { sent, tg } = fakeSender();

    await heartbeat.maybeBeat({ blockNumber: 123n, effectiveMultiplierBps: 10250, ethWei: 5_000_000_000_000_000n }, tg);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("alive");
    expect(sent[0]).toContain("block 123");
    expect(sent[0]).toContain("102.50%");
    vi.useRealTimers();
  });

  it("does not repeat within the heartbeat interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const heartbeat = createHeartbeat();
    const { sent, tg } = fakeSender();

    await heartbeat.maybeBeat({ blockNumber: 1n, effectiveMultiplierBps: 10000, ethWei: 1n }, tg);
    vi.setSystemTime(new Date("2026-06-05T10:30:00Z"));
    await heartbeat.maybeBeat({ blockNumber: 2n, effectiveMultiplierBps: 10000, ethWei: 1n }, tg);

    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it("sends again after the interval elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const heartbeat = createHeartbeat();
    const { sent, tg } = fakeSender();

    await heartbeat.maybeBeat({ blockNumber: 1n, effectiveMultiplierBps: 10000, ethWei: 1n }, tg);
    vi.setSystemTime(new Date("2026-06-05T11:00:01Z"));
    await heartbeat.maybeBeat({ blockNumber: 2n, effectiveMultiplierBps: 10000, ethWei: 1n }, tg);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("block 2");
    vi.useRealTimers();
  });
});
