/**
 * reddit-fast.mjs — the FIRST-COMMENTER lane.
 *
 * The main sweep (reddit-track) reads `hot` five times a day. That is structurally
 * wrong for being early: `hot` surfaces threads that are ALREADY established, and a
 * thread posted at 11:05 wasn't even looked at until 14:00 — by which point it has
 * 300 comments and you're buried.
 *
 * This lane watches `new` across the priority subs in a SINGLE multireddit RSS
 * request (r/a+b+c/new.rss), so one request per run covers them all and we stay
 * inside Reddit's ~1-req/min unauthenticated budget. Verified: the feed returns
 * posts 0-2 minutes old.
 *
 * Flow: fresh post (< MAX_AGE_MIN) → cheap triage → free facts → draft →
 * fact-check → APPEND TO THE STUDIO QUEUE with the thread link, so he can post
 * while the thread still has single-digit comments (founder, Jul 14: "I don't
 * want it to push to my telegram. I want it to be in the dash"). Nothing ever
 * posts automatically.
 *
 * Own state file: the main sweep writes reddit-state.json, and two crons writing
 * one file would race.
 *
 *   node --env-file=.env.local scripts/reddit-fast.mjs
 *   node --env-file=.env.local scripts/reddit-fast.mjs --dry
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS, loadJSON, saveJSON, listPostsRSS, triage, draftReply, factCheck } from "./lib/reddit.mjs";
import { factBrief } from "./lib/football-facts.mjs";

const execFileAsync = promisify(execFile);
const DRY = process.argv.includes("--dry");
const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "data", "reddit-fast-state.json");

// Where being early is worth most: big audiences, fast-moving threads, and the
// topics he actually wants to own. Kept small on purpose — one RSS request.
// All the subs he's joined (founder: "all"), watched in ONE multireddit request.
const wl = loadJSON(PATHS.watchlist, { subreddits: [] });
const SUBS = wl.subreddits.map((s) => s.name);
const NOTE = new Map(wl.subreddits.map((s) => [s.name.toLowerCase(), s.note || ""]));

// The feed must reach back further than the gap between polls, or threads posted
// just after one run would fall off the feed before the next and be silently lost.
// Measured: the default 25-entry feed only reaches ~40min back on a busy
// multireddit; limit=100 reaches ~2.5h. Poll every 30min, look back 40min.
const POLL_LIMIT = 100;
const MAX_AGE_MIN = 40;
const MAX_DRAFTS = 1;      // per run — one strong shout beats a buzzing phone
const MIN_SCORE = 6;       // being early on a weak reply is worth nothing; don't ping him for it
// Founder, Jul 14: "more content is great". At 6 the lane could exhaust its day by
// mid-morning and sit silent through the afternoon — the exact hours he's working
// and wants something fresh to post. 10 keeps it live all day; the MIN_SCORE bar,
// not the cap, is what protects quality.
const DAILY_CAP = 10;

const MEGATHREAD = /daily discussion|free talk|megathread|match thread|post.?match|rank the|moderator|mod post|announcement|weekly/i;

const state = loadJSON(STATE, { seen: {}, day: "", sentToday: 0 });
const now = Date.now();
for (const [id, ts] of Object.entries(state.seen)) if (now - ts > 3 * 864e5) delete state.seen[id];

// Daily push cap. Reddit throttles a low-karma account to roughly one comment
// every 6-10 minutes, and he does ~20 focused minutes a day — flooding him with
// early shouts he can't act on just trains him to ignore the alerts.
const today = new Date().toISOString().slice(0, 10);
if (state.day !== today) { state.day = today; state.sentToday = 0; }
if (state.sentToday >= DAILY_CAP) {
  console.log(`\n⚡ reddit-fast · daily cap reached (${DAILY_CAP} early drafts sent today) — standing down.\n`);
  process.exit(0);
}

// NOTE: this lane used to stand DOWN whenever reddit-track was running, to avoid
// two processes spending the same per-IP Reddit budget. That cost it whole runs —
// the sweep takes ~30min and this fires every 30min, so overlap was guaranteed,
// not occasional — and the process-matching guard misfired anyway, standing the
// lane down when no sweep existed at all. The RSS pacing clock in lib/reddit.mjs
// is now a SHARED FILE, so both lanes pace against one budget and can safely run
// at the same time. No guard needed: don't reintroduce one.

/**
 * Append a draft to the shared queue the Studio dash reads (founder, Jul 14:
 * "I don't want it to push to my telegram. I want it to be in the dash").
 *
 * Re-reads the queue immediately before writing and appends only ids it doesn't
 * already hold. The main sweep writes this same file; we skip while it's running,
 * but it could still start mid-write — a blind saveJSON would clobber its drafts.
 */
