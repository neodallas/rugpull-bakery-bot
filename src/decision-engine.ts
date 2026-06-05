import type { Action, Config, State } from "./types.js";

export function decide(s: State, cfg: Config): Action {
  if (s.ethWei < cfg.minEthReserveWei) {
    return { kind: "sleep", reason: "low ETH" };
  }
  if (s.blockNumber - s.lastBakeBlock < BigInt(s.bakeCooldownBlocks)) {
    return { kind: "sleep", reason: "cooldown" };
  }
  const hasRug = s.activeRugs.length > 0;
  if (
    hasRug &&
    s.playerSkill === "Sweeper" &&
    s.sweeperFreeReady &&
    s.cleanupCrewBoostTypeId !== null
  ) {
    return { kind: "cleanup" };
  }
  if (s.effectiveMultiplierBps >= cfg.minMultiplierBps) {
    return { kind: "bake" };
  }
  return { kind: "sleep", reason: "multiplier below threshold" };
}
