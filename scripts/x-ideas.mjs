/**
 * x-ideas.mjs — the YourScore tweet IDEAS agent (runs every 3h, waking hours).
 *
 * Looks at the whole picture and proposes a short set (3-4) of ORIGINAL tweet ideas
 * for @Yourscore_App_, then pushes them to Telegram for approval. Nothing posts
 * without a tap. Folds in the old repurpose job: the "what's happening on Twitter"
 * signal here is the tracked watchlist, so x-propose is retired in favour of this.
 *
 * Signals it weighs each run:
 *   1. What we're shipping     - recent git commit subjects (inferred, never quoted)
 *   2. The product's talking points - the live, audience-facing features (below)
 *   3. What's happening on X    - top tweets from the tracked watchlist (last 24h)
 *   4. What we've already said  - last ~40 posted tweets + the queue, to NOT repeat
 *
 * A single Claude call turns all that into 3-4 fresh ideas across different pillars,
 * deduped against recent posts. Each idea carries its pillar + a one-line "why".
 *
 * Usage:  node --env-file=.env.local scripts/x-ideas.mjs [--dry]
 */

import { execSync } from "node:child_process";
import { PATHS, loadJSON, saveJSON, getBearer, resolveUser, fetchRecent, sanitize, charLen, HANDLE, REWORD_MODEL } from "./lib/x-watch.mjs";

const DRY = process.argv.includes("--dry");
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const TG = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const OUR_USER_ID = "1894746376396849152"; // @Yourscore_App_
const WANT = 2;           // UP TO this many per run — fewer, only if genuinely great
const ACCTS_PER_RUN = 3;  // tracked accounts READ per run (rotates - cost control)
const NEWS_PER_ACCT = 5;  // tweets scanned per tracked account for the "news" signal
const OWN_POSTS_READ = 10; // our own recent tweets pulled for dedup (was 40)
const NEWS_WINDOW_H = 24;

if (!ANTHROPIC) { console.error("✗ Missing ANTHROPIC_API_KEY (use --env-file=.env.local)"); process.exit(1); }

// ── The product's current, audience-facing talking points (from YOURSCORE.md) ──
// These steer the "feature" ideas. Freshness hints keep us off worn angles.
const TALKING_POINTS = `
38-0 (the flagship team-builder): you SPIN and get DEALT a random squad of real-rated legends from across football eras - you do NOT choose which players you get. The skill is DRAFTING: placing the hand you're dealt into your formation's best-fit slots to build the strongest XI you can, then seeing if it's good enough to go a 38-game season unbeaten. Win a season and you get to swap one player out; lose and your team goes stale and you rebuild. Classic mode shows ratings; Expert mode hides them so you draft on knowledge alone.
38-0 Live Head-to-Head: you've built your XI (from your spun squad), then you face a real person, you see their team and they see yours, one tweak before kickoff and two at half time, then you watch it play out live with commentary and stats.
Interactive penalty shootout (shipped 16 Jun, still FRESH): a drawn knockout goes to penalties and YOU take the kicks in a 3D scene. Pick one of 9 aim zones, time the power meter, keep your nerve.
World Cup Run: an open, no-quiz draft. Spin and build a World XI and chase the WC2026 trophy. Replayable.
La Liga competition: spin and draft your all-time Spanish XI from ~20 years of the league, then simulate the season.
YourScore Rank: one ranking across both games (quiz knowledge + 38-0 results), one number, one #1. Where do you actually sit.
Daily World Cup quiz series: a new quiz every day of the tournament, build a streak, top the board by the final to win £100.
Shareable scorecards + challenge a friend: every result is a card made to share, and you can send your result to a mate to settle who knows football.
World Cup Mastermind (quiz-gated draft): your quiz answers decide how STRONG a squad you get dealt - right answers and streaks deal better players (elite ones only come with a long streak), so knowing your football earns you a better hand to draft from. You STILL don't pick specific players. Two ways to play: "Today's Run" is the ranked one go a day that counts on the World Cup board; "Practice" is unlimited past questions but does NOT count on the board or rank. NOTE: the plain "answer right, unlock a player" line has been tweeted to death this week. Treat it as OVER-EXPOSED. Only reference Mastermind from a genuinely new angle (a real story, the board race, a person). Never claim a ranking/board mechanic you're not sure of (e.g. practice does not count).
`.trim();

