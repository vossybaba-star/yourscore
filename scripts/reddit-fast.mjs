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
import { writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS, loadJSON, saveJSON, listPostsRSS, triage, draftReply, factCheck, costReport } from "./lib/reddit.mjs";
import { factBrief } from "./lib/football-facts.mjs";

const execFileAsync = promisify(execFile);
const DRY = process.argv.includes("--dry");
const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "data", "reddit-fast-state.json");
const RUN_LOCK = join(HERE, "data", ".reddit-fast.lock");
const LOCK_STALE_MS = 25 * 60_000;   // longer than RUN_BUDGET_MS: only a DEAD run gets its lock stolen

// Every joined sub (founder: "all") EXCEPT those flagged `fast: false` — the meme,
// image and satire subs. Being early is worthless there: the value is a funny
// one-liner on a post that already landed, and we can't even see the image. Worse,
// they're the highest-volume subs on Reddit, so in a shared `new` feed they crowd
// out the subs where an early substantive reply actually wins. Measured on the
// 12:30 run: soccercirclejerk + soccermemes were 7 of 15 fresh threads and yielded
// nothing. The 5x/day sweep still covers them via `hot`, which only surfaces hits.
const wl = loadJSON(PATHS.watchlist, { subreddits: [] });
const SUBS = wl.subreddits.filter((s) => s.fast !== false).map((s) => s.name);
const NOTE = new Map(wl.subreddits.map((s) => [s.name.toLowerCase(), s.note || ""]));

// The feed must reach back further than the gap between polls, or threads posted
// just after one run would fall off the feed before the next and be silently lost.
// Measured: the default 25-entry feed only reaches ~40min back on a busy
// multireddit; limit=100 reaches ~2.5h. Poll every 30min, look back 40min.
const POLL_LIMIT = 100;
const MAX_AGE_MIN = 40;

// MAX_DRAFTS was 1, with the note "one strong shout beats a buzzing phone" — a rule
// written when this lane PUSHED TO TELEGRAM. It lands in the Studio queue now, which
// he browses when he has a minute, so there is no phone to buzz and no reason to
// throw drafts away. Worse, the loop breaks the moment it hits the cap: a run with
// 15 fresh threads examined ONE of them and binned the rest, and by the next run
// most had aged past MAX_AGE_MIN and were gone for good.
// (founder, Jul 14: "I need as many as possible per run".)
// Raised 1 → 6 for volume, then pulled back to 3: on Jul 14 the pipeline burned ~$20
// in a day, and MAX_DRAFTS multiplies the single most expensive step (a search-backed
// draft + its fact-check). Volume is worth having, but not before we can SEE what a
// draft costs — every run now prints its spend. Raise this once the numbers are real.
const MAX_DRAFTS = 3;
const MIN_SCORE = 6;       // the quality floor, and now the ONLY thing limiting volume

// A run must finish before the next one starts (30min cadence), or two processes
// race reddit-fast-state.json and re-draft threads the other already took. Stop
// STARTING new candidates past this; whatever's in flight still completes.
const RUN_BUDGET_MS = 20 * 60_000;
const startedAt = Date.now();
// Not a curation limit — a runaway guard. Quality is held by MIN_SCORE and the
// fact-check, not by starving him of drafts. An unread draft in the dash costs
// nothing; a thread that aged out unexamined is gone for good.
const DAILY_CAP = 40;

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

/**
 * Single-instance guard. Now that a run can draft several threads it can take real
 * time, and two overlapping runs would race reddit-fast-state.json — the loser's
 * `seen` marks vanish and both draft the same thread.
 *
 * This is NOT the old pgrep guard (which matched any command line mentioning the
 * script, including an ssh wrapper, and stood the lane down when nothing was
 * running). It's our own lockfile, and — the lesson from the EACCES outage — it
 * fails SOFT: a lock we cannot write must never become a new way for a run to die.
 */
function acquireRunLock() {
  try {
    writeFileSync(RUN_LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") return true;         // unwritable → proceed, don't skip the run
    try {
      if (Date.now() - statSync(RUN_LOCK).mtimeMs < LOCK_STALE_MS) return false;  // a real run is live
      unlinkSync(RUN_LOCK);                       // previous run was killed mid-flight
      writeFileSync(RUN_LOCK, String(process.pid), { flag: "wx" });
      return true;
    } catch { return true; }
  }
}
const releaseRunLock = () => { try { unlinkSync(RUN_LOCK); } catch { /* already gone */ } };

if (!acquireRunLock()) {
  console.log(`\n⚡ reddit-fast · a run is already in flight — skipping this cycle.\n`);
  process.exit(0);
}
process.on("exit", releaseRunLock);

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
  if (Date.now() - startedAt > RUN_BUDGET_MS) {
    // Leave the rest UNSEEN so the next run picks them up, rather than marking
    // them examined and losing them.
    console.log(`\n  ⏳ ${Math.round(RUN_BUDGET_MS / 60000)}min run budget spent — stopping before the next cron fires.`);
    break;
  }
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

    const fc = await factCheck(p, r.reply, { brief });
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
console.log(`\n⚡ ${drafted} early draft(s) pushed${DRY ? " (DRY — nothing sent/saved)" : ""}`);
console.log(costReport() + "\n");
