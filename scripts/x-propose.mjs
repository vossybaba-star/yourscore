/**
 * x-propose.mjs — scan the tracked accounts and queue the SINGLE best new tweet to
 * propose this run (one per run, by founder cadence). Does NOT post and does NOT
 * push; the wrapper runs `x-telegram.mjs push` afterwards to send the one new draft
 * to Telegram for Post / Add GIF / Edit / Decline.
 *
 * How "best" is picked: among tweets from the last WINDOW_HOURS that aren't already
 * in the queue (so nothing is proposed twice and declined ones never return), rank by
 * engagement (likes + 2x retweets + replies + quotes), newest as tiebreak. This
 * surfaces the biggest current story - which is exactly what the morning runs want
 * for overnight news. Rewords the top candidates until one passes the voice/usable
 * check, queues that one, done.
 *
 * Usage:  node --env-file=.env.local scripts/x-propose.mjs [--dry]
 */

import {
  PATHS, loadJSON, saveJSON, resolveUser, fetchRecent, reword,
  tweetUrl, charLen, shortId,
} from "./lib/x-watch.mjs";

const DRY = process.argv.includes("--dry");
const WINDOW_HOURS = 18;    // ignore anything older (keeps proposals timely)
const MAX_PER_ACCT = 15;    // recent tweets scanned per account
const MAX_REWORD_TRIES = 5; // cap reword (Anthropic) calls per run

const watchlist = loadJSON(PATHS.watchlist, null);
if (!watchlist) { console.error("✗ no watchlist"); process.exit(1); }
const accounts = (watchlist.accounts || []).filter((a) => a && a.username);

const state = loadJSON(PATHS.state, {});
state.users ??= {};
const queue = loadJSON(PATHS.queue, []);
const seen = new Set(queue.map((d) => d.source.tweetId)); // proposed / declined / posted

const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;

// 1) Gather fresh, unseen candidates across all accounts.
const candidates = [];
for (const acct of accounts) {
  const handle = acct.username.replace(/^@/, "");
  const key = handle.toLowerCase();
  try {
    let user = state.users[key];
    if (!user) { user = await resolveUser(handle); state.users[key] = user; }
    const tweets = await fetchRecent(user.id, { max: MAX_PER_ACCT }); // no sinceId: re-see overnight until used
    for (const t of tweets) {
      if (seen.has(t.id)) continue;
      if (t.created_at && Date.parse(t.created_at) < cutoff) continue;
      const m = t.public_metrics || {};
      const eng = (m.like_count || 0) + 2 * (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
      candidates.push({ handle, name: user.name, note: acct.note, t, eng, ts: t.created_at ? Date.parse(t.created_at) : 0 });
    }
  } catch (e) { console.error(`@${handle}: ${e.message}`); }
}

if (!candidates.length) { if (!DRY) saveJSON(PATHS.state, state); console.log("no new candidates this run"); process.exit(0); }

// 2) Rank: biggest story first (engagement), newest as tiebreak.
candidates.sort((a, b) => b.eng - a.eng || b.ts - a.ts);

// 3) Reword the top candidates until one passes the voice/usable check.
let chosen = null;
for (const c of candidates.slice(0, MAX_REWORD_TRIES)) {
  const r = await reword({ username: c.handle, text: c.t.text }, { note: c.note });
  if (r.usable && r.tweet) { chosen = { c, draft: r.tweet }; break; }
  console.log(`  skip @${c.handle} ${shortId(c.t.id)} (${r.reason || "not usable"})`);
}

if (!chosen) { if (!DRY) saveJSON(PATHS.state, state); console.log(`scanned ${candidates.length} candidate(s), none usable this run`); process.exit(0); }

// 4) Queue ONE pending draft (the wrapper pushes it to Telegram).
const { c, draft } = chosen;
const d = {
  id: shortId(c.t.id),
  status: "pending",
  createdAt: new Date().toISOString(),
  source: { username: c.handle, name: c.name, tweetId: c.t.id, url: tweetUrl(c.handle, c.t.id), text: c.t.text, createdAt: c.t.created_at, metrics: c.t.public_metrics },
  draft,
  draftChars: charLen(draft),
};
console.log(`proposed ${d.id} from @${c.handle} (${d.draftChars}c, eng ${c.eng})\n  ${draft.replace(/\n/g, " / ")}`);
if (DRY) { console.log("🛑 DRY - not saved"); process.exit(0); }
queue.push(d);
saveJSON(PATHS.state, state);
saveJSON(PATHS.queue, queue);
