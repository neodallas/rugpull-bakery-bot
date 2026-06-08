import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "./types.js";

export type PendingTx = {
  kind: "bake" | "cleanup";
  txHash: Hex;
  broadcastAtUnix: number;
};

function path(dataDir: string): string {
  return join(dataDir, "pending-tx.json");
}

export function readPending(dataDir: string): PendingTx | null {
  const p = path(dataDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (typeof raw?.kind !== "string" || typeof raw?.txHash !== "string") return null;
    return {
      kind: raw.kind,
      txHash: raw.txHash as Hex,
      broadcastAtUnix: typeof raw.broadcastAtUnix === "number" ? raw.broadcastAtUnix : 0,
    };
  } catch {
    return null;
  }
}

export function writePending(dataDir: string, pending: PendingTx): void {
  const p = path(dataDir);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(pending, null, 2));
  renameSync(tmp, p);
}

export function clearPending(dataDir: string): void {
  const p = path(dataDir);
  if (existsSync(p)) unlinkSync(p);
}
