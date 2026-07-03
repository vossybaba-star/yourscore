/**
 * x-watch.mjs — shared helpers for the "track accounts → reword → post" pipeline.
 *
 * One source of truth for everything the repurpose flow needs:
 *   - X reads:  getBearer(), resolveUser(), fetchRecent()   (app-only Bearer)
 *   - X writes: uploadMedia(), postTweet()                   (OAuth 1.0a user ctx)
 *   - Reword:   reword()  — turn a source tweet into an ORIGINAL YourScore tweet
 *   - State:    loadJSON()/saveJSON() + the queue/state/watchlist paths
 *
 * Creds (all already in .env.local — run scripts with `node --env-file=.env.local`):
 *   X_API_KEY  X_API_SECRET  X_ACCESS_TOKEN  X_ACCESS_SECRET   (post as @Yourscore_App_)
 *   ANTHROPIC_API_KEY                                          (rewording)
 *
 * Decisions baked in (set by the founder, Jun 2026):
 *   • Approval-gated — track/reword only WRITES drafts; nothing posts without an
 *     explicit `x-queue.mjs post`.
 *   • Original take, NO @mention/credit of the source account.
 *   • Always posts from @Yourscore_App_.
 */

import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

export const PATHS = {
  watchlist: join(DATA_DIR, "x-watchlist.json"),
  state: join(DATA_DIR, "x-state.json"),
  queue: join(DATA_DIR, "x-queue.json"),
};

export const HANDLE = "Yourscore_App_";
export const REWORD_MODEL = "claude-sonnet-4-6";

// ── small JSON store ─────────────────────────────────────────────────────────
export function loadJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`Corrupt JSON at ${path}: ${e.message}`); }
}
export function saveJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// ── creds ──────────────────────────────────────────────────────────────────--
const KEY = process.env.X_API_KEY;
const SECRET = process.env.X_API_SECRET;
const TOKEN = process.env.X_ACCESS_TOKEN;
const TOKEN_SECRET = process.env.X_ACCESS_SECRET;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;

export function requireReadCreds() {
  if (!KEY || !SECRET) throw new Error("Missing X_API_KEY/X_API_SECRET in env (use --env-file=.env.local)");
}
export function requireWriteCreds() {
  if (!KEY || !SECRET || !TOKEN || !TOKEN_SECRET) throw new Error("Missing X_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET in env");
}
export function requireAnthropic() {
  if (!ANTHROPIC) throw new Error("Missing ANTHROPIC_API_KEY in env (use --env-file=.env.local)");
}

const pct = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// ── X reads (app-only Bearer, minted from the consumer key/secret) ───────────--
let _bearer = null;
export async function getBearer() {
  if (_bearer) return _bearer;
  requireReadCreds();
  const basic = Buffer.from(`${pct(KEY)}:${pct(SECRET)}`).toString("base64");
  const res = await fetch("https://api.twitter.com/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "grant_type=client_credentials",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`bearer mint ${res.status}: ${body}`);
  _bearer = JSON.parse(body).access_token;
  return _bearer;
}

async function xGet(url) {
  const bearer = await getBearer();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  const body = await res.text();
  if (!res.ok) {
    const e = new Error(`GET ${url} → ${res.status}: ${body}`);
    e.status = res.status;
    throw e;
  }
  return JSON.parse(body);
}

/** username (no @) → { id, name, username } */
export async function resolveUser(username) {
  const u = username.replace(/^@/, "");
  const j = await xGet(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(u)}`);
  if (!j.data) throw new Error(`no such user @${u}`);
  return j.data;
}

/**
 * Recent ORIGINAL tweets for a user (replies + retweets excluded), newest first.
 * @param {string} userId
 * @param {{sinceId?:string, max?:number}} opts
 */
export async function fetchRecent(userId, { sinceId, max = 10 } = {}) {
  const p = new URLSearchParams({
    max_results: String(Math.min(Math.max(max, 5), 100)), // API floor is 5
    exclude: "replies,retweets",
    "tweet.fields": "created_at,public_metrics,lang,attachments",
    expansions: "attachments.media_keys",
    // `variants` gives us playable mp4 URLs for video/GIF (available on the app-only Bearer);
    // `duration_ms` lets a consumer reject clips that are too long/short for Reels.
    "media.fields": "url,preview_image_url,type,width,height,alt_text,variants,duration_ms",
  });
  if (sinceId) p.set("since_id", sinceId);
  const j = await xGet(`https://api.twitter.com/2/users/${userId}/tweets?${p}`);
  // Map each tweet's media_keys to the media objects from includes.media. Photos carry `url`;
  // video/animated_gif carry `variants` (pick the best mp4) + a `preview_image_url` still. We
  // keep the still for context AND expose a `videoUrl` so downstream can repost the clip.
  const byKey = Object.fromEntries((j.includes?.media || []).map((m) => [m.media_key, m]));
  return (j.data || []).map((t) => ({
    ...t,
    media: (t.attachments?.media_keys || [])
      .map((k) => byKey[k])
      .filter(Boolean)
      .map((m) => ({
        type: m.type,
        url: m.url || null,
        videoUrl: bestMp4(m.variants),
        preview: m.preview_image_url || null,
        width: m.width,
        height: m.height,
        durationMs: m.duration_ms || null,
        alt: m.alt_text || null,
      }))
      .filter((m) => m.url || m.videoUrl || m.preview),
  }));
}

// Pick the highest-bitrate mp4 variant — the best-quality master. Downstream (brand-media)
// re-encodes with its own bitrate cap before re-hosting, so a small variant here only means
// visibly worse video AND audio in the final Reel, with no upside.
// Twitter `variants` = [{bit_rate?, content_type, url}]; animated_gif mp4s have no bit_rate.
function bestMp4(variants) {
  if (!Array.isArray(variants)) return null;
  const mp4s = variants.filter((v) => v.content_type === "video/mp4" && v.url);
  if (!mp4s.length) return null;
  return mp4s.sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))[0].url;
}

