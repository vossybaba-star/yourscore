/**
 * post-tweet.mjs — post the daily quiz tweet (text + share image) as @Yourscore_App_.
 *
 * Uses OAuth 1.0a User Context (no dependency — Node's crypto). Two calls:
 *   1) v1.1 media/upload (simple, <5MB) to get a media_id for the share card
 *   2) v2 POST /tweets with { text, media: { media_ids } }
 *
 * Creds in .env.local (added during X setup, Read+Write for @Yourscore_App_):
 *   X_API_KEY  X_API_SECRET  X_ACCESS_TOKEN  X_ACCESS_SECRET
 *
 * Usage:
 *   node --env-file=.env.local scripts/post-tweet.mjs --text "..." --image card.png
 *   node --env-file=.env.local scripts/post-tweet.mjs --quiz <file>.json --image card.png  # compose text from quiz
 *   node --env-file=.env.local scripts/post-tweet.mjs --quiz <file>.json --image card.png --dry  # build, don't post
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { loadQuiz, composeTweet } from "./lib/quiz-launch.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry");
const imagePath = flag("--image");
const quizFile = flag("--quiz");
let text = flag("--text");

const KEY = process.env.X_API_KEY;
const SECRET = process.env.X_API_SECRET;
const TOKEN = process.env.X_ACCESS_TOKEN;
const TOKEN_SECRET = process.env.X_ACCESS_SECRET;

function fail(m) { console.error(`✗ ${m}`); process.exit(1); }
if (!KEY || !SECRET || !TOKEN || !TOKEN_SECRET) fail("Missing X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET in env");

// Final edited text from a file (written by the Telegram tweet gate) takes priority.
const textFile = flag("--text-file");
if (!text && textFile) text = readFileSync(textFile, "utf8").trim();
// Else compose from the quiz (same composer as the preview).
if (!text && quizFile) text = composeTweet(loadQuiz(quizFile)).text;
if (!text && !args.includes("--whoami")) fail("Provide --text \"...\" or --quiz <file>.json");

// ── OAuth 1.0a ───────────────────────────────────────────────────────────────
const pct = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function authHeader(method, url, queryParams = {}) {
  const oauth = {
    oauth_consumer_key: KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: TOKEN,
    oauth_version: "1.0",
  };
  // Multipart and JSON bodies are excluded from the signature base; only oauth_*
  // (and any URL query params) are signed.
  const all = { ...oauth, ...queryParams };
  const paramStr = Object.keys(all).sort().map((k) => `${pct(k)}=${pct(all[k])}`).join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join("&");
  const signingKey = `${pct(SECRET)}&${pct(TOKEN_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
}

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEETS_URL = "https://api.twitter.com/2/tweets";
const ME_URL = "https://api.twitter.com/2/users/me";

// --whoami: read-only credential check (no posting) — confirms the tokens auth.
if (args.includes("--whoami")) {
  const res = await fetch(ME_URL, { headers: { Authorization: authHeader("GET", ME_URL) } });
  const body = await res.text();
  if (!res.ok) fail(`whoami ${res.status}: ${body}`);
  const u = JSON.parse(body).data;
  console.log(`\n✅ Authenticated as @${u.username} (${u.name}, id ${u.id}) — Read+Write creds work.\n`);
  process.exit(0);
}

async function uploadMedia(path) {
  const buf = readFileSync(path);
  if (buf.length > 5 * 1024 * 1024) fail(`image ${(buf.length / 1048576).toFixed(1)}MB exceeds the 5MB simple-upload limit`);
  const fd = new FormData();
  fd.set("media", new Blob([buf]), "card.png");
  const res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: authHeader("POST", UPLOAD_URL) }, body: fd });
  const body = await res.text();
  if (!res.ok) fail(`media upload ${res.status}: ${body}`);
  const id = JSON.parse(body).media_id_string;
  if (!id) fail(`media upload returned no media_id: ${body}`);
  return id;
}

async function postTweet(text, mediaId) {
  const payload = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };
  const res = await fetch(TWEETS_URL, {
    method: "POST",
    headers: { Authorization: authHeader("POST", TWEETS_URL), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) fail(`create tweet ${res.status}: ${body}`);
  return JSON.parse(body).data;
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\n🐦 Post tweet as @Yourscore_App_  ${DRY ? "(DRY RUN)" : ""}`);
console.log(`   image: ${imagePath || "(none)"}`);
console.log(`   text:\n${text.split("\n").map((l) => "     " + l).join("\n")}`);
console.log(`   [${[...text].length} raw chars — X counts each URL as 23]\n`);

if (DRY) { console.log("🛑 DRY RUN — not posting. Drop --dry to fire."); process.exit(0); }

let mediaId = null;
if (imagePath) { console.log("⬆️  Uploading media…"); mediaId = await uploadMedia(imagePath); console.log(`   media_id=${mediaId}`); }
console.log("📨 Posting tweet…");
const data = await postTweet(text, mediaId);
console.log(`\n✅ Posted: https://x.com/Yourscore_App_/status/${data.id}\n`);
