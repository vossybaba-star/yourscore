/**
 * Question-text normalization + similarity. THE single copy for node scripts.
 *
 * This normalization must stay in lockstep with:
 *   - src/lib/questions.ts                      (normalizeQuestionText, runtime serve/insert guard)
 *   - scripts/health/checks/experience.mjs      (duplicate detection)
 *   - migration 67_questions_unique_active_text (questions_active_entity_normtext_uidx)
 *
 * It was already copy-pasted into three scripts. The quiz factory needed it too, and a
 * fourth copy is how the index and the app drift apart silently — so it lives here now
 * and scripts/dedupe-questions.mjs imports it rather than redefining it.
 */

/** Same as normalizeQuestionText() in src/lib/questions.ts. Do not change one without the other. */
export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Words carrying no distinguishing signal between two questions about the same entity —
// Jaccard is computed on what's left. Includes question boilerplate ("who holds the
// record for…" vs "which player has made…").
export const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "in", "on", "at", "to", "is", "was", "are", "were",
  "who", "which", "what", "whom", "whose", "did", "does", "do", "has", "have", "had",
  "player", "players", "club", "clubs", "team", "teams", "and", "or", "by", "with",
  "their", "his", "her", "its", "this", "that", "as", "from",
  "hold", "holds", "held", "record", "made", "make", "makes", "ever", "current",
  "currently", "total", "during", "name",
]);

// Fold interchangeable phrasings onto one token so "home ground" matches "home stadium".
export const SYNONYMS = new Map(Object.entries({
  ground: "stadium",
  campaign: "season",
  accumulate: "get", accumulated: "get",
  collect: "get", collected: "get",
  earn: "get", earned: "get",
  gain: "get", gained: "get",
  win: "won", wins: "won",
  title: "titles", trophy: "titles", trophies: "titles",
  formed: "founded", established: "founded",
  netted: "scored", net: "scored",
}));

export const tokens = (s) =>
  new Set(
    norm(s)
      .split(" ")
      .filter((t) => t && !STOPWORDS.has(t))
      .map((t) => SYNONYMS.get(t) ?? t)
  );

/**
 * Digit-bearing tokens (years, seasons, counts). Two questions whose digit tokens differ
 * ask about different things — a question about 2009-10 is never a dup of one about 2010-11.
 */
export const digitTokens = (toks) => [...toks].filter((t) => /\d/.test(t)).sort().join("|");

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Normalized text of the correct answer (options is {A..D}, answer is a letter). */
export const answerText = (q) => norm((q.options ?? {})[q.answer] ?? "");

/**
 * Is `candidate` a near-duplicate of `existing`? Mirrors the near-dup rule in
 * scripts/dedupe-questions.mjs: same normalized correct answer + identical digit
 * tokens + content-token Jaccard >= threshold.
 */
export function isNearDuplicate(candidate, existing, threshold = 0.75) {
  if (answerText(candidate) !== answerText(existing)) return false;
  const ct = tokens(candidate.question);
  const et = tokens(existing.question);
  if (digitTokens(ct) !== digitTokens(et)) return false;
  return jaccard(ct, et) >= threshold;
}
