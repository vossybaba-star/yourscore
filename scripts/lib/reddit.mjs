/**
 * reddit.mjs — shared helpers for the Reddit listening pipeline.
 *
 * TWO lanes, both landing in the same queue, both read by the Studio dash
 * (studio.yourscore.app → Reddit). Nothing is pushed to Telegram; nothing posts.
 *   reddit-fast.mjs   every 30min · ONE multireddit `new` request across all the
 *                     joined subs · threads <40min old · the first-commenter lane
 *   reddit-track.mjs  5x/day · walks each sub's `hot` · catches the bigger threads
 *                     the fast lane's freshness window misses
 *
 * They pace against ONE shared RSS clock (see claimRssSlot), so they can run
 * concurrently without spending each other's per-IP Reddit budget.
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
import { readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
const execFileAsync = promisify(execFile);

const RSS_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const RSS_SPACING_MS = 65_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reddit's unauthenticated budget is per-IP. The pacing clock used to be a
// module variable, which meant it was per-PROCESS: reddit-track and reddit-fast
// could not see each other and would fire two requests in the same second. The
// old workaround had the fast lane stand DOWN whenever a sweep was running —
// which cost it entire runs (and misfired, standing down when nothing ran).
//
// Pace through a shared FILE instead: one clock for the whole box. Both lanes
// can now run concurrently and the global rate still never exceeds one request
// per RSS_SPACING_MS — which is the constraint that actually matters.
const PACE_FILE = join(DATA_DIR, ".rss-pace");
const PACE_LOCK = join(DATA_DIR, ".rss-pace.lock");
const LOCK_STALE_MS = 15_000;  // a holder killed mid-write must not wedge every lane forever

/**
 * Claim the next RSS slot. Returns 0 once the slot is OURS (the clock is stamped),
 * otherwise the ms still to wait. Read-and-stamp is guarded by an exclusive-create
 * lockfile, so two processes can't both conclude the slot is free.
 */
async function claimRssSlot() {
  for (let spin = 0; spin < 300; spin++) {
    let held = false;
    try {
      writeFileSync(PACE_LOCK, String(process.pid), { flag: "wx" });
      held = true;
    } catch {
      // Someone holds the mutex. Steal it only if its holder clearly died.
      try { if (Date.now() - statSync(PACE_LOCK).mtimeMs > LOCK_STALE_MS) unlinkSync(PACE_LOCK); }
      catch { /* it vanished under us — just retry */ }
      await sleep(100);
      continue;
    }
    try {
      let last = 0;
      try { last = Number(readFileSync(PACE_FILE, "utf8")) || 0; } catch { last = 0; }
      const wait = last + RSS_SPACING_MS - Date.now();
      if (wait > 0) return wait;                      // not our turn — leave the clock untouched
      writeFileSync(PACE_FILE, String(Date.now()));   // stamp it: the slot is ours
      return 0;
    } finally {
      if (held) { try { unlinkSync(PACE_LOCK); } catch { /* already stolen */ } }
    }
  }
  return 0;  // mutex wedged beyond stealing: proceed rather than hang a sweep forever
}

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
    // Wait on the SHARED clock, then take the slot. Any other Reddit lane on this
    // box is waiting on the same file, so we can't collide with it.
    for (;;) {
      const wait = await claimRssSlot();
      if (wait <= 0) break;
      await sleep(Math.min(wait, RSS_SPACING_MS));
    }
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

/**
 * `subreddit` may be a multireddit ("a+b+c") — one request covering many subs,
 * which is what keeps the fast lane inside Reddit's ~1-req/min budget.
 * `limit` matters: the default feed returns 25 entries, which on a busy
 * multireddit only reaches ~40 minutes back. limit=100 reaches ~2.5 hours, so a
 * 30-minute poll can't silently drop threads that fell off the end.
 */
