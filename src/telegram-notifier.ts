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
