/**
 * tg-halftime.mjs — Telegram for the halftime gates.
 *
 * WHY THIS EXISTS AND DOESN'T JUST IMPORT scripts/tg.mjs:
 * tg.mjs is read-only for this workstream (spec §9) and its API is single-row
 * keyboards plus a BLOCKING await on one message. The veto gate needs neither:
 * it needs multi-row keyboards (Veto 1 / Veto 2 / Veto 3 · Veto all · KILL) and a
 * NON-BLOCKING poll over many fixtures' messages at once, because a Saturday
 * slate has five 15:00 kick-offs whose gates are open simultaneously. So this is
 * a sibling, not a fork: same token resolution, same retry/backoff, same exit-code
 * conventions as tg-gates.mjs (0 = go, 1 = stop, 3 = regenerate).
 *
 * BOT TOKEN — the one real footgun. getUpdates is SINGLE-CONSUMER per bot: two
 * processes polling the same bot steal each other's taps. tg.mjs already learned
 * this the hard way and moved the launch gates onto their own bot. The veto gate
 * runs on matchday afternoons, the daily launch runs at 07:00, so today they
 * would not usually collide — but "usually" is how you lose a founder's veto on a
 * Saturday. Set TELEGRAM_HALFTIME_BOT_TOKEN to a dedicated bot. Until it is set
 * this falls back to the launch bot and says so out loud.
 */

const TOKEN =
  process.env.TELEGRAM_HALFTIME_BOT_TOKEN ||
  process.env.TELEGRAM_LAUNCH_BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN;

const CHAT =
  process.env.TELEGRAM_HALFTIME_CHAT_ID ||
  process.env.TELEGRAM_LAUNCH_CHAT_ID ||
  process.env.TELEGRAM_CHAT_ID;

export const usingDedicatedBot = Boolean(process.env.TELEGRAM_HALFTIME_BOT_TOKEN);

const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TgError extends Error {}

/** Retry transient failures (DNS blips at VPS wake, 429s, 5xx). 4xx throws. */
async function call(method, body) {
  if (!TOKEN) throw new TgError("no Telegram bot token in env");
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(API(method), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok) return j.result;
      if (res.status !== 429 && res.status < 500) {
        throw new TgError(`telegram ${method} ${res.status}: ${JSON.stringify(j).slice(0, 240)}`);
      }
      lastErr = new TgError(`telegram ${method} ${res.status}`);
    } catch (e) {
      if (e instanceof TgError && /telegram .* 4\d\d:/.test(e.message)) throw e;
      lastErr = e;
    }
    await sleep(Math.min(20000, 1500 * 2 ** attempt));
  }
  throw lastErr;
}

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Send a message with an arbitrary keyboard LAYOUT (rows of buttons), unlike
 * tg.mjs's single-row helper. Returns the Telegram message object — the caller
 * MUST check it came back with a message_id: an unconfirmed send means the gate
 * was never actually offered, and a gate that was never offered is treated as a
 * veto, not as consent (§2.5 fail-safe direction).
 */
export async function send(text, { rows, chatId = CHAT } = {}) {
  if (!chatId) throw new TgError("no Telegram chat id in env");
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (rows?.length) {
    body.reply_markup = {
      inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
    };
  }
  const msg = await call("sendMessage", body);
  if (!msg?.message_id) throw new TgError("send returned no message_id");
  return msg;
}

export async function ack(callbackQueryId, text) {
  // A stale callback ("query is too old") is a 400 — never let it kill the gate.
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text }).catch(() => {});
}

export async function stripButtons(chatId, messageId) {
  await call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
}

/** Start the update cursor past everything already in the queue. */
export async function initOffset() {
  const init = await call("getUpdates", { timeout: 0 });
  return (init.at(-1)?.update_id ?? 0) + 1;
}

/**
 * ONE non-blocking poll tick. Long-polls up to `timeoutSec` and returns every
 * update since `offset`, along with the new offset. The caller owns the loop, so
 * several fixtures' gates and their deadlines can be serviced from a single
 * consumer of the update stream — which is the only safe shape, since getUpdates
 * is single-consumer per bot.
 */
export async function poll(offset, timeoutSec = 20) {
  const updates = await call("getUpdates", { offset, timeout: timeoutSec });
  let next = offset;
  const taps = [];
  const texts = [];
  for (const u of updates) {
    next = u.update_id + 1;
    if (u.callback_query) {
      taps.push({
        id: u.callback_query.id,
        data: String(u.callback_query.data ?? ""),
        chatId: u.callback_query.message?.chat?.id,
        messageId: u.callback_query.message?.message_id,
        from: u.callback_query.from?.username,
      });
    } else if (u.message?.text) {
      texts.push({
        text: String(u.message.text).trim(),
        chatId: u.message.chat?.id,
        from: u.message.from?.username,
      });
    }
  }
  return { offset: next, taps, texts };
}

export const chatId = () => CHAT;
