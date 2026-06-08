# rugpull-bakery-bot

Reactive baker for [Rugpull Bakery](https://www.rugpullbakery.com/) on
Abstract L2. Bakes only when the effective multiplier crosses a configurable
threshold; otherwise sleeps. Uses an AGW session key, never the AGW owner key.

## What it does
- `bake()` when multiplier ≥ `minMultiplier`
- Free Sweeper Cleanup Crew when a rug is active and the cooldown is ready
- Nothing otherwise

## What it does NOT do
- Register, create clans, join clans, select skills (do these manually once)
- Launch attacks, buy positive boosts, contribute to clan upgrades
- Anything outside the configured daily gas/VRF caps

## Onboarding (one-time, manual)

1. Connect AGW on https://www.rugpullbakery.com/, fund ~0.05 ETH.
2. Create a bakery or join one. Register for the current season (pays buy-in).
3. Pick the **Sweeper** skill (free first pick).
4. Note your clan id.
5. Generate an AGW session key authorising `bake` on `PlayerRegistry` and
   `purchaseBoost` on `BoostManager`. Expiry 30 days.
6. Copy the session-key private key into `.env`.

## Configuration

`cp .env.example .env` and fill:

```env
ABSTRACT_RPC_URL=https://api.mainnet.abs.xyz
SESSION_KEY_PRIVATE_KEY=0x...
AGW_OWNER_ADDRESS=0x...
TG_BOT_TOKEN=...
```

Edit `config.json`:
- `clanId` — your clan id from step 4
- `minMultiplier` — `1.0` to bake on any positive window, `1.15` for high-only

## Run

```bash
npm install
npm test
npm run dev          # local dev with tsx
# OR
docker compose up -d --build
docker compose logs -f bot
```

Docker logs are capped at 5×10MB via compose (`json-file` driver,
independent of the structured `data/events.jsonl` log on the bind mount).

## Dry-run mode

To verify the bot can read chain state and that ABI assumptions match live
contracts — without spending ETH — start in dry-run:

```bash
DRY_RUN=1 npm run dev
# or
node dist/main.js --dry-run
```

In dry-run the bot:
- Reads chain state every tick
- Computes the decision (`bake` / `cleanup` / `sleep`) and logs it
- Never sends a transaction
- Does not require `data/session.json`

You still need `SESSION_KEY_PRIVATE_KEY` to be a well-formed 64-char hex string
in `.env` (it is parsed but never used in dry-run — `0x` plus 64 zeros works).

Use this mode to confirm multiplier, rugs, and balance reads work before
configuring the real session key.

## Maintenance

- Renew the session key every 30 days. The bot warns via Telegram 3 days
  before expiry (rotate then redeploy).
- Review `data/events.jsonl` weekly for ROI.
- If you ever suspect `.env` leaked: revoke the session key in the AGW UI
  immediately, then rotate `SESSION_KEY_PRIVATE_KEY` and redeploy.

## Safety caps

Defaults (in `config.json`, all per UTC day unless noted):
- `maxGasPerDay`: 0.01 ETH
- `maxVrfPerDay`: 0.001 ETH
- `maxBakesPerHour`: 30
- `minEthReserve`: 0.005 ETH
- `maxFailedTxConsecutive`: 5 → trips kill switch

A tripped kill switch auto-resets at the next UTC midnight, or manually by
deleting `data/kill.flag`.

## Layout

- `src/decision-engine.ts` — pure decision logic
- `src/state-reader.ts` — agent.json cache + eth_call batch
- `src/executor.ts` — simulate-then-send for bake/cleanup
- `src/safety-caps.ts` — daily counters + kill switch
- `src/telegram-notifier.ts` — alerts (rate-limited, deduped)
- `docs/superpowers/specs/` — design spec
- `docs/superpowers/plans/` — this plan
