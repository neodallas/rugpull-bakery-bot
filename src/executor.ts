import type { PublicClient } from "viem";
import { BOOST_MANAGER_READ_ABI, BAKERY_WRITE_ABI } from "./abis.js";
import type { Logger } from "./logger.js";
import { clearPending, writePending } from "./pending-tx.js";
import type { SessionSigner } from "./session-key.js";
import type { Action, Config, Hex, TxResult } from "./types.js";

const BOOST_MANAGER_WRITE_ABI = [
  ...BOOST_MANAGER_READ_ABI,
  {
    type: "function",
    name: "purchaseBoost",
    stateMutability: "payable",
    inputs: [
      { name: "clanId", type: "uint256" },
      { name: "boostTypeId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const EXPECTED_REVERT_HINTS = [
  "BakeTooSoon",
  "WhoaSlowDown",
  "BoostCooldown",
  "InsufficientCookies",
  "RugProtection",
  "ApprovalRequired",
];

const INVALID_SESSION_HINTS = [
  "Session expired",
  "Session revoked",
  "Unauthorized",
  "InvalidSignature",
  "SessionKeyValidator",
];

export function isInvalidSessionError(message: string): boolean {
  const m = message.toLowerCase();
  return INVALID_SESSION_HINTS.some((h) => m.includes(h.toLowerCase()));
}

let configuredRpcUrl: string | null = null;

/**
 * Records the configured RPC URL so `sanitizeReason` can strip it from any
 * error message before that message is surfaced to Telegram. RPC URLs
 * (e.g. Alchemy-style `https://x.g.alchemy.com/v2/SECRET`) can carry an
 * embedded API key — if a network error message echoes the URL back, that
 * key must never reach chat history.
 */
export function setRpcUrlForReasonSanitization(url: string): void {
  configuredRpcUrl = url || null;
}

export function sanitizeReason(message: string): string {
  let out = message;
  // Strip the configured RPC URL specifically (most likely place a secret could appear)
  if (configuredRpcUrl) {
    out = out.split(configuredRpcUrl).join("[RPC]");
  }
  // Defensive: strip any URL with a long-ish path segment (looks like an API key)
  out = out.replace(/https?:\/\/[^\s"']*\/[a-zA-Z0-9_-]{16,}[^\s"']*/g, "[URL-WITH-KEY]");
  return out;
}

export function classifyRevert(message: string): { expected: boolean; reason: string } {
  const reason = sanitizeReason(message).slice(0, 200);
  const m = message.toLowerCase();
  for (const hint of EXPECTED_REVERT_HINTS) {
    if (m.includes(hint.toLowerCase())) return { expected: true, reason: hint };
  }
  return { expected: false, reason };
}

export type Executor = {
  execute: (
    action: Action,
    args: { clanId: number; cleanupBoostTypeId: number | null; vrfFeeWei: bigint }
  ) => Promise<TxResult>;
};

export function createExecutor(opts: {
  cfg: Config;
  publicClient: PublicClient;
  signer: SessionSigner;
  agentContracts: { boostManager: Hex; bakery: Hex };
  log: Logger;
  dataDir: string;
}): Executor {
  const { cfg, publicClient, signer, agentContracts, log, dataDir } = opts;
  setRpcUrlForReasonSanitization(cfg.rpcUrl);

  async function send(
    description: string,
    txHash: Promise<Hex>,
    vrfPaidWei: bigint
  ): Promise<TxResult> {
    try {
      const hash = await txHash;
      writePending(dataDir, {
        kind: description as "bake" | "cleanup",
        txHash: hash,
        broadcastAtUnix: Math.floor(Date.now() / 1000),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      const gasUsedWei = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
      if (receipt.status !== "success") {
        const reason = `${description} reverted on-chain (post-simulation race)`;
        log.warn("tx reverted", { description, txHash: hash, reason });
        clearPending(dataDir);
        return { ok: false, reason, expected: false };
      }
      log.info("tx ok", { description, txHash: hash, gasUsedWei, vrfPaidWei });
      clearPending(dataDir);
      return { ok: true, txHash: hash, gasUsedWei, vrfPaidWei };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { expected, reason } = classifyRevert(msg);
      log.warn("tx failed", { description, reason, expected });
      clearPending(dataDir);
      return { ok: false, reason, expected };
    }
  }

  async function simulateOrAbort(
    address: Hex,
    abi: unknown,
    functionName: string,
    args: readonly unknown[],
    value: bigint
  ): Promise<{ ok: true } | { ok: false; classified: { expected: boolean; reason: string } }> {
    try {
      await publicClient.simulateContract({
        address,
        abi: abi as never,
        functionName: functionName as never,
        args: args as never,
        account: cfg.agwOwnerAddress,
        value,
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, classified: classifyRevert(msg) };
    }
  }

  return {
    execute: async (action, { clanId, cleanupBoostTypeId, vrfFeeWei }) => {
      if (action.kind === "sleep") {
        return { ok: false, reason: "sleep", expected: true };
      }
      if (action.kind === "bake") {
        const sim = await simulateOrAbort(
          agentContracts.bakery,
          BAKERY_WRITE_ABI,
          "bake",
          [],
          0n
        );
        if (!sim.ok) {
          log.info("bake sim revert; skipping send", sim.classified);
          return { ok: false, ...sim.classified };
        }
        return send(
          "bake",
          (signer as unknown as {
            writeContract: (a: unknown) => Promise<Hex>;
          }).writeContract({
            address: agentContracts.bakery,
            abi: BAKERY_WRITE_ABI,
            functionName: "bake",
            args: [],
          }),
          0n
        );
      }
      if (action.kind === "cleanup") {
        if (cleanupBoostTypeId === null) {
          return { ok: false, reason: "cleanup boost id unknown", expected: false };
        }
        const sim = await simulateOrAbort(
          agentContracts.boostManager,
          BOOST_MANAGER_WRITE_ABI,
          "purchaseBoost",
          [BigInt(clanId), BigInt(cleanupBoostTypeId)],
          vrfFeeWei
        );
        if (!sim.ok) {
          log.info("cleanup sim revert; skipping send", sim.classified);
          return { ok: false, ...sim.classified };
        }
        return send(
          "cleanup",
          (signer as unknown as {
            writeContract: (a: unknown) => Promise<Hex>;
          }).writeContract({
            address: agentContracts.boostManager,
            abi: BOOST_MANAGER_WRITE_ABI,
            functionName: "purchaseBoost",
            args: [BigInt(clanId), BigInt(cleanupBoostTypeId)],
            value: vrfFeeWei,
          }),
          vrfFeeWei
        );
      }
      return { ok: false, reason: "unknown action kind", expected: false };
    },
  };
}
