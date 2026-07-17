/**
 * THE VERIFICATION GATE. Shared by the themed-pack factory and the bank filler.
 *
 * ── Why this file is the most important one in the factory ────────────────────
 * The bank currently holds 2,823 active questions and 31,541 RETIRED ones — that is
 * every single question ever written with source='generated'. The entire AI-authored
 * cohort was nuked for quality; only source='data-grounded' survived. Any factory that
 * just asks a model for trivia recreates that pile. So nothing reaches the bank or a
 * pack without passing here.
 *
 * Three stages, cheapest first:
 *
 *   Stage 0  deterministic, free, no model call
 *            schema · temporal-claim rejection · option sanity · dedupe (batch + live bank)
 *   Stage 2  independent verification, one model call per surviving question
 *            a FRESH context that never saw the authoring prompt must independently derive
 *            the same answer AND cite a source. Disagreement or no source ⇒ DROPPED.
 *   Stage 3  founder review (a 10% sample surfaced with citations in /admin/quiz) — not here.
 *
 * (There is no "Stage 1" in this file: Stage 1 is *grounded authoring*, which lives in
 * author.mjs. The numbering is kept so the stages line up with the plan.)
 *
 * A dropped question is a SUCCESS, not a failure. The drop rate is the health metric:
 * if we generate 200 and 60 survive, the gate is working. If almost nothing drops, the
 * gate is theatre and something is wrong.
 */

import { createClient } from "@supabase/supabase-js";
import { norm, isNearDuplicate } from "../lib/question-text.mjs";
import { callClaude, parseJson, textOf, MODELS, WEB_SEARCH_TOOL, usageOf } from "../lib/anthropic.mjs";

const LETTERS = ["A", "B", "C", "D"];
// THREE levels only. `/api/quiz/start` draws 6 easy / 6 medium / 3 hard and its type is
// `"easy" | "medium" | "hard"` — it can never ask for expert/master, so anything tagged that
// way is stranded and never served (1,101 of 2,447 club rows already are). The DB CHECK still
// permits the legacy values for the old rows; the factory must never write them.
const ALLOWED_DIFF = ["easy", "medium", "hard"];

// ─────────────────────────────────────────────────────────────────────────────
// Stage 0a — temporal-claim rejection
//
// This is the #1 failure mode and it has bitten before: the model states STALE facts
// as current truth (it once had a manager still at a club he had already left). A
// question whose answer depends on "now" is wrong the moment the world moves, and it
// rots silently — nobody notices until a player does.
//
// Three tiers, because a blanket ban on present tense would gut the Legends category:
//
//   TIER 1  time-relative language ("currently", "this season", "still") ⇒ REJECT outright.
//           There is no anchoring that saves these; they mean "at read time".
//   TIER 2  present-tense state ("plays for", "is the manager") ⇒ REJECT unless the
//           question is explicitly anchored to a year or season.
//   TIER 3  all-time superlatives ("record appearance maker") ⇒ ALLOW, but they are
//           marked time-sensitive so Stage 2 must confirm the fact holds TODAY and the
//           verification note carries a checked-on date. You cannot make "all-time top
//           scorer" immune to change — you can only date-stamp it and re-check it later.
// ─────────────────────────────────────────────────────────────────────────────

const TIER1_RELATIVE = [
  /\bcurrent(ly)?\b/i, /\bnow\b/i, /\btoday\b/i, /\bpresently\b/i, /\bat present\b/i,
  /\bthis (season|year|month|week|campaign)\b/i,
  /\brecent(ly)?\b/i, /\blately\b/i, /\blatest\b/i, /\bstill\b/i,
  /\bso far\b/i, /\bto date\b/i, /\bthis term\b/i, /\bat the moment\b/i,
  /\breigning\b/i, /\bnew(est)? signing\b/i,
];

const TIER2_PRESENT_STATE = [
  /\bplays? for\b/i, /\bmanages?\b/i, /\bis the (manager|head coach|captain|owner|chairman)\b/i,
  /\bwho is the\b/i, /\bwho are the\b/i, /\bis captained by\b/i,
  /\bwears? the\b.*\bshirt\b/i, /\bis signed (to|for)\b/i,
];

