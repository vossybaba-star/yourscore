/**
 * Stage 1 — GROUNDED authoring.
 *
 * The distinction that matters: we do NOT ask the model to "write 15 questions about
 * Arsenal". We make it search for source material first and write questions FROM what it
 * found, citing the source for each one. That is what source='data-grounded' means, and
 * data-grounded is the only cohort that survived the great retirement — all 31,541
 * free-authored 'generated' questions were binned.
 *
 * We deliberately OVERGENERATE. The gate drops questions (that is its job), and a pack
 * needs exactly 15 — so authoring exactly 15 guarantees a short pack. We author ~2x and
 * let the gate cut it down.
 */

import { callClaude, parseJson, MODELS, WEB_SEARCH_TOOL, usageOf } from "../lib/anthropic.mjs";

/**
 * Difficulty mix of a finished 15-question pack. THREE levels only — `/api/quiz/start` can
 * only ever request easy/medium/hard, so an `expert` question is stranded and never served.
 */
export const PACK_MIX = { easy: 4, medium: 8, hard: 3 };

/** Difficulty mix for BANK fill. The bank is savagely hard today — 5% easy, and 37 of 45
 *  clubs can't even fill the 6 easy slots the draw asks for — so bank fill skews easy. */
export const BANK_MIX = { easy: 0.4, medium: 0.4, hard: 0.2 };

// ── Facts-first authoring: the shared rules ────────────────────────────────────
// Difficulty is NOT requested from the author — it claims whatever hits the brief and drifts
// (a run asked for 40% easy, delivered 25%). A separate rater assigns it (difficulty.mjs).
const QUESTION_RULES = `HARD RULES — a question breaking any of these is thrown away, so do not write it:
- SPECIFIC. Anyone could read this at any time with no context. Always name the club, the competition and the season. We hold league AND European records for the same club and season, so "top scorer in 2015/16" is ambiguous — write "in the 2015/16 Premier League season" or "in the 2015/16 Champions League". Never "they", "the club", "that season" or "the final" without saying which.
- NEVER depends on when it is read. Banned: "current", "currently", "now", "this season", "recently", "still", "reigning", "latest". "Who is Arsenal's current captain?" is worthless — it's wrong the moment he's replaced. Ask about FIXED events: a named season, a named final, a named year.
- The three wrong options must be the SAME KIND of thing as the right one (all players, or all clubs, or all numbers). A lone odd-one-out gives the answer away.
- No "all of the above" / "none of the above". No two options the same.
- Vary the correct letter. Do not put the answer in A every time.
- Write the ANSWER first, then build plausible distractors around it. A distractor should tempt someone who half-knows the topic.`;

const FACTS_SYSTEM = `You are a football quiz author. You are given VERIFIED FACTS and you write questions from them.

You do NOT search the web. You do NOT use outside knowledge. If it is not in the facts you were given, you cannot ask about it — inventing detail is the single worst thing you can do here.

Reply with ONLY a JSON array:
[{
  "question": "...",
  "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "answer": "A",
  "difficulty": "easy" | "medium" | "hard",
  "fact_ref": 7,
  "source_quote": "the text of the fact you built this from",
  "source_url": "that fact's source"
}]

"fact_ref" is REQUIRED: the NUMBER of the fact you built the question from. It is how we avoid
putting two questions from the same fact into one quiz, so it must be accurate. Writing several
questions from one fact is fine and encouraged — just always say which fact.

(Your "difficulty" is a rough first guess only — it will be re-rated independently. Do not agonise over it, and do not skew your questions to hit a quota.)

${QUESTION_RULES}`;

