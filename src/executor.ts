import type { PublicClient } from "viem";
import { BOOST_MANAGER_READ_ABI, BAKERY_WRITE_ABI } from "./abis.js";
import type { Logger } from "./logger.js";
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

function classifyRevert(message: string): { expected: boolean; reason: string } {
  const reason = message.slice(0, 200);
  for (const hint of EXPECTED_REVERT_HINTS) {
    if (message.includes(hint)) return { expected: true, reason: hint };
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
}): Executor {
  const { cfg, publicClient, signer, agentContracts, log } = opts;

  async function send(
    description: string,
    txHash: Promise<Hex>,
    vrfPaidWei: bigint
  ): Promise<TxResult> {
    try {
      const hash = await txHash;
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      const gasUsedWei = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
      if (receipt.status !== "success") {
        const reason = `${description} reverted on-chain (post-simulation race)`;
        log.warn("tx reverted", { description, txHash: hash, reason });
        return { ok: false, reason, expected: false };
      }
      log.info("tx ok", { description, txHash: hash, gasUsedWei, vrfPaidWei });
      return { ok: true, txHash: hash, gasUsedWei, vrfPaidWei };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { expected, reason } = classifyRevert(msg);
      log.warn("tx failed", { description, reason, expected });
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
