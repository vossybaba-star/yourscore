/**
 * reddit-track.mjs — the SWEEP. Reads `hot` across every watched sub in ONE
 * multireddit request, drafts replies, and queues them for the Studio dash.
 * NEVER posts; only writes data/reddit-queue.json.
 *
 *   node --env-file=.env.local scripts/reddit-track.mjs          # full run
 *   node --env-file=.env.local scripts/reddit-track.mjs --dry    # show, don't save
 *   node --env-file=.env.local scripts/reddit-track.mjs --sub soccer
 *
 * Pairs with reddit-fast.mjs, which reads `new` for threads minutes old. This one
 * reads `hot` — the threads that already have an audience. Both land in one queue.
 *
 * State (data/reddit-state.json) remembers every post already considered, so a
 * thread is drafted against at most once, ever — which is also why running this
 * every 30min costs no more than running it 5x/day.
 */

import { writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS, loadJSON, saveJSON, listPostsRSS, triage, draftReply, factCheck, hasApiCreds, costReport } from "./lib/reddit.mjs";
import { factBrief } from "./lib/football-facts.mjs";

// Match the fast lane's bar. Below this we neither queue nor pay to verify.
const MIN_SCORE = 6;

// The sweep now runs every 30min, so it must finish inside that window or two
// copies race reddit-state.json and re-draft each other's threads.
const RUN_BUDGET_MS = 22 * 60_000;
const startedAt = Date.now();

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_LOCK = join(HERE, "data", ".reddit-track.lock");
const LOCK_STALE_MS = 30 * 60_000;   // longer than RUN_BUDGET_MS: only a DEAD run loses its lock

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ONLY = args.includes("--sub") ? args[args.indexOf("--sub") + 1] : null;

/**
 * Single-instance guard. Fails SOFT on purpose: a lock we can't write must never
 * become a new way for the sweep to die (a root-owned pace file did exactly that
 * to the fast lane on Jul 14, killing a cron run before it fetched anything).
 */
function acquireRunLock() {
  try { writeFileSync(RUN_LOCK, String(process.pid), { flag: "wx" }); return true; }
  catch (e) {
    if (e.code !== "EEXIST") return true;
    try {
      if (Date.now() - statSync(RUN_LOCK).mtimeMs < LOCK_STALE_MS) return false;
      unlinkSync(RUN_LOCK);
      writeFileSync(RUN_LOCK, String(process.pid), { flag: "wx" });
      return true;
    } catch { return true; }
  }
}
if (!DRY && !acquireRunLock()) {
  console.log(`\n👂 reddit-track · a sweep is already in flight — skipping this cycle.\n`);
  process.exit(0);
}
process.on("exit", () => { try { unlinkSync(RUN_LOCK); } catch { /* already gone */ } });

const wl = loadJSON(PATHS.watchlist, null);
if (!wl) { console.error(`✗ no watchlist at ${PATHS.watchlist}`); process.exit(1); }
const D = wl.defaults || {};

const state = loadJSON(PATHS.state, { seen: {}, subOffset: 0 });
const queue = loadJSON(PATHS.queue, []);
const queued = new Set(queue.map((d) => d.post.id));
const now = Date.now();

// prune seen-memory after 30 days so the file can't grow forever
for (const [id, ts] of Object.entries(state.seen)) if (now - ts > 30 * 864e5) delete state.seen[id];

const fresh = (p, maxAgeHours) => now / 1000 - p.createdUtc < (maxAgeHours ?? D.maxAgeHours ?? 20) * 3600;
// RSS mode carries no vote counts (ups=null): feed ranking + the drafter's own
// bar stand in for the minUps filter until API access is approved. RSS also
// hides sticky flags, so recurring megathreads are skipped by title instead of
// burning a drafting call every day.
const MEGATHREAD_RE = /daily discussion|free talk|megathread|match thread|post.match|rank the|moderator|mod post|announcement/i;
const eligible = (p, minUps) => !p.stickied && !p.over18 && !state.seen[p.id] && !queued.has(p.id)
  && !MEGATHREAD_RE.test(p.title)
  && (p.ups == null || p.ups >= (minUps ?? D.minUps ?? 5));

let drafted = 0, considered = 0;
// Founder, Jul 14: "I want around ten responses drafted every 30 minutes." This is
// the ceiling, not a target — the binding limit is SUPPLY (Reddit does not produce
// ten good football threads every half hour), so most runs will land well under it.
const cap = D.maxQueuedPerRun ?? 10;

// Anthropic failures are NOT Reddit failures. A draft error thrown out of
// consider() used to be caught by the per-sub handler and counted as a failed
// FETCH — so an out-of-credit account would alert "every subreddit fetch was
// blocked, the IP may be rate-limited" and send you hunting a Reddit ban.
// Catch drafting errors here and surface them honestly instead.
let draftErr = 0;
export let creditOut = false;