// Spam/gambling terms to keep out of the engagement search (the open firehose is full of them).
const SPAM = ["giveaway", "bet", "bets", "betting", "odds", "parlay", "ticket", "tickets", "prediction", "predictions", "promo", "casino", "gamble", "gambling", "picks", "bankroll", "sportsbook", "fanduel", "draftkings", "stake", "1xbet", "free money", "cash app", "$"];
const SPAM_RE = new RegExp(`\\b(${SPAM.filter((s) => /^[a-z ]+$/.test(s)).join("|")})\\b`, "i");

/**
 * Find high-reach, real football tweets worth engaging with (reply/quote targets).
 * Relevancy-ordered so genuinely viral tweets surface (not just the newest), then filtered to
 * real accounts (follower floor) with the gambling/spam firehose stripped out.
 * @returns {Promise<Array<{id,handle,name,followers,text,eng,url,photo}>>}
 */
export async function searchViral({ query, minFollowers = 80000, max = 100 } = {}) {
  const q = `(${query}) -is:retweet -is:reply -is:quote lang:en ${SPAM.filter((s) => /^[a-z]+$/.test(s)).map((s) => "-" + s).join(" ")}`;
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=${max}&sort_order=relevancy`
    + `&tweet.fields=public_metrics,created_at,author_id&expansions=author_id,attachments.media_keys`
    + `&user.fields=username,name,public_metrics&media.fields=url,type,preview_image_url`;
  const j = await xGet(url);
  const users = Object.fromEntries((j.includes?.users || []).map((u) => [u.id, u]));
  const media = Object.fromEntries((j.includes?.media || []).map((m) => [m.media_key, m]));
  return (j.data || []).map((t) => {
    const u = users[t.author_id] || {}, m = t.public_metrics || {};
    const eng = (m.like_count || 0) + 2 * (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
    const photo = (t.attachments?.media_keys || []).map((k) => media[k]).find((x) => x && x.type === "photo" && x.url);
    return { id: t.id, handle: u.username, name: u.name, followers: u.public_metrics?.followers_count || 0, text: t.text, eng, url: u.username ? `https://x.com/${u.username}/status/${t.id}` : null, photo: photo ? { url: photo.url } : null };
  }).filter((t) => t.handle && t.followers >= minFollowers && !SPAM_RE.test(t.text)
      && !/sportsbook|gambl|casino|parlay|bookie|sportsbet|betway|bet365|draftkings|fanduel|1xbet|picks/i.test(t.handle))
    .sort((a, b) => b.eng - a.eng);
}

