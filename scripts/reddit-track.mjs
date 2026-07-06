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

import { PATHS, loadJSON, saveJSON, listPostsAny, searchPostsAny, draftReply, hasApiCreds } from "./lib/reddit.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ONLY = args.includes("--sub") ? args[args.indexOf("--sub") + 1] : null;

const wl = loadJSON(PATHS.watchlist, null);
if (!wl) { console.error(`✗ no watchlist at ${PATHS.watchlist}`); process.exit(1); }
const D = wl.defaults || {};

const state = loadJSON(PATHS.state, { seen: {} });
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

async function consider(post, { subNote, searchNote }) {
  state.seen[post.id] = now;                        // one shot per thread, usable or not
  considered++;
  const r = await draftReply(post, { subNote, searchNote });
  if (!r.usable) { console.log(`    · skip (${r.reason.slice(0, 90)})`); return; }
  const entry = {
    id: post.id,
    status: "pending",
    createdAt: new Date().toISOString(),
    post,
    draft: r.reply,
    mentionsProduct: r.mentionsProduct,
    score: r.score,
    reason: r.reason,
    origin: searchNote ? "search" : "sub",
  };
  queue.push(entry); queued.add(post.id); drafted++;
  console.log(`    ✓ drafted (score ${r.score}${r.mentionsProduct ? " ⚠️ mentions product" : ""}): ${r.reply.replace(/\n/g, " ⏎ ").slice(0, 110)}`);
}

console.log(`\n👂 reddit-track · ${wl.subreddits.length} subs + ${wl.searches.length} searches · ${hasApiCreds() ? "API" : "RSS (unauthenticated, ~1 req/min pacing)"} mode ${DRY ? "· DRY" : ""}\n`);

for (const s of wl.subreddits) {
  if (ONLY && s.name.toLowerCase() !== ONLY.toLowerCase()) continue;
  if (drafted >= cap) break;
  try {
    const posts = (await listPostsAny(s.name, { sort: s.sort || "hot", limit: 30 }))
      .filter((p) => fresh(p, s.maxAgeHours) && eligible(p, s.minUps))
      .slice(0, s.perRun ?? D.perRun ?? 2);
    console.log(`  r/${s.name}: ${posts.length} candidate(s)`);
    for (const p of posts) {
      if (drafted >= cap) break;
      console.log(`    ${p.title.slice(0, 90)} (${p.ups}↑, ${p.numComments}c)`);
      await consider(p, { subNote: s.note });
    }
  } catch (e) { console.error(`  r/${s.name}: ✗ ${e.message}`); }
}

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

console.log(`\n📊 considered ${considered} thread(s) · queued ${drafted} draft(s)`);
if (DRY) { console.log("🛑 DRY — nothing saved."); process.exit(0); }
saveJSON(PATHS.state, state);
saveJSON(PATHS.queue, queue);
const pending = queue.filter((d) => d.status === "pending").length;
console.log(`💾 saved · ${pending} pending review → reddit-telegram.mjs push\n`);