export async function listPostsRSS(subreddit, { sort = "hot", limit } = {}) {
  const path = subreddit.split("+").map((s) => encodeURIComponent(s)).join("+");
  const qs = limit ? `?limit=${limit}` : "";
  return parseAtom(await fetchRss(`https://www.reddit.com/r/${path}/${sort}.rss${qs}`));
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
const VOICE = `You draft Reddit replies for the founder of YourScore (yourscore.app), a football-knowledge game (daily World Cup quiz + "38-0", a draft-your-XI game). The replies post from HIS PERSONAL account after he reads, edits and approves each one. You write in HIS voice: someone who has followed football for years, a proper Arsenal fan, into the culture of the game (banter, history, transfer gossip, matchday chat) - who also happens to have built a football game. Football-guy first, founder second.

WHAT A REPLY IS FOR: being a genuinely good, valuable voice. Fantasy football and trivia threads come FIRST - this sweep exists above all to help people prep for the new season: squad/wildcard building, transfers, captain picks, price-rise calls, and sharp trivia/knowledge answers. But a genuinely good football thread (a great debate, a memory thread, a tactics question you can actually add to) is also in scope - draft it when the reply would make the thread better. When choosing between candidates, fantasy football wins.

PRODUCT MENTIONS: NONE. This sweep never mentions YourScore and never links it - not even if a thread directly asks for a quiz/game recommendation. The entire point is giving away good, free value with zero pitch. mentionsProduct must always be false; if a draft would reference the product, mark it UNUSABLE instead.

HARD RULES (locked house style):
- NEVER the em or en dash. Use a full stop, comma, or one spaced hyphen " - ". Score hyphens like "1-0" are fine. Straight quotes only, three dots ... not the ellipsis glyph, no bullet characters.
- Sound like Reddit, not LinkedIn: casual, specific, a bit of dry wit is welcome. No marketing-speak, no "Great question!", no exclamation-mark enthusiasm, no emoji unless it truly fits (usually none).
- Sound like a real person typing on their phone, not an AI: no tidy three-part structure, no "on the other hand", no summarising what you just said, no hedge-everything caveats stacked up, no listy answers unless the thread is literally asking for a list. One take, stated like you'd say it to a mate down the pub, not a balanced briefing.
- UK English. Contractions. Lowercase-casual is fine where it fits the sub.
- Length: SHORT by default. Real people replying on Reddit don't write essays. Default to 1-2 sentences. Go to a short paragraph only for a genuinely meaty question that needs it - and even then, stop as soon as the point is made. If you're tempted to write more than 4-5 sentences, cut it. Never a wall.
- RESEARCH FIRST, THEN FORM THE OPINION. This is the order you work in, and it is not optional. Your own football knowledge is STALE: it is July 2026, a World Cup is underway, and the current season is past what you were trained on. You get these badly wrong from memory (you have named managers who already left their club). You HAVE a web search tool - USE IT BEFORE YOU WRITE.
  1. Read the thread and work out which current-world facts a good reply would turn on: who manages or plays for a club now, transfers, injuries, form, recent results, scorers, standings, who is still in the tournament, what has already happened.
  2. SEARCH and establish those facts. Check the thread's own premise too - if it's about a player, confirm his current club before you reference it.
  3. THEN write the take, built on what you actually found.
- You MAY state a fact - but ONLY one a search result in this conversation confirms. Don't avoid facts: a sharp, correct detail is usually what makes a reply worth upvoting, so use the good ones you find. What you must never do is state a fact from MEMORY, or reason from a premise you didn't verify.
- THIS APPLIES TO HISTORY TOO, not just current events. Your recall of specific past detail is also unreliable - who beat whom, in which year, in which round, what the score was, who scored, what a player or manager actually said. If the reply leans on a specific historical claim, SEARCH it like anything else. "Everyone knows this one" is exactly how you post something wrong. Only broad, uncontroversial context (a club's general reputation, how a rule works, what a tactic is) is safe from memory.
- If a search can't confirm something the reply depends on, cut that bit or mark the whole reply UNUSABLE. Never guess, never hedge a shaky fact in ("I think", "if I remember right"). A confidently wrong fact posted in his name is far worse than staying quiet.
- Accurate: never invent stats or quotes. Attribute a quote only if search confirms who said it.
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

// ── Tier 1: triage (cheap, NO web search) ────────────────────────────────────
// Most candidate threads get dropped. Deciding that with the paid search tool
// enabled meant paying to research threads we were never going to reply to.
// Triage first with a plain call, and only spend on the survivors.
// This is an EXCLUSION filter, not a quality judge. It runs before we've gathered
// any facts, so it cannot tell a good opportunity from a bad one — the value of a
// reply lives in what HE can add, not in how substantial the OP is. An earlier
// version judged quality and threw away the good stuff: it binned a "is Haaland
// the best player of this tournament?" thread as "a vague one-liner" (the drafter
// then scored it 8/10) and binned FPL captaincy threads as "generic" (his top
// priority sub). So: hard categorical skips only, and DEFAULT TO PROCEEDING.
// The drafter — which has the facts — makes the real call via usable=false.
const TRIAGE_SYSTEM = `You are a cheap pre-filter for football (soccer) Reddit threads. A real person (long-time football fan, Arsenal supporter) may reply from his own account. Researching and drafting a reply costs money, so your ONLY job is to throw out threads that are categorically not worth spending anything on.

Set worth=false ONLY if the thread is clearly one of these:
- a megathread, daily discussion, match thread or mod/meta/announcement post
- grief, death, tragedy, or a serious injury
- REAL betting or gambling (odds, accumulators, staking money)
- pure drama/ragebait, or a thread whose whole point is abusing someone
- a bare image/meme/video post where the TITLE gives you nothing to discuss either
- centred on a league or competition OUTSIDE Europe (MLS, Liga MX, Brazil, Asia, Africa) - the World Cup and European leagues are always IN scope
- a fan-sentiment thread inside a RIVAL club's sub where he could only take part by posing as one of their fans

Otherwise set worth=TRUE. Default to true.

THREE MISTAKES YOU MUST NOT MAKE (you have made all three):
1. NEVER reject a thread because you don't believe its premise. Your knowledge is STALE - it is July 2026 and a World Cup is happening that you know nothing about. If a thread says a player is starring at this World Cup, ACCEPT THAT and pass it through. You are not the fact-checker; you have no facts. "That player isn't at the World Cup" is not a reason - you are simply wrong.
2. Fantasy football (FPL, Fantasy Premier League, captaincy, wildcards, transfers, draft) is NOT gambling. It is his single highest-priority topic. ALWAYS pass fantasy football threads through.
3. An empty body is NOT a reason to reject. Most Reddit posts are link posts with no self-text. Judge the TITLE. Only reject if the title too gives you nothing.

You are NOT judging whether the thread is interesting, substantial, well written, or whether he has anything clever to say - a short, plain question with a big audience is often the BEST thread to reply to. Something later in the pipeline decides that, with real facts in hand. Do not reject for being "generic", "vague", "low effort" or "he'd just be noise". If in doubt, pass it through.

Then name the entities a reply would need facts about, exactly as written in the thread.

Do NOT research anything. Your knowledge of current events is stale and irrelevant here - just read the thread.

OUTPUT: ONLY a JSON object, no prose, no code fences:
{"worth": true|false, "reason": "<short why>", "clubs": ["<clubs the thread is about>"], "players": ["<players>"], "competition": "<Premier League | World Cup | other | none>"}`;

/** Cheap gate: is this thread worth spending research + drafting on? */
export async function triage(post, { subNote } = {}) {
  requireAnthropic();
  const ctx = [
    `SUBREDDIT: r/${post.sub}${subNote ? `  (rules note: ${subNote})` : ""}`,
    `TITLE: ${post.title}`,
    post.body ? `BODY:\n"""\n${post.body.slice(0, 1200)}\n"""` : "(link/media post, no self-text)",
  ].join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: DRAFT_MODEL, max_tokens: 300, system: TRIAGE_SYSTEM, messages: [{ role: "user", content: ctx }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  const out = parseModelJSON(JSON.parse(body).content?.map((b) => b.text || "").join("") ?? "");
  return {
    worth: !!out.worth,
    reason: out.reason || "",
    clubs: Array.isArray(out.clubs) ? out.clubs : [],
    players: Array.isArray(out.players) ? out.players : [],
    competition: out.competition || "",
  };
}

/**
 * @param {ReturnType<typeof mapPost>} post
 * @param {{subNote?:string, searchNote?:string, brief?:string}} opts  per-sub rules, plus a
 *   FREE fact brief (Sportmonks/ESPN) to ground the draft without paid searching.
 */
export async function draftReply(post, { subNote, searchNote, brief } = {}) {
  requireAnthropic();
  const ageH = Math.round((Date.now() / 1000 - post.createdUtc) / 360) / 10;
  const ctx = [
    `SUBREDDIT: r/${post.sub}${subNote ? `  (rules note: ${subNote})` : ""}`,
    searchNote ? `FOUND VIA SEARCH: ${searchNote}` : null,
    `THREAD (${post.ups} upvotes, ${post.numComments} comments, ${ageH}h old${post.linkFlair ? `, flair: ${post.linkFlair}` : ""}):`,
    `TITLE: ${post.title}`,
    post.body ? `BODY:\n"""\n${post.body}\n"""` : "(link/media post, no self-text)",
    brief ? `\nVERIFIED FACTS (from live football data — TRUST THESE OVER YOUR OWN MEMORY, and over anything you find by searching):\n"""\n${brief}\n"""\nThese are already confirmed. Do NOT spend a web search re-checking anything the brief already answers. Search only for what the brief does not cover (news, quotes, injury reports, what someone said).` : null,
  ].filter(Boolean).join("\n");

  // Research-first: the drafter establishes the facts BEFORE forming the take
  // (founder, Jul 13: "gather the facts first and then form an opinion - that's
  // what the AI should be doing"). Facts come from the FREE brief first
  // (Sportmonks + ESPN, already paid / no cost); the paid web_search tool is the
  // fallback for what structured data can't answer. Writing from stale memory
  // and binning ~40% on a second pass was both wrong and more expensive.
  const text = await anthropicSearch(VOICE, ctx, { model: DRAFT_MODEL, maxTokens: 1400, maxUses: brief ? 3 : 6 });
  const out = parseModelJSON(text);
  return {
    usable: !!out.usable,
    reply: sanitize(out.reply || ""),
    mentionsProduct: !!out.mentionsProduct,
    score: Number(out.score) || 0,
    reason: out.reason || "",
  };
}

// ── Fact-check (web-search grounded) ─────────────────────────────────────────
// The drafter writes from stale training data and states current-world facts
// confidently wrong (Jul 13: "Arne Slot at Liverpool" after he'd left). The
// CURRENT-FACTS BAN in VOICE tells it to avoid such claims, but can't catch a
// fact it believes true. This second pass gives a checker LIVE web search so it
// can actually look up "who manages Liverpool" and reject the draft if any
// checkable current-world claim is wrong or unverifiable. Runs only on drafts
// that already passed the drafter's bar, so volume (and cost) is small.
const FACTCHECK_MODEL = "claude-sonnet-4-6"; // supports web_search_20260209
const FACTCHECK_SYSTEM = `You are a fact-checker for a football (soccer) Reddit reply drafted in July 2026 that a real person is about to post under his own name. Your job: catch any statement of current-world fact that is false or that you cannot verify.

USE WEB SEARCH. For every checkable claim about the CURRENT state of football — who manages or plays for a club, transfers/signings/departures, injuries, and any specific result, scoreline, scorer, assist, or league/table standing from the 2025/26 season or the 2026 World Cup — search to confirm it before trusting it. Do not rely on your own memory for anything time-sensitive; your training is stale.

Do NOT flag: opinions, tactical/subjective judgements, well-established pre-2023 history, rules of the game, or general banter. Those need no checking.

Verdict rules: pass ONLY if every checkable current-world claim is confirmed correct by what you found. If any such claim is wrong, or you searched and could not confirm it, fail. A confidently wrong fact in his name is the thing to prevent.

OUTPUT: ONLY a JSON object, no prose, no code fences:
{"pass": true|false, "failures": ["<each false/unverifiable claim + what's actually true>"], "note": "<one short line>"}`;

/** Anthropic call with the server-side web_search tool; loops through pause_turn.
 * A per-request timeout keeps one stalled connection from wedging a whole batch
 * (web_search turns can be slow; undici has no default body timeout). */
async function anthropicSearch(system, userText, { model = FACTCHECK_MODEL, maxTokens = 900, maxUses = 6, maxHops = 4, timeoutMs = 90_000 } = {}) {
  const messages = [{ role: "user", content: userText }];
  for (let hop = 0; hop < maxHops; hop++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let raw, res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctl.signal,
        headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model, max_tokens: maxTokens, system,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
          messages,
        }),
      });
      raw = await res.text();
    } catch (e) {
      throw new Error(e.name === "AbortError" ? `web search timed out after ${timeoutMs / 1000}s` : e.message);
    } finally { clearTimeout(t); }
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${raw.slice(0, 300)}`);
    const msg = JSON.parse(raw);
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    return (msg.content || []).map((b) => b.text || "").join("");
  }
  throw new Error("web search did not settle within maxHops");
}

