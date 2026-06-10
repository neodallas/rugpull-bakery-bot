import { z } from "zod";

const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x + 40 hex")
  .transform((v) => v as `0x${string}`);

// Defensive: tolerate null for boolean/number fields that the live API
// occasionally returns as null. We coerce to safe defaults so a single
// malformed catalog entry doesn't take down the whole agent.json parse
// and force a stale-cache fallback.
const boolOrNull = z.preprocess((v) => (v === null || v === undefined ? false : v), z.boolean());
const intOrNull = z.preprocess((v) => (v === null || v === undefined ? 0 : v), z.number().int());

const BoostCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  isRandomEvent: boolOrNull,
  isCountermeasure: boolOrNull,
}).passthrough();

const BakeryTierSchema = z.object({
  tierId: intOrNull,
  name: z.string(),
  enabled: boolOrNull,
  bakeCooldownBlocks: intOrNull.pipe(z.number().int().min(0)),
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
