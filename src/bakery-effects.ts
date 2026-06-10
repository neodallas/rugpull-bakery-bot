/**
 * Fetches the live bakery effects (active buffs, debuffs, upgrades) from the
 * site's TRPC API. We use this as the source of truth for the effective bake
 * multiplier because the on-chain BoostManager.getEffectiveMultiplier read
 * returns only the base value, not the value the game UI actually displays
 * (which includes Chef's Help / random events / upgrades).
 */

const TRPC_URL = "https://www.rugpullbakery.com/api/trpc/leaderboard.getBakeryEffects?batch=1";

export type Buff = {
  boostTypeId: number;
  name: string;
  multiplierBps: number;
  bakeOutputBoostBps: number;
  isShield: boolean;
  isRandomEvent: boolean;
  startTimeUnix: number;
  endTimeUnix: number;
};

export type Debuff = Buff;

export type BakeryEffects = {
  buffs: Buff[];
  debuffs: Debuff[];
};

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
}

function parseBuff(raw: Record<string, unknown>): Buff {
  return {
    boostTypeId: toNum(raw.boostTypeId),
    name: typeof raw.name === "string" ? raw.name : "",
    multiplierBps: toNum(raw.multiplierBps),
    bakeOutputBoostBps: toNum(raw.bakeOutputBoostBps),
    isShield: raw.isShield === true,
    isRandomEvent: raw.isRandomEvent === true,
    startTimeUnix: toNum(raw.startTime),
    endTimeUnix: toNum(raw.endTime),
  };
}

export async function fetchBakeryEffects(
  bakeryId: number,
  seasonId: number,
  fetcher: typeof fetch = fetch,
): Promise<BakeryEffects> {
  const body = JSON.stringify({ "0": { json: { bakeryId, seasonId } } });
  const res = await fetcher(TRPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
  });
  if (!res.ok) {
    throw new Error(`getBakeryEffects HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;

  // trpc batch response is an array; entry [0].result.data.json or
  // [{ result: { data: { ... } } }] depending on superjson serialization.
  let payload: Record<string, unknown> | null = null;
  if (Array.isArray(json) && json[0] != null) {
    const first = json[0] as Record<string, unknown>;
    const result = first.result as Record<string, unknown> | undefined;
    const data = result?.data as Record<string, unknown> | undefined;
    const inner = (data?.json as Record<string, unknown> | undefined) ?? data;
    if (inner && typeof inner === "object") payload = inner;
  }
  if (!payload) {
    throw new Error(`getBakeryEffects: unexpected response shape`);
  }

  const buffsRaw = Array.isArray(payload.buffs) ? (payload.buffs as Array<Record<string, unknown>>) : [];
  const debuffsRaw = Array.isArray(payload.debuffs) ? (payload.debuffs as Array<Record<string, unknown>>) : [];

  return {
    buffs: buffsRaw.map(parseBuff),
    debuffs: debuffsRaw.map(parseBuff),
  };
}

/**
 * Compute the effective bake multiplier (in bps) the way the UI does:
 * base 1.0x (10000 bps), plus the strongest active boost overrides it. This
 * matches the "Net baking: 2x (+100%)" display the site shows when Chef's
 * Help is active.
 */
export function computeEffectiveMultiplierBps(buffs: Buff[]): number {
  let max = 10000;
  for (const b of buffs) {
    if (b.multiplierBps > max) max = b.multiplierBps;
  }
  return max;
}
