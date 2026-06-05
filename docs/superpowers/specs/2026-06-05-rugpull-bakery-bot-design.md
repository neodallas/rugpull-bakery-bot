# Rugpull Bakery Bot — Design

**Date:** 2026-06-05
**Status:** Draft
**Owner:** Andrew (madwars11@gmail.com)

## Goal

Run an unattended, low-cost bot that bakes cookies in
[Rugpull Bakery](https://www.rugpullbakery.com/) on the Abstract L2 chain only
when the effective multiplier makes baking economically worthwhile, and pauses
otherwise. Maximise return per spent ETH; do not optimise for absolute output.

## Non-Goals

- No automation of registration, clan creation, password gating, or skill
  selection — those are one-time manual steps performed through the web UI.
- No competitive PvP play: the bot does not launch attacks (`launchAttack`),
  does not purchase positive boosts, does not contribute cookies to clan
  upgrades. (Cleanup Crew via the Sweeper skill is the only "active" action,
  and only when free.)
- No multi-bakery / multi-wallet support. One bot instance = one wallet =
  one clan.
- No web UI, dashboard, or REST API. Telegram notifications are the only
  outbound channel besides logs.

## Constraints

- Abstract Global Wallet (AGW) is required for registration; bot uses an
  **AGW session key**, not the AGW owner key.
- Live state — buy-in, VRF fee, bake cadence, boost catalog — must be read
  from `/agent.json` and/or fresh on-chain reads. No hard-coded gameplay
  numbers in code.
- Bot must never exceed user-configured daily ETH gas/VRF caps.
- Bot must not retry a permanently-failing transaction in a loop.

## Strategy

The bot is a **reactive baker** with a configurable multiplier threshold:

- `MIN_MULTIPLIER = 1.0` → bake during any positive multiplier window
  (random events, purchased boosts, active clan upgrades).
- `MIN_MULTIPLIER = 1.15` → bake only during high windows (Golden Batch,
  Oven Frenzy, stacked effects).

Threshold is hot-reconfigurable via `config.json`. No code changes required.

Additionally, when the player skill is **Sweeper** and a free Cleanup Crew is
ready, the bot consumes the free cleanup as soon as a rug is detected. This
removes the negative multiplier at zero cookie cost (gas + VRF only).

## Architecture

Single Node.js process inside a Docker container, deployed to a VPS using the
same pattern as `polymarket-alert-bot`.

```
┌──────────────────────────────────────────────────┐
│                rugpull-bakery-bot                │
│                                                  │
│   ┌──────────┐    ┌───────────┐   ┌──────────┐   │
│   │  config  │──▶ │   main    │ ◀─│ session  │   │
│   └──────────┘    │   loop    │   │   key    │   │
│                   └─────┬─────┘   └──────────┘   │
│         ┌───────────────┼──────────────┐         │
│         ▼               ▼              ▼         │
│   ┌──────────┐   ┌──────────────┐   ┌──────┐     │
│   │  state   │   │   decision   │   │ exec │     │
│   │  reader  │   │   engine     │   │ tor  │     │
│   └─────┬────┘   └──────┬───────┘   └───┬──┘     │
│         │               │               │        │
│         └────────┬──────┴───────┬───────┘        │
│                  ▼              ▼                │
│             ┌─────────┐   ┌──────────┐           │
│             │ safety  │   │ telegram │           │
│             │  caps   │   │ notifier │           │
│             └─────────┘   └──────────┘           │
│                                                  │
│       jsonl event log (ROI analysis)             │
└──────────────────────────────────────────────────┘
```

### Modules

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `config` | Parse `.env` + `config.json`, validate with zod | — |
| `session-key` | Load session key private key from env, construct a viem account capable of signing on behalf of the AGW for whitelisted methods | `config` |
| `state-reader` | `eth_call` batch: `effectiveMultiplier(clanId)`, `activeDebuffs(clanId)`, `activeBoosts(clanId)`, `lastBakeBlock(player)`, `block.number`, `vrfFee()`, `playerSkill(player, seasonId)`, ETH balance. Cache `/agent.json` for 5 min | viem RPC |
| `decision-engine` | Pure function `(state, config) → Action` where `Action = Bake \| Cleanup \| Sleep(reason)` | — |
| `executor` | Sign with session key, send tx, wait for 1 confirmation, return result | `session-key`, `state-reader` |
| `safety-caps` | Track daily gas/VRF/bake counters, kill-switch logic, atomic persistence to `data/safety.json` | `logger` |
| `telegram-notifier` | Send important events to a Telegram chat; never blocks main loop | — |
| `logger` | Append JSON events to `data/events.jsonl` | — |
| `main` | Tick loop; assembles modules; top-level try/catch | all |

### Actions

The bot is allowed to perform exactly three actions on-chain:

1. **`bake()`** — primary operation
2. **`purchaseBoost(CLEANUP_CREW_BOOST_TYPE_ID)`** — only when the Sweeper
   skill is active, a rug is on the bakery, and the free cooldown is ready.
   The boost type id for Cleanup Crew is **read from `/agent.json`**, not
   hard-coded
3. **Nothing (sleep)** — most ticks

Registration, clan creation, joinClan, skill selection, requestToJoin,
approveJoinRequest, etc. are **not implemented**.

## Data Flow — One Tick

`POLL_INTERVAL_MS` default is `15_000`.

```
1. SAFETY GATE
   if killSwitch.tripped: log, throttled notify, sleep until reset
   if dailyGasSpent >= MAX_GAS_PER_DAY: trip kill switch
   if consecutiveFailedTx >= MAX_FAILED_TX_CONSECUTIVE: trip kill switch

2. READ STATE (parallel eth_calls)
   ├─ player ETH balance
   ├─ effectiveMultiplier(clanId)
   ├─ activeDebuffs(clanId)
   ├─ activeBoosts(clanId)
   ├─ lastBakeBlock(player)
   ├─ currentBlock
   ├─ vrfFee()
   └─ playerSkill(player, seasonId)  [cached after first read]

3. DECISION (pure)
   if ETH < MIN_ETH_RESERVE:                  return Sleep("low ETH")
   if currentBlock - lastBakeBlock < CD:      return Sleep("cooldown")
   if hasActiveRug AND skill == Sweeper
      AND sweeperFreeReady:                   return Cleanup
   if effectiveMultiplier >= MIN_MULTIPLIER:  return Bake
   return Sleep("multiplier below threshold")

4. EXECUTE
   pre-simulate via eth_call with the same calldata/value/from
   that the real tx will use; abort if simulation reverts
   sign with session key → sendTransaction → wait 1 confirmation
   on success: update lastBakeBlock, log, increment counters
   on revert (expected): info log, no failure counter bump
   on revert (unexpected): bump failure counter, TG alert
   on RPC error: exponential backoff (1→2→4 … max 60s)

5. NOTIFY (significant events only)
   first rug per bakery, Sweeper cleanup result, kill switch trip,
   ETH balance below warning, daily summary at 00:00 UTC
```

## Decision Engine — Pseudocode

```ts
type State = {
  ethWei: bigint
  blockNumber: bigint
  lastBakeBlock: bigint
  effectiveMultiplierBps: number     // 10000 = 1.0x
  activeRugs: Debuff[]
  playerSkill: SkillId
  sweeperFreeReady: boolean
  bakeCooldownBlocks: number
  vrfFeeWei: bigint
}

type Action =
  | { kind: "bake" }
  | { kind: "cleanup" }
  | { kind: "sleep"; reason: string }

function decide(s: State, cfg: Config): Action {
  if (s.ethWei < cfg.minEthReserveWei)
    return { kind: "sleep", reason: "low ETH" }

  if (s.blockNumber - s.lastBakeBlock < BigInt(s.bakeCooldownBlocks))
    return { kind: "sleep", reason: "cooldown" }

  if (s.activeRugs.length > 0 &&
      s.playerSkill === "Sweeper" &&
      s.sweeperFreeReady)
    return { kind: "cleanup" }

  if (s.effectiveMultiplierBps >= cfg.minMultiplierBps)
    return { kind: "bake" }

  return { kind: "sleep", reason: "multiplier below threshold" }
}
```

This function is **deterministic and side-effect-free**. All branches are
covered by unit tests in `tests/decision-engine.test.ts`.

## Safety Caps

| Cap | Default | Rationale |
| --- | --- | --- |
| `MAX_GAS_PER_DAY` | `0.01 ETH` | User-set; ample headroom for ~200-1000 bakes |
| `MAX_VRF_PER_DAY` | `0.001 ETH` | Limits Sweeper cleanup churn |
| `MAX_BAKES_PER_HOUR` | `30` | Sanity check; realistically ≤12/hr at 5-block cadence |
| `MIN_ETH_RESERVE` | `0.005 ETH` | Ensures gas to finish the season |
| `MAX_FAILED_TX_CONSECUTIVE` | `5` | Tolerates random reverts, catches misconfig |

### Kill Switch

- Trips on: gas cap exceeded, repeated failed tx, invalid session key,
  manual `data/kill.flag` file.
- While tripped: no transactions; state reads at 5-min cadence; one TG
  heartbeat per hour.
- Auto-resets at next UTC midnight **except** when triggered by invalid
  session key (manual reset required after key renewal).

### Persistence

`data/safety.json` written atomically (tmp + rename) on every counter mutation.
Loss of file = safe defaults (0 spent, kill switch off). Date-rollover detection
on read.

## Security

### Key model

- Bot signs **only** with the AGW session key. The AGW owner key never enters
  the bot, never lives on the VPS, and is never asked for at runtime.
- Session key authority is scoped at the AGW level to a whitelist of methods
  (`bake`, `purchaseBoost`). Even if the session key private key leaks, the
  attacker cannot drain ETH from the AGW, transfer NFTs, register new clans,
  or call `launchAttack`.
- Session key has a finite TTL (default 30 days). Bot warns via Telegram
  3 days before expiry.

### Chain-ID validation

On boot, before any tx is constructed, the bot calls `eth_chainId` and asserts
the response equals `2741` (Abstract mainnet). Mismatch → hard exit with
critical TG alert. Prevents accidental or malicious RPC substitution.

### Logging redaction

The following must **never** appear in `events.jsonl`, stdout, or Telegram:

- session key private key
- raw signatures
- Telegram bot token
- `.env` file contents

Public on-chain data (player address, clan id, multipliers, tx hashes) may be
logged.

### Telegram rate limiting

`telegram-notifier` deduplicates identical alerts within a 1-hour window and
caps total outbound at **20 messages/hour**. Excess alerts are dropped with a
single summary message at the hour boundary. Prevents alert-spam → 429 →
silent bot.

### Source-of-truth ordering

For money-sensitive values (VRF fee, boost cost, registration buy-in) the bot
**always** prefers a fresh contract read over the cached `/agent.json`. This
matches the rugpullbakery.com `skill.md` guidance and prevents a compromised
or stale `/agent.json` from causing the bot to overspend.

### Session key revocation procedure

If `.env` is suspected leaked or VPS compromise is possible:

1. From any browser, open rugpullbakery.com and connect the AGW owner wallet.
2. In the wallet's session key management UI, revoke the session key whose
   public address matches `AGW_OWNER_ADDRESS` config.
3. On the VPS: `docker compose down`, rotate `SESSION_KEY_PRIVATE_KEY`,
   generate a new session key from the AGW UI, redeploy.

Revocation is on-chain and immediate; no bot-side action is required to
honour it (the next tx attempt will revert with an unexpected error and trip
the kill switch).

## Error Handling

| Class | Examples | Reaction |
| --- | --- | --- |
| RPC / network | timeout, 429, dropped connection | exponential backoff; no failure counter bump |
| Expected revert | `BoostCooldown`, `BakeTooSoon`, `InsufficientCookies` | info log; no counter bump |
| Unexpected revert | `NotInClan`, `Unauthorized`, `WrongSeason` | bump failure counter; TG alert with reason |
| Session key invalid | recovery sig fails on chain | immediate kill switch + critical TG alert |
| Insufficient ETH | balance < reserve | pause (not kill); once-per-day TG warning |
| Telegram API fail | rate limit, network | swallow + log; never blocks main loop |
| `/agent.json` outage | site down | use cached snapshot + contract reads; continue |

## Configuration

`config.json` (gameplay parameters, can be edited without rebuild):

```jsonc
{
  "clanId": 0,                            // set during onboarding
  "minMultiplier": 1.0,                   // bps internally: 10000
  "pollIntervalMs": 15000,
  "bakeCooldownBlocks": 5,                // read from /agent.json on start
  "minEthReserve": "0.005",
  "maxGasPerDay": "0.01",
  "maxVrfPerDay": "0.001",
  "maxBakesPerHour": 30,
  "maxFailedTxConsecutive": 5,
  "telegram": {
    "chatId": "",
    "tokenEnv": "TG_BOT_TOKEN"
  }
}
```

`.env` (secrets, never committed):

```env
ABSTRACT_RPC_URL=
SESSION_KEY_PRIVATE_KEY=0x
AGW_OWNER_ADDRESS=0x
TG_BOT_TOKEN=
```

## Repository Layout

```
rugpull-bakery-bot/
├── src/
│   ├── config.ts
│   ├── session-key.ts
│   ├── state-reader.ts
│   ├── decision-engine.ts
│   ├── executor.ts
│   ├── safety-caps.ts
│   ├── telegram-notifier.ts
│   ├── logger.ts
│   ├── main.ts
│   └── types.ts
├── tests/
│   ├── decision-engine.test.ts
│   ├── safety-caps.test.ts
│   ├── state-reader.test.ts
│   └── fixtures/state.ts
├── data/                       # gitignored: safety.json, kill.flag, events.jsonl
├── docs/superpowers/specs/
├── config.json
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Dependencies

- `viem` — RPC + tx signing
- `@abstract-foundation/agw-client` — AGW session key support
- `zod` — config validation
- `vitest` — unit tests
- `node-fetch` (or undici built-in) — Telegram + agent.json

No Express, no database (beyond JSON/JSONL), no ORM, no scheduler library.

## Testing

| Level | Scope | Tool |
| --- | --- | --- |
| Unit | `decision-engine` — ~20 cases across multiplier, cooldown, rug, ETH | vitest |
| Unit | `safety-caps` — counter math, kill switch, UTC rollover | vitest + fake timers |
| Unit | `state-reader` parsing + `/agent.json` fallback/cache | vitest + msw |
| Integration | Abstract **testnet** (chain 11124), real session key, 1-hour soak | manual |
| Smoke (mainnet) | First-run with minimal caps (`maxGasPerDay = 0.001`), 24-hr observation | manual |

Modules not unit-tested (intentional): `executor` (thin viem wrapper),
`telegram-notifier` (thin HTTP wrapper).

## Deployment

- **Dockerfile**: `node:22-alpine`, multi-stage build, non-root user
- **docker-compose.yml**: single `bot` service, `./data` volume, `restart: unless-stopped`
- **Target**: VPS, same pattern as `polymarket-alert-bot`
- **Logs**: stdout (Docker manages rotation) + structured `data/events.jsonl`

## Onboarding Checklist (One-Time, Manual)

1. **AGW setup**
   - Connect Abstract Global Wallet on rugpullbakery.com
   - Fund AGW with ~0.05 ETH

2. **Game registration**
   - Read live buy-in from `/agent.json`
   - Create a bakery **or** join an existing one
   - Register for Season 8 (pays buy-in)
   - Select **Sweeper** starter skill (free first selection)
   - Record `clanId`

3. **Session key**
   - Create AGW session key with permissions for `bake`, `purchaseBoost`
   - Set expiry to 30 days (or max UI allows)
   - Export session key private key → `.env` `SESSION_KEY_PRIVATE_KEY`

4. **Bot config**
   - `cp .env.example .env`, fill RPC, session key, owner address, TG token
   - Edit `config.json`: `clanId`, `minMultiplier=1.0`

5. **Smoke test**
   - `npm install && npm test` → all green
   - `npm run dev` for 10 min, observe state reads and decisions in stdout
   - Verify TG `bot up` message

6. **Production**
   - On VPS: `docker compose up -d --build`
   - `docker compose logs -f bot`
   - Monitor 24 h with conservative caps, then loosen

7. **Maintenance**
   - Renew session key every 30 days (TG warns 3 days before expiry)
   - Review `events.jsonl` weekly for ROI

8. **Emergency revocation** (only if `.env` leaked or VPS compromised)
   - Open rugpullbakery.com with the AGW owner wallet
   - Revoke the session key associated with `AGW_OWNER_ADDRESS`
   - Stop the bot (`docker compose down`)
   - Rotate `SESSION_KEY_PRIVATE_KEY`, generate fresh session key, redeploy

## Open Items

None for v1. Future considerations (NOT in scope):

- Multi-wallet / multi-clan support
- `launchAttack` strategy
- Active boost purchasing strategy
- Clan upgrade contribution timing
- Web dashboard

## Size Estimate

- ~600-800 LOC TypeScript
- 1 Docker container
- 8 source modules, each ~50-100 LOC
- ~30 unit tests
