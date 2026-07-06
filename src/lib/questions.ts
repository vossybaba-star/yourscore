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