// Anchors that pin a question to a fixed point in time.
const ANCHORED = [
  /\b(19|20)\d{2}\b/,                 // 1998, 2024
  /\b(19|20)\d{2}[/–-]\d{2}\b/,       // 2023/24, 2023-24
  /\bas of\b/i,
];

// All-time superlatives: allowed, but flagged so Stage 2 must confirm they hold today.
const TIER3_SUPERLATIVE = [
  /\ball[- ]time\b/i, /\brecord\b/i, /\bmost\b/i, /\bhighest\b/i, /\bleading\b/i,
  /\bfirst\b/i, /\bonly\b/i, /\bever\b/i,
];

const matches = (patterns, s) => patterns.find((p) => p.test(s)) ?? null;

export function checkTemporal(question) {
  const q = String(question ?? "");
  const anchored = ANCHORED.some((p) => p.test(q));

  const t1 = matches(TIER1_RELATIVE, q);
  if (t1) {
    return { ok: false, reason: `temporal: time-relative phrasing ${t1} — answer depends on when it is read` };
  }

  const t2 = matches(TIER2_PRESENT_STATE, q);
  if (t2 && !anchored) {
    return { ok: false, reason: `temporal: present-tense state ${t2} with no year/season anchor` };
  }

  const timeSensitive = !anchored && TIER3_SUPERLATIVE.some((p) => p.test(q));
  return { ok: true, timeSensitive };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 0a2 — SPECIFICITY (founder rule: "anyone could be reading these at any time")
//
// A question must stand alone on two axes. Time is handled by checkTemporal above. This is
// SCOPE: now that we hold Premier League AND European data for the same club and season,
// "Arsenal's top scorer in 2015/16" is ambiguous — league or Europe? Different answers.
// Liverpool's 2004/05 is a Champions League fact; their 2015/16 is a Europa League one.
// Same club, same shape, different trophy.
//
// So: any question whose answer depends on WHICH competition must name the competition.
// A vague question is accidentally hard — hard because it's unclear, not because the fact is
// obscure — which corrupts the difficulty scale. Specificity protects it.
// ─────────────────────────────────────────────────────────────────────────────

const COMPETITION_NAMED = /\b(premier league|champions league|europa league|europa conference|conference league|uefa super cup|super cup|fa cup|league cup|carabao cup|efl cup|world cup|euros|european championship|championship|community shield|cup winners' cup|uefa cup|first division)\b/i;

// Phrases whose answer changes depending on the competition. "Top scorer" in the league is a
// different player from "top scorer" in Europe; "finished 2nd" is meaningless without a table.
const SCOPE_DEPENDENT = /\b(top scorer|leading scorer|top goalscorer|finished|finish|points|appearances|clean sheets|goals? did|scored the most|won the (title|league)|table)\b/i;

// A season reference implies a competition context.
const SEASON_REF = /\b(19|20)\d{2}\s*[/–-]\s*\d{2}\b|\bin (the )?(19|20)\d{2}\b|\bseason\b|\bcampaign\b/i;

export function checkSpecificity(question) {
  const q = String(question ?? "");
  const named = COMPETITION_NAMED.test(q);

  if (SCOPE_DEPENDENT.test(q) && !named) {
    return { ok: false, reason: "specificity: scope-dependent (top scorer / finish / points) without naming the competition — league or Europe?" };
  }
  if (SEASON_REF.test(q) && SCOPE_DEPENDENT.test(q) && !named) {
    return { ok: false, reason: "specificity: names a season but not the competition" };
  }
  // Bare pronouns with no club named — "they", "the club" — can't stand alone.
  if (/^\s*(who|what|which|how many)\b[^?]*\b(they|them|their|the club|the team)\b/i.test(q) && !/\b[A-Z][a-z]+\b/.test(q.replace(/^(Who|What|Which|How)\b/, ""))) {
    return { ok: false, reason: "specificity: refers to 'they'/'the club' without naming it" };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 0b — schema + option sanity
// ─────────────────────────────────────────────────────────────────────────────

const HEDGE_OPTIONS = [/\ball of the above\b/i, /\bnone of the above\b/i, /\bboth\b.*\band\b/i];

export function checkShape(q) {
  if (!q?.question || typeof q.question !== "string") return { ok: false, reason: "shape: empty question" };
  if (!q.options || !LETTERS.every((k) => typeof q.options[k] === "string" && q.options[k].trim()))
    return { ok: false, reason: "shape: needs four non-empty options A-D" };
  if (!LETTERS.includes(q.answer)) return { ok: false, reason: `shape: answer must be A-D, got ${JSON.stringify(q.answer)}` };
  if (!ALLOWED_DIFF.includes(q.difficulty)) return { ok: false, reason: `shape: bad difficulty '${q.difficulty}'` };

  const vals = LETTERS.map((k) => norm(q.options[k]));
  if (new Set(vals).size !== 4) return { ok: false, reason: "options: two options are the same" };

  const hedge = LETTERS.find((k) => HEDGE_OPTIONS.some((p) => p.test(q.options[k])));
  if (hedge) return { ok: false, reason: `options: hedge option in ${hedge} ("all/none of the above")` };

  // Type consistency: a lone non-numeric option among numbers is a giveaway, and vice
  // versa — the distractors must be the same KIND of thing as the answer.
  const numeric = vals.map((v) => /^\d[\d\s,.-]*$/.test(v));
  const numCount = numeric.filter(Boolean).length;
  if (numCount !== 0 && numCount !== 4)
    return { ok: false, reason: `options: mixed types — ${numCount}/4 numeric, the odd one out is a giveaway` };

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 0c — dedupe against the batch AND the live bank
//
// The bank has a PARTIAL UNIQUE INDEX on (entity, normalized(question)) WHERE status='active'
// (migration 67). An unhandled near-dup insert therefore 500s. We must dedupe BEFORE insert
// rather than letting the DB be the guard.
// ─────────────────────────────────────────────────────────────────────────────

/** Every active bank question for these entities, paginated past PostgREST's 1000-row cap. */
export async function loadBank(supabase, entities) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("questions")
      .select("id, entity, question, options, answer")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (entities?.length) q = q.in("entity", entities);
    const { data, error } = await q;
    if (error) throw new Error(`loadBank: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Exact (normalized text) or near-duplicate (Jaccard) against the bank slice for this entity. */
export function findDuplicate(candidate, bank, threshold = 0.75) {
  const key = norm(candidate.question);
  for (const existing of bank) {
    if (candidate.entity && existing.entity && candidate.entity !== existing.entity) continue;
    if (norm(existing.question) === key) return { existing, kind: "exact" };
    if (isNearDuplicate(candidate, existing, threshold)) return { existing, kind: "near" };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — independent verification
//
// A SEPARATE model call with a FRESH context. It is shown the question, the four options
// and NOTHING about how they were authored — critically, it is NOT told which option the
// author claimed was correct, so it cannot rubber-stamp. It must search, derive an answer
// itself, and cite a URL. We then compare.
//
// This is the whole point: an author asked "is this right?" says yes. An independent
// solver asked "what is the answer?" disagrees when the author was wrong.
// ─────────────────────────────────────────────────────────────────────────────

const VERIFY_SYSTEM = `You are a fact-checker for a football quiz. You will be shown a multiple-choice question and its four options. You are NOT told which option is correct — your job is to work it out independently and prove it.

Use web search. Then reply with ONLY a JSON object:

{
  "derived_answer": "A" | "B" | "C" | "D" | "UNKNOWN",
  "confidence": "high" | "medium" | "low",
  "source_url": "the single best URL supporting your answer, or null",
  "source_quote": "a short quote or data point from that source that proves it, or null",
  "still_true_today": true | false | "n/a",
  "ambiguity": "null, or a description of why more than one option could be defended"
}

Rules:
- If you cannot find a source that settles it, answer "UNKNOWN". Do not guess. An UNKNOWN costs us nothing; a wrong answer shipped to players costs us trust.
- "still_true_today": if the question is about an all-time record or a superlative that could change over time, verify it is STILL TRUE as of today and set true/false. Use "n/a" for questions about fixed historical events (a specific final, a specific season).
- If two options could both be defended as correct, say so in "ambiguity" — even if you are confident which is intended.
- Be strict. You are the last line of defence before this reaches real players.`;

export async function verifyQuestion(q, { model = MODELS.verify } = {}) {
  const prompt = `Question: ${q.question}

A) ${q.options.A}
B) ${q.options.B}
C) ${q.options.C}
D) ${q.options.D}

Which option is correct, and what is your source?`;

  const resp = await callClaude({
    model,
    system: VERIFY_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 2048,
    stage: "verify",
  });

  let v;
  try {
    v = parseJson(resp);
  } catch {
    return { verified: false, reason: "verify: model reply was not JSON", raw: textOf(resp).slice(0, 200), usage: usageOf(resp) };
  }
  return { ...gradeVerdict(q, v), verdict: v, usage: usageOf(resp) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 (cheap path) — verify against a SportMonks fact sheet, NO web search.
//
// The verifier's dominant cost is a web search per question. For anything SportMonks
// holds — final tables, points, title winners, per-season top scorers — we hand the
// verifier that ground truth instead and forbid it the web. Same independence property:
// it is NOT told the author's answer and must derive it from the facts.
//
// Three outcomes:
//   verified  — the facts settle it and match the author  → accept (token-only, no search)
//   disagree  — the facts CONTRADICT the author           → drop (a cheap, certain catch)
//   unknown   — the facts don't cover it                  → caller falls back to web verify
// ─────────────────────────────────────────────────────────────────────────────

const FACTS_VERIFY_SYSTEM = `You are a fact-checker for a football quiz. You are given a set of VERIFIED FACTS (from SportMonks, authoritative) and a multiple-choice question. You are NOT told which option the author thinks is correct.

Work ONLY from the facts provided. Do not use outside knowledge. Reply with ONLY a JSON object:

{
  "derived_answer": "A" | "B" | "C" | "D" | "UNKNOWN" | "IMPOSSIBLE",
  "source_quote": "the exact line from the facts that settles it, or null",
  "reasoning": "one sentence, only when you answer IMPOSSIBLE",
  "covered": true | false
}

Rules:
- Only answer A/B/C/D when the facts prove it. Quote the line that does.
- If the facts simply don't address the question, set "covered": false and "derived_answer": "UNKNOWN". Do NOT guess from general knowledge — we'll check elsewhere.

USE WHAT THE FACTS IMPLY, not only what they state word-for-word. The facts are a set of
CONSTRAINTS, and a question can be disproved by them without being directly answered:

- A season's top scorer and their tally is a CEILING for that club that season. If the facts say
  "2010/2011: their top scorer Carlos Tevez (20)", then NOBODY at that club scored more than 20
  that season. A question asking how many a player scored, where every option is 25+, cannot have
  a correct answer — that is IMPOSSIBLE, not UNKNOWN.
- If the facts name the club's top scorer for a season, a question premised on a different player
  being top scorer that season is contradicted.
- Final league position and points are exact. A question premised on a different position or tally
  for that season is contradicted.

Answer "IMPOSSIBLE" when the facts show that NO option can be right — the question's premise is
false. This is how a fabricated question gets caught: it looks well-formed, but the facts make it
unanswerable. Be rigorous, not imaginative: only say IMPOSSIBLE when a specific fact rules every
option out, and quote it.`;

/**
 * Verify one question against a fact sheet, no web search.
 * Returns { outcome: "verified"|"disagree"|"unknown", verdict, usage }.
 */
export async function verifyAgainstFacts(q, factsText, { model = MODELS.verify } = {}) {
  const prompt = `VERIFIED FACTS:
${factsText}

QUESTION: ${q.question}
A) ${q.options.A}
B) ${q.options.B}
C) ${q.options.C}
D) ${q.options.D}

