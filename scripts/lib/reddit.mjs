/**
 * reddit.mjs — shared helpers for the Reddit listening pipeline.
 *
 * The flow (mirrors the X repurpose pipeline):
 *   reddit-track.mjs    poll watched subreddits + searches → draft replies → queue
 *   reddit-telegram.mjs push drafts to Telegram, founder taps Post/Edit/Skip
 *
 * HOUSE RULES, locked at build time (Jul 2026, retargeted Jul 2026):
 *   • NOTHING posts without an explicit founder tap. No auto-post path exists.
 *   • Replies post from the founder's own account and read as a real person,
 *     because they are one: every word is approved (often edited) by him.
 *   • SCOPE: fantasy football (FPL) and trivia lead — new-season prep (squads,
 *     wildcards, transfers, captain picks) is the priority — but a genuinely
 *     good football thread is fair game too (founder, Jul 9).
 *   • EUROPE ONLY: no real insight on leagues outside Europe and no engagement
 *     in those threads either — skip them, don't draft (founder, Jul 9).
 *   • NO PRODUCT MENTIONS, ever, on this pipeline. Pure value, no pitch.
 *
 * Creds in .env.local (run with `node --env-file=.env.local`):
 *   REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET   the "script" app at reddit.com/prefs/apps
 *   REDDIT_REFRESH_TOKEN                      minted once via scripts/reddit-auth.mjs
 *   ANTHROPIC_API_KEY                         reply drafting
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJSON, saveJSON, sanitize } from "./x-watch.mjs";

export { loadJSON, saveJSON, sanitize };

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

export const PATHS = {
  watchlist: join(DATA_DIR, "reddit-watchlist.json"),
  state: join(DATA_DIR, "reddit-state.json"),
  queue: join(DATA_DIR, "reddit-queue.json"),
};

export const DRAFT_MODEL = "claude-sonnet-4-6";
// Descriptive UA is a Reddit API requirement; generic UAs get 403'd/throttled.
export const USER_AGENT = "macos:app.yourscore.reddit-listen:v1.0 (football thread listener; human-approved replies)";

const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;

export function requireReddit() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("Missing REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET in env — create the script app at reddit.com/prefs/apps");
  if (!REFRESH_TOKEN) throw new Error("Missing REDDIT_REFRESH_TOKEN — run: node --env-file=.env.local scripts/reddit-auth.mjs");
}
export function requireAnthropic() {
  if (!ANTHROPIC) throw new Error("Missing ANTHROPIC_API_KEY in env");
}

// ── OAuth ────────────────────────────────────────────────────────────────────
let _token = null, _tokenExp = 0;
export async function getToken() {
  requireReddit();
  if (_token && Date.now() < _tokenExp - 60_000) return _token;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`reddit token ${res.status}: ${body.slice(0, 300)}`);
  const j = JSON.parse(body);
  _token = j.access_token;
  _tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return _token;
}

async function api(path, { method = "GET", form } = {}) {
  const token = await getToken();
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = await res.text();
  if (!res.ok) { const e = new Error(`reddit ${method} ${path} → ${res.status}: ${body.slice(0, 300)}`); e.status = res.status; throw e; }
  return body ? JSON.parse(body) : {};
}

export async function me() { return api("/api/v1/me"); }

export const hasApiCreds = () => !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);

// ── RSS fallback (no credentials) ────────────────────────────────────────────
// Until Reddit approves Data API access, subreddit listings (and sometimes
// search) are readable via public Atom feeds. HEAVILY rate-limited per IP:
// roughly one request a minute sustains, bursts get 429, so pace every request
// and retry a 429 once. Feeds carry no vote counts, so RSS-mode posts have
// ups=null and minUps filters don't apply.
//
// MUST use curl, not fetch(). Reddit fingerprints the TLS handshake, and Node's
// undici client is blocked outright: on Jul 10 2026 the same URL, same IP, same
// User-Agent, 70s apart returned curl 200 / fetch 403 / curl 200 — on both the
// laptop and the VPS. This silently killed every sweep for three hours.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

const RSS_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const RSS_SPACING_MS = 65_000;
let _lastRss = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const unesc = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const stripTags = (s) => unesc(unesc(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const STATUS_MARK = "\n__HTTP_STATUS__:";

/** GET via curl. Returns the body; throws with the status on any non-2xx. */
async function curlGet(url) {
  const { stdout } = await execFileAsync("curl", [
    "-sS", "--compressed", "--max-time", "30",
    "-A", RSS_UA,
    "-H", "Accept: application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H", "Accept-Language: en-GB,en;q=0.9",
    "-w", `${STATUS_MARK}%{http_code}`,
    url,
  ], { maxBuffer: 20 * 1024 * 1024 });
  const at = stdout.lastIndexOf(STATUS_MARK);
  if (at === -1) throw new Error(`rss ${url} → no status from curl`);
  const status = Number(stdout.slice(at + STATUS_MARK.length).trim());
  const body = stdout.slice(0, at);
  if (status < 200 || status >= 300) { const e = new Error(`rss ${url} → ${status}`); e.status = status; throw e; }
  return body;
}

