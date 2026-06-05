import { describe, expect, it } from "vitest";
import { isSweeperFreeReady } from "../src/sweeper-cooldown.js";
import type { SweeperCooldownState } from "../src/sweeper-cooldown.js";

const SIX_HOURS = 6 * 60 * 60;

describe("isSweeperFreeReady", () => {
  it("ready when no prior cleanup (lastFreeCleanupAtUnix = 0)", () => {
    const state: SweeperCooldownState = { lastFreeCleanupAtUnix: 0 };
    const now = Math.floor(Date.now() / 1000);
    expect(isSweeperFreeReady(state, now)).toBe(true);
  });

  it("ready after exactly 6 hours have elapsed", () => {
    const now = 1_700_000_000;
    const state: SweeperCooldownState = { lastFreeCleanupAtUnix: now - SIX_HOURS };
    expect(isSweeperFreeReady(state, now)).toBe(true);
  });

  it("not ready within 6 hours", () => {
    const now = 1_700_000_000;
    const state: SweeperCooldownState = { lastFreeCleanupAtUnix: now - SIX_HOURS + 1 };
    expect(isSweeperFreeReady(state, now)).toBe(false);
  });
});
