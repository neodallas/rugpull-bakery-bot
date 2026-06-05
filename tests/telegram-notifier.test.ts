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
