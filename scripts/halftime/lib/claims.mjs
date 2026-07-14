/**
 * claims.mjs — the factual-safety core. PURE FUNCTIONS ONLY (no I/O), so every
 * rule in here is unit-testable without a network or a DB. validate.mjs does the
 * SportMonks resolution; this file decides what is even ALLOWED to be asked.
 *
 * Three independent gates, all fail-closed (a question that trips any of them is
 * DROPPED, never flagged):
 *
 *   1. FIRST-HALF BAN (§2.1 hard rule). No question may depend on anything that
 *      happened after the kickoff whistle. Two halves to this, and the second is
 *      the one everybody forgets:
 *
 *        (a) lexical — no score, goals, cards, subs, minutes, "currently", "so far".
 *        (b) TEMPORAL ANCHORING — this is the subtle one. "How many league goals
 *            has Saka scored this season?" contains no banned word, yet if Saka
 *            scores in the first half the pack's answer (7) is WRONG on the
 *            screen next to the live score. A running total IS a first-half
 *            dependency. So any question resting on a claim we mark `mutable`
 *            (goals / assists / appearances / minutes / clean sheets — anything
 *            today's match can change) MUST carry an explicit pre-kickoff anchor
 *            ("before kick-off today", "going into this match"). No anchor → drop.
 *
 *   2. NAMED-ENTITY WHITELIST. Every person named in the question text or in any
 *      option must come from the dossier's whitelist (the confirmed XI, the
 *      benches, and the specific historical figures the miner surfaced). The LLM
 *      cannot introduce a name — which is exactly how "the manager who already
 *      left the club" gets in. Independent of what the model claims it named:
 *      we re-extract capitalised runs from the text ourselves and check each one.
 *
 *   3. GROUNDING. A question with zero machine-checkable claims is ungrounded by
 *      definition and is dropped before a human ever sees it.
 */

// ── Claim types ──────────────────────────────────────────────────────────────
//
// Each claim is a machine-checkable assertion that validate.mjs re-resolves
// against SportMonks (or the owned FIFA dataset) at validation time. `mutable`
// means today's match can change the value — those claims force an anchor.

export const CLAIM_TYPES = {
  /** {player_id, name, fixture_id, team_id} — player is in today's confirmed XI. */
  player_in_lineup: { mutable: false },
  /** {player_id, name, team_id, club} — player has been contracted to this club. */
  player_career_club: { mutable: false },
  /** {player_id, name, team_id, club} — zero prior appearances for this club. */
  player_debut_club: { mutable: false },
  /** {player_id, name, stat, value, team_id?, season_id?} — a running total. */
  player_stat: { mutable: true },
  /** {player_id, name, opponent_team_id, value, window_from} — goals vs this club. */
  player_goals_vs: { mutable: false },
  /** {player_id, name, dob, age} — age at kickoff. */
  player_age: { mutable: false },
  /** {fixture_id, team_id, formation} — today's confirmed formation. */
  formation: { mutable: false },
  /** {fixture_id, date, home, away, home_goals, away_goals} — a past result. */
  h2h_result: { mutable: false },
  /** {team_a, team_b, window_from, wins_a, wins_b, draws, played} — the H2H tally. */
  h2h_tally: { mutable: false },
  /** {name, club, season, overall} — owned FIFA-ratings dataset. */
  fifa_rating: { mutable: false },
  /** {club, season, name, overall} — highest-rated player in a club-season. */
  fifa_top: { mutable: false },
  /**
   * {name, club} — the dataset has NO record of this player at this club.
   * A negative claim, and the whole point of it is the wrong answers: a
   * "which of these played for both clubs?" question is broken the moment one of
   * its three distractors also played for both. This makes the distractors as
   * checkable as the answer.
   */
  fifa_absent: { mutable: false },
};

export function isMutable(claim) {
  return Boolean(CLAIM_TYPES[claim?.type]?.mutable);
}

export function knownClaimType(claim) {
  return Boolean(CLAIM_TYPES[claim?.type]);
}

// ── Gate 1a: the first-half lexical ban ──────────────────────────────────────
//
// Everything up to the kickoff whistle is fair game; nothing after it. People
// play this pack who are NOT watching the match, and play it later in the day —
// a question (or an answer) that leaks the first half ruins the game for them,
// and a running-total answer that the first half already invalidated makes the
// pack look broken next to the live score.

