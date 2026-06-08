import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPending, writePending, clearPending } from "../src/pending-tx.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pending-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("pending-tx", () => {
  it("returns null when file does not exist", () => {
    expect(readPending(dir)).toBeNull();
  });
  it("round-trips a pending entry", () => {
    writePending(dir, { kind: "bake", txHash: "0xabc", broadcastAtUnix: 12345 });
    const r = readPending(dir);
    expect(r?.kind).toBe("bake");
    expect(r?.txHash).toBe("0xabc");
    expect(r?.broadcastAtUnix).toBe(12345);
  });
  it("clearPending removes the file", () => {
    writePending(dir, { kind: "cleanup", txHash: "0xdef", broadcastAtUnix: 1 });
    expect(existsSync(join(dir, "pending-tx.json"))).toBe(true);
    clearPending(dir);
    expect(existsSync(join(dir, "pending-tx.json"))).toBe(false);
  });
  it("returns null on corrupted JSON", () => {
    writeFileSync(join(dir, "pending-tx.json"), "not-json{{");
    expect(readPending(dir)).toBeNull();
  });
  it("writes atomically (tmp + rename)", () => {
    writePending(dir, { kind: "bake", txHash: "0xaaa", broadcastAtUnix: 42 });
    const raw = JSON.parse(readFileSync(join(dir, "pending-tx.json"), "utf8"));
    expect(raw.broadcastAtUnix).toBe(42);
  });
});
