import { describe, expect, it } from "vitest";
import { isInvalidSessionError } from "../src/executor.js";

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