/** Download an image URL → { data:base64, media_type, bytes } for Claude vision / re-upload. */
export async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const media_type = ct.includes("png") ? "image/png" : ct.includes("webp") ? "image/webp"
    : ct.includes("gif") ? "image/gif" : /\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg";
  return { data: buf.toString("base64"), media_type, bytes: buf.length, buf };
}

// ── X writes (OAuth 1.0a user context — posts as @Yourscore_App_) ────────────--
function authHeader(method, url, queryParams = {}) {
  requireWriteCreds();
  const oauth = {
    oauth_consumer_key: KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...oauth, ...queryParams };
  const paramStr = Object.keys(all).sort().map((k) => `${pct(k)}=${pct(all[k])}`).join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join("&");
  const signingKey = `${pct(SECRET)}&${pct(TOKEN_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
}

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEETS_URL = "https://api.twitter.com/2/tweets";

export async function uploadMedia(path) {
  const buf = readFileSync(path);
  if (buf.length > 5 * 1024 * 1024) throw new Error(`image ${(buf.length / 1048576).toFixed(1)}MB exceeds 5MB simple-upload limit`);
  const fd = new FormData();
  fd.set("media", new Blob([buf]), "card.png");
  const res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: authHeader("POST", UPLOAD_URL) }, body: fd });
  const body = await res.text();
  if (!res.ok) throw new Error(`media upload ${res.status}: ${body}`);
  const id = JSON.parse(body).media_id_string;
  if (!id) throw new Error(`media upload returned no media_id: ${body}`);
  return id;
}

// opts: a media_id string (legacy) OR { mediaId, replyTo, quoteId } for replies / quote tweets.
export async function postTweet(text, opts = {}) {
  if (typeof opts === "string") opts = { mediaId: opts };
  const { mediaId, replyTo, quoteId } = opts;
  const payload = { text };
  if (mediaId) payload.media = { media_ids: [mediaId] };
  if (replyTo) payload.reply = { in_reply_to_tweet_id: String(replyTo) };
  if (quoteId) payload.quote_tweet_id = String(quoteId);
  const res = await fetch(TWEETS_URL, {
    method: "POST",
    headers: { Authorization: authHeader("POST", TWEETS_URL), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`create tweet ${res.status}: ${body}`);
  return JSON.parse(body).data; // { id, text }
}

// ── Animated GIF / short video upload (chunked v1.1) ─────────────────────────--
// Twitter's API can't reach the in-app GIF picker, so a GIF/clip must be uploaded
// as a file via the chunked INIT/APPEND/FINALIZE flow, then attached like an image.
// We put the command params in the QUERY STRING so the existing OAuth signer covers
// them (the multipart APPEND body is excluded from the signature, same as a photo).
async function uploadCmd(params, body) {
  const url = `${UPLOAD_URL}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: authHeader("POST", UPLOAD_URL, params) }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`media ${params.command} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
async function uploadStatus(mediaId) {
  const params = { command: "STATUS", media_id: mediaId };
  const url = `${UPLOAD_URL}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: authHeader("GET", UPLOAD_URL, params) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`media STATUS ${res.status}: ${text}`);
  return JSON.parse(text);
}

/**
 * Upload an animated GIF (image/gif) or short MP4 (video/mp4 — what Telegram GIFs
 * actually are) and return a media_id ready to attach to a tweet.
 * @param {Buffer} buf
 * @param {string} mime  "image/gif" or "video/mp4"
 */
export async function uploadAnimated(buf, mime) {
  requireWriteCreds();
  const category = mime === "image/gif" ? "tweet_gif" : "tweet_video";
  const init = await uploadCmd({ command: "INIT", total_bytes: String(buf.length), media_type: mime, media_category: category });
  const mediaId = init.media_id_string;
  if (!mediaId) throw new Error(`INIT returned no media_id: ${JSON.stringify(init)}`);

  const CHUNK = 4 * 1024 * 1024;
  for (let off = 0, seg = 0; off < buf.length; off += CHUNK, seg++) {
    const fd = new FormData();
    fd.set("media", new Blob([buf.subarray(off, Math.min(off + CHUNK, buf.length))]));
    await uploadCmd({ command: "APPEND", media_id: mediaId, segment_index: String(seg) }, fd);
  }

  let info = (await uploadCmd({ command: "FINALIZE", media_id: mediaId })).processing_info;
  let tries = 0;
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    if (tries++ > 20) throw new Error("media processing timed out");
    await new Promise((r) => setTimeout(r, Math.max(1, info.check_after_secs || 1) * 1000));
    info = (await uploadStatus(mediaId)).processing_info;
  }
  if (info && info.state === "failed") throw new Error(`media processing failed: ${JSON.stringify(info.error || info)}`);
  return mediaId;
}

