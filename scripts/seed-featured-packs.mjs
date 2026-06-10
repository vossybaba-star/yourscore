/**
 * Seed the three World Cup "Featured This Week" quiz packs into quiz_packs.
 *
 * These render in the Featured row on the Home dashboard (src/app/page.tsx →
 * featured = true, status = 'published', ordered by featured_order) and are
 * playable at /challenges/<slug> via src/app/challenges/[slug]/page.tsx.
 *
 * Question shape MUST match RawQuestion in that player:
 *   { question, options: {A,B,C,D}, answer: "A|B|C|D", difficulty, category }
 *
 * Each pack's card icon (emoji) is stored in the existing quiz_packs.metadata
 * jsonb (metadata.icon) — no schema migration required.
 *
 * Usage:
 *   node scripts/seed-featured-packs.mjs            # DRY RUN — prints, writes nothing
 *   node scripts/seed-featured-packs.mjs --commit   # writes to the live database
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mznvuswzgkaupvaqznkm.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMIT = process.argv.includes("--commit");

if (COMMIT && !SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY env var required for --commit");
  process.exit(1);
}

const supabase = SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

// ── Pack definitions ─────────────────────────────────────────────────────────
// type = "records" so they surface under the /challenges "Records" tab and use
// the 🏆 fallback styling; the cover image is what actually shows on the card.
// Names are kept slug-safe (no apostrophes / intra-word hyphens) so the card
// link and the [slug] matcher agree.

const PACKS = [
  {
    name: "Messi vs Ronaldo: The World Cup Last Dance",
    type: "records",
    parameter: "Messi vs Ronaldo",
    featured_order: 1,
    icon: "🐐",
    questions: [
      { difficulty: "easy",   category: "head_to_head", question: "Which of these two has actually won a World Cup?", options: { A: "Lionel Messi", B: "Cristiano Ronaldo", C: "Both of them", D: "Neither of them" }, answer: "A" },
      { difficulty: "easy",   category: "messi",        question: "In which year did Messi win the World Cup with Argentina?", options: { A: "2010", B: "2014", C: "2018", D: "2022" }, answer: "D" },
      { difficulty: "medium", category: "messi",        question: "How many goals did Messi score across the 2022 World Cup?", options: { A: "5", B: "6", C: "7", D: "8" }, answer: "C" },
      { difficulty: "medium", category: "ronaldo",      question: "Ronaldo became the first man ever to score at how many different World Cups?", options: { A: "3", B: "4", C: "5", D: "6" }, answer: "C" },
      { difficulty: "hard",   category: "messi",        question: "Messi holds the record for most matches played at World Cups. How many?", options: { A: "24", B: "25", C: "26", D: "27" }, answer: "C" },
      { difficulty: "hard",   category: "ronaldo",      question: "How many career World Cup goals has Ronaldo scored (through 2022)?", options: { A: "6", B: "7", C: "8", D: "10" }, answer: "C" },
      { difficulty: "expert", category: "messi",        question: "Messi is the only player to win the World Cup Golden Ball twice. In which two years?", options: { A: "2010 and 2022", B: "2014 and 2022", C: "2014 and 2018", D: "2018 and 2022" }, answer: "B" },
      { difficulty: "expert", category: "messi",        question: "Whom did Messi overtake for most World Cup appearances in the 2022 final?", options: { A: "Lothar Matthaus", B: "Paolo Maldini", C: "Diego Maradona", D: "Miroslav Klose" }, answer: "A" },
      { difficulty: "medium", category: "messi",        question: "Whom did Messi's Argentina beat in the 2022 final, on penalties?", options: { A: "France", B: "Brazil", C: "Croatia", D: "Netherlands" }, answer: "A" },
      { difficulty: "master", category: "ronaldo",      question: "Against which team did Ronaldo score his first World Cup goal, back in 2006?", options: { A: "Iran", B: "Angola", C: "Mexico", D: "Netherlands" }, answer: "A" },
    ],
  },
  {
    name: "World Cup 2026: The Big Kickoff",
    type: "records",
    parameter: "World Cup 2026",
    featured_order: 2,
    icon: "🌎",
    questions: [
      { difficulty: "easy",   category: "format",  question: "How many teams are at the 2026 World Cup, a tournament record?", options: { A: "32", B: "40", C: "48", D: "64" }, answer: "C" },
      { difficulty: "easy",   category: "hosts",   question: "Which trio of nations is co-hosting the 2026 World Cup?", options: { A: "USA, Canada and Mexico", B: "USA, Mexico and Brazil", C: "USA and Canada", D: "Canada, Mexico and Costa Rica" }, answer: "A" },
      { difficulty: "medium", category: "fixtures", question: "Hosts Mexico open the tournament against which side?", options: { A: "South Africa", B: "USA", C: "Canada", D: "Brazil" }, answer: "A" },
      { difficulty: "medium", category: "venues",  question: "The 2026 opening match is staged at which iconic stadium?", options: { A: "MetLife Stadium", B: "Estadio Azteca", C: "Wembley", D: "Maracana" }, answer: "B" },
      { difficulty: "hard",   category: "format",  question: "How many total matches will the 2026 tournament feature, up from 64?", options: { A: "80", B: "96", C: "104", D: "128" }, answer: "C" },
      { difficulty: "hard",   category: "format",  question: "The 48 teams are split into how many groups?", options: { A: "8", B: "12", C: "16", D: "6" }, answer: "B" },
      { difficulty: "expert", category: "format",  question: "The expanded format adds a brand-new knockout round before the last 16. What is it called?", options: { A: "Round of 32", B: "Round of 24", C: "Play-in round", D: "Preliminary final" }, answer: "A" },
      { difficulty: "expert", category: "venues",  question: "Where and when is the 2026 World Cup final?", options: { A: "SoFi Stadium, 13 July", B: "MetLife Stadium (New Jersey), 19 July", C: "Rose Bowl, 4 July", D: "Estadio Azteca, 19 July" }, answer: "B" },
      { difficulty: "medium", category: "fixtures", question: "The USA open their campaign on 12 June at SoFi Stadium against whom?", options: { A: "Paraguay", B: "Australia", C: "Turkiye", D: "Canada" }, answer: "A" },
      { difficulty: "expert", category: "format",  question: "Besides the 12 group winners and 12 runners-up, how many best third-placed teams reach the Round of 32?", options: { A: "4", B: "6", C: "8", D: "12" }, answer: "C" },
    ],
  },
  {
    name: "World Cup Immortals: All Time Records",
    type: "records",
    parameter: "World Cup History",
    featured_order: 3,
    icon: "🏆",
    questions: [
      { difficulty: "easy",   category: "titles",  question: "Which nation has won the most World Cups, with 5 titles?", options: { A: "Brazil", B: "Germany", C: "Italy", D: "Argentina" }, answer: "A" },
      { difficulty: "medium", category: "titles",  question: "Germany and Italy are tied on how many World Cup titles each?", options: { A: "3", B: "4", C: "5", D: "2" }, answer: "B" },
      { difficulty: "medium", category: "titles",  question: "How many World Cups has Argentina won?", options: { A: "2", B: "3", C: "4", D: "1" }, answer: "B" },
      { difficulty: "hard",   category: "scorers", question: "Who is the all-time leading scorer in World Cup history, with 16 goals?", options: { A: "Ronaldo Nazario", B: "Pele", C: "Miroslav Klose", D: "Just Fontaine" }, answer: "C" },
      { difficulty: "expert", category: "scorers", question: "Whom did Klose surpass for that all-time scoring record, in 2014?", options: { A: "Ronaldo Nazario", B: "Gerd Muller", C: "Pele", D: "Gabriel Batistuta" }, answer: "A" },
      { difficulty: "expert", category: "scorers", question: "Which Frenchman holds the record for most goals at a single World Cup, with 13 in 1958?", options: { A: "Kylian Mbappe", B: "Just Fontaine", C: "Michel Platini", D: "Thierry Henry" }, answer: "B" },
      { difficulty: "master", category: "titles",  question: "Brazil's five titles came in 1958, 1962, 1970, 1994 and which other year?", options: { A: "1998", B: "2002", C: "2006", D: "1990" }, answer: "B" },
      { difficulty: "master", category: "titles",  question: "Argentina's 2022 triumph ended a World Cup title drought of how many years?", options: { A: "28", B: "32", C: "36", D: "40" }, answer: "C" },
      { difficulty: "hard",   category: "legends", question: "Who is the only player in history to win three World Cups?", options: { A: "Diego Maradona", B: "Pele", C: "Franz Beckenbauer", D: "Ronaldo Nazario" }, answer: "B" },
      { difficulty: "expert", category: "legends", question: "Pele is also the youngest World Cup winner ever. How old was he in 1958?", options: { A: "16", B: "17", C: "18", D: "19" }, answer: "B" },
    ],
  },
];

// ── Validation ───────────────────────────────────────────────────────────────

function validate(pack) {
  const errs = [];
  const valdiff = ["easy", "medium", "hard", "expert", "master"];
  if (!pack.name || !pack.type || !pack.parameter) errs.push("missing name/type/parameter");
  pack.questions.forEach((q, i) => {
    const n = `Q${i + 1}`;
    if (!q.question) errs.push(`${n}: empty question`);
    if (!q.options || !["A", "B", "C", "D"].every((k) => q.options[k])) errs.push(`${n}: needs 4 options A-D`);
    if (!["A", "B", "C", "D"].includes(q.answer)) errs.push(`${n}: answer must be A-D`);
    if (!valdiff.includes(q.difficulty)) errs.push(`${n}: bad difficulty '${q.difficulty}'`);
  });
  return errs;
}

// ── Run ──────────────────────────────────────────────────────────────────────

async function upsertPack(pack) {
  const row = {
    type: pack.type,
    name: pack.name,
    parameter: pack.parameter,
    questions: pack.questions,
    // question_count is a generated column in prod — do not write it.
    status: "published",
    source: "system",
    featured: true,
    featured_order: pack.featured_order,
    // rotation_active gates visibility in the challenges/lobby pack lists.
    rotation_active: true,
    metadata: { icon: pack.icon },
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("quiz_packs")
    .select("id")
    .eq("name", pack.name)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from("quiz_packs").update(row).eq("id", existing.id);
    if (error) throw error;
    return { action: "updated", id: existing.id };
  }
  const { data, error } = await supabase.from("quiz_packs").insert(row).select("id").single();
  if (error) throw error;
  return { action: "inserted", id: data.id };
}

async function main() {
  let bad = false;
  for (const pack of PACKS) {
    const errs = validate(pack);
    console.log(`\n• ${pack.name}`);
    console.log(`  type=${pack.type}  order=${pack.featured_order}  questions=${pack.questions.length}  icon=${pack.icon}`);
    if (errs.length) { bad = true; errs.forEach((e) => console.log(`  ✗ ${e}`)); }
    else console.log(`  ✓ valid`);
  }
  if (bad) { console.error("\nValidation failed — nothing written."); process.exit(1); }

  if (!COMMIT) {
    console.log(`\nDRY RUN — no database writes. Re-run with --commit to publish.`);
    return;
  }

  console.log(`\nWriting to ${SUPABASE_URL} ...`);
  for (const pack of PACKS) {
    const res = await upsertPack(pack);
    console.log(`  ${res.action}: ${pack.name} (${res.id})`);
  }
  console.log(`\nDone. ${PACKS.length} featured packs published.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
