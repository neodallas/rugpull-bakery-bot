import { appendFileSync, existsSync, renameSync } from "node:fs";

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
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? redact(item as Record<string, unknown>)
          : item
      );
    } else if (v && typeof v === "object") {
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

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createLogger(path: string): Logger {
  let currentDate = todayUtc();

  function rotateIfNeeded(): void {
    const today = todayUtc();
    if (today === currentDate) return;
    // Rotate: events.jsonl → events-YYYY-MM-DD.jsonl
    if (existsSync(path)) {
      const archived = path.replace(/\.jsonl$/, `-${currentDate}.jsonl`);
      try {
        renameSync(path, archived);
      } catch {
        // best-effort; if rename fails, continue appending to current
      }
    }
    currentDate = today;
  }

  function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
    rotateIfNeeded();
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
