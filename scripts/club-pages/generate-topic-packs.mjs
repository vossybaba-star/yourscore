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
import { slugify, shuffle } from "../../src/lib/utils.ts";
import { fillToSize, pickDistinctFacts, dedupeByQuestionText } from "../../src/lib/questions.ts";

const args = process.argv.slice(2);
// Dry run is the DEFAULT. --commit is the only way to write anything.
const COMMIT = args.includes("--commit");

// --volumes[=category] mines a topic beyond its first pack: where a club has enough
// DISTINCT facts left over, it deals a second/third/fourth pack (II, III, IV) drawn
// only from facts no existing volume already used. Without the flag the script keeps
// its original behaviour of exactly one pack per club/topic.
const volumesArg = args.find((a) => a === "--volumes" || a.startsWith("--volumes="));
const VOLUMES = Boolean(volumesArg);
const VOLUMES_CATEGORY = volumesArg && volumesArg.includes("=") ? volumesArg.split("=")[1] : null;
// Beyond IV a club page turns into a wall of numbered packs; the supply doesn't reach
// that far today (Arsenal, the deepest, tops out at 4).
const MAX_VOLUMES = 4;
const ROMAN = { 1: "", 2: " II", 3: " III", 4: " IV" };

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
    // Volume mode has to see the WHOLE pool: it excludes everything earlier volumes
    // already used, so a 60-row window would hide the remaining facts entirely.
    .limit(VOLUMES ? 500 : QUIZ_SIZE * 4);
  if (error) throw new Error(`Fetch failed (${club}/${category}/${difficulty}): ${error.message}`);
  // MUST shuffle, exactly as generate-custom does before returning its pool. Everything
  // downstream (fillToSize, pickDistinctFacts) is greedy over pool order, so returning the
  // rows in PostgREST's order would build every pack from the oldest-written questions in
  // the bank and never deal the newest verified ones. These packs are permanent once they
  // carry scores, so baking in that bias is not recoverable by a rerun.
  return shuffle(data ?? []);
}

// Runs the REAL draw exactly as generate-custom does for the no-difficulty-filter
// path: pools fetched at full quiz width, fillToSize + shared usedFactKeys, then
// a text dedupe pass.
async function runRealDraw(club, category, excludeTexts = new Set()) {
  const [easyRowsAll, mediumRowsAll, hardRowsAll] = await Promise.all([
    fetchByDifficulty(club, category, "easy"),
    fetchByDifficulty(club, category, "medium"),
    fetchByDifficulty(club, category, "hard"),
  ]);
  // Drop anything an earlier volume already used. Existing packs embed their questions
  // with no id or fact_key (see PACK_COLS), so question TEXT is the only join we have.
  const keep = (rows) => rows.filter((r) => !excludeTexts.has(normText(r.question)));
  const easyRows = keep(easyRowsAll);
  const mediumRows = keep(mediumRowsAll);
  const hardRows = keep(hardRowsAll);
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

// Text is the only stable join between the bank and a pack's embedded questions.
const normText = (s) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function buildPackName(club, topicLabel, volume = 1) {
  // MIDDOT separator, never a dash. Volume I carries no suffix so the pack that is
  // already live keeps its exact name, slug and leaderboard.
  return `${club} · ${topicLabel}${ROMAN[volume] ?? ` ${volume}`}`;
}

async function fetchExistingTopicPacks() {
  const { data, error } = await supabase
    .from("quiz_packs")
    // `questions` too: volume mode must know which facts earlier volumes already spent.
    .select("id, name, status, metadata, questions")
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
      // Packs already live for this club+topic, and the question texts they spent.
      const priorPacks = existingTopicPacks.filter(
        (p) => p.metadata?.club === club && p.metadata?.club_topic === topic.slug,
      );
      const spentTexts = new Set(
        priorPacks.flatMap((p) => (p.questions ?? []).map((q) => normText(q.question))),
      );

      // Without --volumes: one pack per club/topic, unchanged behaviour.
      if (!VOLUMES) {
        if (priorPacks.length > 0) {
          rows.push({ club, topic: topic.label, rawCount: "—", drawOk: "—", action: "skip existing" });
          continue;
        }
      } else if (VOLUMES_CATEGORY && topic.slug !== VOLUMES_CATEGORY) {
        // Targeting one category: leave every other topic completely alone.
        continue;
      }

      // Volume mode keeps dealing until the leftover facts can't fill a pack.
      let volume = priorPacks.length + 1;
      let addedForThisTopic = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (volume > MAX_VOLUMES) break;

        const packName = buildPackName(club, topic.label, volume);
        const packSlug = slugify(packName);

        let rawCount = 0;
        let questions = [];
        try {
          const draw = await runRealDraw(club, topic.slug, spentTexts);
          rawCount = draw.rawCount;
          questions = draw.questions;
        } catch (e) {
          rows.push({ club, topic: topic.label, rawCount: "err", drawOk: "no", action: `cannot deal (${e.message})` });
          break;
        }

        if (questions.length !== QUIZ_SIZE) {
          // Only report the miss when nothing was added; otherwise the topic is simply exhausted.
          if (addedForThisTopic === 0 && priorPacks.length === 0) {
            rows.push({ club, topic: topic.label, rawCount, drawOk: "no", action: "cannot deal" });
          } else if (VOLUMES && addedForThisTopic === 0) {
            rows.push({ club, topic: `${topic.label} ${ROMAN[volume]?.trim() || volume}`, rawCount, drawOk: "no", action: "no leftover facts" });
          }
          break;
        }

        if (existingSlugs.has(packSlug)) {
          console.warn(`WARNING: slug collision for "${packName}" (slug "${packSlug}") — skipping insert to avoid ambiguity.`);
          break;
        }
        existingSlugs.add(packSlug);

        dealableTotal++;
        addedForThisTopic++;
        rows.push({
          club,
          topic: volume === 1 ? topic.label : `${topic.label}${ROMAN[volume] ?? ` ${volume}`}`,
          rawCount,
          drawOk: "yes",
          action: "would insert",
        });

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
          metadata: { club_page: true, club, club_topic: topic.slug, club_topic_volume: volume },
        });

        // Everything this volume used is off the table for the next one.
        for (const q of questions) spentTexts.add(normText(q.question));

        if (!VOLUMES) break; // single-pack mode never loops
        volume++;
      }
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
