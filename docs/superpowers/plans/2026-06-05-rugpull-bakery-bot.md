# Rugpull Bakery Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an unattended TypeScript bot that bakes cookies in Rugpull Bakery on Abstract L2 only when the effective multiplier exceeds a configurable threshold, with safety caps, kill switch, and Telegram alerts.

**Architecture:** Single Node.js process running a 15-second polling loop. Eight focused modules (config, session-key, state-reader, decision-engine, executor, safety-caps, telegram-notifier, logger) wired together by `main.ts`. The decision engine is a pure function; all I/O is at the edges. Deploys as a Docker container on a VPS using the same pattern as `polymarket-alert-bot`.

**Tech Stack:** TypeScript, Node.js 22, viem 2.x, `@abstract-foundation/agw-client`, zod, vitest, Docker.

---

## File Structure

| Path | Purpose |
| --- | --- |
| `src/types.ts` | Shared types: `State`, `Action`, `Config`, `SafetyState`, `Debuff`, `SkillId` |
| `src/config.ts` | Load `.env` + `config.json`, validate with zod, expose typed `Config` |
| `src/logger.ts` | Append redacted JSON events to `data/events.jsonl` + stdout |
| `src/safety-caps.ts` | Daily counters, kill-switch, atomic persistence to `data/safety.json` |
| `src/decision-engine.ts` | Pure `decide(state, config) => Action` |
| `src/state-reader.ts` | Fetch `/agent.json` (cached) + parallel `eth_call`s |
| `src/telegram-notifier.ts` | Rate-limited, deduped Telegram alerts |
| `src/session-key.ts` | Build a viem-compatible signer from the AGW session key |
| `src/executor.ts` | Simulate, sign, send, wait for receipt |
| `src/main.ts` | Tick loop, top-level try/catch, module assembly |
| `tests/decision-engine.test.ts` | ~20 unit cases against `decide()` |
| `tests/safety-caps.test.ts` | Counter math, kill switch, UTC rollover |
| `tests/state-reader.test.ts` | `/agent.json` cache + fallback, response parsing |
| `tests/telegram-notifier.test.ts` | Rate-limit + dedup |
| `tests/config.test.ts` | zod parsing + bad input |
| `tests/logger.test.ts` | Redaction rules |
| `tests/fixtures/state.ts` | Reusable `State` snapshots |
| `config.json` | Gameplay parameters (clanId, threshold, caps) |
| `.env.example` | Secret shape; real `.env` is gitignored |
| `Dockerfile` | Multi-stage `node:22-alpine` build |
| `docker-compose.yml` | Single `bot` service with persistent `./data` volume |
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Tooling |
| `.gitignore` | `node_modules`, `dist`, `data`, `.env` |
| `README.md` | Onboarding + run commands |

Total expected size: ~700 LOC source + ~400 LOC tests.

---