Using ONLY the facts above, which option is correct?`;

  const resp = await callClaude({
    model,
    system: FACTS_VERIFY_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    // No tools — this is the whole point: no web search, token cost only.
    maxTokens: 1024,
    stage: "verify-facts",
  });

  let v;
  try {
    v = parseJson(resp);
  } catch {
    return { outcome: "unknown", verdict: null, usage: usageOf(resp) };
  }

  // IMPOSSIBLE = the facts rule out EVERY option, so the question's premise is false. That's a
  // fabrication, and it's the class the Haaland-2010 question belongs to: well-formed, specific,
  // past-tense, and unanswerable ("how many did Haaland score for City in 2010-11?" — options all
  // 25+, but City's top scorer that season managed 20). Treat it as a contradiction, not unknown.
  if (v.derived_answer === "IMPOSSIBLE") {
    return {
      outcome: "disagree",
      verdict: {
        derived_answer: "IMPOSSIBLE",
        confidence: "high",
        source_url: "https://www.sportmonks.com/ (Premier League standings & scorers)",
        source_quote: v.source_quote ?? v.reasoning ?? null,
        still_true_today: "n/a",
        ambiguity: null,
        reasoning: v.reasoning ?? null,
      },
      usage: usageOf(resp),
    };
  }

  if (v.covered === false || v.derived_answer === "UNKNOWN" || !LETTERS.includes(v.derived_answer)) {
    return { outcome: "unknown", verdict: null, usage: usageOf(resp) };
  }
  // Shape a standard verdict so the caller can grade it with gradeVerdict() uniformly.
  const verdict = {
    derived_answer: v.derived_answer,
    confidence: "high",                       // SportMonks is authoritative
    source_url: "https://www.sportmonks.com/ (Premier League standings & scorers)",
    source_quote: v.source_quote ?? null,
    still_true_today: "n/a",                   // fact-sheet facts are historical, fixed
    ambiguity: null,
  };
  return { outcome: v.derived_answer === q.answer ? "verified" : "disagree", verdict, usage: usageOf(resp) };
}

/**
 * Does the verifier's free-text "ambiguity" field describe a REAL ambiguity? It writes
 * "no ambiguity" in prose ("None", "n/a", "None - the records are explicit"), so a bare
 * negation — or a "None"/"No" that leads a sentence — means clear-cut, not ambiguous.
 */
export function isAmbiguous(field) {
  if (field == null) return false;
  const s = String(field).trim();
  if (!s) return false;
  // First word / whole value is a negation ⇒ not ambiguous. Leading token so "None - ..."
  // (verifier explains why it's clear) counts as clear, but a sentence that merely contains
  // the word "none" later would not be let through.
  const lead = s.toLowerCase().replace(/^[^a-z]+/, "").split(/[\s.,;:-]+/)[0];
  if (["null", "none", "no", "na", "n/a", "nil", "clear", "unambiguous"].includes(lead)) return false;
  if (/^(no ambiguity|not ambiguous|there is no)/i.test(s)) return false;
  return true;
}

/** Pure — the pass/fail rules, split out so they're testable without a model call. */
export function gradeVerdict(q, v, { timeSensitive = false } = {}) {
  if (v.derived_answer === "UNKNOWN" || !LETTERS.includes(v.derived_answer))
    return { verified: false, reason: "verify: verifier could not settle it from any source" };

  if (v.derived_answer !== q.answer)
    return { verified: false, reason: `verify: DISAGREEMENT — author said ${q.answer}, verifier derived ${v.derived_answer}` };

  if (!v.source_url)
    return { verified: false, reason: "verify: no source cited" };

  if (v.confidence === "low")
    return { verified: false, reason: "verify: verifier agreed but with low confidence" };

  // The verifier writes the "ambiguity" field as prose, and it expresses "no ambiguity" in
  // words — "None", "No ambiguity", "n/a", sometimes "None - <why it's actually clear-cut>".
  // Treat those as clear. A verifier flagging REAL ambiguity describes the competing options
  // ("Lacazette also scored in that final"), so the negation check can't hide a real one.
  if (isAmbiguous(v.ambiguity))
    return { verified: false, reason: `verify: ambiguous — ${String(v.ambiguity).slice(0, 120)}` };

  // A time-sensitive superlative that the verifier could not confirm still holds is a rot risk.
  if ((timeSensitive || v.still_true_today === false) && v.still_true_today !== true && v.still_true_today !== "n/a")
    return { verified: false, reason: "verify: time-sensitive claim not confirmed as still true today" };

  return { verified: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run every candidate through the gate.
 * Returns { passed, dropped, stats } — `passed` carries a verification_note ready for
 * the `questions.verification_note` column (which already exists).
 */
export async function runGate(candidates, { supabase, entities, threshold = 0.75, onProgress, factsText = null } = {}) {
  const dropped = [];
  const drop = (q, reason) => { dropped.push({ question: q.question, reason }); return false; };

  // ── Stage 0: deterministic, free ───────────────────────────────────────────
  const stage0 = [];
  const batchSeen = [];
  for (const q of candidates) {
    const shape = checkShape(q);
    if (!shape.ok) { drop(q, shape.reason); continue; }

    const temporal = checkTemporal(q.question);
    if (!temporal.ok) { drop(q, temporal.reason); continue; }

    const specific = checkSpecificity(q.question);
    if (!specific.ok) { drop(q, specific.reason); continue; }

    // Dedupe within this batch first (cheap, no network).
    const inBatch = findDuplicate(q, batchSeen, threshold);
    if (inBatch) { drop(q, `dupe: ${inBatch.kind} duplicate of another question in this same batch`); continue; }

    batchSeen.push(q);
    stage0.push({ ...q, _timeSensitive: temporal.timeSensitive });
  }

  // Dedupe against the live bank (one query for the whole batch).
  let afterDedupe = stage0;
  if (supabase) {
    const bank = await loadBank(supabase, entities);
    afterDedupe = stage0.filter((q) => {
      const hit = findDuplicate(q, bank, threshold);
      return hit ? drop(q, `dupe: ${hit.kind} duplicate of bank question ${hit.existing.id}`) : true;
    });
  }

  // ── Stage 2: independent verification, one call per survivor ───────────────
  const passed = [];
  const checkedOn = new Date().toISOString().slice(0, 10);
  let inTok = 0, outTok = 0, viaFactsCount = 0;

  const accept = (q, verdict) => {
    const { _timeSensitive, ...clean } = q;
    passed.push({
      ...clean,
      source: "data-grounded",
      verification_note: JSON.stringify({
        checked_on: checkedOn,
        source_url: verdict.source_url,
        source_quote: verdict.source_quote,
        confidence: verdict.confidence,
        time_sensitive: Boolean(_timeSensitive),
      }),
    });
  };

  for (const [i, q] of afterDedupe.entries()) {
    onProgress?.({ i: i + 1, of: afterDedupe.length, question: q.question });

    // Cheap path first: if we have a SportMonks fact sheet, try to settle it with NO web
    // search. A "verified" or "disagree" outcome is decided here for token cost only; only
    // an "unknown" (fact not covered — e.g. a cup final) falls through to the web verifier.
    if (factsText) {
      const fres = await verifyAgainstFacts(q, factsText);
      inTok += fres.usage?.input ?? 0;
      outTok += fres.usage?.output ?? 0;
      if (fres.outcome !== "unknown") {
        const graded = gradeVerdict(q, fres.verdict, { timeSensitive: q._timeSensitive });
        if (!graded.verified) { drop(q, `${graded.reason} [vs SportMonks]`); continue; }
        viaFactsCount++;
        accept(q, fres.verdict);
        continue;
      }
    }

    // Web-grounded verification (the default, and the fallback when facts don't cover it).
    const res = await verifyQuestion(q);
    inTok += res.usage?.input ?? 0;
    outTok += res.usage?.output ?? 0;

    const graded = res.verdict ? gradeVerdict(q, res.verdict, { timeSensitive: q._timeSensitive }) : res;
    if (!graded.verified) { drop(q, graded.reason); continue; }
    accept(q, res.verdict);
  }

  const stats = {
    generated: candidates.length,
    passed: passed.length,
    dropped: dropped.length,
    passRate: candidates.length ? +(passed.length / candidates.length).toFixed(2) : 0,
    verifiedViaFacts: viaFactsCount,
    tokens: { input: inTok, output: outTok },
  };
  return { passed, dropped, stats };
}
