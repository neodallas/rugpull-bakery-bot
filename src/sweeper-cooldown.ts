import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COOLDOWN_SECONDS = 6 * 60 * 60;

export type SweeperCooldownState = { lastFreeCleanupAtUnix: number };

function path(dataDir: string): string {
  return join(dataDir, "sweeper-cooldown.json");
}

export function readSweeperCooldown(dataDir: string): SweeperCooldownState {
  const p = path(dataDir);
  if (!existsSync(p)) return { lastFreeCleanupAtUnix: 0 };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { lastFreeCleanupAtUnix: 0 };
  }
}

export function isSweeperFreeReady(state: SweeperCooldownState, nowUnix: number): boolean {
  return nowUnix - state.lastFreeCleanupAtUnix >= COOLDOWN_SECONDS;
}

export function recordSweeperCleanup(dataDir: string, nowUnix: number): void {
  writeFileSync(path(dataDir), JSON.stringify({ lastFreeCleanupAtUnix: nowUnix }));
}
