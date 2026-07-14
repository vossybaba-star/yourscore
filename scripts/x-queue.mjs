/**
 * x-queue.mjs — review and publish the reworded-tweet drafts in data/x-queue.json.
 *
 * Nothing posts to @Yourscore_App_ until you explicitly run `post`. Drafts move
 * pending → approved → posted (or → rejected). `post` only fires `approved` ones.
 *
 * Commands (always run with `node --env-file=.env.local`):
 *   list [--status pending|approved|posted|rejected|all]   list drafts (default: pending+approved)
 *   show  <id>                                             full draft + source tweet
 *   approve <id...> | approve --all                        mark draft(s) ready to post
 *   reject  <id...>                                        drop draft(s)
 *   edit    <id> "new tweet text"                          replace the draft text
 *   post   [<id...>] [--image path.png] [--dry]            post approved drafts (or just these ids)
 *   prune                                                  remove posted + rejected from the file
 *
 * Example flow:
 *   node --env-file=.env.local scripts/x-queue.mjs list
 *   node --env-file=.env.local scripts/x-queue.mjs edit 8837121 "Saibari to Bayern — done deal..."
 *   node --env-file=.env.local scripts/x-queue.mjs approve 8837121
 *   node --env-file=.env.local scripts/x-queue.mjs post --dry      # preview exactly what fires
 *   node --env-file=.env.local scripts/x-queue.mjs post            # publish
 */

import { PATHS, loadJSON, saveJSON, postTweet, uploadMedia, charLen, sanitize, HANDLE } from "./lib/x-watch.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const rest = args.slice(1);
const flag = (n) => { const i = rest.indexOf(n); return i !== -1 ? rest[i + 1] : undefined; };
const ids = (statusDefault) => rest.filter((a) => !a.startsWith("--"));

let queue = loadJSON(PATHS.queue, []);
const byId = (id) => queue.find((d) => d.id === id);
const STATUS_ICON = { pending: "○", approved: "✓", posted: "✅", rejected: "✗" };

// Time-locked copy ("tonight", "today", …) is only true on the day it was drafted.
// Once that day passes, the tweet reads stale — auto-reject rather than post (founder rule, Jul 8).
const TIME_WORDS = /\b(tonight|today|this (morning|afternoon|evening)|later today|in an hour|kicks off (in|at))\b/i;
const ukDay = (iso) => (iso || "").slice(0, 10);
const ukTodayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const timeCopyStale = (d) => TIME_WORDS.test(d.draft || "") && ukDay(d.createdAt) !== "" && ukDay(d.createdAt) !== ukTodayStr();

function save() { saveJSON(PATHS.queue, queue); }

function line(d) {
  const warn = d.draftChars > 280 ? " ⚠️OVER" : "";
  return `${STATUS_ICON[d.status] || "?"} ${d.id}  [${d.status}]  @${d.source.username}  ${d.draftChars}c${warn}\n    ${d.draft.replace(/\n/g, " ⏎ ")}`;
}