// ── Reword (Anthropic) ───────────────────────────────────────────────────────
// The voice: YourScore's social handle. Knowledgeable football fan, UK English,
// punchy, confident. Repurposes the SOURCE's news/angle into our OWN standalone
// tweet — no @mention, no "via", no plagiarism, no invented facts.
const VOICE = `You write the X/Twitter posts for YourScore (@${HANDLE}), a small football game app (we made a game called "38-0" and a football "Quiz").
WHO WE ARE: we are FANS who love football. Not journalists, not pundits, not an editorial desk, not a stats account. We talk like normal people texting their mates about the game: warm, easy, a bit of wonder at how good football can be. We are just fans who happened to set up a game, never an authority.

TASK: you are given ONE source tweet from a football account we follow. React to its moment or news the way a fan would, as a brand new, ORIGINAL YourScore tweet.

HARD RULES (house style, locked by the founder):
- Do NOT @mention, tag, quote, credit or reference the source account in any way. No "via", no "per", no "[name] reports". Make it ours.
- Stay accurate to the source. NEVER invent fees, dates, quotes, clubs or outcomes. If the source is a rumour or claim, keep the hedge ("reportedly", "said to be").
- Only say "BREAKING", "confirmed" or "HERE WE GO" if the source clearly confirms it is done.
- NEVER use the long dash (the em dash or en dash). This is the single most important rule, it is the biggest "AI wrote this" tell and the founder hates it. If you genuinely need a dash, use ONE short hyphen with spaces around it, like " - ". Better still, use a full stop, comma or colon, or restructure. Real hyphens in scores like "1-0" are fine.
- No other AI-tell punctuation. Use plain straight quotes ' and ", not curly ones. Type three dots ... not the single ellipsis character. No "•" bullet characters and no arrow symbols (lead a line with an emoji instead). Nothing that looks copy-pasted from a document.
- WE, NEVER I: always speak as we / us / our. NEVER use I, me, my, or any first-person singular, anywhere. We are a crew of fans, not one person.
- TONE: warm and admiring of the game. A LIGHT take is fine (a gentle view, "that was harsh on them", "best keeper of the round"), and DRY WIT is welcome, but no hot takes, no snark, and NEVER a dig at a player. Respect the game and respect the players, the strugglers and the all-time greats alike. Point any wit at situations, irony or scheduling, never at people.
- REGISTER: clean and conversational, like texting a smart mate. No heavy slang, no swearing.
- GO EASY ON STATS. We are NOT a stats account. Do NOT lead with numbers, records or "X in Y games / fewest since 1966". Lead with the player, the moment or how it felt. A number can show up occasionally if it really matters, but keep it human, never a data dump.
- VOICE: warm and human, like texting a mate about the game. Plain, no hype words ("absolutely buzzing", "scenes", "unreal"). Let the photo do the work.
- VARY THE SHAPE - this really matters. Do NOT use the same structure every time. Tweet to tweet it should look genuinely different: sometimes ONE sharp line; sometimes two or three short lines; sometimes a setup line then a punchline; sometimes a line then a question. Read the moment and pick the shape that fits it. The worst thing we can do is make every tweet the same mould.
- SPACING: put a BLANK LINE between distinct thoughts so it breathes and reads well. Never run two separate ideas together into one cramped block when they want their own line.
- EMOJI: use them naturally where they actually fit and add warmth - usually one or two, sometimes none, placed where a real person would put them (mid-sentence or at the end), NOT a mechanical one opening every line. Vary how many you use tweet to tweet.
- SOMETIMES end with a fan question, but only occasionally: when the moment is genuinely debatable (a selection call, "can they go deep", a best-ever / GOAT argument, a contentious decision) you MAY finish with ONE short, real question that mates would actually argue about. MOST tweets have NO question. Never force one and never a flat "thoughts?".
- Short and easy, never a paragraph or a wall of text. No hashtag wall (one at most, or none). No links.
- Talk like a normal person, not journalese. No marketing-speak or CTAs ("Prove it.", "we rank you"), no engagement-bait ("RT if...").
- <= 270 characters. UK English.
- THE BAR IS HIGH — default to UNUSABLE. Only mark usable if this moment genuinely deserves a post on its own and you'd be proud to have it be the only thing we tweeted today: a real, notable moment with something worth saying, ideally carried by a clean photo. We post a FEW great things, never many average ones. Reject anything merely okay, generic, low-stakes, a routine result, or that we'd only post to keep the timeline busy. Without a clean repostable photo, the bar is HIGHER still — only usable if the line genuinely stands on its own. Always unusable: giveaways, replies, account admin, pure self-promo, off-topic, or an angle we've clearly used recently. When in doubt, UNUSABLE.

THE IMAGE (when one is attached):
- The attached image is the photo posted WITH this tweet. LOOK at it. Your caption should react to the actual moment in the picture (the player, the celebration, the scene), not just paraphrase the text. This is what makes it feel real and worth posting, not generic.
- Be specific to what is happening. "Look at this from [player]" beats a vague "what a moment". Name what you see when you can.
- useImage decision — can we REPOST this exact image as our own?
  - true ONLY if it is a clean photograph (a real action/celebration/crowd shot) with NO other account's logo, handle, watermark, or graphic overlay, and no baked-in headline/stat-card text.
  - false if it is a designed graphic, stat card, scoreboard, team-news teamsheet, quote card, or anything carrying another brand's name/logo/watermark, or a press photo with an agency credit stamped on it. We will not fly another brand's mark or risk an agency strike. Still write the caption; we just won't attach their image.

OUTPUT: respond with ONLY a JSON object, no prose, no code fences:
{"usable": true|false, "tweet": "<the rewritten tweet, or empty string>", "useImage": true|false, "imageNote": "<one line: what's in the image / why useImage>", "reason": "<short why/why-not>"}`;

