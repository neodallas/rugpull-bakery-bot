import { createPublicClient, http, type PublicClient } from "viem";
import type { BoostCatalogEntry } from "./agent-json.js";
import { getAgentJson } from "./agent-json.js";
import { BOOST_MANAGER_READ_ABI, BAKERY_READ_ABI } from "./abis.js";
import { readSweeperCooldown, isSweeperFreeReady } from "./sweeper-cooldown.js";
import type { Address, Config, Debuff, State } from "./types.js";

const ABSTRACT_CHAIN_ID = 2741;
const DATA_DIR = "data";

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

      const [
        ethWei,
        blockNumber,
        multiplier,
        rawRugs,
        rawBoosts,
        lastBakeBlockRaw,
      ] = await Promise.all([
        publicClient.getBalance({ address: cfg.agwOwnerAddress }),
        publicClient.getBlockNumber(),
        publicClient.readContract({
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getEffectiveMultiplier",
          args: [BigInt(cfg.clanId)],
        }),
        publicClient.readContract({
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getActiveDebuffs",
          args: [BigInt(cfg.clanId)],
        }),
        publicClient.readContract({
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getActiveBoosts",
          args: [BigInt(cfg.clanId)],
        }),
        publicClient.readContract({
          address: agent.contracts.bakery,
          abi: BAKERY_READ_ABI,
          functionName: "lastBakeBlock",
          args: [cfg.agwOwnerAddress],
        }),
      ]);

      const activeRugs: Debuff[] = (rawRugs as Array<{
        boostTypeId: bigint;
        endTimeUnix: bigint;
        severityBps: bigint;
      }>).map((r) => ({
        boostTypeId: Number(r.boostTypeId),
        endTimeUnix: Number(r.endTimeUnix),
        severityBps: Number(r.severityBps),
      }));

      const activeBoosts: Debuff[] = (rawBoosts as Array<{
        boostTypeId: bigint;
        endTimeUnix: bigint;
        severityBps: bigint;
      }>).map((b) => ({
        boostTypeId: Number(b.boostTypeId),
        endTimeUnix: Number(b.endTimeUnix),
        severityBps: Number(b.severityBps),
      }));

      // Skill is always Sweeper — onboarding invariant
      const playerSkill = "Sweeper" as const;

      // Sweeper free-cleanup cooldown tracked locally
      const cooldownState = readSweeperCooldown(DATA_DIR);
      const sweeperFreeReady = isSweeperFreeReady(cooldownState, Math.floor(Date.now() / 1000));

      // VRF fee from agent.json (string wei → bigint)
      const vrfFeeWei = BigInt(agent.liveState.vrfFeeWei);

      return {
        ethWei: ethWei as bigint,
        blockNumber: blockNumber as bigint,
        lastBakeBlock: lastBakeBlockRaw as bigint,
        effectiveMultiplierBps: Number(multiplier),
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
