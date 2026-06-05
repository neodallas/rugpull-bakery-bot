import { createSessionClient } from "@abstract-foundation/agw-client/sessions";
import type { SessionConfig, SessionClient } from "@abstract-foundation/agw-client/sessions";
import { privateKeyToAccount } from "viem/accounts";
import { http } from "viem";
import { abstract } from "viem/chains";
import type { Config } from "./types.js";

// Re-export the SDK's SessionClient type so downstream modules can reference it.
export type { SessionClient };

/**
 * SessionSigner is the concrete client returned by createSessionClient.
 * Downstream code (executor, main loop) can call writeContract / sendTransaction
 * on this object; every tx is signed with the session-key private key and
 * validated against the on-chain session policy.
 */
export type SessionSigner = SessionClient;

/**
 * Construct an AGW session client from the bot config and an already-registered
 * SessionConfig.
 *
 * The `session` parameter must match the SessionConfig that was submitted
 * on-chain when the session key was created (Task 0 / onboarding).
 *
 * NOTE: createSessionClient (SDK v1.12.x) requires the full SessionConfig to
 * be passed at construction time so it can embed the policy into every EIP-712
 * signature.  It is not possible to construct the client without this argument.
 */
export function createSessionSigner(
  cfg: Config,
  session: SessionConfig,
): SessionSigner {
  const signer = privateKeyToAccount(cfg.sessionKeyPrivateKey);
  return createSessionClient({
    account: cfg.agwOwnerAddress,
    chain: abstract,
    signer,
    transport: http(cfg.rpcUrl),
    session,
  });
}
