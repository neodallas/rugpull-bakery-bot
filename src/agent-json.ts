export type BoostCatalogEntry = {
  id: string;
  name: string;
  type: string;
  isRandomEvent: boolean;
  isCountermeasure: boolean;
};

export type BakeryTier = {
  tierId: number;
  name: string;
  enabled: boolean;
  bakeCooldownBlocks: number;
};

export type AgentJson = {
  network: { chainId: number };
  contracts: {
    bakery: `0x${string}`;
    boostManager: `0x${string}`;
    playerRegistry: `0x${string}`;
    clanRegistry: `0x${string}`;
  };
  liveState: {
    currentSeasonId: number;
    vrfFeeWei: string;
    gameplayCaps: {
      bakeryTiers: BakeryTier[];
    };
    activeBoostCatalog: BoostCatalogEntry[];
  };
};

const TTL_MS = 5 * 60 * 1000;
const URL = "https://www.rugpullbakery.com/agent.json";

let cache: { at: number; data: AgentJson } | null = null;

export async function getAgentJson(fetcher: typeof fetch = fetch): Promise<AgentJson> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetcher(URL);
    if (!res.ok) throw new Error(`agent.json HTTP ${res.status}`);
    const data = (await res.json()) as AgentJson;
    cache = { at: now, data };
    return data;
  } catch (err) {
    if (cache) return cache.data;
    throw err;
  }
}

export function _resetAgentJsonCacheForTests(): void {
  cache = null;
}