function pushToQueue(entry) {
  const q = loadJSON(PATHS.queue, []);
  if (q.some((d) => d.id === entry.id)) return false;
  q.push(entry);
  saveJSON(PATHS.queue, q);
  return true;
}

async function tg(msg) {
  try { await execFileAsync(process.execPath, [join(HERE, "tg.mjs"), "text", msg], { timeout: 20_000 }); }
  catch (e) { console.error(`  telegram failed: ${e.message.slice(0, 60)}`); }
}

const ageMin = (p) => (now / 1000 - p.createdUtc) / 60;

console.log(`\n⚡ reddit-fast · ${SUBS.length} subs, one multireddit request · <${MAX_AGE_MIN}min old ${DRY ? "· DRY" : ""}`);

let posts;
try {
  // ONE request for all priority subs — keeps us inside the RSS budget.
  posts = await listPostsRSS(SUBS.join("+"), { sort: "new", limit: POLL_LIMIT });
} catch (e) {
  console.error(`✗ fetch failed: ${e.message}`);
  process.exit(/429|403/.test(e.message) ? 2 : 1);
}

const fresh = posts
  .filter((p) => !state.seen[p.id])
  .filter((p) => ageMin(p) <= MAX_AGE_MIN)
  .filter((p) => !MEGATHREAD.test(p.title))
  .sort((a, b) => b.createdUtc - a.createdUtc);

console.log(`  ${posts.length} in feed · ${fresh.length} fresh & unseen\n`);

let drafted = 0;
for (const p of fresh) {
  if (drafted >= MAX_DRAFTS) break;
  state.seen[p.id] = now;                 // one shot per thread either way
  console.log(`  [${Math.round(ageMin(p))}m] r/${p.sub}: ${p.title.slice(0, 70)}`);

  try {
    const note = NOTE.get(p.sub.toLowerCase()) || "";
    const tri = await triage(p, { subNote: `r/${p.sub}. ${note}` });
    if (!tri.worth) { console.log(`    · skip (${tri.reason.slice(0, 70)})`); continue; }

    const brief = await factBrief(tri).catch(() => "");
    const r = await draftReply(p, { subNote: `r/${p.sub}. ${note}`, brief });
    if (!r.usable) { console.log(`    · skip (${r.reason.slice(0, 70)})`); continue; }

    // Being first only pays if the reply is actually good. A weak comment posted
    // early is still a weak comment — and it costs him an alert he'll learn to ignore.
    if (r.score < MIN_SCORE) { console.log(`    · skip (score ${r.score} < ${MIN_SCORE}, not worth being early for)`); continue; }

    const fc = await factCheck(p, r.reply);
    if (!fc.pass) { console.log(`    ✗ fact-check failed: ${(fc.failures[0] || fc.note).slice(0, 70)}`); continue; }

    drafted++;
    state.sentToday++;
    const age = Math.round(ageMin(p));
    console.log(`    ✓ EARLY DRAFT (score ${r.score}, thread ${age}m old): ${r.reply.slice(0, 70)}`);
    if (!DRY) {
      // Same shape the main sweep queues, so the dash renders it with no changes.
      // `early` + `ageAtDraftMin` let the dash flag it as time-critical.
      pushToQueue({
        id: p.id,
        status: "pending",
        createdAt: new Date().toISOString(),
        post: p,
        draft: r.reply,
        mentionsProduct: r.mentionsProduct,
        score: r.score,
        reason: r.reason,
        factChecked: true,
        early: true,
        ageAtDraftMin: age,
        origin: "fast",
      });
    }
  } catch (e) {
    if (/credit balance/i.test(e.message)) {
      console.error(`    ✗ ANTHROPIC OUT OF CREDIT`);
      if (!DRY) await tg("🚨 Reddit fast-lane: Anthropic out of credit — no early drafts until you top up.");
      break;
    }
    console.error(`    ✗ ${e.message.slice(0, 80)}`);
  }
}

if (!DRY) saveJSON(STATE, state);
console.log(`\n⚡ ${drafted} early draft(s) pushed${DRY ? " (DRY — nothing sent/saved)" : ""}\n`);
