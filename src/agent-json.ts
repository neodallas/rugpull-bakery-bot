import { z } from "zod";

const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x + 40 hex")
  .transform((v) => v as `0x${string}`);

const BoostCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  isRandomEvent: z.boolean(),
  isCountermeasure: z.boolean(),
}).passthrough();

const BakeryTierSchema = z.object({
  tierId: z.number().int(),
  name: z.string(),
  enabled: z.boolean(),
  bakeCooldownBlocks: z.number().int().min(0),
}).passthrough();

const AgentJsonSchema = z.object({
  network: z.object({
    chainId: z.number().int(),
  }).passthrough(),
  contracts: z.object({
    bakery: AddressSchema,
    boostManager: AddressSchema,
    playerRegistry: AddressSchema,
    clanRegistry: AddressSchema,
  }).passthrough(),
  liveState: z.object({
    currentSeasonId: z.number().int(),
    vrfFeeWei: z.union([z.string(), z.number()]).transform((v) => String(v)),
    gameplayCaps: z.object({
      bakeryTiers: z.array(BakeryTierSchema),
    }).passthrough(),
    activeBoostCatalog: z.array(BoostCatalogEntrySchema),
  }).passthrough(),
}).passthrough();

export type BoostCatalogEntry = z.infer<typeof BoostCatalogEntrySchema>;
export type BakeryTier = z.infer<typeof BakeryTierSchema>;
export type AgentJson = z.infer<typeof AgentJsonSchema>;

const TTL_MS = 5 * 60 * 1000;
const URL = "https://www.rugpullbakery.com/agent.json";

let cache: { at: number; data: AgentJson } | null = null;

export async function getAgentJson(fetcher: typeof fetch = fetch): Promise<AgentJson> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetcher(URL);
    if (!res.ok) throw new Error(`agent.json HTTP ${res.status}`);
    const raw = await res.json();
    const data = AgentJsonSchema.parse(raw);
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