function parseModelJSON(raw) {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  if (start === -1) throw new SyntaxError("no JSON object in model output");
  // Scan for the FIRST balanced object so trailing prose or a second block (the
  // model "thinking out loud") can't break the parse. String-aware so braces
  // inside the tweet text don't throw off the depth count.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  return JSON.parse(s.slice(start)); // unbalanced: let JSON.parse throw a clear error
}

/**
 * @param {{username:string, text:string}} source
 * @param {{note?:string}} opts  per-account voice steer from the watchlist
 * @returns {Promise<{usable:boolean, tweet:string, reason:string}>}
 */
export async function reword(source, { note } = {}) {
  requireAnthropic();
  const system = note ? `${VOICE}\n\nFor this source account, also keep in mind: ${note}` : VOICE;

  // Pick the first real photo (not a video/GIF still) to show the model and potentially repost.
  const photo = (source.media || []).find((m) => m.type === "photo" && m.url);
  const content = [];
  let image = null;
  if (photo) {
    try {
      const img = await fetchImage(photo.url);
      if (img.bytes <= 4.5 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/.test(img.media_type)) {
        content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
        image = { url: photo.url, width: photo.width, height: photo.height, alt: photo.alt };
      }
    } catch { /* image unreachable — fall back to text-only */ }
  }
  content.push({ type: "text", text: `SOURCE TWEET (from @${source.username}):\n"""\n${source.text}\n"""${image ? "\n\n(The attached image is the photo posted with this tweet.)" : ""}` });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: REWORD_MODEL, max_tokens: 600, system, messages: [{ role: "user", content }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body}`);
  const text = JSON.parse(body).content?.map((b) => b.text || "").join("") ?? "";
  const out = parseModelJSON(text);
  return {
    usable: !!out.usable,
    tweet: sanitize(out.tweet || ""),
    reason: out.reason || "",
    // Only hand back an image to repost if the model judged it clean (no other brand's mark).
    image: image && out.useImage ? image : null,
    imageNote: out.imageNote || "",
  };
}

// ── Engagement: reply to / quote a viral tweet (ride someone else's reach) ────
const ENGAGE_VOICE = `You handle X engagement for YourScore (@${HANDLE}), a football game app. RIGHT NOW you are NOT promoting anything. You are a real football fan jumping into a big conversation to be a good voice in the thread. We get noticed by being likeable and sharp, never by pitching.

CONTEXT: the 2026 World Cup is happening RIGHT NOW (June-July 2026, hosted by USA/Canada/Mexico). These tweets are REAL, current events. Treat every result, score and story as real - never call them fictional, speculative or misinformation.

You are given ONE high-reach football tweet. Decide whether to REPLY or QUOTE it, and write our post.
- REPLY (usually the best for reach): a short, genuine reaction that ADDS to the thread - a real thought, a memory, a light take, a warm laugh, or a question back. It must make a stranger smile or nod. NEVER generic ("great post", "this", "love this"), never a pitch, never a link, and NEVER mention YourScore or our games at all.
- QUOTE: our own short take on the moment for our own timeline. A bit more personality allowed. Still a fan first; at most a light, natural nod to how fun football is. Usually no link, no hard pitch.

HARD RULES:
- WE, NEVER I: always speak as we / us / our. NEVER use I, me, my, or any first-person singular, even in a reply. We are a crew of fans, not one person. Sound human and warm, just always "we".
- DRY WIT is welcome, but RESPECT THE GAME AND THE PLAYERS. Never take a dig at a player, never mock a legend, a GOAT, or someone having a poor game. Aim any humour at situations, irony or scheduling, never at people. A LIGHT take is fine (a gentle view); a hot take, snark or jab is not.
- never the em or en dash (use a full stop, comma, or one spaced hyphen " - "); straight quotes only; three dots ... not the ellipsis glyph; no bullet or arrow characters; no hashtag walls (none is best in a reply).
- Clean and conversational, no heavy slang, no swearing. UK English. 240 characters or fewer.
- EMOJI: a fitting emoji or two is welcome in a reply, it reads warm and human. Place them naturally where they land (mid-sentence or at the end); don't force one and never one on every line.
- VARY THE SHAPE: some replies are a single sharp line, others are two short lines with a BLANK LINE between separate thoughts so it breathes. Do NOT make every reply the same shape.

THE BAR IS HIGH. Default to UNUSABLE. Only engage if we genuinely have something good to say to a big, relevant football moment and our post would earn its place in that thread. Skip gambling, ragebait, pure news with nothing to add, off-topic, or anything where we would just be noise. When in doubt, unusable.

OUTPUT JSON only, no prose, no code fences:
{"usable": true|false, "kind": "reply"|"quote", "text": "<our reply or quote, or empty string>", "reason": "<short why/why-not>"}`;

/**
 * Draft a reply or quote for a viral tweet. Vision-aware (sees the tweet's photo).
 * @param {{handle:string, followers:number, text:string, photo?:{url:string}}} target
 * @returns {Promise<{usable:boolean, kind:'reply'|'quote', text:string, reason:string}>}
 */
export async function draftEngagement(target) {
  requireAnthropic();
  const content = [];
  if (target.photo?.url) {
    try {
      const img = await fetchImage(target.photo.url);
      if (img.bytes <= 4.5 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/.test(img.media_type))
        content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
    } catch { /* no image context */ }
  }
  content.push({ type: "text", text: `HIGH-REACH TWEET from @${target.handle} (${target.followers.toLocaleString()} followers):\n"""\n${target.text}\n"""${target.photo ? "\n\n(the attached image is on that tweet)" : ""}` });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: REWORD_MODEL, max_tokens: 500, system: ENGAGE_VOICE, messages: [{ role: "user", content }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body}`);
  const text = JSON.parse(body).content?.map((b) => b.text || "").join("") ?? "";
  const out = parseModelJSON(text);
  return { usable: !!out.usable, kind: out.kind === "quote" ? "quote" : "reply", text: sanitize(out.text || ""), reason: out.reason || "" };
}