async function consider(post, { subNote, searchNote }) {
  state.seen[post.id] = now;                        // one shot per thread, usable or not
  considered++;

  // Tier 1 — cheap triage, NO web search. Most threads die here having cost
  // almost nothing, instead of paying to research a thread we'd never reply to.
  let tri;
  try { tri = await triage(post, { subNote }); }
  catch (e) {
    draftErr++;
    if (/credit balance/i.test(e.message)) { creditOut = true; console.error(`    ✗ ANTHROPIC OUT OF CREDIT`); }
    else console.error(`    ✗ triage failed: ${e.message.slice(0, 80)}`);
    return;
  }
  if (!tri.worth) { console.log(`    · skip (${tri.reason.slice(0, 90)})`); return; }

  // Tier 2 — FREE facts (Sportmonks: already paid, PL. ESPN: free, WC/others).
  // Answers the classes that actually broke drafts: current manager, current
  // club, who's already out of the tournament. Fails soft to "" — never blocks.
  let brief = "";
  try { brief = await factBrief(tri); } catch { /* free-source hiccup: fall back to paid search */ }
  if (brief) console.log(`    📋 facts: ${brief.split("\n")[0].slice(0, 80)}`);

  // Tier 3 — draft, grounded in the brief; paid search only for the gaps.
  let r;
  try {
    r = await draftReply(post, { subNote, searchNote, brief });
  } catch (e) {
    draftErr++;
    if (/credit balance/i.test(e.message)) { creditOut = true; console.error(`    ✗ ANTHROPIC OUT OF CREDIT — cannot draft`); }
    else console.error(`    ✗ draft failed: ${e.message.slice(0, 90)}`);
    return;
  }
  if (!r.usable) { console.log(`    · skip (${r.reason.slice(0, 90)})`); return; }

  // Don't PAY to fact-check a draft we'd be embarrassed to post. The sweep had no
  // score floor, so it bought a full web-search verification pass on 4/10 and 5/10
  // drafts — which then sat in the dash as the stale junk that made it unusable.
  // A fact-check is the single most expensive step; spend it only on keepers.
  if (r.score < MIN_SCORE) { console.log(`    · skip (score ${r.score} < ${MIN_SCORE} — not worth fact-checking)`); return; }

  // Fact-check before queueing: a web-search pass rejects any draft that rests
  // on a wrong or unverifiable current-world claim (managers, transfers, WC
  // results). Never propose an inaccurate reply. If the check itself errors,
  // fail safe by dropping the draft rather than queueing an unchecked one.
  let fc;
  try { fc = await factCheck(post, r.reply, { brief }); }
  catch (e) {
    if (/credit balance/i.test(e.message)) { creditOut = true; console.error(`    ✗ ANTHROPIC OUT OF CREDIT — cannot fact-check`); return; }
    console.log(`    · skip (fact-check errored: ${e.message.slice(0, 70)})`); return;
  }
  if (!fc.pass) { console.log(`    ✗ fact-check FAILED: ${(fc.failures[0] || fc.note).slice(0, 100)}`); return; }

  const entry = {
    id: post.id,
    status: "pending",
    createdAt: new Date().toISOString(),
    post,
    draft: r.reply,
    mentionsProduct: r.mentionsProduct,
    score: r.score,
    reason: r.reason,
    factChecked: true,
    origin: searchNote ? "search" : "sub",
  };
  queue.push(entry); queued.add(post.id); drafted++;
  console.log(`    ✓ drafted + fact-checked (score ${r.score}${r.mentionsProduct ? " ⚠️ mentions product" : ""}): ${r.reply.replace(/\n/g, " ⏎ ").slice(0, 110)}`);
}


// ONE multireddit request covers every sub. Reddit paces unauthenticated reads at
// ~65s apart, so the old per-sub loop spent 29 x 65s = 31 MINUTES fetching before it
// could draft anything — which is the only reason the sweep ran 5x/day instead of
// continuously. `r/a+b+c/hot.rss` returns all of them at once (verified: 100 posts,
// 28 of 29 subs, one request, ~1s), so the sweep can now run every 30 minutes.
//
// Cost does NOT scale with how often it runs: threads we've already considered are
// marked seen and skipped BEFORE any paid call, and `hot` barely churns in 30min.
// Running more often finds the same threads sooner, it doesn't buy them twice.
const SUBS = ONLY ? [ONLY] : wl.subreddits.map((s) => s.name);
const NOTE = new Map(wl.subreddits.map((s) => [s.name.toLowerCase(), s.note || ""]));
const PER_SUB = new Map(wl.subreddits.map((s) => [s.name.toLowerCase(), s.perRun ?? D.perRun ?? 2]));