## Task 0: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `config.json`
- Create: `data/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "rugpull-bakery-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@abstract-foundation/agw-client": "^1.8.0",
    "viem": "^2.21.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    clearMocks: true,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
data/*
!data/.gitkeep
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 5: Create `.env.example`**

```env
ABSTRACT_RPC_URL=https://api.mainnet.abs.xyz
SESSION_KEY_PRIVATE_KEY=0x
AGW_OWNER_ADDRESS=0x
TG_BOT_TOKEN=
```

- [ ] **Step 6: Create `config.json`**

```json
{
  "clanId": 0,
  "minMultiplier": 1.0,
  "pollIntervalMs": 15000,
  "bakeCooldownBlocks": 5,
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

- [ ] **Step 7: Create `data/.gitkeep`** (empty file so the directory exists but contents stay gitignored)

```bash
mkdir -p data && touch data/.gitkeep
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: dependencies installed, `package-lock.json` created, no audit errors that block.

- [ ] **Step 9: Sanity-build**

Create stub `src/main.ts` with one line so `tsc` has something to compile:

```ts
console.log("rugpull-bakery-bot bootstrapping");
```

Run: `npm run build`
Expected: `dist/main.js` exists.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example config.json data/.gitkeep src/main.ts
git commit -m "chore: scaffold project (package.json, tsconfig, vitest, config, gitignore)"
```

---

## Task 1: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type SkillId =
  | "None"
  | "Lucky"
  | "Evil"
  | "Booster"
  | "Saboteur"
  | "Sweeper"
  | "Perfectionist"
  | "Trailblazer"
  | "Guardian";

export type Debuff = {
  boostTypeId: number;
  endTimeUnix: number;
  severityBps: number;
};

export type State = {
  ethWei: bigint;
  blockNumber: bigint;
  lastBakeBlock: bigint;
  effectiveMultiplierBps: number;
  activeRugs: Debuff[];
  playerSkill: SkillId;
  sweeperFreeReady: boolean;
  bakeCooldownBlocks: number;
  vrfFeeWei: bigint;
  cleanupCrewBoostTypeId: number | null;
};

export type Action =
  | { kind: "bake" }
  | { kind: "cleanup" }
  | { kind: "sleep"; reason: string };

export type Config = {
  clanId: number;
  minMultiplierBps: number;
  pollIntervalMs: number;
  bakeCooldownBlocks: number;
  minEthReserveWei: bigint;
  maxGasPerDayWei: bigint;
  maxVrfPerDayWei: bigint;
  maxBakesPerHour: number;
  maxFailedTxConsecutive: number;
  telegram: { chatId: string; botToken: string };
  rpcUrl: string;
  sessionKeyPrivateKey: Hex;
  agwOwnerAddress: Address;
};

export type SafetyState = {
  dateUtc: string;
  gasSpentWei: bigint;
  vrfSpentWei: bigint;
  bakeCountToday: number;
  bakeCountThisHour: number;
  hourBucket: number;
  consecutiveFailedTx: number;
  killSwitchUntil: number | null;
  killSwitchReason: string | null;
};

export type TxResult =
  | { ok: true; txHash: Hex; gasUsedWei: bigint; vrfPaidWei: bigint }
  | { ok: false; reason: string; expected: boolean };
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add shared State, Action, Config, SafetyState types"
```

---

## Task 2: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test `tests/config.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const validRaw = {
  clanId: 42,
  minMultiplier: 1.15,
  pollIntervalMs: 15000,
  bakeCooldownBlocks: 5,
  minEthReserve: "0.005",
  maxGasPerDay: "0.01",
  maxVrfPerDay: "0.001",
  maxBakesPerHour: 30,
  maxFailedTxConsecutive: 5,
  telegram: { chatId: "123", tokenEnv: "TG_BOT_TOKEN" },
};

const validEnv = {
  ABSTRACT_RPC_URL: "https://api.mainnet.abs.xyz",
  SESSION_KEY_PRIVATE_KEY:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  AGW_OWNER_ADDRESS: "0x2222222222222222222222222222222222222222",
  TG_BOT_TOKEN: "bot-token",
};

describe("parseConfig", () => {
  it("converts ETH strings to wei bigints", () => {
    const cfg = parseConfig(validRaw, validEnv);
    expect(cfg.minEthReserveWei).toBe(5_000_000_000_000_000n);
    expect(cfg.maxGasPerDayWei).toBe(10_000_000_000_000_000n);
  });

  it("converts multiplier to bps", () => {
    const cfg = parseConfig(validRaw, validEnv);
    expect(cfg.minMultiplierBps).toBe(11500);
  });

  it("resolves telegram token from referenced env var", () => {
    const cfg = parseConfig(validRaw, validEnv);
    expect(cfg.telegram.botToken).toBe("bot-token");
  });

  it("rejects clanId 0 (not yet onboarded)", () => {
    expect(() => parseConfig({ ...validRaw, clanId: 0 }, validEnv)).toThrow(
      /clanId/
    );
  });

  it("rejects missing session key", () => {
    expect(() =>
      parseConfig(validRaw, { ...validEnv, SESSION_KEY_PRIVATE_KEY: "" })
    ).toThrow(/SESSION_KEY_PRIVATE_KEY/);
  });

  it("rejects malformed address", () => {
    expect(() =>
      parseConfig(validRaw, { ...validEnv, AGW_OWNER_ADDRESS: "not-an-address" })
    ).toThrow(/AGW_OWNER_ADDRESS/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL with "Cannot find module '../src/config.js'".

- [ ] **Step 3: Write `src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { parseEther } from "viem";
import { z } from "zod";
import type { Address, Config, Hex } from "./types.js";

const RawConfigSchema = z.object({
  clanId: z.number().int().positive("clanId must be set during onboarding"),
  minMultiplier: z.number().min(0.5).max(5),
  pollIntervalMs: z.number().int().min(1000).max(600000),
  bakeCooldownBlocks: z.number().int().min(1).max(1000),
  minEthReserve: z.string(),
  maxGasPerDay: z.string(),
  maxVrfPerDay: z.string(),
  maxBakesPerHour: z.number().int().positive(),
  maxFailedTxConsecutive: z.number().int().positive(),
  telegram: z.object({
    chatId: z.string(),
    tokenEnv: z.string(),
  }),
});

const EnvSchema = z.object({
  ABSTRACT_RPC_URL: z.string().url(),
  SESSION_KEY_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "SESSION_KEY_PRIVATE_KEY must be 0x + 64 hex"),
  AGW_OWNER_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "AGW_OWNER_ADDRESS must be 0x + 40 hex"),
});

export function parseConfig(
  rawJson: unknown,
  env: Record<string, string | undefined>
): Config {
  const raw = RawConfigSchema.parse(rawJson);
  const parsedEnv = EnvSchema.parse(env);
  const botToken = env[raw.telegram.tokenEnv] ?? "";
  if (!botToken && raw.telegram.chatId) {
    throw new Error(
      `Telegram chatId set but env var ${raw.telegram.tokenEnv} is empty`
    );
  }
  return {
    clanId: raw.clanId,
    minMultiplierBps: Math.round(raw.minMultiplier * 10000),
    pollIntervalMs: raw.pollIntervalMs,
    bakeCooldownBlocks: raw.bakeCooldownBlocks,
    minEthReserveWei: parseEther(raw.minEthReserve),
    maxGasPerDayWei: parseEther(raw.maxGasPerDay),
    maxVrfPerDayWei: parseEther(raw.maxVrfPerDay),
    maxBakesPerHour: raw.maxBakesPerHour,
    maxFailedTxConsecutive: raw.maxFailedTxConsecutive,
    telegram: { chatId: raw.telegram.chatId, botToken },
    rpcUrl: parsedEnv.ABSTRACT_RPC_URL,
    sessionKeyPrivateKey: parsedEnv.SESSION_KEY_PRIVATE_KEY as Hex,
    agwOwnerAddress: parsedEnv.AGW_OWNER_ADDRESS as Address,
  };
}

export function loadConfigFromDisk(): Config {
  const rawJson = JSON.parse(readFileSync("config.json", "utf8"));
  return parseConfig(rawJson, process.env);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/config.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): zod-validated config loader for env + config.json"
```

---

## Task 3: Logger with Redaction

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

- [ ] **Step 1: Write the failing test `tests/logger.test.ts`**

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-log-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("logger", () => {
  it("writes one JSON object per line", () => {
    const log = createLogger(join(dir, "events.jsonl"));
    log.info("hello", { foo: 1 });
    log.info("world", { foo: 2 });
    const lines = readFileSync(join(dir, "events.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).msg).toBe("hello");
    expect(JSON.parse(lines[1]!).foo).toBe(2);
  });

  it("redacts forbidden keys", () => {
    const log = createLogger(join(dir, "events.jsonl"));
    log.info("x", {
      sessionKeyPrivateKey: "0xdead",
      privateKey: "0xbeef",
      signature: "0xfeed",
      token: "tg",
      botToken: "tg2",
      addr: "0xabc",
    });
    const parsed = JSON.parse(readFileSync(join(dir, "events.jsonl"), "utf8"));
    expect(parsed.sessionKeyPrivateKey).toBe("[REDACTED]");
    expect(parsed.privateKey).toBe("[REDACTED]");
    expect(parsed.signature).toBe("[REDACTED]");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.botToken).toBe("[REDACTED]");
    expect(parsed.addr).toBe("0xabc");
  });

  it("serializes bigint as string", () => {
    const log = createLogger(join(dir, "events.jsonl"));
    log.info("x", { wei: 12345678901234567890n });
    const parsed = JSON.parse(readFileSync(join(dir, "events.jsonl"), "utf8"));
    expect(parsed.wei).toBe("12345678901234567890");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/logger.ts`**

```ts
import { appendFileSync } from "node:fs";

const REDACT_KEYS = new Set([
  "sessionKeyPrivateKey",
  "privateKey",
  "signature",
  "token",
  "botToken",
  "tgBotToken",
  "mnemonic",
  "seed",
]);

type Level = "info" | "warn" | "error";

function replacer(_k: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  return v;
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type Logger = {
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
};

export function createLogger(path: string): Logger {
  function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
    const entry = { ts: new Date().toISOString(), level, msg, ...redact(fields) };
    const line = JSON.stringify(entry, replacer) + "\n";
    appendFileSync(path, line);
    if (level !== "info") process.stderr.write(line);
    else process.stdout.write(line);
  }
  return {
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run tests/logger.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat(logger): jsonl logger with secret redaction and bigint support"
```

---

## Task 4: Safety Caps + Kill Switch

**Files:**
- Create: `src/safety-caps.ts`
- Create: `tests/safety-caps.test.ts`

- [ ] **Step 1: Write failing test `tests/safety-caps.test.ts`**

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSafetyCaps } from "../src/safety-caps.js";
import type { Config } from "../src/types.js";

const cfg: Pick<
  Config,
  "maxGasPerDayWei" | "maxVrfPerDayWei" | "maxBakesPerHour" | "maxFailedTxConsecutive"
> = {
  maxGasPerDayWei: 10_000_000_000_000_000n,
  maxVrfPerDayWei: 1_000_000_000_000_000n,
  maxBakesPerHour: 30,
  maxFailedTxConsecutive: 5,
};

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "safety-"));
  path = join(dir, "safety.json");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("safety-caps", () => {
  it("starts with empty counters when no file exists", () => {
    const caps = createSafetyCaps(path, cfg);
    const s = caps.snapshot();
    expect(s.gasSpentWei).toBe(0n);
    expect(s.killSwitchUntil).toBeNull();
  });

  it("trips kill switch when daily gas cap exceeded", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: cfg.maxGasPerDayWei, vrfPaidWei: 0n });
    expect(caps.isKilled()).toBe(true);
  });

  it("trips kill switch after N consecutive failed unexpected tx", () => {
    const caps = createSafetyCaps(path, cfg);
    for (let i = 0; i < cfg.maxFailedTxConsecutive; i++) {
      caps.recordTxResult({ ok: false, reason: "weird", expected: false });
    }
    expect(caps.isKilled()).toBe(true);
  });

  it("expected reverts do not bump failure counter", () => {
    const caps = createSafetyCaps(path, cfg);
    for (let i = 0; i < 100; i++) {
      caps.recordTxResult({ ok: false, reason: "BakeTooSoon", expected: true });
    }
    expect(caps.isKilled()).toBe(false);
  });

  it("successful tx resets failure counter", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: false, reason: "weird", expected: false });
    caps.recordTxResult({ ok: false, reason: "weird", expected: false });
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 1n, vrfPaidWei: 0n });
    expect(caps.snapshot().consecutiveFailedTx).toBe(0);
  });

  it("resets daily counters on UTC date rollover", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 5n, vrfPaidWei: 0n });
    vi.setSystemTime(new Date("2026-06-06T00:00:01Z"));
    const reloaded = createSafetyCaps(path, cfg);
    expect(reloaded.snapshot().gasSpentWei).toBe(0n);
    expect(reloaded.snapshot().dateUtc).toBe("2026-06-06");
  });

  it("can be tripped manually via kill flag file", () => {
    const caps = createSafetyCaps(path, cfg);
    writeFileSync(join(dir, "kill.flag"), "manual");
    expect(caps.isKilled(join(dir, "kill.flag"))).toBe(true);
  });

  it("persists state atomically (tmp + rename)", () => {
    const caps = createSafetyCaps(path, cfg);
    caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 100n, vrfPaidWei: 0n });
    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.gasSpentWei).toBe("100");
  });

  it("caps maxBakesPerHour and trips kill switch on anomaly", () => {
    const caps = createSafetyCaps(path, cfg);
    for (let i = 0; i < cfg.maxBakesPerHour + 1; i++) {
      caps.recordTxResult({ ok: true, txHash: "0x1", gasUsedWei: 1n, vrfPaidWei: 0n });
    }
    expect(caps.isKilled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run tests/safety-caps.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write `src/safety-caps.ts`**

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Config, SafetyState, TxResult } from "./types.js";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function hourBucket(): number {
  return Math.floor(Date.now() / 3_600_000);
}

function freshState(): SafetyState {
  return {
    dateUtc: todayUtc(),
    gasSpentWei: 0n,
    vrfSpentWei: 0n,
    bakeCountToday: 0,
    bakeCountThisHour: 0,
    hourBucket: hourBucket(),
    consecutiveFailedTx: 0,
    killSwitchUntil: null,
    killSwitchReason: null,
  };
}

function loadOrFresh(path: string): SafetyState {
  if (!existsSync(path)) return freshState();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      dateUtc: raw.dateUtc,
      gasSpentWei: BigInt(raw.gasSpentWei ?? "0"),
      vrfSpentWei: BigInt(raw.vrfSpentWei ?? "0"),
      bakeCountToday: raw.bakeCountToday ?? 0,
      bakeCountThisHour: raw.bakeCountThisHour ?? 0,
      hourBucket: raw.hourBucket ?? hourBucket(),
      consecutiveFailedTx: raw.consecutiveFailedTx ?? 0,
      killSwitchUntil: raw.killSwitchUntil ?? null,
      killSwitchReason: raw.killSwitchReason ?? null,
    };
  } catch {
    return freshState();
  }
}

function persist(path: string, s: SafetyState): void {
  const json = JSON.stringify(
    s,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
  const tmp = path + ".tmp";
  writeFileSync(tmp, json);
  renameSync(tmp, path);
}

export type SafetyCaps = {
  snapshot: () => SafetyState;
  isKilled: (killFlagPath?: string) => boolean;
  preflight: (estGasWei: bigint, estVrfWei: bigint) => { ok: boolean; reason?: string };
  recordTxResult: (r: TxResult) => void;
  trip: (reason: string) => void;
};

export function createSafetyCaps(
  path: string,
  cfg: Pick<
    Config,
    "maxGasPerDayWei" | "maxVrfPerDayWei" | "maxBakesPerHour" | "maxFailedTxConsecutive"
  >
): SafetyCaps {
  let state = loadOrFresh(path);

  function rolloverIfNeeded(): void {
    const today = todayUtc();
    if (state.dateUtc !== today) {
      state = freshState();
      persist(path, state);
      return;
    }
    const hb = hourBucket();
    if (state.hourBucket !== hb) {
      state.hourBucket = hb;
      state.bakeCountThisHour = 0;
      persist(path, state);
    }
  }

  function save() { persist(path, state); }

  function trip(reason: string) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    state.killSwitchUntil = tomorrow.getTime();
    state.killSwitchReason = reason;
    save();
  }

  return {
    snapshot: () => {
      rolloverIfNeeded();
      return { ...state };
    },
    isKilled: (killFlagPath?: string) => {
      rolloverIfNeeded();
      if (killFlagPath && existsSync(killFlagPath)) return true;
      if (state.killSwitchUntil && Date.now() < state.killSwitchUntil) return true;
      if (state.killSwitchUntil && Date.now() >= state.killSwitchUntil) {
        state.killSwitchUntil = null;
        state.killSwitchReason = null;
        save();
      }
      return false;
    },
    preflight: (estGasWei, estVrfWei) => {
      rolloverIfNeeded();
      if (state.gasSpentWei + estGasWei > cfg.maxGasPerDayWei) {
        return { ok: false, reason: "daily gas cap would be exceeded" };
      }
      if (state.vrfSpentWei + estVrfWei > cfg.maxVrfPerDayWei) {
        return { ok: false, reason: "daily VRF cap would be exceeded" };
      }
      if (state.bakeCountThisHour >= cfg.maxBakesPerHour) {
        return { ok: false, reason: "hourly bake cap reached" };
      }
      return { ok: true };
    },
    recordTxResult: (r) => {
      rolloverIfNeeded();
      if (r.ok) {
        state.gasSpentWei += r.gasUsedWei;
        state.vrfSpentWei += r.vrfPaidWei;
        state.bakeCountToday += 1;
        state.bakeCountThisHour += 1;
        state.consecutiveFailedTx = 0;
        if (state.gasSpentWei >= cfg.maxGasPerDayWei) {
          trip("daily gas cap exceeded");
        }
        if (state.bakeCountThisHour > cfg.maxBakesPerHour) {
          trip("hourly bake anomaly");
        }
      } else if (!r.expected) {
        state.consecutiveFailedTx += 1;
        if (state.consecutiveFailedTx >= cfg.maxFailedTxConsecutive) {
          trip(`${cfg.maxFailedTxConsecutive} consecutive failed tx`);
        }
      }
      save();
    },
    trip,
  };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run tests/safety-caps.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/safety-caps.ts tests/safety-caps.test.ts
git commit -m "feat(safety): daily caps, kill switch, atomic persistence, UTC rollover"
```

---

## Task 5: Decision Engine

**Files:**
- Create: `src/decision-engine.ts`
- Create: `tests/fixtures/state.ts`
- Create: `tests/decision-engine.test.ts`

- [ ] **Step 1: Write `tests/fixtures/state.ts`**

```ts
import type { Config, State } from "../../src/types.js";

export function makeState(overrides: Partial<State> = {}): State {
  return {
    ethWei: 50_000_000_000_000_000n,
    blockNumber: 1000n,
    lastBakeBlock: 900n,
    effectiveMultiplierBps: 10000,
    activeRugs: [],
    playerSkill: "Sweeper",
    sweeperFreeReady: true,
    bakeCooldownBlocks: 5,
    vrfFeeWei: 100_000_000_000_000n,
    cleanupCrewBoostTypeId: 7,
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    clanId: 1,
    minMultiplierBps: 10000,
    pollIntervalMs: 15000,
    bakeCooldownBlocks: 5,
    minEthReserveWei: 5_000_000_000_000_000n,
    maxGasPerDayWei: 10_000_000_000_000_000n,
    maxVrfPerDayWei: 1_000_000_000_000_000n,
    maxBakesPerHour: 30,
    maxFailedTxConsecutive: 5,
    telegram: { chatId: "", botToken: "" },
    rpcUrl: "http://x",
    sessionKeyPrivateKey: "0x".padEnd(66, "1") as `0x${string}`,
    agwOwnerAddress: "0x".padEnd(42, "2") as `0x${string}`,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write failing test `tests/decision-engine.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { decide } from "../src/decision-engine.js";
import { makeConfig, makeState } from "./fixtures/state.js";

describe("decide", () => {
  it("sleeps when ETH below reserve", () => {
    const s = makeState({ ethWei: 1_000_000_000_000_000n });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });

  it("sleeps when cooldown not elapsed", () => {
    const s = makeState({ blockNumber: 902n, lastBakeBlock: 900n });
    const a = decide(s, makeConfig());
    expect(a.kind).toBe("sleep");
    if (a.kind === "sleep") expect(a.reason).toBe("cooldown");
  });

  it("bakes when multiplier exactly at threshold", () => {
    const s = makeState({ effectiveMultiplierBps: 10000 });
    expect(decide(s, makeConfig({ minMultiplierBps: 10000 })).kind).toBe("bake");
  });

  it("sleeps when multiplier below threshold", () => {
    const s = makeState({ effectiveMultiplierBps: 9999 });
    expect(decide(s, makeConfig({ minMultiplierBps: 10000 })).kind).toBe("sleep");
  });

  it("prefers cleanup when rug active and sweeper free is ready", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      playerSkill: "Sweeper",
      sweeperFreeReady: true,
    });
    expect(decide(s, makeConfig()).kind).toBe("cleanup");
  });

  it("does not cleanup when sweeper cooldown not ready (even if rug present)", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      playerSkill: "Sweeper",
      sweeperFreeReady: false,
      effectiveMultiplierBps: 7000,
    });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });

  it("does not cleanup if player skill is not Sweeper", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      playerSkill: "Lucky",
      sweeperFreeReady: true,
      effectiveMultiplierBps: 7000,
    });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });

  it("does not cleanup when no rug present", () => {
    const s = makeState({ activeRugs: [], playerSkill: "Sweeper", sweeperFreeReady: true });
    expect(decide(s, makeConfig()).kind).toBe("bake");
  });

  it("bakes during Rush Order event (1.10x)", () => {
    const s = makeState({ effectiveMultiplierBps: 11000 });
    expect(decide(s, makeConfig({ minMultiplierBps: 10500 })).kind).toBe("bake");
  });

  it("sleeps when only Rush Order (1.10x) but threshold is Golden Batch (1.20x)", () => {
    const s = makeState({ effectiveMultiplierBps: 11000 });
    expect(decide(s, makeConfig({ minMultiplierBps: 12000 })).kind).toBe("sleep");
  });

  it("sleeps below threshold even when rug expired and skill is Sweeper", () => {
    const s = makeState({
      activeRugs: [],
      playerSkill: "Sweeper",
      sweeperFreeReady: true,
      effectiveMultiplierBps: 9000,
    });
    expect(decide(s, makeConfig({ minMultiplierBps: 10000 })).kind).toBe("sleep");
  });

  it("cleanup not chosen if cleanupCrewBoostTypeId is null (catalog unknown)", () => {
    const s = makeState({
      activeRugs: [{ boostTypeId: 11, endTimeUnix: 9_999_999_999, severityBps: 5000 }],
      cleanupCrewBoostTypeId: null,
      effectiveMultiplierBps: 7000,
    });
    expect(decide(s, makeConfig()).kind).toBe("sleep");
  });
});
```

- [ ] **Step 3: Run test, expect fail**

Run: `npx vitest run tests/decision-engine.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `src/decision-engine.ts`**

```ts
import type { Action, Config, State } from "./types.js";

export function decide(s: State, cfg: Config): Action {
  if (s.ethWei < cfg.minEthReserveWei) {
    return { kind: "sleep", reason: "low ETH" };
  }
  if (s.blockNumber - s.lastBakeBlock < BigInt(s.bakeCooldownBlocks)) {
    return { kind: "sleep", reason: "cooldown" };
  }
  const hasRug = s.activeRugs.length > 0;
  if (
    hasRug &&
    s.playerSkill === "Sweeper" &&
    s.sweeperFreeReady &&
    s.cleanupCrewBoostTypeId !== null
  ) {
    return { kind: "cleanup" };
  }
  if (s.effectiveMultiplierBps >= cfg.minMultiplierBps) {
    return { kind: "bake" };
  }
  return { kind: "sleep", reason: "multiplier below threshold" };
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run tests/decision-engine.test.ts`
Expected: 12 passing.

- [ ] **Step 6: Commit**

```bash
git add src/decision-engine.ts tests/decision-engine.test.ts tests/fixtures/state.ts
git commit -m "feat(decision): pure decide() with 12 unit cases covering all branches"
```

---

## Task 6: State Reader + agent.json Cache

**Files:**
- Create: `src/agent-json.ts` (helper, single responsibility for the cached fetch)
- Create: `src/abis.ts` (minimal ABIs for read calls)
- Create: `src/state-reader.ts`
- Create: `tests/state-reader.test.ts`

- [ ] **Step 1: Write `src/abis.ts`** (minimal ABI fragments only for the reads we need)

```ts
export const BOOST_MANAGER_READ_ABI = [
  {
    type: "function",
    name: "getEffectiveMultiplier",
    stateMutability: "view",
    inputs: [{ name: "clanId", type: "uint256" }],
    outputs: [{ name: "bps", type: "uint256" }],
  },
  {
    type: "function",
    name: "getActiveDebuffs",
    stateMutability: "view",
    inputs: [{ name: "clanId", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "boostTypeId", type: "uint256" },
          { name: "endTimeUnix", type: "uint256" },
          { name: "severityBps", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getVrfFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "wei", type: "uint256" }],
  },
] as const;

export const PLAYER_REGISTRY_READ_ABI = [
  {
    type: "function",
    name: "lastBakeBlock",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "block", type: "uint256" }],
  },
] as const;

export const PLAYER_SKILLS_READ_ABI = [
  {
    type: "function",
    name: "getPlayerSkill",
    stateMutability: "view",
    inputs: [
      { name: "player", type: "address" },
      { name: "seasonId", type: "uint256" },
    ],
    outputs: [{ name: "skillId", type: "uint8" }],
  },
  {
    type: "function",
    name: "getSweeperFreeReadyAt",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "unix", type: "uint256" }],
  },
] as const;

export const SKILL_ID_TO_NAME = [
  "None",
  "Lucky",
  "Evil",
  "Booster",
  "Saboteur",
  "Sweeper",
  "Perfectionist",
  "Trailblazer",
  "Guardian",
] as const;
```

> **Note for implementer:** the exact method names and tuple shapes above are
> the bot-side contract this code expects. Before integration, the agent must
> read `/agent.json` and validate that the published ABIs match. If any
> signature differs (e.g. the live contract exposes `effectiveMultiplier(uint256)`
> instead of `getEffectiveMultiplier`), update both `src/abis.ts` and the
> corresponding `readContract` calls in `src/state-reader.ts`. Live ABI
> validation is part of integration testing (Task 10).

- [ ] **Step 2: Write `src/agent-json.ts`**

```ts
export type AgentJson = {
  chainId: number;
  seasonId: number;
  contracts: {
    boostManager: `0x${string}`;
    playerRegistry: `0x${string}`;
    playerSkills: `0x${string}`;
    clanRegistry: `0x${string}`;
  };
  boostCatalog: Array<{
    typeId: number;
    name: string;
    isRandomEvent: boolean;
    isCountermeasure: boolean;
  }>;
};

const TTL_MS = 5 * 60 * 1000;
const URL = "https://www.rugpullbakery.com/agent.json";

let cache: { at: number; data: AgentJson } | null = null;

export async function getAgentJson(fetcher: typeof fetch = fetch): Promise<AgentJson> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetcher(URL);
    if (!res.ok) throw new Error(`agent.json HTTP ${res.status}`);
    const data = (await res.json()) as AgentJson;
    cache = { at: now, data };
    return data;
  } catch (err) {
    if (cache) return cache.data;
    throw err;
  }
}

export function _resetAgentJsonCacheForTests(): void {
  cache = null;
}
```

- [ ] **Step 3: Write failing test `tests/state-reader.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetAgentJsonCacheForTests, getAgentJson } from "../src/agent-json.js";

afterEach(() => {
  _resetAgentJsonCacheForTests();
  vi.useRealTimers();
});

const sampleAgentJson = {
  chainId: 2741,
  seasonId: 10,
  contracts: {
    boostManager: "0xaaaa000000000000000000000000000000000000",
    playerRegistry: "0xbbbb000000000000000000000000000000000000",
    playerSkills: "0xcccc000000000000000000000000000000000000",
    clanRegistry: "0xdddd000000000000000000000000000000000000",
  },
  boostCatalog: [
    { typeId: 7, name: "Cleanup Crew", isRandomEvent: false, isCountermeasure: true },
    { typeId: 11, name: "Stink Bomb", isRandomEvent: false, isCountermeasure: false },
  ],
};

describe("getAgentJson", () => {
  it("fetches and caches", async () => {
    const fetcher = vi.fn(async () =>
      ({ ok: true, json: async () => sampleAgentJson } as unknown as Response)
    );
    const a = await getAgentJson(fetcher);
    const b = await getAgentJson(fetcher);
    expect(a).toEqual(sampleAgentJson);
    expect(b).toEqual(sampleAgentJson);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
    const fetcher = vi.fn(async () =>
      ({ ok: true, json: async () => sampleAgentJson } as unknown as Response)
    );
    await getAgentJson(fetcher);
    vi.setSystemTime(new Date("2026-06-05T10:06:00Z"));
    await getAgentJson(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns stale cache when network fails", async () => {
    const okFetcher = vi.fn(async () =>
      ({ ok: true, json: async () => sampleAgentJson } as unknown as Response)
    );
    await getAgentJson(okFetcher);
    _resetAgentJsonCacheForTests();
    await getAgentJson(okFetcher);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T11:00:00Z"));
    const failFetcher = vi.fn(async () => {
      throw new Error("net down");
    });
    const result = await getAgentJson(failFetcher);
    expect(result.chainId).toBe(2741);
  });

  it("throws when no cache and network fails", async () => {
    const failFetcher = vi.fn(async () => {
      throw new Error("net down");
    });
    await expect(getAgentJson(failFetcher)).rejects.toThrow("net down");
  });
});

describe("findCleanupCrewBoostTypeId", () => {
  it("returns matching typeId by name", async () => {
    const { findCleanupCrewBoostTypeId } = await import("../src/state-reader.js");
    expect(findCleanupCrewBoostTypeId(sampleAgentJson.boostCatalog)).toBe(7);
  });

  it("returns null when not in catalog", async () => {
    const { findCleanupCrewBoostTypeId } = await import("../src/state-reader.js");
    expect(
      findCleanupCrewBoostTypeId([
        { typeId: 1, name: "Other", isRandomEvent: false, isCountermeasure: false },
      ])
    ).toBeNull();
  });
});
```

- [ ] **Step 4: Run test, expect fail**

Run: `npx vitest run tests/state-reader.test.ts`
Expected: FAIL.

- [ ] **Step 5: Write `src/state-reader.ts`**

```ts
import { createPublicClient, http, type PublicClient } from "viem";
import type { AgentJson } from "./agent-json.js";
import { getAgentJson } from "./agent-json.js";
import {
  BOOST_MANAGER_READ_ABI,
  PLAYER_REGISTRY_READ_ABI,
  PLAYER_SKILLS_READ_ABI,
  SKILL_ID_TO_NAME,
} from "./abis.js";
import type { Address, Config, Debuff, SkillId, State } from "./types.js";

const ABSTRACT_CHAIN_ID = 2741;

export function findCleanupCrewBoostTypeId(
  catalog: AgentJson["boostCatalog"]
): number | null {
  const hit = catalog.find(
    (b) => b.isCountermeasure && b.name.toLowerCase().includes("cleanup")
  );
  return hit?.typeId ?? null;
}

export async function assertChainId(client: PublicClient): Promise<void> {
  const id = await client.getChainId();
  if (id !== ABSTRACT_CHAIN_ID) {
    throw new Error(`chain mismatch: RPC reports ${id}, expected ${ABSTRACT_CHAIN_ID}`);
  }
}

export type StateReader = {
  read: () => Promise<State>;
  publicClient: PublicClient;
};

export function createStateReader(cfg: Config): StateReader {
  const publicClient = createPublicClient({
    transport: http(cfg.rpcUrl),
  }) as PublicClient;

  return {
    publicClient,
    read: async (): Promise<State> => {
      const agent = await getAgentJson();
      const cleanupId = findCleanupCrewBoostTypeId(agent.boostCatalog);

      const [
        ethWei,
        blockNumber,
        multiplier,
        rawRugs,
        vrfFeeWei,
        lastBakeBlockRaw,
        skillIdRaw,
        sweeperReadyAt,
      ] = await Promise.all([
        publicClient.getBalance({ address: cfg.agwOwnerAddress }),
        publicClient.getBlockNumber(),
        publicClient.readContract({
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getEffectiveMultiplier",
          args: [BigInt(cfg.clanId)],
        }),
        publicClient.readContract({
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getActiveDebuffs",
          args: [BigInt(cfg.clanId)],
        }),
        publicClient.readContract({
          address: agent.contracts.boostManager,
          abi: BOOST_MANAGER_READ_ABI,
          functionName: "getVrfFee",
          args: [],
        }),
        publicClient.readContract({
          address: agent.contracts.playerRegistry,
          abi: PLAYER_REGISTRY_READ_ABI,
          functionName: "lastBakeBlock",
          args: [cfg.agwOwnerAddress],
        }),
        publicClient.readContract({
          address: agent.contracts.playerSkills,
          abi: PLAYER_SKILLS_READ_ABI,
          functionName: "getPlayerSkill",
          args: [cfg.agwOwnerAddress, BigInt(agent.seasonId)],
        }),
        publicClient.readContract({
          address: agent.contracts.playerSkills,
          abi: PLAYER_SKILLS_READ_ABI,
          functionName: "getSweeperFreeReadyAt",
          args: [cfg.agwOwnerAddress],
        }),
      ]);

      const activeRugs: Debuff[] = (rawRugs as Array<{
        boostTypeId: bigint;
        endTimeUnix: bigint;
        severityBps: bigint;
      }>).map((r) => ({
        boostTypeId: Number(r.boostTypeId),
        endTimeUnix: Number(r.endTimeUnix),
        severityBps: Number(r.severityBps),
      }));

      const playerSkill: SkillId =
        SKILL_ID_TO_NAME[Number(skillIdRaw)] ?? "None";
      const sweeperFreeReady =
        playerSkill === "Sweeper" &&
        Math.floor(Date.now() / 1000) >= Number(sweeperReadyAt);

      return {
        ethWei: ethWei as bigint,
        blockNumber: blockNumber as bigint,
        lastBakeBlock: lastBakeBlockRaw as bigint,
        effectiveMultiplierBps: Number(multiplier),
        activeRugs,
        playerSkill,
        sweeperFreeReady,
        bakeCooldownBlocks: cfg.bakeCooldownBlocks,
        vrfFeeWei: vrfFeeWei as bigint,
        cleanupCrewBoostTypeId: cleanupId,
      };
    },
  };
}
```

- [ ] **Step 6: Run tests, expect pass**

Run: `npx vitest run tests/state-reader.test.ts`
Expected: 6 passing.

- [ ] **Step 7: Commit**

```bash
git add src/agent-json.ts src/abis.ts src/state-reader.ts tests/state-reader.test.ts
git commit -m "feat(state-reader): agent.json cache + parallel eth_call batch + chain-ID guard"
```

---

## Task 7: Telegram Notifier (Rate-Limited + Deduped)

**Files:**
- Create: `src/telegram-notifier.ts`
- Create: `tests/telegram-notifier.test.ts`

- [ ] **Step 1: Write failing test `tests/telegram-notifier.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramNotifier } from "../src/telegram-notifier.js";

let sent: Array<{ chat: string; text: string }>;
const fakeSend = async (chat: string, text: string) => {
  sent.push({ chat, text });
};

beforeEach(() => {
  sent = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-05T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("telegram notifier", () => {
  it("sends a new alert", async () => {
    const n = createTelegramNotifier({ chatId: "1", botToken: "t" }, fakeSend);
    await n.send("hello");
    expect(sent).toHaveLength(1);
  });

  it("dedupes identical alerts inside the 1-hour window", async () => {
    const n = createTelegramNotifier({ chatId: "1", botToken: "t" }, fakeSend);
    await n.send("same");
    await n.send("same");
    await n.send("same");
    expect(sent).toHaveLength(1);
  });

  it("re-emits the same alert after 1 hour", async () => {
    const n = createTelegramNotifier({ chatId: "1", botToken: "t" }, fakeSend);
    await n.send("same");
    vi.setSystemTime(new Date("2026-06-05T11:01:00Z"));
    await n.send("same");
    expect(sent).toHaveLength(2);
  });

  it("caps total at 20 messages per rolling hour and emits one summary", async () => {
    const n = createTelegramNotifier({ chatId: "1", botToken: "t" }, fakeSend);
    for (let i = 0; i < 25; i++) {
      await n.send(`alert ${i}`);
    }
    expect(sent.length).toBeLessThanOrEqual(21);
    expect(sent[20]?.text).toMatch(/dropped/i);
  });

  it("no-ops when chatId is empty (TG disabled)", async () => {
    const n = createTelegramNotifier({ chatId: "", botToken: "t" }, fakeSend);
    await n.send("hello");
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run tests/telegram-notifier.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/telegram-notifier.ts`**

```ts
const HOUR_MS = 60 * 60 * 1000;
const HARD_CAP_PER_HOUR = 20;

export type SendFn = (chatId: string, text: string) => Promise<void>;

async function defaultSend(chatId: string, botToken: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    throw new Error(`telegram HTTP ${res.status}`);
  }
}

export type TelegramNotifier = {
  send: (text: string) => Promise<void>;
};

export function createTelegramNotifier(
  cfg: { chatId: string; botToken: string },
  sendOverride?: SendFn
): TelegramNotifier {
  if (!cfg.chatId || !cfg.botToken) {
    return { send: async () => {} };
  }
  const send: SendFn =
    sendOverride ?? ((chat, text) => defaultSend(chat, cfg.botToken, text));

  const lastSeen = new Map<string, number>();
  const sentTimestamps: number[] = [];
  let summaryEmittedAt = 0;
  let droppedSinceSummary = 0;

  function prune(now: number) {
    while (sentTimestamps.length && now - sentTimestamps[0]! > HOUR_MS) {
      sentTimestamps.shift();
    }
    for (const [k, t] of lastSeen) if (now - t > HOUR_MS) lastSeen.delete(k);
  }

  return {
    send: async (text: string) => {
      const now = Date.now();
      prune(now);

      const lastTs = lastSeen.get(text);
      if (lastTs !== undefined && now - lastTs <= HOUR_MS) {
        return;
      }

      if (sentTimestamps.length >= HARD_CAP_PER_HOUR) {
        droppedSinceSummary += 1;
        if (now - summaryEmittedAt > HOUR_MS) {
          summaryEmittedAt = now;
          try {
            await send(cfg.chatId, `[summary] ${droppedSinceSummary} alerts dropped (hourly cap)`);
            sentTimestamps.push(now);
            droppedSinceSummary = 0;
          } catch {
          }
        }
        return;
      }

      try {
        await send(cfg.chatId, text);
        sentTimestamps.push(now);
        lastSeen.set(text, now);
      } catch {
      }
    },
  };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run tests/telegram-notifier.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/telegram-notifier.ts tests/telegram-notifier.test.ts
git commit -m "feat(telegram): dedup + 20/hour cap + summary; safe no-op when disabled"
```

---

## Task 8: Session Key Signer

**Files:**
- Create: `src/session-key.ts`

> **No unit tests for this module.** It is a thin adapter over
> `@abstract-foundation/agw-client`; mocking the SDK adds noise without
> exercising real behaviour. It is validated end-to-end against testnet in
> Task 10 (manual integration).

- [ ] **Step 1: Write `src/session-key.ts`**

```ts
import { createSessionClient } from "@abstract-foundation/agw-client/sessions";
import { privateKeyToAccount } from "viem/accounts";
import { http } from "viem";
import { abstract } from "viem/chains";
import type { Address, Config, Hex } from "./types.js";

export type SessionSigner = ReturnType<typeof createSessionClient>;

export function createSessionSigner(cfg: Config): SessionSigner {
  const signer = privateKeyToAccount(cfg.sessionKeyPrivateKey as Hex);
  return createSessionClient({
    account: cfg.agwOwnerAddress as Address,
    chain: abstract,
    signer,
    transport: http(cfg.rpcUrl),
  });
}
```

> **Implementer note:** the exact `@abstract-foundation/agw-client` API may
> differ between SDK versions. If `createSessionClient` is not the canonical
> name or its argument shape differs in the installed version, consult the
> `@abstract-foundation/agw-client` package's `dist/types/sessions.d.ts` and
> adjust this file accordingly. The expected surface is "construct an object
> that can `writeContract` / `sendTransaction` on the AGW's behalf, signing
> with the session-key private key, scoped to the methods the AGW already
> authorised". If the SDK uses a different name (e.g. `toSessionAccount`,
> `createSessionAccount`), update the import and call site to match —
> behaviour is the same.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: success. If TypeScript errors about missing exports, see the implementer note above and adjust against the installed SDK's actual surface.

- [ ] **Step 3: Commit**

```bash
git add src/session-key.ts
git commit -m "feat(session-key): construct AGW session client from env-supplied key"
```

---

## Task 9: Executor (Simulate, Sign, Send, Receipt)

**Files:**
- Create: `src/executor.ts`

> **No unit tests for this module** for the same reason as session-key —
> it is a thin viem wrapper. Behaviour is exercised by the integration
> step in Task 10.

- [ ] **Step 1: Write `src/executor.ts`**

```ts
import type { PublicClient } from "viem";
import { BOOST_MANAGER_READ_ABI, PLAYER_REGISTRY_READ_ABI } from "./abis.js";
import type { Logger } from "./logger.js";
import type { SessionSigner } from "./session-key.js";
import type { Action, Config, Hex, TxResult } from "./types.js";

const PLAYER_REGISTRY_WRITE_ABI = [
  ...PLAYER_REGISTRY_READ_ABI,
  {
    type: "function",
    name: "bake",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

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
  agentContracts: { boostManager: Hex; playerRegistry: Hex };
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
        const { expected, reason } = classifyRevert(`${description} reverted on-chain`);
        log.warn("tx reverted", { description, txHash: hash, reason });
        return { ok: false, reason, expected };
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
          agentContracts.playerRegistry,
          PLAYER_REGISTRY_WRITE_ABI,
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
            address: agentContracts.playerRegistry,
            abi: PLAYER_REGISTRY_WRITE_ABI,
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/executor.ts
git commit -m "feat(executor): simulate-then-send for bake/cleanup with classified reverts"
```

---

## Task 10: Main Loop

**Files:**
- Modify: `src/main.ts` (currently the stub from Task 0)

- [ ] **Step 1: Replace `src/main.ts` entirely**

```ts
import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfigFromDisk } from "./config.js";
import { getAgentJson } from "./agent-json.js";
import { createLogger } from "./logger.js";
import { createSafetyCaps } from "./safety-caps.js";
import { decide } from "./decision-engine.js";
import { createStateReader, assertChainId } from "./state-reader.js";
import { createSessionSigner } from "./session-key.js";
import { createExecutor } from "./executor.js";
import { createTelegramNotifier } from "./telegram-notifier.js";

const DATA_DIR = "data";
const KILL_FLAG_PATH = join(DATA_DIR, "kill.flag");
const SAFETY_PATH = join(DATA_DIR, "safety.json");
const LOG_PATH = join(DATA_DIR, "events.jsonl");

async function main(): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const log = createLogger(LOG_PATH);
  const cfg = loadConfigFromDisk();
  const safety = createSafetyCaps(SAFETY_PATH, cfg);
  const tg = createTelegramNotifier(cfg.telegram);
  const reader = createStateReader(cfg);
  const signer = createSessionSigner(cfg);

  await assertChainId(reader.publicClient);
  const agent = await getAgentJson();
  if (agent.chainId !== 2741) {
    throw new Error(`/agent.json chainId mismatch: ${agent.chainId}`);
  }

  const executor = createExecutor({
    cfg,
    publicClient: reader.publicClient,
    signer,
    agentContracts: {
      boostManager: agent.contracts.boostManager,
      playerRegistry: agent.contracts.playerRegistry,
    },
    log,
  });

  log.info("bot up", { clanId: cfg.clanId, agwOwner: cfg.agwOwnerAddress });
  await tg.send(`Rugpull bot started, clan ${cfg.clanId}`);

  let killAnnouncedAt = 0;
  let backoffMs = 0;

  while (true) {
    try {
      if (safety.isKilled(KILL_FLAG_PATH)) {
        const snap = safety.snapshot();
        if (Date.now() - killAnnouncedAt > 60 * 60 * 1000) {
          killAnnouncedAt = Date.now();
          await tg.send(`KILL SWITCH active. Reason: ${snap.killSwitchReason}`);
          log.warn("kill switch active", { reason: snap.killSwitchReason });
        }
        await sleep(5 * 60 * 1000);
        continue;
      }

      const state = await reader.read();
      const action = decide(state, cfg);

      if (action.kind === "sleep") {
        log.info("sleep", { reason: action.reason, multiplierBps: state.effectiveMultiplierBps });
        if (action.reason === "low ETH") {
          await tg.send(`ETH balance low: ${state.ethWei} wei`);
        }
        backoffMs = 0;
        await sleep(cfg.pollIntervalMs);
        continue;
      }

      const estGas = 200_000n * (await reader.publicClient.getGasPrice());
      const estVrf = action.kind === "cleanup" ? state.vrfFeeWei : 0n;
      const pre = safety.preflight(estGas, estVrf);
      if (!pre.ok) {
        log.info("preflight blocked", { reason: pre.reason });
        await sleep(cfg.pollIntervalMs);
        continue;
      }

      const result = await executor.execute(action, {
        clanId: cfg.clanId,
        cleanupBoostTypeId: state.cleanupCrewBoostTypeId,
        vrfFeeWei: state.vrfFeeWei,
      });
      safety.recordTxResult(result);

      if (!result.ok && !result.expected) {
        await tg.send(`Unexpected tx failure: ${result.reason}`);
      }
      if (result.ok && action.kind === "cleanup") {
        await tg.send(`Sweeper cleanup sent: ${result.txHash}`);
      }

      backoffMs = 0;
      await sleep(cfg.pollIntervalMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("tick error", { msg });
      backoffMs = Math.min(60_000, backoffMs === 0 ? 1000 : backoffMs * 2);
      await sleep(backoffMs);
    }
  }
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `dotenv` to deps**

Run: `npm install dotenv`
Expected: dotenv added.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all tests from Tasks 2-7 pass (decision, safety, config, logger, state-reader, telegram).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts package.json package-lock.json
git commit -m "feat(main): polling tick loop with chain-ID guard, preflight, and TG alerts"
```

- [ ] **Step 6: Manual integration smoke (testnet)**

This is manual; the implementer should:

1. Provision a small amount of Abstract testnet ETH (chain 11124) to a throwaway AGW.
2. Join/create a testnet clan, pick Sweeper.
3. Set `ABSTRACT_RPC_URL=https://api.testnet.abs.xyz`, generate a testnet session key, fill `.env`.
4. Set `config.json` `clanId` and run `npm run dev`.
5. Watch stdout for `bot up`, then a sequence of `sleep` and ideally one `bake ok` over ~10 minutes.
6. Stop with Ctrl+C.

If the SDK surface for session keys differs from what `src/session-key.ts` assumes, this is where the implementer adjusts and re-runs. Do **not** proceed to Docker until testnet smoke is green.

- [ ] **Step 7: Commit any session-key SDK adjustments**

```bash
git add src/session-key.ts
git commit -m "fix(session-key): align with installed agw-client SDK surface"
```

(Skip this commit if no changes were needed.)

---

## Task 11: Dockerization

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
data
.git
.env
*.log
tests
docs
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S bot && adduser -S bot -G bot
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config.json ./config.json
RUN mkdir -p /app/data && chown -R bot:bot /app
USER bot
CMD ["node", "dist/main.js"]
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  bot:
    build: .
    container_name: rugpull-bakery-bot
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
      - ./config.json:/app/config.json:ro
    init: true
    stop_grace_period: 10s
```

- [ ] **Step 4: Build and inspect locally**

Run: `docker compose build`
Expected: image builds successfully. (No `up` yet — that requires a real `.env`.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "build: multi-stage Dockerfile + compose with persistent data volume"
```

---

## Task 12: README + Onboarding Doc

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with onboarding, run, maintenance, and safety overview"
```

---

## Self-Review (after writing the plan)

- **Spec coverage** — every module in the spec has a task (config T2, logger T3, safety T4, decision T5, state-reader T6, telegram T7, session-key T8, executor T9, main T10, Docker T11, README T12). The spec's Security section is implemented across T2 (zod validation incl. chain-id constants placed in T6 via `assertChainId`), T3 (redaction tested), T6 (`assertChainId`), T7 (rate-limit/dedup tested), T10 (chain-ID asserted on boot, revocation procedure documented in T12 README). Onboarding checklist is in T12 README.
- **Placeholders** — no `TODO`/`TBD`. Every code step has full code. Two implementer notes flag SDK-API drift (Tasks 6 and 8): those are not placeholders, they are intentional pointers to verify the live SDK surface during integration, with concrete fallback instructions.
- **Type consistency** — `State`, `Action`, `Config`, `SafetyState`, `TxResult` defined once in T1 and used unchanged by every later task. `bps` representation is used consistently for multipliers throughout.
- **Test depth** — config (6 cases), logger (3), safety (9), decision (12), state-reader/agent-json (6), telegram (5). Executor and session-key are intentionally exercised via the testnet smoke step in T10 rather than mocked.
