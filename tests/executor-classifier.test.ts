import { describe, expect, it } from "vitest";
import {
  classifyRevert,
  isInvalidSessionError,
  sanitizeReason,
  setRpcUrlForReasonSanitization,
} from "../src/executor.js";

describe("isInvalidSessionError", () => {
  it("matches Session expired", () => {
    expect(isInvalidSessionError("Reverted: Session expired at block 123")).toBe(true);
  });
  it("matches SessionKeyValidator", () => {
    expect(isInvalidSessionError("SessionKeyValidator: signature invalid")).toBe(true);
  });
  it("matches Unauthorized", () => {
    expect(isInvalidSessionError("execution reverted: Unauthorized")).toBe(true);
  });
  it("does NOT match BakeTooSoon (regular revert)", () => {
    expect(isInvalidSessionError("BakeTooSoon: 3 blocks remaining")).toBe(false);
  });
  it("does NOT match empty", () => {
    expect(isInvalidSessionError("")).toBe(false);
  });
});

describe("classifyRevert (case-insensitive)", () => {
  it("matches WhoaSlowDown regardless of casing", () => {
    expect(classifyRevert("execution reverted: whoaslowdown").expected).toBe(true);
    expect(classifyRevert("WHOASLOWDOWN").expected).toBe(true);
    expect(classifyRevert("WhoaSlowDown").expected).toBe(true);
  });
  it("matches BakeTooSoon regardless of casing", () => {
    expect(classifyRevert("baketoosoon").expected).toBe(true);
  });
  it("does not match arbitrary text", () => {
    expect(classifyRevert("random unrelated error").expected).toBe(false);
  });
});

describe("sanitizeReason", () => {
  it("strips configured rpcUrl", () => {
    setRpcUrlForReasonSanitization("https://api.x.com/v2/SECRETKEY");
    expect(sanitizeReason("failed to reach https://api.x.com/v2/SECRETKEY/eth")).not.toContain("SECRETKEY");
    setRpcUrlForReasonSanitization("");  // reset
  });
  it("strips alchemy/infura-style URLs with long path segments", () => {
    const msg = "fetch failed: https://eth-mainnet.alchemyapi.io/v2/abc123def456ghi789jkl";
    expect(sanitizeReason(msg)).toContain("[URL-WITH-KEY]");
    expect(sanitizeReason(msg)).not.toContain("abc123def456ghi789jkl");
  });
});
