import { readFileSync } from "node:fs";
import { parseEther } from "viem";
import { z } from "zod";
import type { Address, Config, Hex } from "./types.js";

const RawConfigSchema = z.object({
  clanId: z.number().int().positive("clanId must be set during onboarding"),
  minMultiplier: z.number().min(0.5).max(5),
  pollIntervalMs: z.number().int().min(1000).max(600000),
  bakeCooldownBlocks: z.number().int().min(1).max(1000),
  minEthReserve: z.string(),
  maxGasPerDay: z.string(),
  maxVrfPerDay: z.string(),
  maxBakesPerHour: z.number().int().nonnegative(),
  maxFailedTxConsecutive: z.number().int().positive(),
  telegram: z.object({
    chatId: z.string(),
    tokenEnv: z.string(),
  }),
});

const EnvSchema = z.object({
  ABSTRACT_RPC_URL: z.string().url(),
  SESSION_KEY_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "SESSION_KEY_PRIVATE_KEY must be 0x + 64 hex"),
  AGW_OWNER_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "AGW_OWNER_ADDRESS must be 0x + 40 hex"),
});

export function parseConfig(
  rawJson: unknown,
  env: Record<string, string | undefined>
): Config {
  const raw = RawConfigSchema.parse(rawJson);
  const parsedEnv = EnvSchema.parse(env);
  const botToken = env[raw.telegram.tokenEnv] ?? "";
  if (!botToken && raw.telegram.chatId) {
    throw new Error(
      `Telegram chatId set but env var ${raw.telegram.tokenEnv} is empty`
    );
  }
  return {
    clanId: raw.clanId,
    minMultiplierBps: Math.round(raw.minMultiplier * 10000),
    pollIntervalMs: raw.pollIntervalMs,
    bakeCooldownBlocks: raw.bakeCooldownBlocks,
    minEthReserveWei: parseEther(raw.minEthReserve),
    maxGasPerDayWei: parseEther(raw.maxGasPerDay),
    maxVrfPerDayWei: parseEther(raw.maxVrfPerDay),
    maxBakesPerHour: raw.maxBakesPerHour,
    maxFailedTxConsecutive: raw.maxFailedTxConsecutive,
    telegram: { chatId: raw.telegram.chatId, botToken },
    rpcUrl: parsedEnv.ABSTRACT_RPC_URL,
    sessionKeyPrivateKey: parsedEnv.SESSION_KEY_PRIVATE_KEY as Hex,
    agwOwnerAddress: parsedEnv.AGW_OWNER_ADDRESS as Address,
  };
}

export function loadConfigFromDisk(): Config {
  const rawJson = JSON.parse(readFileSync("config.json", "utf8"));
  return parseConfig(rawJson, process.env);
}

export function isDryRun(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes("--dry-run") || env.DRY_RUN === "1";
}
