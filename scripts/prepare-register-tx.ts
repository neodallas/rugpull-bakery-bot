import { readFileSync } from "node:fs";
import { createPublicClient, http, type PublicClient } from "viem";
import { abstract } from "viem/chains";
import { prepareCreateSessionCall, type SessionConfig } from "@abstract-foundation/agw-client/sessions";

function hydrateSession(raw: unknown): SessionConfig {
  const r = raw as Record<string, unknown>;
  const fl = r.feeLimit as Record<string, unknown>;
  return {
    signer: r.signer as SessionConfig["signer"],
    expiresAt: BigInt(r.expiresAt as string),
    feeLimit: {
      limitType: fl.limitType as SessionConfig["feeLimit"]["limitType"],
      limit: BigInt(fl.limit as string),
      period: BigInt(fl.period as string),
    },
    callPolicies: (r.callPolicies as Array<Record<string, unknown>>).map((p) => {
      const vl = p.valueLimit as Record<string, unknown>;
      return {
        target: p.target as `0x${string}`,
        selector: p.selector as `0x${string}`,
        valueLimit: {
          limitType: vl.limitType as SessionConfig["feeLimit"]["limitType"],
          limit: BigInt(vl.limit as string),
          period: BigInt(vl.period as string),
        },
        maxValuePerUse: BigInt(p.maxValuePerUse as string),
        constraints: (p.constraints as SessionConfig["callPolicies"][number]["constraints"]) ?? [],
      };
    }),
    transferPolicies: (r.transferPolicies as SessionConfig["transferPolicies"]) ?? [],
  };
}

async function main() {
  const agwOwnerAddress = process.env.AGW_OWNER_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = process.env.ABSTRACT_RPC_URL ?? "https://api.mainnet.abs.xyz";
  if (!agwOwnerAddress) {
    console.error("AGW_OWNER_ADDRESS missing in env. Source .env or export it.");
    process.exit(1);
  }

  const sessionRaw = JSON.parse(readFileSync("data/session.json", "utf8"));
  const session = hydrateSession(sessionRaw);

  const publicClient = createPublicClient({ chain: abstract, transport: http(rpcUrl) }) as PublicClient;
  const call = await prepareCreateSessionCall(agwOwnerAddress, publicClient, session);

  console.log("=".repeat(70));
  console.log("createSession transaction parameters");
  console.log("=".repeat(70));
  console.log();
  console.log("From (your AGW):", agwOwnerAddress);
  console.log("To (target):    ", call.to);
  console.log("Value:          ", call.value?.toString() ?? "0", "wei");
  console.log();
  console.log("Data (calldata, paste this whole hex string):");
  console.log();
  console.log(call.data);
  console.log();
  console.log("=".repeat(70));
  console.log("How to submit");
  console.log("=".repeat(70));
  console.log();
  console.log("Option A — paste into AGW Portal:");
  console.log("  https://portal.abs.xyz (if available) → send raw tx with the");
  console.log("  parameters above. Confirm in the popup wallet.");
  console.log();
  console.log("Option B — via abscan.org:");
  console.log("  1) Open https://abscan.org/address/" + agwOwnerAddress);
  console.log("  2) If you see Write Contract, connect your wallet, find the");
  console.log("     'executeTransactions' or equivalent function, and paste");
  console.log("     a single Call: { target: <To>, value: <Value>, data: <Data> }.");
  console.log("  3) abscan UI varies — if the AGW is not verified, this option");
  console.log("     may not work. Falls back to Option C.");
  console.log();
  console.log("Option C — sign and submit via a small wagmi/viem one-liner:");
  console.log("  Use any wagmi-based app where your AGW is connected; send a tx");
  console.log("  with the (to, data, value) above. The wallet popup will ask you");
  console.log("  to confirm. After confirmation, the session is active.");
  console.log();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
