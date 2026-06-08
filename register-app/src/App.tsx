import { useState } from "react";
import { useAccount } from "wagmi";
import { useLoginWithAbstract, useAbstractClient } from "@abstract-foundation/agw-react";

const TX_PARAMS = {
  to: "0x34ca1501FAE231cC2ebc995CE013Dbe882d7d081" as const,
  value: 0n,
  data: "0x5a0694d200000000000000000000000000000000000000000000000000000000000000200000000000000000000000001584679d54ee4607bff631fbd5a01364fce3b400000000000000000000000000000000000000000000000000000000006a4b5b49000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000b1a2bc2ec50000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000014000000000000000000000000030b49389d5271712b7e539a690b2f7b92afa3c31b0de262e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004f97015601863c256892e0a5e2710b48e149948c0ed20e950000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000038d7ea4c6800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as const,
} as const;

const EXPECTED_AGW = "0x3b7714d090618eA6C0063546faE02b8E6a21Db3a";

export default function App() {
  const { address, isConnected } = useAccount();
  const { login, logout } = useLoginWithAbstract();
  const { data: client } = useAbstractClient();

  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "err">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function submit() {
    if (!client) return;
    setStatus("pending");
    setErrMsg(null);
    try {
      const hash = await client.sendTransaction({
        to: TX_PARAMS.to,
        value: TX_PARAMS.value,
        data: TX_PARAMS.data,
      });
      setTxHash(hash);
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

  return (
    <div style={styles.wrap}>
      <h1>Register Bot Session Key</h1>
      <p>Connected as <code>{address}</code> <button style={styles.btn} onClick={() => logout()}>Disconnect</button></p>
      {wrongWallet && (
        <div style={styles.warn}>
          ⚠ This wallet is not the AGW recorded in <code>.env</code> ({EXPECTED_AGW}). Disconnect and reconnect with the correct AGW.
        </div>
      )}
      <h3>Transaction parameters</h3>
      <div style={styles.card}>
        <div><b>to:</b> {TX_PARAMS.to}</div>
        <div><b>value:</b> {TX_PARAMS.value.toString()} wei</div>
        <div><b>data:</b> {TX_PARAMS.data.slice(0, 66)}... ({TX_PARAMS.data.length / 2 - 1} bytes)</div>
      </div>
      <p style={{ marginTop: 16 }}>
        <button style={styles.primary} disabled={!client || status === "pending" || wrongWallet === true} onClick={submit}>
          {status === "pending" ? "Submitting…" : "Submit createSession"}
        </button>
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