const FIRST_HALF_PATTERNS = [
  [/\bhalf[-\s]?time\b/i, "references half time"],
  [/\bscoreline\b/i, "references the scoreline"],
  // "the score" alone is NOT bannable — "what was the score when they last met in
  // 2001" is a perfectly good historic question, and banning it outright killed
  // real base questions on the first run. What is bannable is the score of the
  // match being played right now.
  [/\bcurrent score\b/i, "references the current score"],
  [/\bwhat\s+(is|are)\s+the\s+score\b/i, "asks for the live score"],
  [/\bthe score is\b/i, "asserts the live score"],
  [/\bcurrent(ly)?\b/i, "'currently' — a live claim, not a pre-kickoff one"],
  [/\bso far\b/i, "'so far' — open-ended, includes the first half"],
  [/\b(this|the)\s+(first\s+|opening\s+)?half\b/i, "references this half"],
  [/\b(today|tonight)'?s?\s+(goal|goals|scorer|scorers|score|opener|card|cards)\b/i, "references today's match events"],
  [/\b(opened|open)\s+the\s+scoring\b/i, "references the opening goal"],
  [/\b(leading|trailing|level|drawing|winning|losing)\s+(at|after|by)\b/i, "references the live state of the match"],
  [/\b\d{1,2}(st|nd|rd|th)\s+minute\b/i, "references a minute of play"],
  [/\bin the \d{1,2}(st|nd|rd|th)\b/i, "references a minute of play"],
  [/\bsubbed\b|\bsubstituted\b|\bcame on\b/i, "references a substitution"],
  [/\b(booked|yellow card|red card|sent off)\b/i, "references a card"],
  [/\bhas (already )?scored (today|tonight|in this match|in this game)\b/i, "references a goal in this match"],
  [/\bright now\b|\bat this moment\b|\bas things stand\b/i, "live-state language"],
];

/** Lexical first-half check. Returns [] when clean. */
export function firstHalfViolations(text) {
  const s = String(text ?? "");
  const out = [];
  for (const [re, why] of FIRST_HALF_PATTERNS) {
    if (re.test(s)) out.push(why);
  }
  return out;
}

// ── Gate 1b: the temporal anchor for mutable claims ───────────────────────────

const ANCHOR_PATTERNS = [
  /before kick[-\s]?off/i,
  /before today'?s? (match|game|kick)/i,
  /going into (this|today'?s) (match|game|fixture)/i,
  /coming into (this|today'?s) (match|game|fixture)/i,
  /ahead of (this|today'?s) (match|game|fixture|kick)/i,
  /prior to (this|today'?s) (match|game|kick)/i,
  /at kick[-\s]?off/i,
  /heading into (this|today'?s) (match|game|fixture)/i,
];

export function hasPreKickoffAnchor(text) {
  const s = String(text ?? "");
  return ANCHOR_PATTERNS.some((re) => re.test(s));
}

/**
 * A question resting on a mutable claim (a running total today's match can
 * change) is only safe if it explicitly freezes itself before kick-off.
 * This is what makes "how many goals has he scored this season" survivable.
 */
export function anchorViolations(text, claims) {
  const mutable = (claims ?? []).filter(isMutable);
  if (!mutable.length) return [];
  if (hasPreKickoffAnchor(text)) return [];
  return [
    `rests on a mutable stat (${mutable.map((c) => c.stat ?? c.type).join(", ")}) ` +
      `but carries no pre-kickoff anchor — today's first half could change the answer`,
  ];
}

// ── Gate 2: named-entity whitelist ───────────────────────────────────────────

/**
 * Words that begin a sentence or are legitimately capitalised but are NOT
 * people. Anything capitalised that is neither on this list nor in the dossier
 * whitelist is treated as an unresolvable person and the question is dropped.
 * Fail-closed: a false positive costs us one question; a false negative ships a
 * hallucinated player name to a user watching the actual match.
 */
const NON_PERSON_WORDS = new Set(
  (
    "a an the and or of in on at to for with from by as is are was were be been has have had " +
    "who whom whose which what when where why how many much more most least fewest first last " +
    "before after during since between against versus vs than then this that these those " +
    "premier league championship cup fa efl carabao uefa champions europa conference world " +
    "monday tuesday wednesday thursday friday saturday sunday " +
    "january february march april may june july august september october november december " +
    "england english britain british europe european united kingdom " +
    "goalkeeper defender midfielder forward striker winger captain manager head coach " +
    "goal goals assist assists appearance appearances minute minutes clean sheet season seasons " +
    "club clubs side sides team teams squad squads player players starter starters " +
    "home away draw win won lose lost defeat victory nil none " +
    "which of these none of them all of them both neither either " +
    // Football shorthand that is capitalised but is not a person. Missing "XI"
    // here cost a perfectly good question in the first real run: "Arsenal have
    // named their starting XI" was flagged as a hallucinated player called XI.
    "xi var gk cb cm cdm cam lw rw st ht ft aet gw var " +
    "fifa rating ratings overall stadium ground arena park road lane bridge villa emirates anfield " +
    "he she they his her their him it its one two three four five six seven eight nine ten " +
    "yes no not never always only ever also still just"
  ).split(/\s+/),
);

/**
 * Ordinary English words that start a sentence and are capitalised for that
 * reason alone. A single capitalised word at the very start of a sentence is
 * ambiguous — "Among these four…" and "Messi has more…" look identical to a
 * regex — so the ONLY way through this gate for a sentence-initial single word is
 * to be on this closed list. Anything else sentence-initial and unrecognised is
 * still treated as a person and still kills the question. (The first real run
 * dropped a good question because "Among" wasn't here; adding words to the
 * catch-all stoplist instead would have been the wrong fix — a player really can
 * be called Young, or Rice, or Beto.)
 */
const SENTENCE_OPENERS = new Set(
  (
    "which who whom whose what when where why how the a an this that these those " +
    "among amongst between before after during since until while although though despite " +
    "only just both neither either each every all none one two three four five six seven " +
    "going coming heading ahead prior according looking counting starting including " +
    "in on at of for with from by to as and or but if so then now here there " +
    "he she they his her their it its no not never always " +
    "of the on today tonight football premier"
  ).split(/\s+/),
);

/**
 * Pull capitalised token-runs out of free text, with their positions. This is
 * deliberately dumb and over-eager: it is a SAFETY net, not an NLP model.
 * Everything it finds must either be whitelisted or explain itself, or the
 * question dies.
 */
export function extractCapitalisedRuns(text) {
  return extractRuns(text).map((r) => r.run);
}

function extractRuns(text) {
  const s = String(text ?? "");
  const out = [];
  // Unicode-aware: catches Gabriel Magalhães, Jurriën Timber, Iliman Ndiaye, O'Brien.
  const re = /[A-ZÀ-Þ][\p{L}'’.-]*(?:\s+(?:van|de|der|den|da|dos|di|du|le|la)\s+[\p{L}'’.-]+)*(?:\s+[A-ZÀ-Þ][\p{L}'’.-]*)*/gu;
  for (const m of s.matchAll(re)) {
    const run = m[0].trim();
    if (!run) continue;
    // Is this run the first thing in its sentence?
    const before = s.slice(0, m.index).replace(/\s+$/, "");
    const sentenceInitial = before === "" || /[.!?:;]$/.test(before);
    out.push({ run, sentenceInitial, multiword: /\s/.test(run) });
  }
  return out;
}

/**
 * Normalise a name for comparison: lowercase, strip accents/punctuation.
 * The possessive is stripped FIRST — otherwise "Arsenal's" normalises to
 * "arsenal s" and the orphan "s" gets read as an unresolvable person, which is
 * exactly what killed eight good base questions on the first real run.
 */
export function normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the lookup index from the dossier whitelist. Each allowed name yields
 * its full form AND its individual tokens longer than 2 chars, so "Saka" matches
 * the whitelisted "Bukayo Saka" but a bare "Ronaldo" does not match anything.
 */
export function buildNameIndex(allowedNames = [], allowedOther = []) {
  const idx = new Set();
  for (const n of allowedNames) {
    const norm = normName(n);
    if (!norm) continue;
    idx.add(norm);
    for (const tok of norm.split(" ")) if (tok.length > 2) idx.add(tok);
  }
  for (const n of allowedOther) {
    const norm = normName(n);
    if (!norm) continue;
    idx.add(norm);
    for (const tok of norm.split(" ")) if (tok.length > 2) idx.add(tok);
  }
  return idx;
}

/**
 * Every capitalised run in the text must resolve: to the whitelist, to a club /
 * competition / stadium name we supplied, or to an ordinary capitalised English
 * word. Anything else is an entity the model invented — drop the question.
 *
 * `declared` (what the model SAYS it named) is checked too, but is never
 * trusted on its own: a model that names someone and forgets to declare them is
 * exactly the failure this gate exists for, so the text scan is authoritative.
 */
export function entityViolations(text, options, nameIndex, declared = []) {
  const out = [];

  for (const d of declared) {
    if (!nameIndex.has(normName(d))) out.push(`names "${d}", which is not in the dossier`);
  }

  // Options are noun phrases, never sentences, so EVERY capitalised run in them is
  // a person candidate. This matters: the options are where the answer and the
  // three wrong answers live, which is exactly where a hallucinated player does
  // the damage.
  const parts = [
    { text: String(text ?? ""), isSentence: true },
    ...Object.values(options ?? {}).map((o) => ({ text: String(o), isSentence: false })),
  ];

  for (const part of parts) {
    for (const { run, sentenceInitial, multiword } of extractRuns(part.text)) {
      const norm = normName(run);
      if (!norm) continue;
      if (nameIndex.has(norm)) continue;

      // A single capitalised word opening a sentence is capitalised by grammar,
      // not by being a name — but ONLY if it is a word we recognise as an opener.
      // "Among these four…" passes. "Messi has scored…" does not.
      if (part.isSentence && sentenceInitial && !multiword && SENTENCE_OPENERS.has(norm)) continue;

      // Tokens shorter than 3 chars are noise (initials, a stray possessive "s"),
      // never a person on their own.
      const toks = norm.split(" ").filter((t) => t.length >= 3);
      const unknown = toks.filter((t) => !NON_PERSON_WORDS.has(t) && !nameIndex.has(t));
      if (!unknown.length) continue;

      out.push(`names "${run}", which is not in the dossier (unresolved: ${unknown.join(" ")})`);
    }
  }
  return [...new Set(out)];
}

// ── Gate 3 + shape ───────────────────────────────────────────────────────────

export const LETTERS = ["A", "B", "C", "D"];

/**
 * Structural gate. Authors write the correct answer as option A every time —
 * the deterministic shuffle happens at assembly (src/lib/halftime/shared.ts),
 * the same publish-time pattern the daily quiz uses. A question that arrives
 * with the answer anywhere else means the model ignored the format, which is a
 * strong smell that it ignored other instructions too. Drop it.
 */
export function shapeViolations(q) {
  const out = [];
  if (!q || typeof q.question !== "string" || q.question.trim().length < 12) {
    out.push("missing or trivially short question text");
  }
  if (!q?.options || !LETTERS.every((k) => typeof q.options[k] === "string" && q.options[k].trim())) {
    out.push("needs four options A-D");
  } else {
    const seen = new Set(LETTERS.map((k) => normName(q.options[k])));
    if (seen.size !== 4) out.push("options are not distinct");
  }
  if (q?.answer !== "A") out.push(`answer must be authored as "A" (got ${JSON.stringify(q?.answer)})`);
  if (!["easy", "medium", "hard"].includes(q?.difficulty)) out.push("difficulty must be easy|medium|hard");
  return out;
}

// ── Gate 4: the answer leak ──────────────────────────────────────────────────
//
// Found on the very first real generation run. Given a dossier line that reads
// "Bukayo Saka is the only one of these four who has ever scored against Everton",
// the model wrote:
//
//   "Bukayo Saka starts against Everton today, and remarkably he's the only one of
//    these four Arsenal starters who has ever scored against them. Who is it?"
//        A) Bukayo Saka  ← correct
//
// Factually flawless. Every claim resolves. Completely broken as a quiz question:
// the answer is in the stem. No amount of claim-checking catches this, because
// nothing is wrong with the facts — what is wrong is the QUESTION. So it gets its
// own gate: the correct option's text may not appear in the stem.

/**
 * @param {Set<string>} ignore  tokens that carry no information about WHICH option
 *   is correct and therefore cannot leak it — in practice the two club names.
 *   Without this, "What was the score when Arsenal hosted Coventry City in
 *   September 2000?" → "Arsenal 2-1 Coventry City" reads as a leak (the club
 *   names are in both), and a perfectly good history question dies. The clubs are
 *   in EVERY option; the scoreline is the answer.
 */
export function answerLeakViolations(q, ignore = new Set()) {
  const correct = q?.options?.[q?.answer];
  if (!correct) return [];
  const stem = normName(q.question);
  const ans = normName(correct);
  if (!ans) return [];

  const informative = ans.split(" ").filter((t) => t.length > 3 && !ignore.has(t));

  // Whole-answer match is a leak unless the answer is entirely club names.
  if (informative.length && stem.includes(ans)) {
    return [`the answer ("${correct}") appears in the question itself`];
  }
  // A surname on its own gives it away just as completely: "Saka is one of these.
  // Which of them has scored against Everton?  A) Bukayo Saka".
  const leaked = informative.filter((t) => new RegExp(`\\b${t}\\b`).test(stem));
  if (leaked.length) {
    return [`the answer ("${correct}") is given away in the question itself ("${leaked.join(", ")}")`];
  }
  return [];
}

/** Tokens that appear in every option and therefore cannot identify the answer. */
export function buildLeakIgnore(clubs = []) {
  const out = new Set();
  for (const c of clubs) {
    for (const t of normName(c).split(" ")) if (t.length > 3) out.add(t);
  }
  return out;
}

/** A question with no machine-checkable claim is ungrounded by definition. */
export function groundingViolations(claims) {
  const list = claims ?? [];
  if (!list.length) return ["no machine-checkable claims — ungrounded by definition"];
  const unknown = list.filter((c) => !knownClaimType(c));
  if (unknown.length) {
    return [`unknown claim type(s): ${unknown.map((c) => String(c?.type)).join(", ")}`];
  }
  return [];
}

// ── Base-slate-only rules ────────────────────────────────────────────────────
//
// Base questions are written the DAY BEFORE, from historic/static facts. They
// cannot go stale — which means they may not touch anything that changes with
// the news cycle. This is the exact class of failure the founder has been burned
// by (the model asserting a manager was still at a club he had left), so the ban
// is lexical and it is absolute.

const CURRENT_AFFAIRS_PATTERNS = [
  [/\bthis season\b/i, "'this season' — a moving target across a 38-game season"],
  [/\bcurrent(ly)?\b/i, "'current' — a claim with an expiry date"],
  [/\b(injur|fit again|fitness|doubtful|suspended)\w*\b/i, "injury/fitness claim — changes weekly"],
  [/\b(in form|out of form|form guide|unbeaten run|winning run|losing run)\b/i, "form claim — changes weekly"],
  [/\b(league position|the table|top of the|bottom of the|relegation zone|title race)\b/i, "league-position claim — changes weekly"],
  [/\btransfer window\b|\bnew signing\b|\bjust signed\b|\bon loan\b/i, "squad/transfer claim — changes weekly"],
  [/\b(this|next|last) (week|month|weekend)\b/i, "relative time reference"],
];

/**
 * A manager/coach question is only safe if it is anchored to a historical moment
 * (a year or a season). "Who is Arsenal's manager?" is a landmine. "Who managed
 * Arsenal in the 2003/04 unbeaten season?" is not.
 */
const MANAGER_RE = /\b(manager|head coach|boss|gaffer)\b/i;
const HISTORICAL_ANCHOR_RE = /\b(19|20)\d{2}\b|\b\d{2}\/\d{2}\b/;

export function currentAffairsViolations(text) {
  const s = String(text ?? "");
  const out = [];
  for (const [re, why] of CURRENT_AFFAIRS_PATTERNS) {
    if (re.test(s)) out.push(why);
  }
  if (MANAGER_RE.test(s) && !HISTORICAL_ANCHOR_RE.test(s)) {
    out.push("manager/coach claim with no historical anchor (year or season) — the exact stale-fact class");
  }
  return out;
}

// ── The composite gate ───────────────────────────────────────────────────────

/**
 * Every lexical/structural rule, in one call. `pass` = 'base' | 'fresh'.
 * Returns a list of reasons; empty means the question survives to the DATA gate
 * (validate.mjs), which re-resolves every claim against SportMonks.
 */
export function textViolations(q, { pass, nameIndex, clubs = [] }) {
  const claims = q?.claims ?? [];
  const reasons = [
    ...shapeViolations(q),
    ...groundingViolations(claims),
    ...answerLeakViolations(q, buildLeakIgnore(clubs)),
    ...firstHalfViolations(q?.question),
    ...anchorViolations(q?.question, claims),
  ];
  for (const opt of Object.values(q?.options ?? {})) {
    reasons.push(...firstHalfViolations(opt));
  }
  if (pass === "base") {
    reasons.push(...currentAffairsViolations(q?.question));
    for (const opt of Object.values(q?.options ?? {})) {
      reasons.push(...currentAffairsViolations(opt));
    }
  }
  if (nameIndex) {
    reasons.push(...entityViolations(q?.question, q?.options, nameIndex, q?.named_entities ?? []));
  }
  return [...new Set(reasons)];
}
