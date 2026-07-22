/**
 * Pre-generate club topic packs (History & Honours / Legends / Modern Era / Rivalries)
 * as real quiz_packs rows for the club page (src/app/club/[slug]/page.tsx).
 *
 * Approach: these are ordinary published, non-rotation packs — identical in shape to
 * the 178 existing builder packs that /api/challenges/pack already serves fully
 * playable/leaderboarded/shareable/guest-capable. No new generation path is needed;
 * the hub grid is unaffected because /api/quiz/packs only lists rotation_active=true.
 *
 * The draw MUST match /api/quiz/generate-custom/route.ts exactly (same filters, same
 * MIX, same fillToSize/pickDistinctFacts/dedupeByQuestionText) — this script imports
 * those three functions verbatim from src/lib/questions.ts rather than reimplementing
 * them, so the two paths can never drift out of sync.
 *
 * A raw row count >= 15 is NOT sufficient: pickDistinctFacts refuses to reuse a fact,
 * so real capacity can only be known by actually running the draw.
 *
 * Usage:
 *   node --env-file=.env.local scripts/club-pages/generate-topic-packs.mjs              # DRY RUN (default)
 *   node --env-file=.env.local scripts/club-pages/generate-topic-packs.mjs --dry-run    # same, explicit
 *   node --env-file=.env.local scripts/club-pages/generate-topic-packs.mjs --commit     # write to prod — founder approval only
 *
 * (Also runnable via `npx tsx` — needed so the .ts imports below transpile without a build step.)
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { slugify } from "../../src/lib/utils.ts";
import { fillToSize, pickDistinctFacts, dedupeByQuestionText } from "../../src/lib/questions.ts";

const args = process.argv.slice(2);
// Dry run is the DEFAULT. --commit is the only way to write anything.
const COMMIT = args.includes("--commit");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Same 15-question mix as /api/quiz/generate-custom ───────────────────────
const MIX = { easy: 2, medium: 5, hard: 8 };
const QUIZ_SIZE = 15;

// The four locked club topics — values must match questions.category exactly
// (src/app/quiz/create/page.tsx TOPIC_OPTIONS), in the fixed display order.
const TOPICS = [
  { slug: "history-honours", label: "History & Honours" },
  { slug: "legends", label: "Legends" },
  { slug: "modern-era", label: "Modern Era" },
  { slug: "rivalries-derbies", label: "Rivalries" },
];

// ── Resolve the 20 in-rotation PL clubs from the same source of truth the ────
// hub grid uses (rotation_active=true club season packs), not a hardcoded list —
// avoids drift if the rotation set ever changes.
async function fetchInRotationClubs() {
  const { data, error } = await supabase
    .from("quiz_packs")
    .select("name")
    .eq("type", "club")
    .eq("status", "published")
    .eq("rotation_active", true)
    .order("name");
  if (error) throw new Error(`Failed to fetch in-rotation clubs: ${error.message}`);
  return (data ?? []).map((r) => r.name);
}

// Mirrors fetchByDifficulty in /api/quiz/generate-custom/route.ts — same filters,
// same shape. No seenIds/history exclusion here: this is a fresh pre-generated
// pack, not a per-player draw.
async function fetchByDifficulty(club, category, difficulty) {
  const { data, error } = await supabase
    .from("questions")
    .select("id, entity, entity_type, question, options, answer, difficulty, category, era, fact_key")
    .eq("entity", club)
    .eq("status", "active")
    .eq("source", "data-grounded")
    .eq("difficulty", difficulty)
    .eq("category", category)
    .limit(QUIZ_SIZE * 4);
  if (error) throw new Error(`Fetch failed (${club}/${category}/${difficulty}): ${error.message}`);
  return data ?? [];
}

// Runs the REAL draw exactly as generate-custom does for the no-difficulty-filter
// path: pools fetched at full quiz width, fillToSize + shared usedFactKeys, then
// a text dedupe pass.
async function runRealDraw(club, category) {
  const [easyRows, mediumRows, hardRows] = await Promise.all([
    fetchByDifficulty(club, category, "easy"),
    fetchByDifficulty(club, category, "medium"),
    fetchByDifficulty(club, category, "hard"),
  ]);
  const rawCount = easyRows.length + mediumRows.length + hardRows.length;

  const usedFactKeys = new Set();
  let questions = fillToSize(
    { easy: easyRows, medium: mediumRows, hard: hardRows },
    MIX,
    QUIZ_SIZE,
    usedFactKeys
  );
  questions = dedupeByQuestionText(questions);

  return { rawCount, questions };
}

function buildPackName(club, topicLabel) {
  // MIDDOT separator, never a dash.
  return `${club} · ${topicLabel}`;
}

async function fetchExistingTopicPacks() {
  const { data, error } = await supabase
    .from("quiz_packs")
    .select("id, name, status, metadata")
    .eq("type", "club")
    .not("metadata->>club_topic", "is", null);
  if (error) throw new Error(`Failed to fetch existing topic packs: ${error.message}`);
  return data ?? [];
}

async function fetchAllPublishedPackNames() {
  const { data, error } = await supabase
    .from("quiz_packs")
    .select("name")
    .eq("status", "published");
  if (error) throw new Error(`Failed to fetch published pack names: ${error.message}`);
  return (data ?? []).map((r) => r.name);
}

async function main() {
  console.log(COMMIT ? "*** COMMIT MODE — will write to the database ***" : "DRY RUN (default) — no writes will be made");
  console.log("");

  const clubs = await fetchInRotationClubs();
  if (clubs.length === 0) {
    console.error("No in-rotation clubs found (quiz_packs type=club, status=published, rotation_active=true). Aborting.");
    process.exit(1);
  }

  const existingTopicPacks = await fetchExistingTopicPacks();
  const existingKey = (club, topicSlug) =>
    existingTopicPacks.some(
      (p) => p.metadata?.club === club && p.metadata?.club_topic === topicSlug
    );

  const allPublishedNames = await fetchAllPublishedPackNames();
  const existingSlugs = new Set(allPublishedNames.map((n) => slugify(n)));

  const rows = [];
  let dealableTotal = 0;
  const toInsert = [];

  for (const club of clubs) {
    for (const topic of TOPICS) {
      const packName = buildPackName(club, topic.label);
      const packSlug = slugify(packName);

      if (existingKey(club, topic.slug)) {
        rows.push({ club, topic: topic.label, rawCount: "—", drawOk: "—", action: "skip existing" });
        continue;
      }

      let rawCount = 0;
      let questions = [];
      try {
        const draw = await runRealDraw(club, topic.slug);
        rawCount = draw.rawCount;
        questions = draw.questions;
      } catch (e) {
        rows.push({ club, topic: topic.label, rawCount: "err", drawOk: "no", action: `cannot deal (${e.message})` });
        continue;
      }

      const drawOk = questions.length === QUIZ_SIZE;

      if (!drawOk) {
        rows.push({ club, topic: topic.label, rawCount, drawOk: "no", action: "cannot deal" });
        continue;
      }

      dealableTotal++;
      rows.push({ club, topic: topic.label, rawCount, drawOk: "yes", action: "would insert" });

      // Slug collision check across ALL published packs (existing + ones we're about to add).
      if (existingSlugs.has(packSlug)) {
        console.warn(`WARNING: slug collision for "${packName}" (slug "${packSlug}") — skipping insert to avoid ambiguity.`);
        continue;
      }
      existingSlugs.add(packSlug);

      toInsert.push({
        name: packName,
        type: "club",
        parameter: club,
        questions: questions.map((q) => ({
          question: q.question,
          options: q.options,
          answer: q.answer,
          difficulty: q.difficulty,
          category: q.category,
        })),
        status: "published",
        rotation_active: false,
        is_custom: false,
        created_by: null,
        metadata: { club_page: true, club, club_topic: topic.slug },
      });
    }
  }

  // ── Print the table ────────────────────────────────────────────────────
  const colw = { club: 22, topic: 20, raw: 8, ok: 6, action: 24 };
  const pad = (s, w) => String(s).padEnd(w);
  console.log(
    pad("Club", colw.club) + pad("Topic", colw.topic) + pad("Raw", colw.raw) + pad("15?", colw.ok) + "Action"
  );
  console.log("-".repeat(colw.club + colw.topic + colw.raw + colw.ok + colw.action));
  for (const r of rows) {
    console.log(
      pad(r.club, colw.club) + pad(r.topic, colw.topic) + pad(r.rawCount, colw.raw) + pad(r.drawOk, colw.ok) + r.action
    );
  }
  console.log("");
  console.log(`Dealable total (real draw yields exactly ${QUIZ_SIZE}): ${dealableTotal} / ${clubs.length * TOPICS.length}`);
  console.log(`Rows queued to insert (after slug-collision check): ${toInsert.length}`);
  console.log("");

  if (!COMMIT) {
    console.log("Dry run complete. No rows were written. Re-run with --commit to write (founder approval required).");
    return;
  }

  if (toInsert.length === 0) {
    console.log("Nothing to insert.");
    return;
  }

  console.log(`Inserting ${toInsert.length} pack(s)...`);
  const { data: inserted, error } = await supabase.from("quiz_packs").insert(toInsert).select("id, name");
  if (error) {
    console.error("Insert failed:", error.message);
    process.exit(1);
  }
  console.log(`Inserted ${inserted?.length ?? 0} pack(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
