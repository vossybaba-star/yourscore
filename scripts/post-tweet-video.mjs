/**
 * post-tweet-video.mjs — post a tweet with a VIDEO as @Yourscore_App_.
 *
 * post-tweet.mjs only does simple <5MB image upload. Video needs the v1.1 chunked
 * upload flow: INIT -> APPEND (chunks) -> FINALIZE -> STATUS poll (async transcode),
 * then v2 POST /tweets with { text, media: { media_ids } }.
 *
 * OAuth 1.0a User Context (Node crypto, no deps). Creds in .env.local:
 *   X_API_KEY  X_API_SECRET  X_ACCESS_TOKEN  X_ACCESS_SECRET
 *
 * Usage:
 *   node --env-file=.env.local scripts/post-tweet-video.mjs --video path.mp4 --text-file t.txt
 *   ... --dry   # upload + process the video but DON'T post the tweet
 */

import crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry");
const videoPath = flag("--video");
const textFile = flag("--text-file");
let text = flag("--text");
if (!text && textFile) text = readFileSync(textFile, "utf8").replace(/\s+$/, "");

const KEY = process.env.X_API_KEY, SECRET = process.env.X_API_SECRET;
const TOKEN = process.env.X_ACCESS_TOKEN, TOKEN_SECRET = process.env.X_ACCESS_SECRET;
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
if (!KEY || !SECRET || !TOKEN || !TOKEN_SECRET) fail("Missing X_API_* creds in env");
if (!videoPath) fail("Provide --video <path>");
if (!text) fail("Provide --text or --text-file");

const pct = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function authHeader(method, url, params = {}) {
  const oauth = {
    oauth_consumer_key: KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...params };
  const paramStr = Object.keys(all).sort().map((k) => `${pct(k)}=${pct(all[k])}`).join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join("&");
  const signingKey = `${pct(SECRET)}&${pct(TOKEN_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
}
const qs = (p) => Object.keys(p).map((k) => `${pct(k)}=${pct(p[k])}`).join("&");

const UPLOAD = "https://upload.twitter.com/1.1/media/upload.json";
const TWEETS = "https://api.twitter.com/2/tweets";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadVideo(path) {
  const buf = readFileSync(path);
  const totalBytes = statSync(path).size;

  // INIT
  let p = { command: "INIT", total_bytes: String(totalBytes), media_type: "video/mp4", media_category: "tweet_video" };
  let res = await fetch(`${UPLOAD}?${qs(p)}`, { method: "POST", headers: { Authorization: authHeader("POST", UPLOAD, p) } });
  let body = await res.text();
  if (!res.ok) fail(`INIT ${res.status}: ${body}`);
  const mediaId = JSON.parse(body).media_id_string;
  console.log(`   INIT ok, media_id=${mediaId}`);

  // APPEND in 4MB chunks
  const CHUNK = 4 * 1024 * 1024;
  let seg = 0;
  for (let off = 0; off < buf.length; off += CHUNK, seg++) {
    const slice = buf.subarray(off, Math.min(off + CHUNK, buf.length));
    p = { command: "APPEND", media_id: mediaId, segment_index: String(seg) };
    const fd = new FormData();
    fd.set("media", new Blob([slice]));
    res = await fetch(`${UPLOAD}?${qs(p)}`, { method: "POST", headers: { Authorization: authHeader("POST", UPLOAD, p) }, body: fd });
    if (!res.ok) fail(`APPEND seg ${seg} ${res.status}: ${await res.text()}`);
    console.log(`   APPEND seg ${seg} (${(slice.length / 1048576).toFixed(1)}MB)`);
  }

  // FINALIZE
  p = { command: "FINALIZE", media_id: mediaId };
  res = await fetch(`${UPLOAD}?${qs(p)}`, { method: "POST", headers: { Authorization: authHeader("POST", UPLOAD, p) } });
  body = await res.text();
  if (!res.ok) fail(`FINALIZE ${res.status}: ${body}`);
  let info = JSON.parse(body).processing_info;
  console.log(`   FINALIZE ok${info ? ` (processing: ${info.state})` : ""}`);

  // STATUS poll until transcode done
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    await sleep((info.check_after_secs || 3) * 1000);
    p = { command: "STATUS", media_id: mediaId };
    res = await fetch(`${UPLOAD}?${qs(p)}`, { method: "GET", headers: { Authorization: authHeader("GET", UPLOAD, p) } });
    body = await res.text();
    if (!res.ok) fail(`STATUS ${res.status}: ${body}`);
    info = JSON.parse(body).processing_info;
    console.log(`   processing: ${info?.state}${info?.progress_percent != null ? ` ${info.progress_percent}%` : ""}`);
  }
  if (info && info.state === "failed") fail(`video processing failed: ${JSON.stringify(info.error || info)}`);
  return mediaId;
}

async function postTweet(text, mediaId) {
  const res = await fetch(TWEETS, {
    method: "POST",
    headers: { Authorization: authHeader("POST", TWEETS), "Content-Type": "application/json" },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  });
  const body = await res.text();
  if (!res.ok) fail(`create tweet ${res.status}: ${body}`);
  return JSON.parse(body).data;
}

console.log(`\n🐦 Post VIDEO tweet as @Yourscore_App_  ${DRY ? "(DRY)" : ""}`);
console.log(`   video: ${videoPath} (${(statSync(videoPath).size / 1048576).toFixed(1)}MB)`);
console.log(`   text:\n${text.split("\n").map((l) => "     " + l).join("\n")}\n`);

console.log("⬆️  Uploading video (chunked)…");
const mediaId = await uploadVideo(videoPath);
console.log(`✅ Video ready, media_id=${mediaId}`);

if (DRY) { console.log("\n🛑 DRY — video uploaded+processed but tweet NOT posted. Drop --dry to fire."); process.exit(0); }

console.log("📨 Posting tweet…");
const data = await postTweet(text, mediaId);
console.log(`\n✅ Posted: https://x.com/Yourscore_App_/status/${data.id}\n`);
