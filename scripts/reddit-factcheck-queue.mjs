/**
 * reddit-factcheck-queue.mjs — run the web-search fact-check over every pending
 * draft already in the queue (they were drafted before fact-checking existed).
 * Failures are moved to status "skipped"; passes get factChecked: true. Never posts.
 *
 *   node --env-file=.env.local scripts/reddit-factcheck-queue.mjs         # apply
 *   node --env-file=.env.local scripts/reddit-factcheck-queue.mjs --dry   # report only
 */
import { PATHS, loadJSON, saveJSON, factCheck } from "./lib/reddit.mjs";

const DRY = process.argv.includes("--dry");
const queue = loadJSON(PATHS.queue, []);
// Skip drafts already checked (factChecked or already dropped) so a re-run
// resumes where a previous one stopped rather than redoing the whole queue.
const pending = queue.filter((d) => d.status === "pending" && !d.factChecked);
console.log(`fact-checking ${pending.length} unchecked pending drafts${DRY ? " (DRY)" : ""}\n`);

let passed = 0, failed = 0, errored = 0;
for (const d of pending) {
  try {
    const fc = await factCheck(d.post, d.draft);
    if (fc.pass) {
      passed++;
      if (!DRY) { d.factChecked = true; }
      console.log(`  ✓ r/${d.post.sub}: ${d.draft.replace(/\n/g, " ").slice(0, 70)}`);
    } else {
      failed++;
      if (!DRY) { d.status = "skipped"; d.reason = `fact-check: ${(fc.failures[0] || fc.note)}`.slice(0, 240); }
      console.log(`  ✗ r/${d.post.sub}: DROPPED — ${(fc.failures[0] || fc.note).slice(0, 100)}`);
    }
  } catch (e) {
    errored++;
    console.log(`  ! r/${d.post.sub}: check errored (${e.message.slice(0, 50)}) — left pending`);
  }
  if (!DRY) saveJSON(PATHS.queue, queue); // persist after every draft so a stall never loses progress
}

console.log(`\n${DRY ? "DRY — nothing saved. " : ""}${passed} verified · ${failed} dropped · ${errored} errored (left pending)`);
