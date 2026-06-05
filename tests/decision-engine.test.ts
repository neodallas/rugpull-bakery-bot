import { describe, expect, it } from "vitest";
import { decide } from "../src/decision-engine.js";
import { makeConfig, makeState } from "./fixtures/state.js";

describe("decide", () => {
  it("sleeps when ETH below reserve", () => {
    const s = makeState({ ethWei: 1_000_000_000_000_000n });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });

  it("sleeps when cooldown not elapsed", () => {
    const s = makeState({ blockNumber: 902n, lastBakeBlock: 900n });
    const a = decide(s, makeConfig());
    expect(a.kind).toBe("sleep");
    if (a.kind === "sleep") expect(a.reason).toBe("cooldown");
  });

  it("bakes when multiplier exactly at threshold", () => {
    const s = makeState({ effectiveMultiplierBps: 10000 });
    expect(decide(s, makeConfig({ minMultiplierBps: 10000 })).kind).toBe("bake");
  });

  it("sleeps when multiplier below threshold", () => {
    const s = makeState({ effectiveMultiplierBps: 9999 });
    expect(decide(s, makeConfig({ minMultiplierBps: 10000 })).kind).toBe("sleep");
  });

  it("prefers cleanup when rug active and sweeper free is ready", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      playerSkill: "Sweeper",
      sweeperFreeReady: true,
    });
    expect(decide(s, makeConfig()).kind).toBe("cleanup");
  });

  it("does not cleanup when sweeper cooldown not ready (even if rug present)", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      playerSkill: "Sweeper",
      sweeperFreeReady: false,
      effectiveMultiplierBps: 7000,
    });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });

  it("does not cleanup if player skill is not Sweeper", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      playerSkill: "Lucky",
      sweeperFreeReady: true,
      effectiveMultiplierBps: 7000,
    });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });

  it("does not cleanup when no rug present", () => {
    const s = makeState({ activeRugs: [], playerSkill: "Sweeper", sweeperFreeReady: true });
    expect(decide(s, makeConfig()).kind).toBe("bake");
  });

  it("bakes during Rush Order event (1.10x)", () => {
    const s = makeState({ effectiveMultiplierBps: 11000 });
    expect(decide(s, makeConfig({ minMultiplierBps: 10500 })).kind).toBe("bake");
  });

  it("sleeps when only Rush Order (1.10x) but threshold is Golden Batch (1.20x)", () => {
    const s = makeState({ effectiveMultiplierBps: 11000 });
    expect(decide(s, makeConfig({ minMultiplierBps: 12000 })).kind).toBe("sleep");
  });

  it("sleeps below threshold even when rug expired and skill is Sweeper", () => {
    const s = makeState({
      activeRugs: [],
      playerSkill: "Sweeper",
      sweeperFreeReady: true,
      effectiveMultiplierBps: 9000,
    });
    expect(decide(s, makeConfig({ minMultiplierBps: 10000 })).kind).toBe("sleep");
  });

  it("cleanup not chosen if cleanupCrewBoostTypeId is null (catalog unknown)", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      cleanupCrewBoostTypeId: null,
      effectiveMultiplierBps: 7000,
    });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });
});
