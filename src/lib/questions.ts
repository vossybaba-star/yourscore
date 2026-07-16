/**
 * Question-text normalization + duplicate filtering, shared by every path that
 * serves or inserts bank questions. Two rows with different ids but the same
 * text are the same question to a player — id-based dedup alone let the same
 * question get dealt twice in one quiz (health-check catch, Jul 2026).
 *
 * Must stay in sync with the normalization in scripts/dedupe-questions.mjs,
 * scripts/health/checks/experience.mjs, and the questions_active_entity_normtext_uidx
 * index (migration 67).
 */

export function normalizeQuestionText(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop later entries whose normalized question text repeats an earlier one. */
export function dedupeByQuestionText<T extends { question: string }>(questions: T[]): T[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = normalizeQuestionText(q.question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Take up to `n` questions from a pool, never two built from the same fact.
 *
 * The quiz factory is facts-first and writes SEVERAL questions per researched fact — that's
 * deliberate, volume beats purity when building a bank. But two questions off one fact can
 * spoil each other:
 *   "Which club did Arsenal beat in the 2019/20 FA Cup final?"      → Chelsea
 *   "Who scored both goals in that final win OVER CHELSEA?"         → hands you the answer
 *
 * dedupeByQuestionText can't catch this — those two texts are entirely different. So the rule
 * is enforced at selection time instead: keep every question in the bank, just never put
 * related ones in the same quiz.
 *
 * `usedFactKeys` is passed in (and mutated) so a caller can share one set across several
 * picks — the pair above sits at different difficulties, so per-pick sets would miss it.
 * Rows with a null fact_key are legacy/untracked and treated as unrelated to everything.
 */
export function pickDistinctFacts<T extends { fact_key?: string | null }>(
  pool: T[],
  n: number,
  usedFactKeys: Set<string> = new Set()
): T[] {
  const out: T[] = [];
  for (const q of pool) {
    if (out.length >= n) break;
    const key = q.fact_key;
    if (key) {
      if (usedFactKeys.has(key)) continue;
      usedFactKeys.add(key);
    }
    out.push(q);
  }
  return out;
}