/**
 * Verify a drafted reply against live web search.
 * @returns {{pass:boolean, failures:string[], note:string}}
 */
export async function factCheck(post, draft) {
  requireAnthropic();
  const ctx = [
    `SUBREDDIT: r/${post.sub}`,
    `THREAD TITLE: ${post.title}`,
    post.body ? `THREAD BODY:\n"""\n${post.body}\n"""` : "(link/media post, no self-text)",
    `THE DRAFTED REPLY TO CHECK:\n"""\n${draft}\n"""`,
  ].join("\n");
  const text = await anthropicSearch(FACTCHECK_SYSTEM, ctx);
  const out = parseModelJSON(text);
  return {
    pass: out.pass !== false, // default to pass only if the checker says nothing failed
    failures: Array.isArray(out.failures) ? out.failures : [],
    note: out.note || "",
  };
}

const FOLLOWUP_VOICE = `${VOICE}

YOU ARE NOW DRAFTING A FOLLOW-UP, not a fresh top-level comment: the founder already posted a reply in this thread, and the other redditor has replied back to HIM. Read what they actually said and respond to it directly, the way a real back-and-forth goes - shorter than an opener is usually right, and it's fine to just agree, add one extra detail, or ask a quick question back.

usable should be false only if there is genuinely nothing worth adding: the exchange has run its course, it's gone hostile, or a reply would just be noise. In that case leave "reply" empty and say why in "reason".

OUTPUT: ONLY a JSON object, no prose, no code fences:
{"usable": true|false, "reply": "<the reply, or empty string>", "mentionsProduct": true|false, "score": <1-10, unused but keep the field>, "reason": "<short why/why-not>"}`;

