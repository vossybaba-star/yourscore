/**
 * reddit-telegram.mjs — founder review loop for Reddit reply drafts.
 *
 *   push    send new pending drafts to Telegram with [Post | Edit | Skip]
 *   poll    process taps + edit replies (run by the launchd poller)
 *   list    show the queue in the terminal
 *
 * Posting happens HERE and only here, on an explicit "Post" tap. Cards that
 * mention YourScore carry a ⚠️ DISCLOSURE line so the founder double-checks the
 * sub allows it before approving.
 *
 * Needs a DEDICATED bot (getUpdates is single-consumer per bot; sharing one with
 * the X/IG pollers eats taps): set REDDIT_TELEGRAM_BOT_TOKEN in .env.local
 * (create via @BotFather in ~1 min). Chat id falls back to TELEGRAM_CHAT_ID.
 *
 * Run with:  node --env-file=.env.local scripts/reddit-telegram.mjs <cmd>
 */

import { PATHS, loadJSON, saveJSON, sanitize, postComment, hasApiCreds } from "./lib/reddit.mjs";

const TG = process.env.REDDIT_TELEGRAM_BOT_TOKEN;
const CHAT = process.env.REDDIT_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
const cmd = process.argv[2] || "push";

if (cmd === "list") {
  const q = loadJSON(PATHS.queue, []);
  for (const d of q) console.log(`${d.status.padEnd(8)} ${d.id}  r/${d.post.sub} ${d.mentionsProduct ? "⚠️" : "  "} ${d.post.title.slice(0, 70)}`);
  console.log(`\n${q.filter((d) => d.status === "pending").length} pending / ${q.length} total`);
  process.exit(0);
}
if (!TG || !CHAT) {
  console.error("✗ Missing REDDIT_TELEGRAM_BOT_TOKEN (make one via @BotFather) / chat id in env. Queue is untouched; drafts wait.");
  process.exit(1);
}

const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
const send = (text, reply_markup) => tg("sendMessage", { chat_id: CHAT, text, reply_markup, disable_web_page_preview: true });
const editText = (mid, text) => tg("editMessageText", { chat_id: CHAT, message_id: mid, text });
const ackCb = (id, text) => tg("answerCallbackQuery", { callback_query_id: id, text });

// Until Data API access is approved (RSS-only mode) the pipeline can't post for
// you: the card carries the thread link + the draft to paste, and the ✅ button
// just records that you posted it yourself.
const buttons = (id) => ({ inline_keyboard: [
  hasApiCreds()
    ? [{ text: "✅ Post", callback_data: `rpost:${id}` }, { text: "✏️ Edit", callback_data: `redit:${id}` }, { text: "🗑 Skip", callback_data: `rskip:${id}` }]
    : [{ text: "✅ I posted it", callback_data: `rdone:${id}` }, { text: "✏️ Edit", callback_data: `redit:${id}` }, { text: "🗑 Skip", callback_data: `rskip:${id}` }],
] });

const age = (p) => `${Math.round((Date.now() / 1000 - p.createdUtc) / 360) / 10}h`;
const card = (d) => [
  `👂 REDDIT · r/${d.post.sub} · ${d.post.ups}↑ ${d.post.numComments}c · ${age(d.post)} old · score ${d.score}/10`,
  d.mentionsProduct ? "⚠️ MENTIONS YOURSCORE - check this sub allows it (disclosure is in the draft)" : null,
  ``,
  `${d.post.title}`,
  d.post.url,
  ``,
  `DRAFT REPLY:`,
  d.draft,
].filter((l) => l !== null).join("\n");

const queue = loadJSON(PATHS.queue, []);
const byId = (id) => queue.find((d) => d.id === id);
const STALE_MS = 36 * 3600 * 1000;

// ── push ─────────────────────────────────────────────────────────────────────
if (cmd === "push") {
  let pushed = 0;
  for (const d of queue) {
    if (d.status !== "pending" || d.tg?.pushed) continue;
    if (Date.now() - Date.parse(d.createdAt) > STALE_MS) { d.status = "stale"; continue; } // thread's gone cold
    const r = await send(card(d), buttons(d.id));
    if (r.ok) { d.tg = { messageId: r.result.message_id, pushed: true, pushedAt: Date.now() }; pushed++; }
    else console.error(`✗ push ${d.id}: ${JSON.stringify(r).slice(0, 200)}`);
  }
  saveJSON(PATHS.queue, queue);
  console.log(`📨 pushed ${pushed} draft(s)`);
  process.exit(0);
}

// ── poll ─────────────────────────────────────────────────────────────────────
if (cmd !== "poll") { console.error("usage: reddit-telegram.mjs push|poll|list"); process.exit(1); }

const st = loadJSON(PATHS.state, { seen: {} });
let offset = st.tgOffset || 0;
const updates = (await tg("getUpdates", { offset, timeout: 0 })).result || [];

async function doPost(d, viaCbId) {
  try {
    const res = await postComment(d.post.fullname, d.draft);
    d.status = "posted"; d.postedAt = new Date().toISOString(); d.commentUrl = res.permalink;
    if (viaCbId) await ackCb(viaCbId, "Posted ✅");
    await editText(d.tg.messageId, `✅ POSTED to r/${d.post.sub}\n${res.permalink || d.post.url}\n\n${d.draft}`);
  } catch (e) {
    d.status = "error"; d.error = e.message;
    if (viaCbId) await ackCb(viaCbId, "Failed ✗");
    await send(`✗ posting ${d.id} failed: ${e.message.slice(0, 300)}\n(it stays in the queue as 'error')`);
  }
}

for (const up of updates) {
  offset = up.update_id + 1;

  const cq = up.callback_query;
  if (cq?.data) {
    const [action, id] = cq.data.split(":");
    const d = byId(id);
    if (!d || d.status !== "pending") { await ackCb(cq.id, "Already handled"); continue; }
    if (action === "rpost") {
      if (!hasApiCreds()) { await ackCb(cq.id, "No API creds yet - paste it manually"); continue; }
      await doPost(d, cq.id);
    }
    else if (action === "rdone") {
      d.status = "posted"; d.postedAt = new Date().toISOString(); d.postedManually = true;
      await ackCb(cq.id, "Marked as posted 👍");
      await editText(d.tg.messageId, `✅ POSTED (manually) to r/${d.post.sub}\n${d.post.url}\n\n${d.draft}`);
    }
    else if (action === "rskip") {
      d.status = "skipped";
      await ackCb(cq.id, "Skipped");
      await editText(d.tg.messageId, `🗑 skipped · r/${d.post.sub} · ${d.post.title.slice(0, 80)}`);
    } else if (action === "redit") {
      d.awaitingEdit = true;
      await ackCb(cq.id, "Send the new text");
      await send(`✏️ Reply with the full new text for ${d.id} (r/${d.post.sub}). It will be re-carded for approval, not auto-posted.`);
    }
    continue;
  }

  const m = up.message;
  if (m && String(m.chat?.id) === String(CHAT) && typeof m.text === "string" && !m.text.startsWith("/")) {
    const d = queue.find((x) => x.awaitingEdit && x.status === "pending");
    if (!d) continue;
    d.draft = sanitize(m.text);
    d.awaitingEdit = false;
    const r = await send(card(d), buttons(d.id));           // re-card with the edit; still needs a Post tap
    if (r.ok) d.tg = { messageId: r.result.message_id, pushed: true, pushedAt: Date.now() };
  }
}

st.tgOffset = offset;
saveJSON(PATHS.state, st);
saveJSON(PATHS.queue, queue);
