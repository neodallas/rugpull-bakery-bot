import type { Config, State } from "../../src/types.js";

export function makeState(overrides: Partial<State> = {}): State {
  return {
    ethWei: 50_000_000_000_000_000n,
    blockNumber: 1000n,
    lastBakeBlock: 900n,
    effectiveMultiplierBps: 10000,
    activeRugs: [],
    playerSkill: "Sweeper",
    sweeperFreeReady: true,
    bakeCooldownBlocks: 5,
    vrfFeeWei: 100_000_000_000_000n,
    cleanupCrewBoostTypeId: 7,
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    clanId: 1,
    minMultiplierBps: 10000,
    pollIntervalMs: 15000,
    bakeCooldownBlocks: 5,
    minEthReserveWei: 5_000_000_000_000_000n,
    maxGasPerDayWei: 10_000_000_000_000_000n,
    maxVrfPerDayWei: 1_000_000_000_000_000n,
    maxBakesPerHour: 30,
    maxFailedTxConsecutive: 5,
    telegram: { chatId: "", botToken: "" },
    rpcUrl: "http://x",
    sessionKeyPrivateKey: "0x".padEnd(66, "1") as `0x${string}`,
    agwOwnerAddress: "0x".padEnd(42, "2") as `0x${string}`,
    ...overrides,
  };
}