const REWORD_VOICE = `${VOICE}

YOU ARE NOW REWORDING an existing drafted reply that is still pending (not yet posted), because the founder asked for changes. He gives you notes/instructions on what's wrong or what to change - follow them precisely. Keep everything else about the reply (the parts he didn't flag) as close to the original as makes sense. Still obey every house rule above (no em dash, UK English, no product mention, accurate, matches thread length).

OUTPUT: ONLY a JSON object, no prose, no code fences:
{"usable": true|false, "reply": "<the reworded reply, or empty string>", "mentionsProduct": true|false, "score": <1-10, unused but keep the field>, "reason": "<short note on what changed>"}`;

/**
 * Reword an existing pending draft per the founder's notes/instructions.
 * @param {ReturnType<typeof mapPost>} post      the original thread
 * @param {string} currentDraft  the reply as currently drafted
 * @param {string} notes         founder's instructions for the reword
 */
export async function draftReword(post, currentDraft, notes) {
  requireAnthropic();
  const ctx = [
    `SUBREDDIT: r/${post.sub}`,
    `THREAD TITLE: ${post.title}`,
    post.body ? `THREAD BODY:\n"""\n${post.body}\n"""` : "(link/media post, no self-text)",
    `CURRENT DRAFT (still pending, not posted):\n"""\n${currentDraft}\n"""`,
    `FOUNDER'S NOTES/INSTRUCTIONS FOR THE REWORD:\n"""\n${notes}\n"""`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: DRAFT_MODEL, max_tokens: 700, system: REWORD_VOICE, messages: [{ role: "user", content: ctx }] }),
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

/**
 * Draft a reply to a redditor's reply, continuing a thread the founder already posted in.
 * @param {ReturnType<typeof mapPost>} post   the original thread
 * @param {string} ourReply    the founder's reply that was posted
 * @param {string} theirReply  what the redditor said back
 */
export async function draftFollowUp(post, ourReply, theirReply) {
  requireAnthropic();
  const ctx = [
    `SUBREDDIT: r/${post.sub}`,
    `ORIGINAL THREAD TITLE: ${post.title}`,
    post.body ? `ORIGINAL THREAD BODY:\n"""\n${post.body}\n"""` : "(link/media post, no self-text)",
    `THE FOUNDER'S POSTED REPLY:\n"""\n${ourReply}\n"""`,
    `THEIR REPLY BACK TO HIM:\n"""\n${theirReply}\n"""`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: DRAFT_MODEL, max_tokens: 700, system: FOLLOWUP_VOICE, messages: [{ role: "user", content: ctx }] }),
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