switch (cmd) {
  case "list": {
    const s = flag("--status");
    const want = s === "all" ? null : s ? [s] : ["pending", "approved"];
    const rows = queue.filter((d) => !want || want.includes(d.status));
    if (!rows.length) { console.log("(no matching drafts)"); break; }
    console.log(`\n${rows.length} draft(s):\n`);
    for (const d of rows) console.log(line(d) + "\n");
    const p = queue.filter((d) => d.status === "pending").length;
    const a = queue.filter((d) => d.status === "approved").length;
    console.log(`pending ${p} · approved ${a} · total ${queue.length}`);
    break;
  }

  case "show": {
    const d = byId(rest[0]);
    if (!d) { console.error(`✗ no draft ${rest[0]}`); process.exit(1); }
    console.log(`\n${d.id}  [${d.status}]  ${d.draftChars} chars`);
    console.log(`\n── source (@${d.source.username}, ${d.source.createdAt}) ──\n${d.source.text}`);
    console.log(`\n   ${d.source.url}`);
    console.log(`\n── YourScore draft ──\n${d.draft}`);
    if (d.rewordReason) console.log(`\n(reword note: ${d.rewordReason})`);
    if (d.postedUrl) console.log(`\nposted: ${d.postedUrl}`);
    break;
  }

  case "add": {
    // Compose a brand-new draft (Studio dash / card pipelines): add "text..." [--approve] [--image path.png]
    const imgIdx = rest.indexOf("--image");
    const imagePath = imgIdx !== -1 ? rest[imgIdx + 1] : undefined;
    const text = sanitize(rest.filter((a, i) => !a.startsWith("--") && i !== imgIdx + 1).join(" "));
    if (!text) { console.error('✗ provide text: add "..." [--approve] [--image path.png]'); process.exit(1); }
    const d = {
      id: "dz" + String(Date.now()).slice(-9),
      status: rest.includes("--approve") ? "approved" : "pending",
      createdAt: new Date().toISOString(),
      source: { username: "studio", name: "Composed in Studio", url: "https://yourscore.app" },
      draft: text,
      draftChars: charLen(text),
      origin: "studio-dash",
      pillar: "composed",
    };
    if (imagePath) d.imagePath = imagePath;
    queue.push(d);
    save();
    console.log(`+ ${d.id} [${d.status}] ${d.draftChars} chars${d.draftChars > 280 ? " ⚠️ OVER 280" : ""}`);
    break;
  }

  case "approve": {
    const targets = rest.includes("--all") ? queue.filter((d) => d.status === "pending") : ids().map(byId).filter(Boolean);
    if (!targets.length) { console.error("✗ no matching pending drafts"); process.exit(1); }
    for (const d of targets) {
      if (d.draftChars > 280) { console.error(`✗ ${d.id} is ${d.draftChars} chars — edit it under 280 first.`); continue; }
      d.status = "approved";
      console.log(`✓ approved ${d.id}`);
    }
    save();
    break;
  }

  case "reject": {
    const targets = ids().map(byId).filter(Boolean);
    if (!targets.length) { console.error("✗ no matching drafts"); process.exit(1); }
    for (const d of targets) { d.status = "rejected"; console.log(`✗ rejected ${d.id}`); }
    save();
    break;
  }

  case "edit": {
    const d = byId(rest[0]);
    const text = sanitize(rest.slice(1).filter((a) => !a.startsWith("--")).join(" "));
    if (!d) { console.error(`✗ no draft ${rest[0]}`); process.exit(1); }
    if (!text) { console.error('✗ provide new text: edit <id> "..."'); process.exit(1); }
    d.draft = text;
    d.draftChars = charLen(text);
    d.edited = true;
    if (d.status === "posted") d.status = "pending";
    console.log(`✏️  ${d.id} now ${d.draftChars} chars${d.draftChars > 280 ? " ⚠️ OVER 280" : ""} [${d.status}]\n    ${text}`);
    save();
    break;
  }

  case "post": {
    const DRY = rest.includes("--dry");
    const NEXT = rest.includes("--next"); // drip: post only the single oldest approved draft
    const image = flag("--image");
    const chosen = ids();
    let targets;
    if (NEXT) {
      const next = queue.find((d) => d.status === "approved");
      targets = next ? [next] : [];
    } else {
      targets = chosen.length ? chosen.map(byId).filter(Boolean) : queue.filter((d) => d.status === "approved");
    }
    targets = targets.filter((d) => d.status !== "posted");
    if (!targets.length) { console.log(NEXT ? "(drip: nothing approved to post right now)" : "(nothing to post — approve some drafts first: x-queue.mjs approve <id>)"); break; }

    console.log(`\n🐦 ${DRY ? "DRY RUN — would post" : "Posting"} ${targets.length} tweet(s) as @${HANDLE}${image ? ` · image ${image}` : ""}\n`);
    for (const d of targets) {
      // Final scrub right before it goes live — guards against pre-sanitizer or
      // hand-edited queue entries sneaking an AI-tell character onto the account.
      const clean = sanitize(d.draft);
      if (clean !== d.draft) { d.draft = clean; d.draftChars = charLen(clean); }
      if (d.draftChars > 280) { console.error(`✗ ${d.id} is ${d.draftChars} chars — skipping (edit under 280).`); continue; }
      if (timeCopyStale(d)) {
        console.error(`✗ ${d.id} says "tonight/today" but was drafted ${ukDay(d.createdAt)} — ${DRY ? "would auto-reject" : "auto-rejected (stale time copy)"}.`);
        if (!DRY) { d.status = "rejected"; d.rejectReason = "time-sensitive copy went stale"; save(); }
        continue;
      }
      console.log(`  ${d.id} (${d.draftChars}c):\n    ${d.draft.replace(/\n/g, " ⏎ ")}`);
      if (DRY) continue;
      try {
        // --image flag wins; otherwise a per-draft attached card (add --image) rides along.
        const img = image || d.imagePath;
        const mediaId = img ? await uploadMedia(img) : null;
        const data = await postTweet(d.draft, mediaId);
        d.status = "posted";
        d.postedId = data.id;
        d.postedUrl = `https://x.com/${HANDLE}/status/${data.id}`;
        d.postedAt = new Date().toISOString();
        console.log(`    ✅ ${d.postedUrl}`);
        save(); // persist after each post so a mid-batch failure can't double-post
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
    }
    if (DRY) console.log("\n🛑 DRY — nothing posted. Drop --dry to publish.");
    break;
  }

  case "expire": {
    // Founder rule (Jul 9): a draft not approved within 48h is a "no" — it leaves
    // the approval feed. Run daily by cron; expired drafts stay in the file for history.
    const hours = Number(flag("--hours")) || 48;
    const cutoff = Date.now() - hours * 3600000;
    let n = 0;
    for (const d of queue) {
      if (d.status !== "pending") continue;
      if (Date.parse(d.createdAt) < cutoff) { d.status = "expired"; n++; continue; }
      if (timeCopyStale(d)) { d.status = "expired"; d.rejectReason = "time-sensitive copy went stale"; n++; }
    }
    save();
    console.log(`expired ${n} pending draft(s) older than ${hours}h`);
    break;
  }

  case "prune": {
    const before = queue.length;
    queue = queue.filter((d) => d.status !== "posted" && d.status !== "rejected");
    save();
    console.log(`🧹 removed ${before - queue.length} posted/rejected · ${queue.length} remain`);
    break;
  }

  default:
    console.log(`Usage:
  list [--status pending|approved|posted|rejected|all]
  show <id>
  approve <id...> | approve --all
  reject <id...>
  edit <id> "new text"
  post [<id...>] [--image path.png] [--dry]
  prune
Run with:  node --env-file=.env.local scripts/x-queue.mjs <command>`);
}
