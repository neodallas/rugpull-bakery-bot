import { useState } from "react";
import { useAccount } from "wagmi";
import { useLoginWithAbstract, useCreateSession } from "@abstract-foundation/agw-react";
import { LimitType, LimitUnlimited, type SessionConfig } from "@abstract-foundation/agw-client/sessions";
import { parseEther, toFunctionSelector, type Address, type Hex } from "viem";

const BAKERY_ADDRESS: Address = "0x30b49389D5271712b7e539a690B2F7b92afA3c31";
const BOOST_MANAGER_ADDRESS: Address = "0x4F97015601863C256892e0a5e2710b48E149948C";
const SESSION_SIGNER: Address = "0x1584679D54Ee4607bFF631fbD5A01364FcE3B400";
const SESSION_EXPIRES_AT_UNIX = 1783323465n;

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
    {
      target: BOOST_MANAGER_ADDRESS,
      selector: toFunctionSelector("function purchaseBoost(uint256,uint256)") as Hex,
      valueLimit: LimitUnlimited,
      maxValuePerUse: parseEther("0.001"),
      constraints: [],
    },
  ],
  transferPolicies: [],
};

const EXPECTED_AGW = "0x3b7714d090618eA6C0063546faE02b8E6a21Db3a";

export default function App() {
  const { address, isConnected } = useAccount();
  const { login, logout } = useLoginWithAbstract();
  const { createSessionAsync, isPending } = useCreateSession();

  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function submit() {
    setStatus("idle");
    setErrMsg(null);
    try {
      const result = await createSessionAsync({ session: SESSION_CONFIG });
      setTxHash(result.transactionHash ?? null);
      setStatus("ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrMsg(msg);
      setStatus("err");
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
        <div>&nbsp;&nbsp;• BoostManager.purchaseBoost(uint256,uint256) — max value 0.001 ETH</div>
      </div>
      <p style={{ marginTop: 16 }}>
        <button
          style={styles.primary}
          disabled={isPending || wrongWallet === true}
          onClick={submit}
        >
          {isPending ? "Submitting…" : "Submit createSession"}
        </button>
      </p>
      <p style={{ fontSize: 13, color: "#666" }}>
        Uses the SDK's <code>useCreateSession</code> hook, which routes signing through your AGW owner key (not any active site session).
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
