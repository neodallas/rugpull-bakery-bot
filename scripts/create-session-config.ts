import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toFunctionSelector, parseEther, type Address, type Hex } from "viem";
import {
  LimitType,
  LimitUnlimited,
  type SessionConfig,
} from "@abstract-foundation/agw-client/sessions";

const BAKERY_ADDRESS: Address = "0x30b49389D5271712b7e539a690B2F7b92afA3c31";
// NOTE: BoostManager was intentionally removed from callPolicies on
// 2026-06-11 because it is not registered in SessionKeyPolicyRegistry on
// Abstract mainnet. Including it causes the SDK / on-chain validator to
// reject the session every time (signed-hash mismatch vs registered
// policy). Cleanup-via-bot is therefore disabled — use site UI instead.
const SESSION_DURATION_DAYS = 30;
const SESSION_FEE_LIMIT_ETH = "0.05"; // Lifetime fee cap for this session

function main() {
  // 1. Generate a fresh session-key pair
  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);

  // 2. Compute selectors via viem — never hardcoded so a sig change is one edit away
  const bakeSelector = toFunctionSelector("function bake()") as Hex;

  // 3. Compute expiresAt
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = BigInt(now + SESSION_DURATION_DAYS * 24 * 60 * 60);

  // 4. Build SessionConfig
  const sessionConfig: SessionConfig = {
    signer: sessionAccount.address,
    expiresAt,
    feeLimit: {
      limitType: LimitType.Lifetime,
      limit: parseEther(SESSION_FEE_LIMIT_ETH),
      period: 0n,
    },
    callPolicies: [
      {
        target: BAKERY_ADDRESS,
        selector: bakeSelector,
        valueLimit: LimitUnlimited,
        maxValuePerUse: 0n,
        constraints: [],
      },
    ],
    transferPolicies: [],
  };

  // 5. Persist
  if (!existsSync("data")) mkdirSync("data", { recursive: true });
  const sessionConfigJson = JSON.stringify(
    sessionConfig,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
  writeFileSync("data/session.json", sessionConfigJson);

  // 6. Stdout
  console.log("=".repeat(70));
  console.log("Session key created. Take these two values and stop reading.");
  console.log("=".repeat(70));
  console.log();
  console.log("1) Add to .env (treat this like a wallet key — never commit):");
  console.log();
  console.log(`SESSION_KEY_PRIVATE_KEY=${sessionPrivateKey}`);
  console.log();
  console.log("2) SessionConfig was written to data/session.json.");
  console.log();
  console.log("Session details:");
  console.log(`  signer:    ${sessionAccount.address}`);
  console.log(
    `  expiresAt: ${new Date(Number(expiresAt) * 1000).toISOString()}`
  );
  console.log(`  fee cap:   ${SESSION_FEE_LIMIT_ETH} ETH (lifetime)`);
  console.log();
  console.log("3) Now register this session ON-CHAIN with your AGW.");
  console.log("   Options:");
  console.log(
    '     a) https://www.rugpullbakery.com/my-bakery — accept the'
  );
  console.log(
    '        "create session key" prompt and paste the signer above'
  );
  console.log(
    "        if asked. (May not work if the site forces its own key.)"
  );
  console.log("     b) Use AGW Portal or Abstract Explorer to call");
  console.log(
    "        createSession({ session: <contents of data/session.json> })"
  );
  console.log(
    "        on your AGW. The data/session.json shows the exact policy."
  );
  console.log();
  console.log("Until step 3 succeeds, the bot's transactions will be rejected by");
  console.log(
    "the session-key validator on-chain (no policy = no session)."
  );
  console.log();
}

main();
