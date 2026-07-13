/**
 * reddit-redraft.mjs — re-draft every still-pending reply with the CURRENT voice.
 *
 * Editing the VOICE prompt only affects future sweeps; drafts already queued keep
 * the voice they were written with. This regenerates the reply text for each
 * pending draft against its original thread, in place. Never posts.
 *
 *   node --env-file=.env.local scripts/reddit-redraft.mjs         # all pending
 *   node --env-file=.env.local scripts/reddit-redraft.mjs --dry   # show, don't save
 */
import { PATHS, loadJSON, saveJSON, draftReply } from "./lib/reddit.mjs";

const DRY = process.argv.includes("--dry");
const wl = loadJSON(PATHS.watchlist, { subreddits: [] });
const noteFor = (sub) => (wl.subreddits.find((s) => s.name.toLowerCase() === String(sub).toLowerCase()) || {}).note;

const queue = loadJSON(PATHS.queue, []);
const pending = queue.filter((d) => d.status === "pending");
console.log(`re-drafting ${pending.length} pending drafts with the current voice${DRY ? " (DRY)" : ""}\n`);

let redone = 0, dropped = 0, failed = 0;
for (const d of pending) {
  try {
    const r = await draftReply(d.post, { subNote: noteFor(d.post.sub) });
    if (!r.usable) {
      dropped++;
      if (!DRY) { d.status = "skipped"; d.reason = `redraft dropped: ${r.reason}`.slice(0, 200); }
      console.log(`  · drop r/${d.post.sub}: ${r.reason.slice(0, 70)}`);
      continue;
    }
    redone++;
    if (!DRY) {
      d.draft = r.reply; d.mentionsProduct = r.mentionsProduct; d.score = r.score;
      d.reason = r.reason; d.redraftedAt = new Date().toISOString();
    }
    console.log(`  ✓ r/${d.post.sub}: ${r.reply.replace(/\n/g, " ").slice(0, 90)}`);
  } catch (e) { failed++; console.error(`  ✗ r/${d.post.sub}: ${e.message}`); }
}

if (!DRY) saveJSON(PATHS.queue, queue);
console.log(`\n${DRY ? "DRY — nothing saved. " : ""}${redone} redrafted · ${dropped} dropped (no longer usable) · ${failed} errored`);
