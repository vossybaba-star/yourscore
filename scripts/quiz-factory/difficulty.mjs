/**
 * The difficulty model.
 *
 * Rules this encodes (founder-agreed, 2026-07-16):
 *
 * 1. Difficulty is assigned A PRIORI, from properties of the question itself. It is NEVER
 *    derived from how players actually answer. Live answers would measure the wrong thing:
 *    a club's questions are answered overwhelmingly by that club's fans, so accuracy tells
 *    you how well Arsenal fans know Arsenal, not how hard the question is — every club would
 *    converge on "easy". Difficulty that drifts also makes scores non-comparable over time,
 *    and a question everyone fails is often WRONG rather than hard.
 *    (times_answered/times_correct still have a job — as a QUALITY ALARM. High volume + near
 *    zero correct = flag for human review. That's a different system, not this one.)
 *
 * 2. THREE levels only: easy | medium | hard. The draw (`/api/quiz/start`) asks for exactly
 *    6 easy / 6 medium / 3 hard and its type is `"easy" | "medium" | "hard"` — it can never
 *    request expert/master. Tagging anything expert/master strands it: 1,101 of 2,447 club
 *    questions (45%) are currently unreachable for exactly this reason. Never write them.
 *
 * 3. The AUTHOR does not set difficulty. It has an incentive to hit the requested mix and it
 *    drifts (a run asked for 40% easy and delivered 25%). A separate rater does it, seeing
 *    only the question, its options, and the anchors.
 *
 * 4. ANCHORS make the scale stable. Without a fixed reference set, "medium" moves every time
 *    a prompt changes. Every rating is made relative to these.
 */

import { callClaude, parseJson, MODELS, usageOf } from "../lib/anthropic.mjs";

export const LEVELS = ["easy", "medium", "hard"];

/**
 * The calibration set. THIS DEFINES THE SCALE — edit deliberately, not casually, because
 * changing an anchor silently re-grades everything rated afterwards.
 */
export const ANCHORS = [
  // EASY — a casual fan who watches the highlights gets this.
  { difficulty: "easy", q: "Which club won the Premier League in the 2023/24 season?", a: "Manchester City", why: "The champion. The single most-reported fact of the season." },
  { difficulty: "easy", q: "Which club won the 2004/05 Champions League final?", a: "Liverpool", why: "Istanbul. Famous enough to survive two decades." },
  { difficulty: "easy", q: "Who finished as the Premier League's top scorer in the 2022/23 season, with 36 goals?", a: "Erling Haaland", why: "Golden Boot winner, record tally, recent." },
  { difficulty: "easy", q: "Which club did Arsenal beat in the 2019/20 FA Cup final?", a: "Chelsea", why: "A major final involving two huge clubs." },

  // MEDIUM — a proper fan who follows the league gets this.
  { difficulty: "medium", q: "Who was Arsenal's top scorer in the 2018/19 Premier League season?", a: "Pierre-Emerick Aubameyang", why: "Club-level top scorer: known to that club's fans, not to everyone." },
  { difficulty: "medium", q: "Which club did Liverpool beat in the 2018/19 Champions League final?", a: "Tottenham Hotspur", why: "A famous final, but the opponent is less recalled than the winner." },
  { difficulty: "medium", q: "Where did Arsenal finish in the 2019/20 Premier League season?", a: "8th", why: "A mid-table finish — memorable only if you followed that season." },
  { difficulty: "medium", q: "Which club won the Europa League in the 2018/19 season?", a: "Chelsea", why: "A secondary competition; well known but not headline." },

  // HARD — you need real depth.
  { difficulty: "hard", q: "How many points did Arsenal finish with in the 2015/16 Premier League season?", a: "71", why: "An exact points tally for a non-title season. Nobody remembers this." },
  { difficulty: "hard", q: "Who was Arsenal's top scorer in the 2021/22 Premier League season?", a: "Bukayo Saka", why: "A low-scoring season with no obvious focal striker — needs real recall." },
  { difficulty: "hard", q: "Who was Arsenal's top scorer in the 2020/21 Premier League season, with 13 goals?", a: "Alexandre Lacazette", why: "Unremarkable season, modest tally, easily confused with team-mates." },
  { difficulty: "hard", q: "How many points did Liverpool win the 2019/20 Premier League title with?", a: "99", why: "Famous season, but the exact number is a precise-recall test." },
];

const anchorText = () =>
  LEVELS.map((lvl) => {
    const rows = ANCHORS.filter((a) => a.difficulty === lvl)
      .map((a) => `  - "${a.q}" (answer: ${a.a}) — ${a.why}`)
      .join("\n");
    return `${lvl.toUpperCase()}:\n${rows}`;
  }).join("\n\n");

// ── Deterministic signals ──────────────────────────────────────────────────────
// Not a full formula — sanity guards on top of the rater, for the things that are simply
// measurable and where the rater is known to be unreliable.