async function fetchRss(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = _lastRss + RSS_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    _lastRss = Date.now();
    try {
      return await curlGet(url);
    } catch (e) {
      if (e.status !== 429) throw e;
      await sleep(90_000); // one patient retry on 429
    }
  }
  throw new Error(`rss ${url} → 429 (still throttled after retry)`);
}

function parseAtom(xml) {
  const posts = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const pick = (tag) => (entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
    const link = (entry.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    const id = (link.match(/\/comments\/([a-z0-9]+)\//) || [])[1];
    if (!id) continue;
    const m = link.match(/reddit\.com\/r\/([^/]+)\//);
    posts.push({
      id,
      fullname: `t3_${id}`,
      sub: m ? m[1] : "",
      title: stripTags(pick("title")),
      body: stripTags(pick("content")).replace(/submitted by.*$/i, "").slice(0, 4000),
      author: stripTags(pick("name")).replace(/^\/?u\//, ""),
      ups: null,                    // not in feeds — RSS mode skips vote filters
      numComments: null,
      createdUtc: Math.floor(Date.parse(pick("published") || pick("updated")) / 1000) || Math.floor(Date.now() / 1000),
      url: unesc(link),
      linkFlair: null, isSelf: true, over18: false, stickied: false,
    });
  }
  return posts;
}

export async function listPostsRSS(subreddit, { sort = "hot" } = {}) {
  return parseAtom(await fetchRss(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.rss`));
}
export async function searchPostsRSS(query, { time = "day" } = {}) {
  return parseAtom(await fetchRss(`https://www.reddit.com/search.rss?${new URLSearchParams({ q: query, sort: "new", t: time })}`));
}

/** OAuth when creds exist, RSS otherwise — same shape either way. */
export async function listPostsAny(subreddit, opts = {}) {
  return hasApiCreds() ? listPosts(subreddit, opts) : listPostsRSS(subreddit, opts);
}
export async function searchPostsAny(query, opts = {}) {
  return hasApiCreds() ? searchPosts(query, opts) : searchPostsRSS(query, opts);
}

// ── reads ────────────────────────────────────────────────────────────────────
const mapPost = (c) => {
  const d = c.data;
  return {
    id: d.id,
    fullname: d.name,                       // t3_xxxxx — what /api/comment replies to
    sub: d.subreddit,
    title: d.title,
    body: (d.selftext || "").slice(0, 4000),
    author: d.author,
    ups: d.ups,
    numComments: d.num_comments,
    createdUtc: d.created_utc,
    url: `https://www.reddit.com${d.permalink}`,
    linkFlair: d.link_flair_text || null,
    isSelf: d.is_self,
    over18: d.over_18,
    stickied: d.stickied,
  };
};

/** Posts from a subreddit listing. sort: hot | new | rising | top */
export async function listPosts(subreddit, { sort = "hot", limit = 30 } = {}) {
  const j = await api(`/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}&raw_json=1`);
  return (j.data?.children || []).filter((c) => c.kind === "t3").map(mapPost);
}

/** Site-wide (or per-sub) post search. time: hour | day | week */
export async function searchPosts(query, { sub, sort = "new", time = "day", limit = 25 } = {}) {
  const base = sub ? `/r/${encodeURIComponent(sub)}/search.json` : "/search.json";
  const p = new URLSearchParams({ q: query, sort, t: time, limit: String(limit), type: "link", raw_json: "1", ...(sub ? { restrict_sr: "1" } : {}) });
  const j = await api(`${base}?${p}`);
  return (j.data?.children || []).filter((c) => c.kind === "t3").map(mapPost);
}

// ── writes (only ever called from the Telegram poller, after a founder tap) ──
/** Comment on a post (parent = t3_xxx fullname). Returns {id, permalink}. */
export async function postComment(parentFullname, text) {
  const j = await api("/api/comment", { method: "POST", form: { api_type: "json", thing_id: parentFullname, text } });
  const errors = j.json?.errors || [];
  if (errors.length) throw new Error(`reddit comment rejected: ${JSON.stringify(errors)}`);
  const thing = j.json?.data?.things?.[0]?.data;
  return { id: thing?.id, permalink: thing?.permalink ? `https://www.reddit.com${thing.permalink}` : null };
}

// ── drafting ─────────────────────────────────────────────────────────────────
// The founder's Reddit voice. First person singular ("I") — unlike the X handle,
// these replies go out from HIS account and every one is approved by him, so the
// register is a real person, not a brand.
const VOICE = `You draft Reddit replies for the founder of YourScore (yourscore.app), a football-knowledge game (daily World Cup quiz + "38-0", a draft-your-XI game). The replies post from HIS PERSONAL account after he reads, edits and approves each one. You write in HIS voice: a UK football fan who happens to have built a football game.

WHAT A REPLY IS FOR: being a genuinely good, valuable voice. Fantasy football and trivia threads come FIRST - this sweep exists above all to help people prep for the new season: squad/wildcard building, transfers, captain picks, price-rise calls, and sharp trivia/knowledge answers. But a genuinely good football thread (a great debate, a memory thread, a tactics question you can actually add to) is also in scope - draft it when the reply would make the thread better. When choosing between candidates, fantasy football wins.

PRODUCT MENTIONS: NONE. This sweep never mentions YourScore and never links it - not even if a thread directly asks for a quiz/game recommendation. The entire point is giving away good, free value with zero pitch. mentionsProduct must always be false; if a draft would reference the product, mark it UNUSABLE instead.

HARD RULES (locked house style):
- NEVER the em or en dash. Use a full stop, comma, or one spaced hyphen " - ". Score hyphens like "1-0" are fine. Straight quotes only, three dots ... not the ellipsis glyph, no bullet characters.
- Sound like Reddit, not LinkedIn: casual, specific, a bit of dry wit is welcome. No marketing-speak, no "Great question!", no exclamation-mark enthusiasm, no emoji unless it truly fits (usually none).
- UK English. Contractions. Lowercase-casual is fine where it fits the sub.
- Length: match the thread. Often 1-3 sentences. A meaty answer to a meaty question can be a short paragraph or two. Never a wall.
- Accurate: never invent facts, stats, transfers or quotes. If unsure, hedge or leave it out.
- Respect players and the game. No digs, no snark at people. Skip grief/injury/tragedy threads entirely.

THE BAR: default UNUSABLE. Only usable if the reply would genuinely earn upvotes on its own merits and he'd be happy to have written it himself. Skip: betting/gambling, drama/ragebait, mod/meta threads, anything stickied, anything where we'd be noise, threads older than a day with hundreds of comments (we'd be buried), and any thread where a product mention would be the only reason to reply but the rules or vibe forbid it. Also skip any thread that is really about a league, team or competition outside Europe (MLS, Liga MX, Brazilian/South American leagues, African and Asian leagues, etc.) - we have no genuine insight there and these threads don't get engagement for us, so mark UNUSABLE rather than guessing.

OUTPUT: ONLY a JSON object, no prose, no code fences:
{"usable": true|false, "reply": "<the reply, or empty string>", "mentionsProduct": true|false, "score": <1-10 how strong an opportunity this thread is>, "reason": "<short why/why-not>"}`;

function parseModelJSON(raw) {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  if (start === -1) throw new SyntaxError("no JSON object in model output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  return JSON.parse(s.slice(start));
}

/**
 * @param {ReturnType<typeof mapPost>} post
 * @param {{subNote?:string, searchNote?:string}} opts  per-sub rules / per-search steer from the watchlist
 */
export async function draftReply(post, { subNote, searchNote } = {}) {
  requireAnthropic();
  const ageH = Math.round((Date.now() / 1000 - post.createdUtc) / 360) / 10;
  const ctx = [
    `SUBREDDIT: r/${post.sub}${subNote ? `  (rules note: ${subNote})` : ""}`,
    searchNote ? `FOUND VIA SEARCH: ${searchNote}` : null,
    `THREAD (${post.ups} upvotes, ${post.numComments} comments, ${ageH}h old${post.linkFlair ? `, flair: ${post.linkFlair}` : ""}):`,
    `TITLE: ${post.title}`,
    post.body ? `BODY:\n"""\n${post.body}\n"""` : "(link/media post, no self-text)",
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: DRAFT_MODEL, max_tokens: 700, system: VOICE, messages: [{ role: "user", content: ctx }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  const text = JSON.parse(body).content?.map((b) => b.text || "").join("") ?? "";
  const out = parseModelJSON(text);
  return {
    usable: !!out.usable,
    reply: sanitize(out.reply || ""),
    mentionsProduct: !!out.mentionsProduct,
    score: Number(out.score) || 0,
    reason: out.reason || "",
  };
}
