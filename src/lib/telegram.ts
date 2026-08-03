import "server-only";

/**
 * Shared server-side Telegram sender (same retry/backoff behaviour as the
 * private copy in fantasy/ops.ts — extracted rather than exported so the
 * watchdog file stays untouched; fold that copy into here on a later pass).
 *
 * Token: TELEGRAM_LAUNCH_BOT_TOKEN, falling back to TELEGRAM_BOT_TOKEN.
 * Chat:  explicit `chatId` param, else TELEGRAM_LAUNCH_CHAT_ID / TELEGRAM_CHAT_ID.
 * Unconfigured = log + false, never a throw — alerts must not take a cron down.
 */
export async function sendTelegram(text: string, chatId?: string): Promise<boolean> {
  const token = process.env.TELEGRAM_LAUNCH_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chat = chatId || process.env.TELEGRAM_LAUNCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.error("[telegram] not configured — skipping send"); return false; }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      const j = await res.json();
      if (j.ok) return true;
      if (res.status !== 429 && res.status < 500) { console.error("[telegram] send error:", j); return false; }
    } catch (e) {
      console.error(`[telegram] send attempt ${attempt + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  console.error("[telegram] send failed after retries");
  return false;
}

/** Escape user-controlled text for Telegram HTML parse_mode. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