const numeric = (s) => /^\d[\d\s,.]*$/.test(String(s ?? "").trim());
const numOf = (s) => Number(String(s).replace(/[^\d.]/g, ""));

/**
 * Are the options numbers packed tightly together? Four options within a few of each other
 * (88/89/90/91) is a precise-recall test however famous the fact; a wide spread
 * (26/42/68/91) can be reasoned out. Returns null when the options aren't numeric.
 */
export function numericTightness(options) {
  const vals = ["A", "B", "C", "D"].map((k) => options?.[k]);
  if (!vals.every(numeric)) return null;
  const ns = vals.map(numOf).sort((a, b) => a - b);
  const range = ns[3] - ns[0];
  const mean = ns.reduce((a, b) => a + b, 0) / 4;
  if (!mean) return null;
  return range / mean; // < ~0.15 ⇒ tight
}

/** The most recent season referenced, as a start year. "2019/20" or "2019-20" or "2019". */
export function seasonYear(question) {
  const years = [...String(question).matchAll(/\b(19|20)(\d{2})\b/g)].map((m) => Number(m[0]));
  return years.length ? Math.max(...years) : null;
}

const CURRENT_SEASON_START = 2025; // 2025/26 is the season just completed

/**
 * Guards applied on top of the rater's call. Each exists because it's objectively true
 * regardless of how the fact "feels":
 *   - a tightly-clustered numeric answer is never easy — it's precise recall
 *   - a fact 10+ seasons old is never easy — most current players didn't see it
 */
export function applyGuards(q, base) {
  let level = LEVELS.includes(base) ? base : "medium";
  const notes = [];

  const tight = numericTightness(q.options);
  if (tight !== null && tight < 0.15 && level === "easy") {
    level = "hard";
    notes.push("numeric options tightly clustered ⇒ precise recall, not easy");
  }

  const yr = seasonYear(q.question);
  if (yr && CURRENT_SEASON_START - yr >= 10 && level === "easy") {
    level = "medium";
    notes.push(`fact is ${CURRENT_SEASON_START - yr} seasons old ⇒ not easy for most players`);
  }

  return { difficulty: level, adjusted: notes.length > 0, notes };
}

// ── The rater ──────────────────────────────────────────────────────────────────

const RATER_SYSTEM = `You rate the difficulty of football quiz questions for a general football audience (people who follow the game casually to keenly — NOT superfans of one club).

You will be given reference questions with agreed difficulties. Rate every new question RELATIVE to those references.

Only three levels exist: easy, medium, hard.
- easy   — someone who watches highlights and follows the headlines gets this.
- medium — someone who properly follows the league or that club gets this.
- hard   — you need real depth or precise recall.

Judge by how many people would KNOW the answer, not by how obscure the wording is:
- Champions, trophy winners, Golden Boot winners and famous finals are EASY — everyone saw them.
- Club-level detail (a club's own top scorer, where they finished) is MEDIUM.
- Exact numbers, mid-table placings, and forgettable seasons are HARD.
- Older facts are harder than recent ones at the same level of fame.
- IMPORTANT: rate for a NEUTRAL fan, not a fan of the club in question. An Arsenal fan finds Arsenal detail easy; that does not make it easy.

Reply with ONLY a JSON array, one entry per question, in the same order:
[{ "i": 0, "difficulty": "easy" | "medium" | "hard", "reason": "brief" }]`;

/**
 * Rate a batch in ONE call (cheap — no web search, and batching amortises the anchors).
 * Returns the questions with difficulty set by the rater + deterministic guards.
 */
export async function rateBatch(questions, { model = MODELS.cheap } = {}) {
  if (!questions.length) return { rated: [], usage: { input: 0, output: 0 } };

  const list = questions
    .map((q, i) => `${i}. ${q.question}\n   A) ${q.options.A}  B) ${q.options.B}  C) ${q.options.C}  D) ${q.options.D}\n   (correct: ${q.options[q.answer]})`)
    .join("\n\n");

  const resp = await callClaude({
    model,
    system: RATER_SYSTEM,
    messages: [{ role: "user", content: `REFERENCE QUESTIONS (the agreed scale):\n\n${anchorText()}\n\n───\n\nRate these ${questions.length} questions:\n\n${list}` }],
    maxTokens: 4096,
    stage: "difficulty",
  });

  let ratings = [];
  try {
    ratings = parseJson(resp);
  } catch {
    ratings = [];
  }
  const byIndex = new Map((Array.isArray(ratings) ? ratings : []).map((r) => [r.i, r]));

  const rated = questions.map((q, i) => {
    const r = byIndex.get(i);
    // No rating back ⇒ medium, then let the guards pull it. Never silently trust the author's.
    const guarded = applyGuards(q, r?.difficulty ?? "medium");
    return { ...q, difficulty: guarded.difficulty, _difficultyReason: r?.reason ?? null, _difficultyAdjusted: guarded.notes };
  });

  return { rated, usage: usageOf(resp) };
}