const PILLARS = "identity (who it's for, why we built it) · feature (how a mode actually plays, from the inside) · community (a question or challenge that pulls mates into a game, usually no link) · proof (a real run, the £100 board race, a scorecard)";

const SYSTEM = `You are the tweet ideas agent for YourScore (@${HANDLE}), a football game app. Games: "38-0" (a team-builder where you draft an all-time XI and chase a 38-game unbeaten season) and a football "Quiz". You decide what we should tweet next.

WHO WE ARE: we ARE YourScore. We are building a platform where our users can enjoy great football games and play with their friends - that is the whole goal, our users having a good time together. We play our own games every day so we know them inside out, and we are football fans at heart, so we talk like a normal person texting their mates: warm, easy, a bit of wonder at how good football is. Never journalists, pundits or a stats account, never an authority, never salesy, never a brochure.

YOUR JOB: this is our YourScore voice, and every idea here must be genuinely ABOUT YourScore - what it's like to play, the daily quiz as a challenge to your mates, the board race, a real scorecard, who it's for, why we built it. (Pure football-moment reactions are handled by a SEPARATE track, so do NOT spend a slot on a football news take with no tie to us.) From the signals you are given (what we're building, our talking points, what's happening on X today, and what we've already posted), propose UP TO ${WANT} such ideas we could send right now. THE BAR IS HIGH: we post a FEW great things, never filler - but we DO want to show up about YourScore, so aim to give at least ONE genuinely good YourScore idea each run (return 0 only if you truly have nothing worth sending). If you propose two, they must be DIFFERENT pillars (${PILLARS}) and must NOT repeat a product angle or CTA we've used recently — no second "build your XI", "£100 board" or "one go a day" tweet if we've just run one. Vary it: not every YourScore tweet is a CTA with a link; some are just us talking about our game and our players like people who love it. A founder with taste will read these; do not waste the slot.

HARD RULES (locked house style):
- NEVER use the long dash (em or en dash). Biggest "AI wrote this" tell and the founder hates it. Use a full stop, comma or colon, or one spaced hyphen " - ". Real score hyphens like "1-0" are fine.
- No other AI-tell punctuation: plain straight quotes ' and ", three dots ... not the ellipsis glyph, no "•" bullets, no arrow characters.
- Natural contractions (don't, you're, it's). Never robotic.
- EMOJI: use them naturally where they fit and add warmth, usually one or two, sometimes none. Placed where a person would put them, never one mechanically opening every line.
- VARY THE SHAPE tweet to tweet (one sharp line, or a few short lines, or a setup then a punchline), and use BLANK LINES between distinct thoughts so it breathes. Never the same mould every time.
- Easy on stats. Lead with the player, the moment or the feeling, not numbers or records.
- WE, NEVER I: always speak as we / us / our. Never use I, me, my, or any first-person singular anywhere.
- Warm and admiring. A light take is fine and dry wit is welcome, but never a dig at a player, never mock a great, and no hot takes or snark. Respect the players and the game.
- Clean and conversational, like texting a smart mate. No heavy slang, no swearing.
- GET THE MECHANIC RIGHT (the founder caught tweets that misunderstood the game): in 38-0 you do NOT pick your players - you SPIN and are DEALT a RANDOM squad, and the game is DRAFTING that random hand into the best XI you can. NEVER write anything that implies the user freely chooses specific players: no "who's the first player you'll always draft", no "who's first on your teamsheet", no "who do you always pick", no "build your dream XI of anyone you want". Those questions make no sense for our game. The real hooks are the opposite: what do you do with the hand you're dealt, do you gamble on your spin, can you make a weird squad work. In Mastermind, knowing your football gets you a STRONGER hand (better-rated players dealt), it does NOT let you choose who. If you're unsure whether a mechanic is real, do not write it.
- KNOW THE PRODUCT FOR REAL: when a tweet is about our own game, write like someone who PLAYS it every day, not someone reading a spec sheet. Reference the actual mechanics specifically and casually (the one go a day ranked World Cup Mastermind, the £100 board you're chasing, taking your OWN penalties in a shootout, trying to get a 38 game season unbeaten, drafting the random squad you spun into your best XI and watching it play out). NEVER sound like a landing page or an advert: no "Introducing", no "Meet ...", no "the app that lets you", no feature lists, no "we built / added / launched". Talk about PLAYING it, not selling it. If you wouldn't say it to a mate about a game you genuinely love, don't tweet it.
- PROPORTION, do NOT over-amplify: most product and in-game moments are small and fun, treat them that way. Match the words to the size of the thing. A quiz streak, a single good draft, a near miss, one player unlocked are NOT "insane", "unreal", "incredible", "ridiculous", "historic", "broke the internet" or "you won't believe". Ban that inflation. Say small things small and warm. Keep real excitement for genuinely big moments, and even then stay human, never breathless.
- STAY GROUNDED, NEVER OVERSELL THE EXPERIENCE: we are NOT selling an incredible, amazing, immersive or unforgettable experience. We are a fun football game you play with your friends, no more and no less. Do not make grand promises about how it will make someone feel or claim it is a special/epic experience. Describe the game plainly and let it stand on its own. If a line reads like a hype ad, a pitch deck or a brochure, cut it.
- NEVER EQUATE OUR PLAYERS WITH REAL FOOTBALLERS. This is banned and it is the thing the founder hates most. Our users are people having fun with mates; they are NOT living what real professionals live. NEVER write that playing YourScore feels like being a real manager or player, never compare our players' feelings, pressure, nerves or glory to what actual footballers feel, never suggest we "put you in their boots". It is a game about football knowledge and squad-building, not a simulator of a pro's life. Talk about the fun our USERS are having, never borrow the emotions of the real sport.
- Short and easy: a few short lines, not a paragraph, not a wall of text.
- HASHTAGS (required on every post): always end with a short final line of 2 to 4 relevant hashtags - the teams, competition or topic (e.g. #ThreeLions #WorldCup), and #YourScore where it fits. A few that genuinely fit, never a spammy wall. UK English. 275 characters or fewer including any link and the hashtags.
- For a "feature" idea, end with the relevant link on its own final line. For "community" ideas, usually NO link (pure reach). Links: 38-0 core/H2H/penalties = https://yourscore.app/38-0 ; World Cup modes = https://yourscore.app/38-0/wc ; daily quiz = https://yourscore.app ; site = https://yourscore.app.
- TODAY signal: use "what's happening on X" only to pick a TIMELY YourScore angle (e.g. a big World Cup moment is a natural hook into our daily WC quiz or the board race). If you reference a real moment, stay ACCURATE - never invent fees, dates, quotes, clubs or outcomes, keep any hedge ("reportedly"), and never @mention or credit the source. The tweet must still be ABOUT us, not a bare news take.
- DO NOT REPEAT what we've recently posted (you'll be shown it). The founder is very sensitive to repetition. In particular, do not re-run the World Cup Mastermind "answer a question, unlock a player" explainer. Find fresh angles.
- The git commit subjects are INTERNAL signals of what's ACTIVE right now. Use them ONLY to decide which of OUR TALKING POINTS is most timely to feature. Do NOT state any specific product change, number or new capability based on a commit. Every concrete claim in a tweet MUST be grounded in the talking points above, never invented from a commit. Never quote commits or mention anything internal, technical or about security/bugs.
- If the live signals (X news, recent posts) come back empty, still produce strong community and feature ideas from the talking points, and be EXTRA careful not to repeat an obvious recent angle.

OUTPUT: respond with ONLY a JSON object, no prose, no code fences:
{"ideas":[{"tweet":"<the full tweet text, with link line if it's a feature>","pillar":"<one of: identity|feature|community|proof>","why":"<one short line: why this is worth sending right now>"}]}`;

