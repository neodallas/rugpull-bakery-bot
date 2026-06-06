# Onboarding: from zero to running bot

A practical walkthrough for getting the bot running on Abstract mainnet.

## What you need first

- An Abstract Global Wallet (AGW)
- ~0.05 ETH on Abstract mainnet (for buy-in + gas reserve)
- A bakery you're registered in for the current season

If you have all three, jump to **Step 4**. If not, do steps 1-3 once.

## 1. Create or connect an AGW

Go to https://www.rugpullbakery.com/my-bakery and click connect. Use the popup
wallet flow. Your AGW is a smart-contract wallet -- its address starts with
`0x` and is 40 hex chars.

**Record:** your AGW address.

## 2. Fund the AGW

Send ~0.05 ETH to the AGW address from any exchange or bridge. Confirm the
balance shows up at https://abscan.org/address/<your_agw_address>.

## 3. Create or join a bakery and register for the season

On `/my-bakery`:

1. Either "Create a Bakery" (you pick name + tier) or "Join an existing one"
   from `/bakeries`.
2. Confirm "Register for Season N" -- this pays the live buy-in (~0.002 ETH).
3. When prompted to pick a starter skill, **choose Sweeper** (the bot relies
   on this). First pick is free.
4. Navigate into your bakery on `/bakeries/<id>` and **record `<id>`** -- this
   is your `clanId`.

## 4. Verify the bot can read state (DRY-RUN)

Before doing any of the on-chain session work, make sure the bot connects to
the chain correctly.

Edit `.env`:

```
ABSTRACT_RPC_URL=https://api.mainnet.abs.xyz
SESSION_KEY_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000
AGW_OWNER_ADDRESS=<your AGW>
TG_BOT_TOKEN=
SESSION_CONFIG_PATH=data/session.json
DRY_RUN=1
```

Edit `config.json`: set `clanId` to your bakery id.

Run:

```bash
npm install
npm test
npm run dev
```

Within ~15 seconds you should see log lines like:

```
{"msg":"startup mode","dryRun":true}
{"msg":"bot up","clanId":1552, ...}
{"msg":"dry-run tick","actionKind":"bake","multiplierBps":10000, ...}
```

If you see `lastBake reverted` or similar -- paste the log and stop. The ABI
guess is wrong and the bot needs a fix before going further. Otherwise, kill
the bot (Ctrl+C) and proceed.

## 5. Generate the session key

```bash
npm run create-session
```

This:
- generates a fresh session-key private key (32 bytes)
- writes `data/session.json` with a SessionConfig authorising `bake()` on the
  Bakery contract and `purchaseBoost(uint256,uint256)` on BoostManager
- prints the private key to stdout

**Copy the printed `SESSION_KEY_PRIVATE_KEY=0x...` line into `.env`** (replace
the 64-zero placeholder from step 4).

## 6. Register the session on-chain with your AGW

The session in `data/session.json` is a *policy* -- until you submit it
on-chain through your AGW, no transaction signed by the session key is valid.

There are two ways:

### Option A -- via rugpullbakery.com UI

Some site flows let you paste a session signer address and policy. If the
site UI accepts the data, it will submit `createSession` for you. (Usually
the site insists on generating its own key -- option B is more reliable.)

### Option B -- via AGW Portal / Abstract Explorer / a small wagmi script

Open https://abscan.org/address/<your AGW> and use the "Write" tab to call
`createSession` on your AGW (selector and ABI from the AGW source). The
argument is the full SessionConfig from `data/session.json` -- paste each
field. Confirm the transaction from your AGW.

On success you can verify the session is active via:

```
https://abscan.org/tx/<txhash>
```

## 7. First real run with safety caps

Edit `.env` and **comment out** `DRY_RUN=1` (or set it to `0`).

Verify safety caps in `config.json` for the first 24 hours:

```json
{
  "minMultiplier": 1.2,
  "maxGasPerDay": "0.002",
  "maxVrfPerDay": "0.001",
  "maxBakesPerHour": 12
}
```

These are deliberately conservative: bake only on Golden Batch / Oven Frenzy
windows, 0.002 ETH/day gas cap, 12 bakes/hour. Loosen after observation.

Run:

```bash
npm run dev
```

Watch the first hour. If anything looks wrong, kill it (Ctrl+C), inspect
`data/events.jsonl`, and fix.

## 8. Productionise

```bash
docker compose up -d --build
docker compose logs -f bot
```

## Maintenance

- Renew the session key every 30 days. `npm run create-session` and repeat
  step 6 with the new SessionConfig.
- If `.env` is suspected leaked: revoke the session on-chain (call
  `removeSessionKey` / disable the session config hash) and rotate. See the
  Security section of `README.md`.
