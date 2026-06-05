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

  it("redacts secrets nested inside arrays", () => {
    const log = createLogger(join(dir, "events.jsonl"));
    log.info("x", { secrets: [{ privateKey: "bad" }, { token: "tg" }] });
    const parsed = JSON.parse(readFileSync(join(dir, "events.jsonl"), "utf8"));
    expect(parsed.secrets[0].privateKey).toBe("[REDACTED]");
    expect(parsed.secrets[1].token).toBe("[REDACTED]");
  });

  it("serializes bigint as string", () => {
    const log = createLogger(join(dir, "events.jsonl"));
    log.info("x", { wei: 12345678901234567890n });
    const parsed = JSON.parse(readFileSync(join(dir, "events.jsonl"), "utf8"));
    expect(parsed.wei).toBe("12345678901234567890");
  });
});