// ── revise (feedback-driven rewrite of an existing original draft) ───────────--
const REVISE = `You revise X/Twitter posts for YourScore (@${HANDLE}), a football game app (games: "38-0", a team-builder, and a football "Quiz"). You are a FAN of football who set up a game. NOT a journalist, pundit or stats account. Talk like a normal person texting their mates.

TASK: revise the CURRENT DRAFT according to the FOUNDER FEEDBACK. Keep what already works and change only what the feedback asks for (reword, restructure, tighten, shift the tone, etc.). If the feedback is vague, make the tweet sharper and more human while honouring it.

HARD RULES (locked house style):
- NEVER use the long dash (em or en dash). This is the biggest "AI wrote this" tell and the founder hates it. Use a full stop, comma or colon, or one short hyphen with spaces " - ". Real score hyphens like "1-0" are fine.
- No other AI-tell punctuation: plain straight quotes ' and ", three dots ... not the ellipsis glyph, no "•" bullets, no arrow characters.
- Use natural contractions (don't, you're, it's). Never sound robotic or stiff.
- EMOJI: use them naturally where they fit and add warmth, usually one or two, sometimes none. Placed where a person would put them, never one mechanically opening every line.
- VARY THE SHAPE and use BLANK LINES between distinct thoughts so it breathes. Don't force the draft into the same mould as every other tweet.
- Easy on stats. Lead with the player, the moment or how it feels, not numbers or records.
- WE, never I: always we / us / our, never first-person singular anywhere.
- Warm and admiring. A light take is fine and dry wit is welcome, but never a dig at a player, never mock a great, and no hot takes or snark. Respect the players and the game. Clean and conversational, no heavy slang or swearing. Default to warm and understated (like texting a mate); a real fan question at the end is fine only when the moment is genuinely debatable.
- No hashtag wall (one at most, usually none). UK English.
- KEEP any link/URL from the draft EXACTLY as written, on its own final line. Do not invent, change or drop a link unless the feedback explicitly says to.
- Tweet length, 275 characters or fewer including the link.

OUTPUT: respond with ONLY a JSON object, no prose, no code fences:
{"tweet": "<the revised tweet>", "note": "<one short line on what you changed>"}`;

