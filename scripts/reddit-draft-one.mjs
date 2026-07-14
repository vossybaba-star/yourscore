/**
 * reddit-draft-one.mjs — draft a reply to ONE pasted Reddit post.
 *
 * The Studio dash's "Write a reply" tab calls this: the founder pastes someone
 * else's post, and we draft a reply using EXACTLY the same pipeline as the
 * automated sweep — the same VOICE rules (fan voice, concise, never corporate,
 * never AI-sounding, no product mentions), the same drafter, the same free fact
 * brief. Reusing the sweep's own functions (not a second prompt) is the point:
 * every voice fix the founder gives via feedback lands here too.
 *
 * WHY IT WAS SLOW (fixed, Jul 14). v1 called draftReply + factCheck and skipped
 * the sweep's two FREE tiers. Without a `brief`, draftReply buys its full paid
 * search budget (3 searches x 2 hops) and the fact-checker then re-researches
 * the same facts from scratch — two slow server-side web-search round-trips
 * back to back, ~3.5 min. The sweep is fast because it hands the drafter facts
 * up front, for free, from structured data.
 *
 * WHAT IT DOES NOW — the sweep's tiers, minus the gates that don't apply to a
 * post the founder chose himself:
 *   1. triage  (Haiku, ~2s)  — NOT a gate here. He picked the thread; we don't
 *                              second-guess him. We run it only to name the
 *                              clubs/players/competition the brief needs.
 *   2. factBrief (FREE, ~2s) — Sportmonks (PL) + ESPN (WC). No LLM, no cost.
 *                              Current manager, current club, tournament state:
 *                              exactly the facts drafts kept getting wrong.
 *   3. draft   (Sonnet)      — grounded in the brief, so its search budget drops
 *                              3 -> 1. Research-first still holds; it just has
 *                              far less left to research.
 *
 * The fact-check is NOT in the draft path any more (founder, Jul 14: "it doesn't
 * need to be fact-checked at the end"). It lives behind `--mode verify` so the
 * dash can run it in the background, after the reply is already on screen. It
 * costs him no waiting, and it still catches the class of error that made him
 * demand it (a confidently stated stale fact, e.g. "Arne Slot at Liverpool").
 *
 * Usage:
 *   node --env-file=.env.local scripts/reddit-draft-one.mjs \
 *     --sub PremierLeague --title "..." [--body "..."] [--url "..."] [--note "..."]
 *   node --env-file=.env.local scripts/reddit-draft-one.mjs --mode verify \
 *     --title "..." --reply "..." [--body "..."]
 *
 * Prints ONE line of JSON.
 *   draft:  {usable, reply, score, reason, mentionsProduct, brief, ms}
 *   verify: {pass, failures, note, ms}
 */
import { triage, draftReply, factCheck } from "./lib/reddit.mjs";
import { factBrief } from "./lib/football-facts.mjs";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : undefined; };
const t0 = Date.now();

const title = flag("title");
if (!title) { console.error('need --title "..."'); process.exit(1); }

// Shape a pasted post like the sweep's own post objects. Unknown metadata gets
// neutral values — the drafter only uses them for context, never for facts.
const post = {
  id: "manual-" + Date.now().toString(36),
  sub: (flag("sub") || "soccer").replace(/^\/?r\//, ""),
  title,
  body: flag("body") || "",
  url: flag("url") || null,
  ups: Number(flag("ups")) || 0,
  numComments: Number(flag("comments")) || 0,
  createdUtc: Math.floor(Date.now() / 1000),
};

const mode = flag("mode") || "draft";
const note = flag("note");

try {
  if (mode === "verify") {
    const reply = flag("reply");
    if (!reply) { console.error('verify needs --reply "..."'); process.exit(1); }
    // Re-derive the brief so the checker isn't paying to look up what we already
    // hold for free — same saving as in the draft path.
    let brief = "";
    try { brief = await factBrief(await triage(post)); } catch { /* free-source hiccup: check unaided */ }
    const fc = await factCheck(post, reply, { brief });
    console.log(JSON.stringify({
      pass: fc.pass !== false,
      failures: fc.failures || [],
      note: fc.note || "",
      ms: Date.now() - t0,
    }));
    process.exit(0);
  }

  // Tier 1 — name the entities (not a gate; see header).
  let tri = { clubs: [], players: [], competition: "" };
  try { tri = await triage(post, { subNote: note ? `Founder's steer: ${note}` : undefined }); }
  catch { /* triage is only here to feed the brief — never block a draft on it */ }

  // Tier 2 — FREE facts. Fails soft to "": the drafter then buys its own search
  // budget, exactly as it did before. Never blocks.
  let brief = "";
  try { brief = await factBrief(tri); } catch { /* free-source hiccup: fall back to paid search */ }

  // Tier 3 — draft, grounded in the brief.
  const r = await draftReply(post, {
    // The founder's own steer for this one reply rides in as a subreddit note —
    // the same channel the sweep uses for per-sub rules.
    subNote: note ? `Founder's steer for this reply: ${note}` : undefined,
    brief,
  });

  console.log(JSON.stringify({
    usable: r.usable,
    reply: r.reply,
    score: r.score,
    reason: r.reason,
    mentionsProduct: r.mentionsProduct,
    brief,                       // show him what it grounded on
    ms: Date.now() - t0,
  }));
} catch (e) {
  console.error(e.message || String(e));
  process.exit(1);
}