console.log(`\n👂 reddit-track · sweeping \`hot\` across ${SUBS.length} subs in ONE request · up to ${cap} drafts · ${hasApiCreds() ? "API" : "RSS"} mode ${DRY ? "· DRY" : ""}\n`);

let raw;
try {
  raw = await listPostsRSS(SUBS.join("+"), { sort: "hot", limit: 100 });
} catch (e) {
  // Fail LOUD. A total fetch failure used to look exactly like a quiet news day
  // ("considered 0") — that silence hid a 3-hour Reddit outage on Jul 10.
  const m = `🚨 Reddit sweep failed: the multireddit fetch was blocked (${e.message}). Nothing drafted.`;
  console.error(`\n${m}`);
  await alert(m);
  process.exit(2);
}

// `hot` is dominated by whichever subs are loudest — r/Gunners alone was 18 of 100
// on the test fetch. Cap each sub, then ROUND-ROBIN them, or one busy sub eats the
// entire draft budget and the other 28 never get looked at.
const bySub = new Map();
for (const p of raw) {
  if (!fresh(p) || !eligible(p)) continue;
  const k = p.sub.toLowerCase();
  const arr = bySub.get(k) ?? [];
  if (arr.length >= (PER_SUB.get(k) ?? 2)) continue;
  arr.push(p);
  bySub.set(k, arr);
}
const candidates = [];
for (let i = 0; ; i++) {
  const row = [...bySub.values()].map((arr) => arr[i]).filter(Boolean);
  if (!row.length) break;
  candidates.push(...row);
}

console.log(`  1 multireddit request · ${raw.length} posts · ${candidates.length} candidate(s) across ${bySub.size} sub(s)\n`);

for (const p of candidates) {
  if (drafted >= cap) break;
  if (creditOut) break;
  if (Date.now() - startedAt > RUN_BUDGET_MS) {
    console.log(`\n  ⏳ ${Math.round(RUN_BUDGET_MS / 60000)}min run budget spent — stopping before the next sweep fires.`);
    break;
  }
  console.log(`  r/${p.sub}: ${p.title.slice(0, 80)}`);
  // consider() guards its own Anthropic calls, but a leak from any of them must
  // never be blamed on Reddit — that turned a billing outage into "20 subreddit
  // fetches blocked, Reddit is likely blocking the VPS IP" on Jul 14.
  try {
    await consider(p, { subNote: `r/${p.sub}. ${NOTE.get(p.sub.toLowerCase()) || ""}` });
  } catch (e) {
    draftErr++;
    if (/credit balance/i.test(e.message)) { creditOut = true; console.error(`    ✗ ANTHROPIC OUT OF CREDIT`); break; }
    console.error(`    ✗ draft pipeline: ${e.message.slice(0, 90)}`);
  }
}

console.log(`\n📊 considered ${considered} thread(s) · queued ${drafted} draft(s) · ${bySub.size}/${wl.subreddits.length} subs had candidates`);
console.log(costReport());

// Cron runs this script directly (no wrapper), so a non-zero exit only lands in
// the log and nobody hears about it — the same silent-failure trap that hid the
// Jul 10 outage. Alert to Telegram from here.
async function alert(msg) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, [new URL("./tg.mjs", import.meta.url).pathname, "text", msg], { timeout: 20_000 });
  } catch { /* alerting must never mask the underlying failure */ }
}

// Anthropic out of credit: report the REAL cause, don't blame Reddit.
if (creditOut) {
  const m = `🚨 Reddit sweep DEAD: Anthropic is out of credit.\n\nReddit reads are fine — drafting and fact-checking can't run, so no drafts will reach Studio until you top up (Plans & Billing).`;
  console.error(`\n${m}`);
  await alert(m);
  process.exit(3);
}

// NOTE: the "every subreddit fetch was blocked" case used to be checked here, with
// per-sub subsOk/subsErr counters. The sweep now fetches all subs in ONE multireddit
// request, so that failure IS the throw from listPostsRSS above — which already alerts
// and exits 2. The counters were deleted with the loop; the check that referenced them
// was not, and it threw a ReferenceError AFTER every paid draft call but BEFORE the
// saveJSON below — so each run billed ~$1.70 and then binned the drafts it paid for.
if (draftErr > 0) console.error(`\n⚠️  ${draftErr} draft(s) failed on the Anthropic side (Reddit reads were fine).`);

if (DRY) { console.log("🛑 DRY — nothing saved."); process.exit(0); }
saveJSON(PATHS.state, state);
saveJSON(PATHS.queue, queue);
const pending = queue.filter((d) => d.status === "pending").length;
console.log(`💾 saved · ${pending} pending review → Studio dash (studio.yourscore.app → Reddit)\n`);
