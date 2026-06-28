/**
 * x-telegram.mjs — review + GIF + post loop over Telegram (@Yourscor_bot).
 *
 * Telegram is the approval surface: drafts are pushed to your chat with buttons,
 * you (optionally) attach a GIF, then tap Post and it goes live as @Yourscore_App_.
 * Nothing posts without your tap.
 *
 *   push            send new pending drafts to Telegram with [Post | Add GIF | Skip]
 *   push <id...>    push specific drafts
 *   poll            process your taps + GIF replies (run by the poller launchd job)
 *
 * GIF: tap "🎬 Add GIF", then either forward a GIF or paste a Giphy/Tenor link.
 * Run with:  node --env-file=.env.local scripts/x-telegram.mjs <cmd>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PATHS, loadJSON, saveJSON, postTweet, uploadAnimated, uploadMedia, sanitize, charLen, HANDLE, revise, fetchImage } from "./lib/x-watch.mjs";

const TG = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
if (!TG || !CHAT) { console.error("✗ Missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID in env"); process.exit(1); }

const GIF_DIR = join(PATHS.queue, "..", "gif-cache");
const IMG_DIR = join(PATHS.queue, "..", "img-cache");
const UA = { "User-Agent": "Mozilla/5.0" };

const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());

const send = (text, reply_markup) => tg("sendMessage", { chat_id: CHAT, text, reply_markup, disable_web_page_preview: true });
const sendPhoto = (photo, caption, reply_markup) => tg("sendPhoto", { chat_id: CHAT, photo, caption, reply_markup });
const editText = (messageId, text) => tg("editMessageText", { chat_id: CHAT, message_id: messageId, text });
const editCaption = (messageId, caption) => tg("editMessageCaption", { chat_id: CHAT, message_id: messageId, caption });
// A draft pushed WITH a photo is a media message: its text lives in the caption, so the
// "posted/declined" update must edit the caption, not the (nonexistent) text body.
const editDraftMsg = (d, text) => (d.tg?.photo ? editCaption(d.tg.messageId, text) : editText(d.tg.messageId, text));
const ackCb = (id, text) => tg("answerCallbackQuery", { callback_query_id: id, text });

const draftButtons = (id) => ({ inline_keyboard: [
  [{ text: "✅ Post", callback_data: `post:${id}` }, { text: "🎬 Add GIF", callback_data: `gif:${id}` }],
  [{ text: "💬 Reword / Feedback", callback_data: `fb:${id}` }],
  [{ text: "✏️ Edit", callback_data: `edit:${id}` }, { text: "🗑 Decline", callback_data: `skip:${id}` }],
] });

// ── GIF resolution / download ────────────────────────────────────────────────
const firstUrl = (t) => (t.match(/https?:\/\/\S+/) || [null])[0];

// fetch with a hard timeout so a slow CDN can never hang the poller.
async function fetchT(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}

async function resolveGifUrl(url) {
  if (/\.(gif|mp4|webm)(\?|$)/i.test(url)) return url;
  if (/giphy\.com/i.test(url)) {
    if (/(?:media\d*|i)\.giphy\.com/i.test(url)) return url;
    const m = url.match(/giphy\.com\/(?:gifs|clips|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]{6,})/i);
    if (m) return `https://i.giphy.com/media/${m[1]}/giphy.gif`;
  }
  if (/tenor\.com/i.test(url)) {
    const page = await (await fetchT(url, { headers: UA })).text();
    const m = page.match(/https:\/\/(?:media\d*|c)\.tenor\.com\/[^"'\\ ]+\.(?:gif|mp4)/i);
    if (m) return m[0];
  }
  return url; // last resort: try the link directly
}

async function downloadMedia(url, forcedMime) {
  const res = await fetchT(url, { headers: UA });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let mime = forcedMime || (res.headers.get("content-type") || "").split(";")[0];
  if (mime === "image/gif" || mime === "video/mp4") return { buf, mime };
  if (/\.gif(\?|$)/i.test(url)) return { buf, mime: "image/gif" };
  if (/\.(mp4|webm)(\?|$)/i.test(url)) return { buf, mime: "video/mp4" };
  throw new Error(`unsupported media type (${mime || "unknown"})`);
}

// Pull a GIF out of a Telegram message (forwarded GIF/file) or a pasted link.
async function gifFromMessage(msg) {
  const fileRef = msg.animation || msg.video || (msg.document && /gif|mp4|webm/i.test(msg.document.mime_type || "") ? msg.document : null);
  if (fileRef) {
    const r = await tg("getFile", { file_id: fileRef.file_id });
    if (!r.ok) throw new Error("Telegram getFile failed");
    const mime = /image\/gif/i.test(fileRef.mime_type || "") ? "image/gif" : "video/mp4";
    return downloadMedia(`https://api.telegram.org/file/bot${TG}/${r.result.file_path}`, mime);
  }
  const url = firstUrl(msg.text || msg.caption || "");
  if (url) return downloadMedia(await resolveGifUrl(url));
  return null;
}

// ── posting ──────────────────────────────────────────────────────────────────
// Download the approved source photo and upload it to X. Resize down if it's over the
// 5MB simple-upload limit (Twitter media photos can be large).
async function uploadSourcePhoto(d) {
  const img = await fetchImage(d.image.url);
  let buf = img.buf;
  let ext = (img.media_type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  if (buf.length > 5 * 1024 * 1024) {
    buf = await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    ext = "jpg";
  }
  mkdirSync(IMG_DIR, { recursive: true });
  const path = join(IMG_DIR, `${d.id}.${ext}`);
  writeFileSync(path, buf);
  return uploadMedia(path);
}

async function doPost(d) {
  // GIF (founder-added) wins; otherwise repost the approved source photo if we have one.
  let mediaId = null, kind = "";
  if (d.gifPath) { mediaId = await uploadAnimated(readFileSync(d.gifPath), d.gifMime); kind = " with GIF"; }
  else if (d.image?.url) { mediaId = await uploadSourcePhoto(d); kind = " with image"; }
  const data = await postTweet(sanitize(d.draft), mediaId);
  d.status = "posted";
  d.postedId = data.id;
  d.postedUrl = `https://x.com/${HANDLE}/status/${data.id}`;
  d.postedAt = new Date().toISOString();
  d.postedKind = kind;
  return d.postedUrl;
}

// ── commands ───────────────────────────────────────────────────────────────--
const cmd = process.argv[2];
const argIds = process.argv.slice(3).filter((a) => !a.startsWith("--"));
const queue = loadJSON(PATHS.queue, []);
const state = loadJSON(PATHS.state, {});
state.tg ??= { offset: 0, awaitingGif: null, awaitingEdit: null, awaitingFeedback: null };
state.tg.awaitingEdit ??= null;
state.tg.awaitingFeedback ??= null;
const byId = (id) => queue.find((d) => d.id === id);
const save = () => { saveJSON(PATHS.queue, queue); saveJSON(PATHS.state, state); };

if (cmd === "push") {
  const PUSH_CAP = 6; // never flood Telegram with a big burst in one run
  let targets = argIds.length
    ? argIds.map(byId).filter(Boolean)
    : queue.filter((d) => d.status === "pending" && !d.tg?.pushed);
  let held = 0;
  if (!argIds.length && targets.length > PUSH_CAP) { held = targets.length - PUSH_CAP; targets = targets.slice(0, PUSH_CAP); }
  if (!targets.length) { console.log("(nothing new to push)"); process.exit(0); }
  for (const d of targets) {
    const text = `🟢 New draft  ·  @${d.source.username}  ·  ${d.draftChars}c\n\n${d.draft}\n\nSource: ${d.source.url}`;
    let r;
    // If we have a clean repostable photo, show it WITH the caption so you judge the whole
    // post at a glance. Fall back to a text message if Telegram can't fetch the photo URL.
    if (d.image?.url) {
      r = await sendPhoto(d.image.url, text, draftButtons(d.id));
      if (r.ok) { d.tg = { messageId: r.result.message_id, pushed: true, photo: true }; }
      else { r = await send(`${text}\n\n(image: ${d.image.url})`, draftButtons(d.id)); if (r.ok) d.tg = { messageId: r.result.message_id, pushed: true }; }
    } else {
      r = await send(text, draftButtons(d.id));
      if (r.ok) d.tg = { messageId: r.result.message_id, pushed: true };
    }
    if (r.ok) console.log(`pushed ${d.id}${d.image?.url ? " 📷" : ""}`);
    else console.error(`✗ push ${d.id}: ${JSON.stringify(r).slice(0, 140)}`);
  }
  if (held) console.log(`(held ${held} extra draft(s) to avoid a burst; they push on the next run)`);
  save();
  process.exit(0);
}

if (cmd === "poll") {
  // allowed_updates MUST include "message" or Telegram silently drops GIFs/links.
  const r = await tg("getUpdates", { offset: state.tg.offset || 0, timeout: 0, allowed_updates: ["message", "callback_query"] });
  if (!r.ok) { console.error(`getUpdates: ${JSON.stringify(r).slice(0, 140)}`); process.exit(1); }
  for (const u of r.result) {
    state.tg.offset = u.update_id + 1;
    try {
      if (u.callback_query) {
        const cq = u.callback_query;
        const [action, id] = (cq.data || "").split(":");
        const d = byId(id);
        if (!d) { await ackCb(cq.id, "draft gone"); continue; }
        if (action === "post") {
          if (d.status === "posted") { await ackCb(cq.id, "already posted"); continue; }
          await ackCb(cq.id, "Posting...");
          try { const url = await doPost(d); await editDraftMsg(d, `✅ Posted${d.postedKind || ""}\n${url}`); }
          catch (e) { await send(`✗ Post failed for ${id}: ${e.message}`); }
        } else if (action === "gif") {
          state.tg.awaitingGif = id;
          state.tg.awaitingEdit = null;
          state.tg.awaitingFeedback = null;
          await ackCb(cq.id, "Send a GIF or a link");
          await send(`🎬 Send a GIF or paste a Giphy/Tenor link for:\n\n"${d.draft.split("\n")[0]}..."`);
        } else if (action === "edit") {
          state.tg.awaitingEdit = id;
          state.tg.awaitingGif = null;
          state.tg.awaitingFeedback = null;
          await ackCb(cq.id, "Send the new wording");
          await send(`✏️ Send the new wording for this tweet (just reply with the text):\n\n"${d.draft.split("\n")[0]}..."`);
        } else if (action === "fb") {
          state.tg.awaitingFeedback = id;
          state.tg.awaitingEdit = null;
          state.tg.awaitingGif = null;
          await ackCb(cq.id, "Send your feedback");
          await send(`💬 Tell me how to change it and I'll reword it. e.g. "punchier", "restructure around the keeper", "too salesy", "lose the link".\n\nFor:\n"${d.draft.split("\n")[0]}..."`);
        } else if (action === "skip") {
          d.status = "rejected";
          await ackCb(cq.id, "Declined");
          await editDraftMsg(d, `🗑 Declined`);
        }
      } else if (u.message) {
        const msg = u.message;
        // 0) Feedback: we asked how to change it; they sent a plain-text instruction. Reword it.
        if (state.tg.awaitingFeedback && msg.text && !msg.animation && !msg.video && !msg.document) {
          const d = byId(state.tg.awaitingFeedback);
          state.tg.awaitingFeedback = null;
          if (!d) { await send("That draft is gone."); continue; }
          if (d.status !== "pending") { await send("That draft isn't active anymore."); continue; }
          await send("💬 Rewording...");
          try {
            const { tweet, note } = await revise(d.draft, msg.text);
            if (!tweet) { await send("Reword came back empty. Try different feedback, or tap ✏️ Edit to write it yourself."); continue; }
            d.draft = tweet; d.draftChars = charLen(d.draft); d.reworded = true;
            const tag = note ? `\n(${note})` : "";
            await send(`💬 Reworded (${d.draftChars}c)${d.draftChars > 280 ? " ⚠️ OVER 280" : ""}:${tag}\n\n${d.draft}`, draftButtons(d.id));
          } catch (e) { await send(`✗ Reword failed: ${e.message}. Tap ✏️ Edit to write it yourself.`); }
          continue;
        }
        // 1) An edit: we asked for new wording and they sent plain text (no media).
        if (state.tg.awaitingEdit && msg.text && !msg.animation && !msg.video && !msg.document) {
          const d = byId(state.tg.awaitingEdit);
          state.tg.awaitingEdit = null;
          if (!d) { await send("That draft is gone."); continue; }
          if (d.status !== "pending") { await send("That draft isn't active anymore."); continue; }
          d.draft = sanitize(msg.text); d.draftChars = charLen(d.draft); d.edited = true;
          await send(`✏️ Updated (${d.draftChars}c)${d.draftChars > 280 ? " ⚠️ OVER 280" : ""}:\n\n${d.draft}`, draftButtons(d.id));
          continue;
        }
        // 1.5) A plain-text reply to a draft message = feedback. No button tap needed:
        // just reply to the tweet with how you'd change it and I'll reword it.
        if (msg.text && !msg.animation && !msg.video && !msg.document && msg.reply_to_message
            && !/(?:giphy|tenor)\.com|\.(?:gif|mp4)(?:\?|$)/i.test(msg.text)) {
          const d = queue.find((x) => x.tg && x.tg.messageId === msg.reply_to_message.message_id);
          if (d && d.status === "pending") {
            await send("💬 Rewording...");
            try {
              const { tweet, note } = await revise(d.draft, msg.text);
              if (tweet) {
                d.draft = tweet; d.draftChars = charLen(d.draft); d.reworded = true;
                const tag = note ? `\n(${note})` : "";
                await send(`💬 Reworded (${d.draftChars}c)${d.draftChars > 280 ? " ⚠️ OVER 280" : ""}:${tag}\n\n${d.draft}`, draftButtons(d.id));
              } else { await send("Reword came back empty. Tap ✏️ Edit to write it yourself."); }
            } catch (e) { await send(`✗ Reword failed: ${e.message}`); }
            continue;
          }
        }
        // 2) A GIF. Which draft is it for? The one we're awaiting (after a 🎬 tap), OR
        // the draft whose pushed message the user replied to (the natural action).
        let targetId = state.tg.awaitingGif;
        if (msg.reply_to_message) {
          const replied = queue.find((d) => d.tg && d.tg.messageId === msg.reply_to_message.message_id);
          if (replied) targetId = replied.id;
        }
        const looksLikeGif = !!(msg.animation || msg.video || msg.document
          || /(?:giphy|tenor)\.com|\.(?:gif|mp4)(?:\?|$)/i.test(msg.text || msg.caption || ""));
        if (!looksLikeGif) continue;            // ignore plain chatter
        if (!targetId) { await send("Which draft is that GIF for? Reply to the draft message with the GIF (or tap 🎬 Add GIF on it first)."); continue; }
        const d = byId(targetId);
        if (state.tg.awaitingGif === targetId) state.tg.awaitingGif = null;
        if (!d) { await send("That draft is gone."); continue; }
        if (d.status !== "pending") { await send("That draft isn't active anymore (already posted or skipped)."); continue; }
        try {
          const media = await gifFromMessage(msg);
          if (!media) { await send("Couldn't read a GIF from that. Forward a GIF or paste a Giphy/Tenor link."); continue; }
          mkdirSync(GIF_DIR, { recursive: true });
          const ext = media.mime === "image/gif" ? "gif" : "mp4";
          const path = join(GIF_DIR, `${d.id}.${ext}`);
          writeFileSync(path, media.buf);
          d.gifPath = path; d.gifMime = media.mime;
          await send(`🎬 GIF attached to:\n"${d.draft.split("\n")[0]}"\n(${(media.buf.length / 1048576).toFixed(1)}MB) - tap to post 👇`, { inline_keyboard: [[{ text: "✅ Post with this GIF", callback_data: `post:${d.id}` }, { text: "🗑 Skip", callback_data: `skip:${d.id}` }]] });
        } catch (e) { await send(`✗ Couldn't use that GIF: ${e.message}`); }
      }
    } catch (e) { console.error("update error:", e.message); }
  }
  save();
  process.exit(0);
}

console.log("Usage: x-telegram.mjs push [<id>...] | poll");
