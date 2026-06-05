import { createPublicClient, http, type PublicClient } from "viem";
import type { AgentJson } from "./agent-json.js";
import { getAgentJson } from "./agent-json.js";
import {
  BOOST_MANAGER_READ_ABI,
  PLAYER_REGISTRY_READ_ABI,
  PLAYER_SKILLS_READ_ABI,
  SKILL_ID_TO_NAME,
} from "./abis.js";
import type { Address, Config, Debuff, SkillId, State } from "./types.js";

const ABSTRACT_CHAIN_ID = 2741;

export function findCleanupCrewBoostTypeId(
  catalog: AgentJson["boostCatalog"]
): number | null {
  const hit = catalog.find(
    (b) => b.isCountermeasure && b.name.toLowerCase().includes("cleanup")
  );
  return hit?.typeId ?? null;
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
      const cleanupId = findCleanupCrewBoostTypeId(agent.boostCatalog);

      const [
        ethWei,
        blockNumber,
        multiplier,
        rawRugs,
        rawBoosts,
        vrfFeeWei,
        lastBakeBlockRaw,
        skillIdRaw,
        sweeperReadyAt,
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
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getVrfFee",
          args: [],
        }),
        publicClient.readContract({
          address: agent.contracts.playerRegistry,
          abi: PLAYER_REGISTRY_READ_ABI,
          functionName: "lastBakeBlock",
          args: [cfg.agwOwnerAddress],
        }),
        publicClient.readContract({
          address: agent.contracts.playerSkills,
          abi: PLAYER_SKILLS_READ_ABI,
          functionName: "getPlayerSkill",
          args: [cfg.agwOwnerAddress, BigInt(agent.seasonId)],
        }),
        publicClient.readContract({
          address: agent.contracts.playerSkills,
          abi: PLAYER_SKILLS_READ_ABI,
          functionName: "getSweeperFreeReadyAt",
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

      const playerSkill: SkillId =
        SKILL_ID_TO_NAME[Number(skillIdRaw)] ?? "None";
      const sweeperFreeReady =
        playerSkill === "Sweeper" &&
        Math.floor(Date.now() / 1000) >= Number(sweeperReadyAt);

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
        vrfFeeWei: vrfFeeWei as bigint,
        cleanupCrewBoostTypeId: cleanupId,
      };
    },
  };
}
