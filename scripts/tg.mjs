/**
 * tg.mjs — Telegram I/O for the daily quiz launch gates.
 *
 * The launch pipeline messages the founder on Telegram and waits for an
 * Approve/Reject tap at two gates (the quiz, then the assembled pack). This is
 * both a library (import the functions) and a CLI (for the orchestrator/skill).
 *
 * Env (.env.local): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
 *
 * CLI:
 *   node --env-file=.env.local scripts/tg.mjs text "message"
 *   node --env-file=.env.local scripts/tg.mjs photo <path> "caption"
 *   node --env-file=.env.local scripts/tg.mjs photos "caption" <path1> <path2> ...
 *   node --env-file=.env.local scripts/tg.mjs whoami            # capture chat id (send the bot a msg first)
 *   node --env-file=.env.local scripts/tg.mjs await "Approve today's quiz?" Approve Reject
 *        → prints the tapped button text (APPROVE/REJECT...) and exits 0; exits 2 on timeout.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Dedicated launch bot so the daily quiz gates never share an update stream with the
// X-repurpose poller (getUpdates is single-consumer per bot — a shared bot eats the taps).
// Falls back to the legacy shared bot until TELEGRAM_LAUNCH_BOT_TOKEN is set, so nothing breaks.
const TOKEN = process.env.TELEGRAM_LAUNCH_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_LAUNCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function need(v, name) { if (!v) { console.error(`✗ missing ${name} in env`); process.exit(1); } }

// Retry transient failures (DNS/network at Mac-wake, 429s, 5xx) with backoff so a single
// blip at 07:06 doesn't kill the launch. ~7 attempts over ~3 min. Telegram 4xx (other than
// 429) are real errors and throw immediately.
async function call(method, body, isForm = false) {
  need(TOKEN, "TELEGRAM_BOT_TOKEN");
  let lastErr;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(API(method), isForm
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (j.ok) return j.result;
      if (res.status !== 429 && res.status < 500) // permanent API error — don't retry
        throw new Error(`telegram ${method} ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      lastErr = new Error(`telegram ${method} ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    } catch (e) {
      if (/^telegram .* 4\d\d:/.test(e.message)) throw e; // permanent error bubbled from above
      lastErr = e; // network error (fetch failed / ENOTFOUND) — retry
    }
    await sleep(Math.min(30000, 2000 * 2 ** attempt)); // 2,4,8,16,30,30,30s
  }
  throw lastErr;
}

export async function sendMessage(text, { chatId = CHAT, buttons } = {}) {
  need(chatId, "TELEGRAM_CHAT_ID");
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false };
  if (buttons) body.reply_markup = { inline_keyboard: [buttons.map((b) => ({ text: b, callback_data: b }))] };
  return call("sendMessage", body);
}

export async function sendPhoto(path, caption = "", { chatId = CHAT } = {}) {
  need(chatId, "TELEGRAM_CHAT_ID");
  const fd = new FormData();
  fd.set("chat_id", String(chatId));
  if (caption) { fd.set("caption", caption); fd.set("parse_mode", "HTML"); }
  fd.set("photo", new Blob([readFileSync(path)]), basename(path));
  return call("sendPhoto", fd, true);
}

export async function sendPhotos(paths, caption = "", { chatId = CHAT } = {}) {
  need(chatId, "TELEGRAM_CHAT_ID");
  const fd = new FormData();
  fd.set("chat_id", String(chatId));
  const media = paths.map((p, i) => {
    const key = `photo${i}`;
    fd.set(key, new Blob([readFileSync(p)]), basename(p));
    return { type: "photo", media: `attach://${key}`, ...(i === 0 && caption ? { caption, parse_mode: "HTML" } : {}) };
  });
  fd.set("media", JSON.stringify(media));
  return call("sendMediaGroup", fd, true);
}

/** Capture the chat id from the most recent message sent TO the bot. */
export async function whoami() {
  const updates = await call("getUpdates", { offset: -1, timeout: 0 });
  const u = (updates || []).at(-1);
  const id = u?.message?.chat?.id ?? u?.callback_query?.message?.chat?.id;
  return { chatId: id, from: u?.message?.from?.username || u?.message?.chat?.first_name };
}

/**
 * Post a question with inline buttons, then long-poll until the founder taps one.
 * Returns the tapped button text (uppercased). Rejects on timeout.
 * Telegram long-poll handles the waiting; each getUpdates call blocks up to 50s.
 */
