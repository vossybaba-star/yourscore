/**
 * reddit-track.mjs — scan watched subreddits + intent searches, draft replies,
 * queue them for Telegram review. NEVER posts; only writes data/reddit-queue.json.
 *
 *   node --env-file=.env.local scripts/reddit-track.mjs          # full run
 *   node --env-file=.env.local scripts/reddit-track.mjs --dry    # show, don't save
 *   node --env-file=.env.local scripts/reddit-track.mjs --sub soccer
 *
 * State (data/reddit-state.json) remembers every post already considered, so a
 * thread is drafted against at most once, ever.
 */

import { PATHS, loadJSON, saveJSON, listPostsAny, searchPostsAny, triage, draftReply, factCheck, hasApiCreds, costReport } from "./lib/reddit.mjs";
import { factBrief } from "./lib/football-facts.mjs";

// Match the fast lane's bar. Below this we neither queue nor pay to verify.
const MIN_SCORE = 6;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ONLY = args.includes("--sub") ? args[args.indexOf("--sub") + 1] : null;

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
const cap = D.maxQueuedPerRun ?? 6;

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

console.log(`\n👂 reddit-track · ${wl.subreddits.length} subs + ${wl.searches.length} searches · ${hasApiCreds() ? "API" : "RSS (unauthenticated, ~1 req/min pacing)"} mode ${DRY ? "· DRY" : ""}\n`);

// Track fetch health. A run where EVERY fetch fails looks identical, in the log,
// to a quiet news day ("considered 0") — that silence hid a 3-hour Reddit IP ban
// on Jul 10. Count outcomes so the run can fail loudly instead.
let subsOk = 0, subsErr = 0;

// Rotate where the sweep starts. The run stops the moment it hits maxQueuedPerRun,
// and each RSS fetch costs ~65s, so a fixed order means the tail of the watchlist
// is never reached on a productive run (Jul 10: 6 drafts by sub 15 of 29, so the
// bottom 14 went unswept all day). Start where the last run stopped instead; over
// the day's runs every sub gets a turn.
const total = wl.subreddits.length;
const startAt = ONLY ? 0 : ((state.subOffset ?? 0) % total + total) % total;
const order = ONLY ? wl.subreddits : [...wl.subreddits.slice(startAt), ...wl.subreddits.slice(0, startAt)];
let visited = 0;
if (!ONLY) console.log(`  ↻ starting at r/${order[0].name} (offset ${startAt}/${total})\n`);

for (const s of order) {
  if (ONLY && s.name.toLowerCase() !== ONLY.toLowerCase()) continue;
  if (drafted >= cap) break;
  if (creditOut) break;   // can't draft — stop burning 65s-per-sub RSS fetches for nothing
  visited++;

  // The FETCH is the only thing subsOk/subsErr may count. These two used to share
  // one try-block, so any error out of consider() — including "Anthropic credit
  // balance is too low" — was tallied as a failed Reddit fetch. On Jul 14 that
  // turned a billing outage into a log reading "20 subreddit fetches blocked,
  // Reddit is likely blocking the VPS IP", pointing at exactly the wrong problem.
  let posts;
  try {
    posts = (await listPostsAny(s.name, { sort: s.sort || "hot", limit: 30 }))
      .filter((p) => fresh(p, s.maxAgeHours) && eligible(p, s.minUps))
      .slice(0, s.perRun ?? D.perRun ?? 2);
    subsOk++;
  } catch (e) { subsErr++; console.error(`  r/${s.name}: ✗ fetch: ${e.message}`); continue; }

  console.log(`  r/${s.name}: ${posts.length} candidate(s)`);
  for (const p of posts) {
    if (drafted >= cap) break;
    console.log(`    ${p.title.slice(0, 90)} (${p.ups}↑, ${p.numComments}c)`);
    // consider() guards its own Anthropic calls, but a leak from any of them must
    // never be blamed on Reddit. Backstop it here and name the real cause.
    try {
      await consider(p, { subNote: s.note });
    } catch (e) {
      draftErr++;
      if (/credit balance/i.test(e.message)) {
        creditOut = true;
        console.error(`    ✗ ANTHROPIC OUT OF CREDIT`);
        break;
      }
      console.error(`    ✗ draft pipeline: ${e.message.slice(0, 90)}`);
    }
  }
  if (creditOut) break;
}

// Next run picks up at the first sub this one didn't reach.
if (!ONLY) state.subOffset = (startAt + visited) % total;

for (const q of wl.searches) {
  if (ONLY) break;
  if (drafted >= cap) break;
  try {
    const posts = (await searchPostsAny(q.q, { time: q.time || "day", limit: 25 }))
      .filter((p) => fresh(p, q.maxAgeHours ?? 48) && eligible(p, q.minUps ?? 0))
      .slice(0, q.perRun ?? 2);
    console.log(`  🔎 "${q.q}": ${posts.length} candidate(s)`);
    for (const p of posts) {
      if (drafted >= cap) break;
      console.log(`    r/${p.sub} · ${p.title.slice(0, 80)} (${p.ups}↑)`);
      await consider(p, { searchNote: q.note, subNote: `unfamiliar sub (r/${p.sub}) - if in doubt about its self-promo rules, keep the reply product-free` });
    }
  } catch (e) { console.error(`  🔎 "${q.q}": ✗ ${e.message}`); }
}

console.log(`\n📊 considered ${considered} thread(s) · queued ${drafted} draft(s) · fetch ok ${subsOk}/${subsOk + subsErr} · swept ${visited}/${total} subs${ONLY ? "" : ` · next run starts at r/${wl.subreddits[state.subOffset].name}`}`);
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

// Every fetch failed: Reddit is blocking this IP (403/429) or the network is down.
// Exit non-zero so the wrapper alerts instead of writing an empty "all quiet" run.
if (subsOk === 0 && subsErr > 0) {
  const m = `🚨 Reddit sweep failed: all ${subsErr} subreddit fetches blocked (403/429). Reddit is likely blocking the VPS IP. Nothing drafted.`;
  console.error(`\n${m}`);
  await alert(m);
  process.exit(2);
}
if (draftErr > 0) console.error(`\n⚠️  ${draftErr} draft(s) failed on the Anthropic side (Reddit reads were fine).`);

if (DRY) { console.log("🛑 DRY — nothing saved."); process.exit(0); }
saveJSON(PATHS.state, state);
saveJSON(PATHS.queue, queue);
const pending = queue.filter((d) => d.status === "pending").length;
console.log(`💾 saved · ${pending} pending review → Studio dash (studio.yourscore.app → Reddit)\n`);
