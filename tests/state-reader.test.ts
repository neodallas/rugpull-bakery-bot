import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetAgentJsonCacheForTests, getAgentJson } from "../src/agent-json.js";

afterEach(() => {
  _resetAgentJsonCacheForTests();
  vi.useRealTimers();
});

const sampleAgentJson = {
  chainId: 2741,
  seasonId: 10,
  contracts: {
    boostManager: "0xaaaa000000000000000000000000000000000000",
    playerRegistry: "0xbbbb000000000000000000000000000000000000",
    playerSkills: "0xcccc000000000000000000000000000000000000",
    clanRegistry: "0xdddd000000000000000000000000000000000000",
  },
  boostCatalog: [
    { typeId: 7, name: "Cleanup Crew", isRandomEvent: false, isCountermeasure: true },
    { typeId: 11, name: "Stink Bomb", isRandomEvent: false, isCountermeasure: false },
  ],
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
    expect(result.chainId).toBe(2741);
  });

  it("throws when no cache and network fails", async () => {
    const failFetcher = vi.fn(async () => {
      throw new Error("net down");
    });
    await expect(getAgentJson(failFetcher)).rejects.toThrow("net down");
  });
});

describe("findCleanupCrewBoostTypeId", () => {
  it("returns matching typeId by name", async () => {
    const { findCleanupCrewBoostTypeId } = await import("../src/state-reader.js");
    expect(findCleanupCrewBoostTypeId(sampleAgentJson.boostCatalog)).toBe(7);
  });

  it("returns null when not in catalog", async () => {
    const { findCleanupCrewBoostTypeId } = await import("../src/state-reader.js");
    expect(
      findCleanupCrewBoostTypeId([
        { typeId: 1, name: "Other", isRandomEvent: false, isCountermeasure: false },
      ])
    ).toBeNull();
  });
});