function parseModelJSON(raw) {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  if (start === -1) throw new SyntaxError("no JSON in model output");
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

const norm = (t) => (t || "").toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const key12 = (t) => norm(t).split(" ").slice(0, 12).join(" "); // first ~12 words, for dedup

// ── 1) What we're shipping: recent commit subjects (hints only) ───────────────
function recentCommits() {
  try {
    const out = execSync(`git -C /Users/zchukwumah/yourscore log --since="4 days ago" --no-merges --pretty=format:%s -n 60`, { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((s) => !/^(chore|wip|fix typo|merge|bump|lint|format)\b/i.test(s)).slice(0, 40);
  } catch { return []; }
}

// ── 3) What we've already said: our last ~40 posted tweets ────────────────────
async function recentPosts() {
  try {
    const bearer = await getBearer();
    const url = `https://api.twitter.com/2/users/${OUR_USER_ID}/tweets?max_results=${OWN_POSTS_READ}&exclude=retweets,replies&tweet.fields=created_at`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    const j = await r.json();
    return (j.data || []).map((t) => t.text);
  } catch (e) { console.error(`recentPosts: ${e.message}`); return []; }
}

// ── 4) What's happening on X: top tracked tweets in the last 24h ──────────────
async function newsSignal(state) {
  const watchlist = loadJSON(PATHS.watchlist, null);
  const all = (watchlist?.accounts || []).filter((a) => a && a.username);
  // Cost control: read only a FEW accounts per run, rotating a cursor through the
  // watchlist so every account still gets covered over the day - just not all at once.
  state.ideas ??= {};
  const n = Math.max(all.length, 1);
  const start = (state.ideas.acctCursor || 0) % n;
  const accounts = all.length <= ACCTS_PER_RUN
    ? all
    : Array.from({ length: ACCTS_PER_RUN }, (_, k) => all[(start + k) % n]);
  state.ideas.acctCursor = (start + ACCTS_PER_RUN) % n;
  console.log(`reading ${accounts.length} account(s) this run: ${accounts.map((a) => "@" + a.username).join(", ")}`);
  const cutoff = Date.now() - NEWS_WINDOW_H * 3600 * 1000;
  const items = [];
  for (const acct of accounts) {
    const handle = acct.username.replace(/^@/, ""), key = handle.toLowerCase();
    try {
      state.users ??= {};
      let user = state.users[key];
      if (!user) { user = await resolveUser(handle); state.users[key] = user; }
      const tweets = await fetchRecent(user.id, { max: NEWS_PER_ACCT });
      for (const t of tweets) {
        if (t.created_at && Date.parse(t.created_at) < cutoff) continue;
        const m = t.public_metrics || {};
        const eng = (m.like_count || 0) + 2 * (m.retweet_count || 0) + (m.reply_count || 0);
        items.push({ handle, text: t.text, eng });
      }
    } catch (e) { console.error(`@${handle}: ${e.message}`); }
  }
  items.sort((a, b) => b.eng - a.eng);
  return items.slice(0, 12);
}

// ── Telegram push (mirrors x-telegram.mjs draftButtons so the poller handles taps) ──
const tg = (method, body) => fetch(`https://api.telegram.org/bot${TG}/${method}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const draftButtons = (id) => ({ inline_keyboard: [
  [{ text: "✅ Post", callback_data: `post:${id}` }, { text: "🎬 Add GIF", callback_data: `gif:${id}` }],
  [{ text: "💬 Reword / Feedback", callback_data: `fb:${id}` }],
  [{ text: "✏️ Edit", callback_data: `edit:${id}` }, { text: "🗑 Decline", callback_data: `skip:${id}` }],
] });

// ── main ──────────────────────────────────────────────────────────────────────
const state = loadJSON(PATHS.state, {});
const queue = loadJSON(PATHS.queue, []);

const commits = recentCommits();
const [posts, news] = await Promise.all([recentPosts(), newsSignal(state)]);

const seenKeys = new Set([
  ...queue.map((d) => key12(d.draft)),
  ...posts.map(key12),
]);

const user = [
  `WHAT WE'RE SHIPPING (internal commit subjects, hints only - infer audience-facing features, never quote):\n${commits.length ? commits.map((c) => "- " + c).join("\n") : "(none)"}`,
  `\nOUR CURRENT TALKING POINTS:\n${TALKING_POINTS}`,
  `\nWHAT'S HAPPENING ON X RIGHT NOW (tracked accounts, top by engagement, last 24h - react accurately, no credit):\n${news.length ? news.map((n) => `- ${n.text.replace(/\n/g, " ")}`).join("\n") : "(nothing notable)"}`,
  `\nWHAT WE'VE ALREADY POSTED RECENTLY (do NOT repeat any of these angles):\n${posts.length ? posts.map((p) => `- ${p.replace(/\n/g, " ")}`).join("\n") : "(none)"}`,
  `\nPropose ${WANT} fresh, varied ideas now.`,
].join("\n");

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({ model: REWORD_MODEL, max_tokens: 1400, system: SYSTEM, messages: [{ role: "user", content: user }] }),
});
const body = await res.text();
if (!res.ok) { console.error(`Anthropic ${res.status}: ${body.slice(0, 300)}`); process.exit(1); }
const out = parseModelJSON(JSON.parse(body).content?.map((b) => b.text || "").join("") ?? "");
let ideas = Array.isArray(out.ideas) ? out.ideas : [];

// Dedup vs what's already queued/posted (and within this batch), clean punctuation.
const fresh = [];
for (const idea of ideas) {
  const tweet = sanitize(idea.tweet || "");
  if (!tweet) continue;
  const k = key12(tweet);
  if (seenKeys.has(k)) { console.log(`  skip (dup): ${tweet.split("\n")[0]}`); continue; }
  seenKeys.add(k);
  fresh.push({ ...idea, tweet });
}

if (!fresh.length) { console.log("no fresh ideas this run"); if (!DRY) saveJSON(PATHS.state, state); process.exit(0); }

console.log(`Proposing ${fresh.length} idea(s):`);
const stamp = Date.now();
let i = 0;
for (const idea of fresh) {
  const id = "ix" + (stamp + i).toString().slice(-9); i++;
  const draftChars = charLen(idea.tweet);
  console.log(`\n  [${idea.pillar}] ${id} (${draftChars}c)\n    ${idea.tweet.replace(/\n/g, "\n    ")}\n    ↳ ${idea.why || ""}`);
  if (DRY) continue;
  // Just QUEUE it. The x-telegram poller trickles drafts to Telegram one at a time, so ideas
  // never arrive in a clump and never jump ahead of time-sensitive engagement.
  queue.push({
    id, status: "pending", createdAt: new Date().toISOString(),
    source: { username: `idea:${idea.pillar || "?"}`, name: "YourScore idea", url: "https://yourscore.app" },
    draft: idea.tweet, draftChars, origin: "x-ideas", pillar: idea.pillar || "", why: idea.why || "",
  });
}

if (!DRY) { saveJSON(PATHS.state, state); saveJSON(PATHS.queue, queue); }
console.log(DRY ? "🛑 DRY - nothing saved or pushed" : `done - ${fresh.length} idea(s) queued (the poller trickles them to Telegram)`);
