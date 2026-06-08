import { useState } from "react";
import { useAccount } from "wagmi";
import { useLoginWithAbstract, useGlobalWalletSignerClient } from "@abstract-foundation/agw-react";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import { LimitType, LimitUnlimited, type SessionConfig } from "@abstract-foundation/agw-client/sessions";
import { parseEther, toFunctionSelector, custom, http, type Address, type Hex } from "viem";
import { abstract } from "viem/chains";

const BAKERY_ADDRESS: Address = "0x30b49389D5271712b7e539a690B2F7b92afA3c31";
const SESSION_SIGNER: Address = "0x1584679D54Ee4607bFF631fbD5A01364FcE3B400";
const SESSION_EXPIRES_AT_UNIX = 1783323465n;
const ABSTRACT_RPC_URL = "https://api.mainnet.abs.xyz";

const SESSION_CONFIG: SessionConfig = {
  signer: SESSION_SIGNER,
  expiresAt: SESSION_EXPIRES_AT_UNIX,
  feeLimit: {
    limitType: LimitType.Lifetime,
    limit: parseEther("0.05"),
    period: 0n,
  },
  callPolicies: [
    {
      target: BAKERY_ADDRESS,
      selector: toFunctionSelector("function bake()") as Hex,
      valueLimit: LimitUnlimited,
      maxValuePerUse: 0n,
      constraints: [],
    },
    // NOTE: BoostManager.purchaseBoost(...) is NOT in callPolicies because
    // BoostManager is not registered in SessionKeyPolicyRegistry on Abstract
    // mainnet — the SDK rejects the createSession tx with
    // "Session key policy violation. Target: 0x4F97...; Status: Unset"
    // if we include it. The bot therefore cannot do automated Sweeper cleanup
    // through its session key — cleanup must be triggered manually via the
    // site (or via the site's auto-cooking session, which is on-chain anyway).
  ],
  transferPolicies: [],
};

const EXPECTED_AGW = "0x3b7714d090618eA6C0063546faE02b8E6a21Db3a";

export default function App() {
  const { address, isConnected } = useAccount();
  const { login, logout } = useLoginWithAbstract();
  const { data: signer } = useGlobalWalletSignerClient();

  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function submit() {
    setStatus("idle");
    setErrMsg(null);
    setIsPending(true);
    try {
      if (!signer?.account) throw new Error("No owner EOA signer available — reconnect AGW");
      if (!address) throw new Error("No AGW account address");
      // Build the AGW client manually with isPrivyCrossApp:false so createSession
      // signs locally via EIP-712 with the owner EOA and submits via sendRawTransaction.
      // useAbstractClient/useCreateSession hardcode isPrivyCrossApp:true which routes
      // through Privy's hosted cross-app bridge — that bridge auto-selects the active
      // site session and the policy validator rejects new SessionConfig targets it
      // wasn't authorised for.
      const ownerClient = await createAbstractClient({
        signer: signer.account,
        chain: abstract,
        transport: custom(signer.transport),
        publicTransport: http(ABSTRACT_RPC_URL),
        isPrivyCrossApp: false,
      });
      const result = await ownerClient.createSession({ session: SESSION_CONFIG, account: address as Address, chain: abstract });
      setTxHash(result.transactionHash ?? null);
      setStatus("ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrMsg(msg);
      setStatus("err");
    } finally {
      setIsPending(false);
    }
  }

  const styles = {
    wrap: { fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "40px auto", padding: 16 } as const,
    btn: { padding: "10px 16px", fontSize: 16, cursor: "pointer", borderRadius: 6, border: "1px solid #333", background: "#fff" } as const,
    primary: { padding: "10px 16px", fontSize: 16, cursor: "pointer", borderRadius: 6, border: "1px solid #1e40af", background: "#2563eb", color: "white" } as const,
    card: { padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16, fontFamily: "monospace", fontSize: 13, wordBreak: "break-all" as const, background: "#f9f9f9" } as const,
    warn: { color: "#b91c1c", marginTop: 12 } as const,
    ok: { color: "#15803d", marginTop: 12 } as const,
  };

  if (!isConnected) {
    return (
      <div style={styles.wrap}>
        <h1>Register Bot Session Key</h1>
        <p>Connect your Abstract Global Wallet (the same one you use on rugpullbakery.com) to register the bot's session key on-chain.</p>
        <button style={styles.primary} onClick={() => login()}>Connect AGW</button>
      </div>
    );
  }

  const wrongWallet = address && address.toLowerCase() !== EXPECTED_AGW.toLowerCase();
  const expiresIso = new Date(Number(SESSION_EXPIRES_AT_UNIX) * 1000).toISOString();

  return (
    <div style={styles.wrap}>
      <h1>Register Bot Session Key</h1>
      <p>Connected as <code>{address}</code> <button style={styles.btn} onClick={() => logout()}>Disconnect</button></p>
      {wrongWallet && (
        <div style={styles.warn}>
          ⚠ This wallet is not the AGW recorded in <code>.env</code> ({EXPECTED_AGW}). Disconnect and reconnect with the correct AGW.
        </div>
      )}
      <h3>Session policy</h3>
      <div style={styles.card}>
        <div><b>signer:</b> {SESSION_SIGNER}</div>
        <div><b>expires:</b> {expiresIso}</div>
        <div><b>fee cap:</b> 0.05 ETH lifetime</div>
        <div style={{ marginTop: 6 }}><b>allowed calls:</b></div>
        <div>&nbsp;&nbsp;• Bakery.bake() — value 0</div>
        <div style={{ marginTop: 6, color: "#666" }}>
          (BoostManager.purchaseBoost is intentionally omitted — it is not in
          SessionKeyPolicyRegistry on Abstract mainnet. Manual cleanup via site.)
        </div>
      </div>
      <p style={{ marginTop: 16 }}>
        <button
          style={styles.primary}
          disabled={isPending || wrongWallet === true || !signer?.account}
          onClick={submit}
        >
          {isPending ? "Submitting…" : "Submit createSession"}
        </button>
      </p>
      <p style={{ fontSize: 13, color: "#666" }}>
        Constructs an AGW client with <code>isPrivyCrossApp: false</code> so signing
        happens locally via the owner EOA (EIP-712), bypassing Privy's cross-app
        bridge — which is where active site sessions would otherwise auto-route the call.
      </p>
      {status === "ok" && txHash && (
        <div style={styles.ok}>
          ✓ Transaction sent! <a href={`https://abscan.org/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash}</a>
        </div>
      )}
      {status === "err" && (
        <div style={styles.warn}>
          ✗ Failed: <pre style={{ whiteSpace: "pre-wrap" }}>{errMsg}</pre>
        </div>
      )}
    </div>
  );
}