const SYSTEM = `You are a football quiz author. You write questions that are VERIFIABLY TRUE and will still be true in five years.

Method — follow it exactly:
1. FIRST search the web for source material on the topic. Reference pages: honours lists, record appearance/goalscoring tables, match reports, final line-ups.
2. THEN write questions from what you actually found. Every question must trace to something you read. If you did not find it, do not write it.

Reply with ONLY a JSON array:
[{
  "question": "...",
  "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "answer": "A",
  "difficulty": "easy" | "medium" | "hard",
  "source_url": "the page you took this from",
  "source_quote": "the specific line or data point that proves the answer"
}]

(Your "difficulty" is a rough first guess only — it will be re-rated independently.)

- If you write about a record or an all-time superlative, that is allowed, but it must be true TODAY and you must have checked.

${QUESTION_RULES}`;

/**
 * Author candidate questions for a theme (pack authoring).
 * Returns { candidates, usage }. Overgenerates by `overGenerate`x the 15 needed.
 */
export async function authorPack({ theme, angle, count = 26, model = MODELS.author } = {}) {
  const resp = await callClaude({
    model,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Theme: ${theme}
What it should cover: ${angle}

Search for source material, then write ${count} football quiz questions on this theme.

Aim for roughly this spread: ${Math.round(count * 0.27)} easy, ${Math.round(count * 0.45)} medium, ${Math.round(count * 0.2)} hard, ${Math.round(count * 0.08)} expert.

Write ${count}, not 15 — many will be rejected by fact-checking, and I need enough survivors to build a full pack.`,
    }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 32000,
    stage: "author",
  });

  return { candidates: normalize(parseJson(resp), { entity: theme, entity_type: "records" }), usage: usageOf(resp) };
}

/**
 * Author candidate questions for the BANK (Ship 2 — club/category fill).
 * entity is the exact club string already used in questions.entity, e.g. "Arsenal".
 */
export async function authorBank({ entity, entityType = "club", category, categoryBrief, count = 30, model = MODELS.author } = {}) {
  const resp = await callClaude({
    model,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Club/topic: ${entity}
Category: ${category} — ${categoryBrief}

Search for source material, then write ${count} quiz questions about ${entity} in this category ONLY.

Difficulty spread — this matters, read it carefully: ${Math.round(count * BANK_MIX.easy)} EASY, ${Math.round(count * BANK_MIX.medium)} medium, ${Math.round(count * BANK_MIX.hard)} hard.
The existing question bank is far too hard — it has almost no easy questions, and new players are bouncing off it. Easy means a casual ${entity} fan answers it without thinking. Do not quietly make the "easy" ones medium.

Write ${count}, not fewer — many will be rejected by fact-checking.`,
    }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 32000,
    stage: "author",
  });

  return {
    candidates: normalize(parseJson(resp), { entity, entity_type: entityType, category }),
    usage: usageOf(resp),
  };
}

/**
 * Author BANK questions from a verified fact sheet — NO web search. THE authoring path.
 *
 * Facts-first: the model is handed already-verified facts (SportMonks league/European record,
 * plus web-researched facts that passed the source-tier gate) and writes questions straight
 * from them. It cannot invent, because it isn't looking anything up — the worst it can do is
 * misread a line, which the consistency check catches without a web search.
 *
 * Difficulty is deliberately NOT requested here. The author has an incentive to claim it hit
 * the mix and it drifts (a run asked for 40% easy and delivered 25%), so a separate rater
 * assigns it afterwards — see difficulty.mjs.
 */
