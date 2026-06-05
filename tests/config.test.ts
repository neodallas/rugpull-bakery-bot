import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const validRaw = {
  clanId: 42,
  minMultiplier: 1.15,
  pollIntervalMs: 15000,
  bakeCooldownBlocks: 5,
  minEthReserve: "0.005",
  maxGasPerDay: "0.01",
  maxVrfPerDay: "0.001",
  maxBakesPerHour: 30,
  maxFailedTxConsecutive: 5,
  telegram: { chatId: "123", tokenEnv: "TG_BOT_TOKEN" },
};

const validEnv = {
  ABSTRACT_RPC_URL: "https://api.mainnet.abs.xyz",
  SESSION_KEY_PRIVATE_KEY:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  AGW_OWNER_ADDRESS: "0x2222222222222222222222222222222222222222",
  TG_BOT_TOKEN: "bot-token",
};

describe("parseConfig", () => {
  it("converts ETH strings to wei bigints", () => {
    const cfg = parseConfig(validRaw, validEnv);
    expect(cfg.minEthReserveWei).toBe(5_000_000_000_000_000n);
    expect(cfg.maxGasPerDayWei).toBe(10_000_000_000_000_000n);
  });

  it("converts multiplier to bps", () => {
    const cfg = parseConfig(validRaw, validEnv);
    expect(cfg.minMultiplierBps).toBe(11500);
  });

  it("resolves telegram token from referenced env var", () => {
    const cfg = parseConfig(validRaw, validEnv);
    expect(cfg.telegram.botToken).toBe("bot-token");
  });

  it("rejects clanId 0 (not yet onboarded)", () => {
    expect(() => parseConfig({ ...validRaw, clanId: 0 }, validEnv)).toThrow(
      /clanId/
    );
  });

  it("rejects missing session key", () => {
    expect(() =>
      parseConfig(validRaw, { ...validEnv, SESSION_KEY_PRIVATE_KEY: "" })
    ).toThrow(/SESSION_KEY_PRIVATE_KEY/);
  });

  it("rejects malformed address", () => {
    expect(() =>
      parseConfig(validRaw, { ...validEnv, AGW_OWNER_ADDRESS: "not-an-address" })
    ).toThrow(/AGW_OWNER_ADDRESS/);
  });
});
