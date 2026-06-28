/**
 * x-track.mjs — fetch new tweets from the tracked accounts, reword each into an
 * ORIGINAL YourScore tweet, and append them to the review queue as `pending`.
 *
 * Approval-gated: this NEVER posts. It only writes drafts to data/x-queue.json.
 * Review + publish with `node --env-file=.env.local scripts/x-queue.mjs`.
 *
 * Usage:
 *   node --env-file=.env.local scripts/x-track.mjs                 # all accounts
 *   node --env-file=.env.local scripts/x-track.mjs --account FabrizioRomano
 *   node --env-file=.env.local scripts/x-track.mjs --per 5         # up to 5 newest/account
 *   node --env-file=.env.local scripts/x-track.mjs --dry           # fetch+reword, show, don't save
 *   node --env-file=.env.local scripts/x-track.mjs --raw           # skip rewording (debug fetch)
 *
 * State (data/x-state.json) records the last tweet id seen per account so each
 * run only processes what's new. Each source tweet enters the queue at most once.
 */

import {
  PATHS, loadJSON, saveJSON, resolveUser, fetchRecent, reword,
  tweetUrl, charLen, shortId, HANDLE,
} from "./lib/x-watch.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const RAW = args.includes("--raw");
const ONLY = flag("--account");
const PER = parseInt(flag("--per", ""), 10);

const watchlist = loadJSON(PATHS.watchlist, null);
if (!watchlist) { console.error(`✗ No watchlist at ${PATHS.watchlist}`); process.exit(1); }
let accounts = (watchlist.accounts || []).filter((a) => a && a.username);
if (ONLY) accounts = accounts.filter((a) => a.username.toLowerCase() === ONLY.replace(/^@/, "").toLowerCase());
if (!accounts.length) {
  console.error(ONLY ? `✗ @${ONLY} not in the watchlist.` : "✗ Watchlist has no accounts yet. Add some to data/x-watchlist.json (or just tell Claude the handles).");
  process.exit(1);
}
const perRun = Number.isFinite(PER) ? PER : (watchlist.defaults?.perRun ?? 3);

const state = loadJSON(PATHS.state, { users: {}, lastSeen: {} });
state.users ??= {}; state.lastSeen ??= {};
const queue = loadJSON(PATHS.queue, []);
const inQueue = new Set(queue.map((d) => d.source.tweetId));

console.log(`\n🛰️  Tracking ${accounts.length} account(s) · up to ${perRun} new tweet(s) each · reword=${!RAW} ${DRY ? "· DRY (no save)" : ""}\n`);

let added = 0, skipped = 0, scanned = 0;

for (const acct of accounts) {
  const handle = acct.username.replace(/^@/, "");
  const key = handle.toLowerCase();
  try {
    // Resolve + cache the numeric id (id lookups count against rate limits).
    let user = state.users[key];
    if (!user) { user = await resolveUser(handle); state.users[key] = user; }

    const tweets = await fetchRecent(user.id, { sinceId: state.lastSeen[key], max: 10 });
    if (!tweets.length) { console.log(`  @${handle}: nothing new`); continue; }

    // Newest first; advance lastSeen to the newest regardless of what we keep.
    state.lastSeen[key] = tweets[0].id;
    const cap = Number.isFinite(acct.perRun) ? acct.perRun : perRun; // per-account override
    const batch = tweets.slice(0, cap);

    for (const t of batch) {
      scanned++;
      if (inQueue.has(t.id)) { skipped++; continue; }

      const source = { username: handle, name: user.name, tweetId: t.id, url: tweetUrl(handle, t.id), text: t.text, createdAt: t.created_at, metrics: t.public_metrics, media: t.media || [] };

      if (RAW) { console.log(`  @${handle} ${shortId(t.id)} · ${charLen(t.text)}c · ${(t.media||[]).length} media\n    ${t.text.replace(/\n/g, " ⏎ ").slice(0, 160)}`); continue; }

      const r = await reword(source, { note: acct.note });
      if (!r.usable || !r.tweet) { skipped++; console.log(`  @${handle} ${shortId(t.id)} · skipped (${r.reason || "not usable"})`); continue; }

      const draft = {
        id: shortId(t.id),
        status: "pending",
        createdAt: new Date().toISOString(),
        source,
        draft: r.tweet,
        draftChars: charLen(r.tweet),
        image: r.image || null,        // the source photo we may repost (null if none/branded)
        imageNote: r.imageNote || "",
        rewordReason: r.reason,
      };
      queue.push(draft);
      inQueue.add(t.id);
      added++;
      const warn = draft.draftChars > 280 ? " ⚠️ OVER 280" : "";
      const img = draft.image ? " 📷 +image" : ((t.media || []).some((m) => m.type === "photo") ? " 🚫 image-skipped" : "");
      console.log(`  @${handle} ${draft.id} → draft (${draft.draftChars}c)${warn}${img}\n    src: ${t.text.replace(/\n/g, " ⏎ ").slice(0, 120)}\n    ${draft.draft.replace(/\n/g, " ⏎ ")}${draft.imageNote ? `\n    img: ${draft.imageNote}` : ""}`);
    }
  } catch (e) {
    console.error(`  @${handle}: ✗ ${e.message}`);
  }
}

console.log(`\n📊 scanned ${scanned} · queued ${added} new · skipped ${skipped}`);
if (DRY) { console.log("🛑 DRY — nothing saved."); process.exit(0); }
if (RAW) { saveJSON(PATHS.state, state); console.log("💾 state advanced (raw mode, no drafts written)."); process.exit(0); }

saveJSON(PATHS.state, state);
saveJSON(PATHS.queue, queue);
const pending = queue.filter((d) => d.status === "pending").length;
console.log(`💾 saved. ${pending} draft(s) pending review → node --env-file=.env.local scripts/x-queue.mjs list\n`);