export async function authorFromFacts({ entity, category, categoryBrief, factsText, count = 30, model = MODELS.author } = {}) {
  const resp = await callClaude({
    model,
    system: FACTS_SYSTEM,
    messages: [{
      role: "user",
      content: `Club: ${entity}
Category: ${category} — ${categoryBrief}

Write ${count} quiz questions about ${entity} using ONLY the verified facts below. Do NOT search the web. Do NOT use outside knowledge. Every question must trace to a specific numbered fact.

VERIFIED FACTS:
${factsText}

SPECIFICITY — this is the rule that matters most. Anyone could read these at any time, with no context:
- ALWAYS name the club, the competition AND the season. We hold both league and European records for the same club and season, so "${entity}'s top scorer in 2015/16" is ambiguous — league or Europe? Write "in the 2015/16 Premier League season" or "in the 2015/16 Champions League".
- Never write "they", "the club", "that season" or "the final" without saying which.
- A question must be answerable by someone who has read nothing else.

QUESTION SHAPE — read this carefully, it is the thing we most often get wrong.

The same fact can make an easy question or a hard one depending on what you ask:
- "Arsenal beat Chelsea 2-1 in the 2020 FA Cup final" → "Which club did Arsenal beat in the 2019/20 FA Cup final?" is EASY (recognition).
- The same fact → "How many goals did Arsenal score in the 2019/20 FA Cup final?" is HARD (precise recall).

A "how many" question is NEVER easy, however famous the event. Counting and exact numbers are precision tests.

So write a spread of shapes:
- Plenty of RECOGNITION questions — "which club…", "who scored…", "who did they beat…" — built on the MOST FAMOUS facts on the sheet. These are the questions we are badly short of: our bank is only 5% easy and new players bounce off it. Do not skip these because they feel too obvious. Obvious is the point.
- Some DETAIL questions a fan who follows the club would get.
- Only a FEW "how many"/exact-number questions. They are inherently hard, so a sheet turned entirely into number questions produces a brutal quiz.

VARIETY: don't repeat one shape. Spread across the facts — trophies, finals, records, matches, milestones. Fifteen questions all of the form "who was top scorer in season X" is a bad pack.

For each question set "source_quote" to the numbered fact you used, and "source_url" to that fact's source.
Write ${count} — some will still be rejected.`,
    }],
    // No web search tool — authoring from facts is token-only. This is the cost saving.
    maxTokens: 32000,
    stage: "author-facts",
  });

  return {
    candidates: normalize(parseJson(resp), { entity, entity_type: "club", category }),
    usage: usageOf(resp),
  };
}

/** @deprecated Kept only so older callers don't break — use authorFromFacts (facts-first). */
export const authorBankGrounded = authorFromFacts;

/** Shape the model's array into our question rows. Malformed entries are dropped by the gate. */
function normalize(arr, extra) {
  if (!Array.isArray(arr)) return [];
  return arr.map((q) => ({
    question: String(q?.question ?? "").trim(),
    options: q?.options ?? {},
    answer: String(q?.answer ?? "").trim().toUpperCase(),
    difficulty: String(q?.difficulty ?? "").trim().toLowerCase(),
    // Which numbered fact this came from (1-based). The caller maps it to that fact's stable
    // key — we never trust the model's paraphrase of the fact, only its pointer to ours.
    fact_ref: Number.isFinite(Number(q?.fact_ref)) ? Number(q.fact_ref) : null,
    // The author's own citation. NOT trusted — the check re-derives the answer independently.
    // Kept only so a reviewer can see what the author read.
    author_source: q?.source_url ?? null,
    ...extra,
  }));
}

/**
 * Cut verified questions down to exactly the pack mix. Returns null if there aren't enough
 * survivors — a short pack is not shippable (seed validation demands exactly 15), and
 * padding it with the wrong difficulty would quietly wreck the difficulty curve.
 */
export function selectPack(verified, mix = PACK_MIX) {
  const byDiff = {};
  for (const q of verified) (byDiff[q.difficulty] ??= []).push(q);

  const picked = [];
  const shortfall = {};
  for (const [diff, n] of Object.entries(mix)) {
    const have = byDiff[diff] ?? [];
    picked.push(...have.slice(0, n));
    if (have.length < n) shortfall[diff] = n - have.length;
  }

  const target = Object.values(mix).reduce((a, b) => a + b, 0);

  // Backfill a shortfall from the nearest difficulty rather than failing outright — but
  // only from what actually survived verification.
  if (picked.length < target) {
    const used = new Set(picked.map((q) => q.question));
    const spare = verified.filter((q) => !used.has(q.question));
    picked.push(...spare.slice(0, target - picked.length));
  }

  if (picked.length < target) return { pack: null, shortfall, got: picked.length, target };
  return { pack: picked.slice(0, target), shortfall, got: target, target };
}
