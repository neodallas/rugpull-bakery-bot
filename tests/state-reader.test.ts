import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetAgentJsonCacheForTests, getAgentJson } from "../src/agent-json.js";

afterEach(() => {
  _resetAgentJsonCacheForTests();
  vi.useRealTimers();
});

const sampleAgentJson = {
  network: { chainId: 2741 },
  contracts: {
    bakery: "0xaaaa000000000000000000000000000000000000",
    boostManager: "0xbbbb000000000000000000000000000000000000",
    playerRegistry: "0xcccc000000000000000000000000000000000000",
    clanRegistry: "0xdddd000000000000000000000000000000000000",
  },
  liveState: {
    currentSeasonId: 10,
    vrfFeeWei: "24006155000000",
    gameplayCaps: {
      bakeryTiers: [
        { tierId: 1, name: "Grouped", enabled: true, bakeCooldownBlocks: 5 },
        { tierId: 2, name: "Open", enabled: true, bakeCooldownBlocks: 1 },
      ],
    },
    activeBoostCatalog: [
      { id: "9", name: "Cleanup Crew", type: "boost", isRandomEvent: false, isCountermeasure: true },
      { id: "11", name: "Stink Bomb", type: "boost", isRandomEvent: false, isCountermeasure: false },
    ],
  },
};

describe("getAgentJson", () => {
  it("fetches and caches", async () => {
    const fetcher = vi.fn(async () =>
      ({ ok: true, json: async () => sampleAgentJson } as unknown as Response)
    );
    const a = await getAgentJson(fetcher);
    const b = await getAgentJson(fetcher);
    expect(a).toEqual(sampleAgentJson);
    expect(b).toEqual(sampleAgentJson);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const fetcher = vi.fn(async () =>
      ({ ok: true, json: async () => sampleAgentJson } as unknown as Response)
    );
    await getAgentJson(fetcher);
    vi.setSystemTime(new Date("2026-06-05T10:06:00Z"));
    await getAgentJson(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns stale cache when network fails", async () => {
    const okFetcher = vi.fn(async () =>
      ({ ok: true, json: async () => sampleAgentJson } as unknown as Response)
    );
    await getAgentJson(okFetcher);
    _resetAgentJsonCacheForTests();
    await getAgentJson(okFetcher);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T11:00:00Z"));
    const failFetcher = vi.fn(async () => {
      throw new Error("net down");
    });
    const result = await getAgentJson(failFetcher);
    expect(result.network.chainId).toBe(2741);
  });

  it("throws when no cache and network fails", async () => {
    const failFetcher = vi.fn(async () => {
      throw new Error("net down");
    });
    await expect(getAgentJson(failFetcher)).rejects.toThrow("net down");
  });
});

describe("findCleanupCrewBoostTypeId", () => {
  it("returns numeric id parsed from string id for matching entry", async () => {
    const { findCleanupCrewBoostTypeId } = await import("../src/state-reader.js");
    expect(findCleanupCrewBoostTypeId(sampleAgentJson.liveState.activeBoostCatalog)).toBe(9);
  });

  it("returns null when not in catalog", async () => {
    const { findCleanupCrewBoostTypeId } = await import("../src/state-reader.js");
    expect(
      findCleanupCrewBoostTypeId([
        { id: "1", name: "Other", type: "boost", isRandomEvent: false, isCountermeasure: false },
      ])
    ).toBeNull();
  });
});

describe("PartialReadError", () => {
  it("is exported and constructable with failures list", async () => {
    const { PartialReadError } = await import("../src/state-reader.js");
    const e = new PartialReadError(["balance", "blockNumber"]);
    expect(e.name).toBe("PartialReadError");
    expect(e.failures).toEqual(["balance", "blockNumber"]);
    expect(e.message).toContain("balance");
  });
});

describe("agent.json zod validation", () => {
  it("rejects missing contracts field", async () => {
    const { _resetAgentJsonCacheForTests, getAgentJson } = await import("../src/agent-json.js");
    _resetAgentJsonCacheForTests();
    const fetcher = vi.fn(async () =>
      ({ ok: true, json: async () => ({ network: { chainId: 2741 }, liveState: {} }) } as unknown as Response)
    );
    await expect(getAgentJson(fetcher)).rejects.toThrow();
  });
  it("rejects invalid bakery address shape", async () => {
    const { _resetAgentJsonCacheForTests, getAgentJson } = await import("../src/agent-json.js");
    _resetAgentJsonCacheForTests();
    const fetcher = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          network: { chainId: 2741 },
          contracts: {
            bakery: "not-an-address",
            boostManager: "0xaaaa000000000000000000000000000000000000",
            playerRegistry: "0xaaaa000000000000000000000000000000000000",
            clanRegistry: "0xaaaa000000000000000000000000000000000000",
          },
          liveState: { currentSeasonId: 10, vrfFeeWei: "0", gameplayCaps: { bakeryTiers: [] }, activeBoostCatalog: [] },
        }),
      } as unknown as Response)
    );
    await expect(getAgentJson(fetcher)).rejects.toThrow();
  });
  it("accepts valid shape with extra unknown fields (passthrough)", async () => {
    const { _resetAgentJsonCacheForTests, getAgentJson } = await import("../src/agent-json.js");
    _resetAgentJsonCacheForTests();
    const fetcher = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          name: "Bakery",  // unknown field at top level
          network: { chainId: 2741, extra: 1 },
          contracts: {
            bakery: "0xaaaa000000000000000000000000000000000000",
            boostManager: "0xbbbb000000000000000000000000000000000000",
            playerRegistry: "0xcccc000000000000000000000000000000000000",
            clanRegistry: "0xdddd000000000000000000000000000000000000",
          },
          liveState: { currentSeasonId: 10, vrfFeeWei: "0", gameplayCaps: { bakeryTiers: [] }, activeBoostCatalog: [] },
        }),
      } as unknown as Response)
    );
    const result = await getAgentJson(fetcher);
    expect(result.network.chainId).toBe(2741);
  });
});
