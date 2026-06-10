import { createPublicClient, http, type PublicClient } from "viem";
import type { BoostCatalogEntry } from "./agent-json.js";
import { getAgentJson } from "./agent-json.js";
import { BAKERY_READ_ABI } from "./abis.js";
import { readSweeperCooldown, isSweeperFreeReady } from "./sweeper-cooldown.js";
import { fetchBakeryEffects, computeEffectiveMultiplierBps, type Buff } from "./bakery-effects.js";
import type { Config, Debuff, State } from "./types.js";

const ABSTRACT_CHAIN_ID = 2741;
const DATA_DIR = "data";

/**
 * Thrown when SOME (but not all) of the batched chain reads fail. This is
 * distinguished from a hard error so main.ts can retry at normal cadence
 * instead of triggering exponential backoff — a single transient RPC
 * timeout shouldn't punish an otherwise-healthy bot for 60s.
 */
export class PartialReadError extends Error {
  readonly failures: string[];
  constructor(failures: string[]) {
    super(`partial read failure: ${failures.join(", ")}`);
    this.name = "PartialReadError";
    this.failures = failures;
  }
}

export function findCleanupCrewBoostTypeId(
  catalog: BoostCatalogEntry[]
): number | null {
  const hit = catalog.find(
    (b) => b.isCountermeasure && b.name.toLowerCase().includes("cleanup")
  );
  return hit != null ? Number(hit.id) : null;
}

export async function assertChainId(client: PublicClient): Promise<void> {
  const id = await client.getChainId();
  if (id !== ABSTRACT_CHAIN_ID) {
    throw new Error(`chain mismatch: RPC reports ${id}, expected ${ABSTRACT_CHAIN_ID}`);
  }
}

export type StateReader = {
  read: () => Promise<State>;
  publicClient: PublicClient;
};

export function createStateReader(cfg: Config): StateReader {
  const publicClient = createPublicClient({
    transport: http(cfg.rpcUrl),
  }) as PublicClient;

  return {
    publicClient,
    read: async (): Promise<State> => {
      const agent = await getAgentJson();
      const cleanupId = findCleanupCrewBoostTypeId(agent.liveState.activeBoostCatalog);

      const results = await Promise.allSettled([
        publicClient.getBalance({ address: cfg.agwOwnerAddress }),
        publicClient.getBlockNumber(),
        publicClient.readContract({
          address: agent.contracts.bakery,
          abi: BAKERY_READ_ABI,
          functionName: "lastBake",
          args: [cfg.agwOwnerAddress],
        }),
        fetchBakeryEffects(cfg.clanId, agent.liveState.currentSeasonId),
      ]);

      const labels = ["balance", "blockNumber", "lastBake", "bakeryEffects"];
      const failures: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") failures.push(labels[i]!);
      });
      if (failures.length === results.length) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      if (failures.length > 0) {
        throw new PartialReadError(failures);
      }

      const [ethWei, blockNumber, lastBakeBlockRaw, effects] = results.map(
        (r) => (r as PromiseFulfilledResult<unknown>).value
      );
      const effectsTyped = effects as { buffs: Buff[]; debuffs: Buff[] };

      const multiplier = computeEffectiveMultiplierBps(effectsTyped.buffs);
      const activeRugs: Debuff[] = effectsTyped.debuffs.map((d) => ({
        boostTypeId: d.boostTypeId,
        endTimeUnix: d.endTimeUnix,
        severityBps: d.multiplierBps,
      }));
      const activeBoosts: Debuff[] = effectsTyped.buffs.map((b) => ({
        boostTypeId: b.boostTypeId,
        endTimeUnix: b.endTimeUnix,
        severityBps: b.multiplierBps,
      }));

      // Skill is reported as "None" because the bot's session key has no
      // policy on BoostManager (purchaseBoost is not in the mainnet
      // SessionKeyPolicyRegistry, so it was omitted from the session). The
      // decision engine reads playerSkill to decide cleanup; "None" causes
      // the cleanup branch to be skipped entirely. Cleanup must be triggered
      // manually via the site (or by the site's separate auto-cooking session).
      const playerSkill = "None" as const;

      // Sweeper cooldown is still read for telemetry, but is never used to
      // trigger cleanup because playerSkill === "None" above.
      const cooldownState = readSweeperCooldown(DATA_DIR);
      const sweeperFreeReady = isSweeperFreeReady(cooldownState, Math.floor(Date.now() / 1000));

      // VRF fee from agent.json (string wei → bigint)
      const vrfFeeWei = BigInt(agent.liveState.vrfFeeWei);

      return {
        ethWei: ethWei as bigint,
        blockNumber: blockNumber as bigint,
        lastBakeBlock: lastBakeBlockRaw as bigint,
        effectiveMultiplierBps: multiplier,
        activeRugs,
        activeBoosts,
        playerSkill,
        sweeperFreeReady,
        bakeCooldownBlocks: cfg.bakeCooldownBlocks,
        vrfFeeWei,
        cleanupCrewBoostTypeId: cleanupId,
      };
    },
  };
}