/**
 * Revise an existing original draft per the founder's feedback.
 * @param {string} currentDraft  the draft tweet text
 * @param {string} feedback      free-text instruction ("punchier", "restructure around the keeper", ...)
 * @returns {Promise<{tweet:string, note:string}>}
 */
export async function revise(currentDraft, feedback) {
  requireAnthropic();
  const user = `CURRENT DRAFT:\n"""\n${currentDraft}\n"""\n\nFOUNDER FEEDBACK:\n"""\n${feedback}\n"""\n\nRewrite the draft accordingly.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: REWORD_MODEL, max_tokens: 500, system: REVISE, messages: [{ role: "user", content: user }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body}`);
  const text = JSON.parse(body).content?.map((b) => b.text || "").join("") ?? "";
  const out = parseModelJSON(text);
  return { tweet: sanitize(out.tweet || ""), note: out.note || "" };
}

// ── sanitize ─────────────────────────────────────────────────────────────────
/**
 * Scrub the punctuation/symbols that read as "an AI wrote this" so every tweet
 * looks like a person typed it. Belt-and-braces: the reword prompt forbids these,
 * this guarantees it. Applied to every draft (reworded AND hand-edited) before it
 * can reach the queue or get posted.
 *
 * The founder's #1 rule: NO long dash (em/en). Collapse it to a single spaced
 * hyphen. Also normalises smart quotes, the ellipsis glyph, bullets, arrows and
 * stray non-breaking spaces, and tidies spacing.
 */
export function sanitize(text) {
  if (!text) return "";
  return text
    // every long dash / figure dash / minus sign -> a single spaced hyphen, so
    // "a \u2014 b", "a\u2014b" and "a - b" all land as "a - b". ASCII "-" in
    // "1-0" or "head-to-head" is left alone.
    .replace(/\s*[\u2010-\u2015\u2212]\s*/g, " - ")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // curly single quotes / apostrophes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // curly double quotes
    .replace(/\u2026/g, "...")                       // ellipsis glyph -> three dots
    .replace(/[\u2022\u00B7\u2023\u25AA\u25CF\u25E6\u2043]/g, "") // bullets / middots
    .replace(/[\u2190-\u21FF\u2794\u2799\u27A1]/g, "")  // arrow chars (emoji arrows unaffected)
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u2007\u2009]/g, " ") // exotic spaces -> normal
    .replace(/[ \t]{2,}/g, " ")     // collapse runs of spaces
    .replace(/ +\n/g, "\n")        // trailing space before a newline
    .replace(/\n[ \t]+/g, "\n")   // leading space after a newline
    .replace(/\n{3,}/g, "\n\n")   // at most one blank line
    .trim();
}

// ── helpers shared by the CLIs ───────────────────────────────────────────────
export const tweetUrl = (username, id) => `https://x.com/${username}/status/${id}`;
export const charLen = (t) => [...t].length;
export const shortId = (sourceTweetId) => sourceTweetId.slice(-8);