export async function awaitApproval(prompt, { buttons = ["Approve", "Reject"], timeoutSec = 3600, chatId = CHAT } = {}) {
  const msg = await sendMessage(prompt, { chatId, buttons });
  const deadline = Date.now() + timeoutSec * 1000;
  // Start from the latest update id so we ignore old taps.
  let offset;
  { const init = await call("getUpdates", { timeout: 0, allowed_updates: ["callback_query"] }); offset = (init.at(-1)?.update_id ?? 0) + 1; }
  while (Date.now() < deadline) {
    const remaining = Math.max(1, Math.min(50, Math.round((deadline - Date.now()) / 1000)));
    const updates = await call("getUpdates", { offset, timeout: remaining, allowed_updates: ["callback_query"] });
    for (const up of updates) {
      offset = up.update_id + 1;
      const cq = up.callback_query;
      if (cq && cq.message?.message_id === msg.message_id) {
        // The callback ack is just a toast. If it's stale ("query is too old", a 400),
        // NEVER let it crash the launch — the tap already told us the decision.
        await call("answerCallbackQuery", { callback_query_id: cq.id, text: `Got it: ${cq.data}` }).catch(() => {});
        // Strip the buttons + show the decision on the original message.
        await call("editMessageReplyMarkup", { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        await sendMessage(`✅ You chose: <b>${cq.data}</b>`, { chatId });
        return String(cq.data).toUpperCase();
      }
    }
  }
  throw new Error("approval timed out");
}

/** Wait for the next plain text message in the chat (used for tweet edits). */
export async function awaitText({ timeoutSec = 1800, chatId = CHAT } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  let offset; { const init = await call("getUpdates", { timeout: 0 }); offset = (init.at(-1)?.update_id ?? 0) + 1; }
  while (Date.now() < deadline) {
    const remaining = Math.max(1, Math.min(50, Math.round((deadline - Date.now()) / 1000)));
    const updates = await call("getUpdates", { offset, timeout: remaining, allowed_updates: ["message"] });
    for (const up of updates) {
      offset = up.update_id + 1;
      const m = up.message;
      if (m && String(m.chat?.id) === String(chatId) && typeof m.text === "string" && !m.text.startsWith("/")) return m.text;
    }
  }
  throw new Error("text reply timed out");
}

/**
 * Post a prompt with buttons, then resolve on the FIRST of: a button tap
 * ({kind:'button', value}) or a typed text reply ({kind:'text', value}).
 * Lets the founder edit by simply replying with new text.
 */
export async function awaitButtonsOrText(prompt, { buttons = ["Approve", "Reject"], timeoutSec = 3600, chatId = CHAT } = {}) {
  const msg = await sendMessage(prompt, { chatId, buttons });
  const deadline = Date.now() + timeoutSec * 1000;
  let offset; { const init = await call("getUpdates", { timeout: 0 }); offset = (init.at(-1)?.update_id ?? 0) + 1; }
  while (Date.now() < deadline) {
    const remaining = Math.max(1, Math.min(50, Math.round((deadline - Date.now()) / 1000)));
    const updates = await call("getUpdates", { offset, timeout: remaining });
    for (const up of updates) {
      offset = up.update_id + 1;
      const cq = up.callback_query;
      if (cq && cq.message?.message_id === msg.message_id) {
        await call("answerCallbackQuery", { callback_query_id: cq.id, text: `Got it: ${cq.data}` }).catch(() => {});
        await call("editMessageReplyMarkup", { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        return { kind: "button", value: String(cq.data) };
      }
      const m = up.message;
      if (m && String(m.chat?.id) === String(chatId) && typeof m.text === "string" && !m.text.startsWith("/")) return { kind: "text", value: m.text };
    }
  }
  throw new Error("approval timed out");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "text") { await sendMessage(rest.join(" ")); console.log("sent"); }
    else if (cmd === "photo") { await sendPhoto(rest[0], rest.slice(1).join(" ")); console.log("sent"); }
    else if (cmd === "photos") { const cap = rest[0]; await sendPhotos(rest.slice(1), cap); console.log("sent"); }
    else if (cmd === "whoami") { console.log(JSON.stringify(await whoami())); }
    else if (cmd === "await") { const decision = await awaitApproval(rest[0], { buttons: rest.slice(1).length ? rest.slice(1) : undefined }); console.log(decision); process.exit(decision === "APPROVE" ? 0 : 1); }
    else { console.error("usage: tg.mjs text|photo|photos|whoami|await ..."); process.exit(1); }
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
}
