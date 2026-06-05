export type AgentJson = {
  chainId: number;
  seasonId: number;
  contracts: {
    boostManager: `0x${string}`;
    playerRegistry: `0x${string}`;
    playerSkills: `0x${string}`;
    clanRegistry: `0x${string}`;
  };
  boostCatalog: Array<{
    typeId: number;
    name: string;
    isRandomEvent: boolean;
    isCountermeasure: boolean;
  }>;
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
