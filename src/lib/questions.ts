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

/**
 * Fill a quiz to `size`, treating the difficulty mix as a TARGET rather than a requirement.
 *
 * The mix used to be a hard floor, and that floor blocked 11 of 20 PL clubs from being dealt a
 * rivalries quiz at all — not for want of questions, but for want of EASY ones.
 *
 * The cause is a calibration mismatch, not a content gap. Difficulty is rated for a NEUTRAL
 * fan, but only a club's own fans ever pick that club's quiz. Two sides of one derby,
 * researched identically from the same tier-1 sources with zero facts dropped:
 *
 *     Newcastle    2 easy /  9 medium / 16 hard
 *     Sunderland   0 easy /  1 medium / 27 hard
 *
 * Nothing about Sunderland's material is worse — a neutral just knows less about Sunderland, so
 * every fact rates harder, while the Sunderland fan who'd actually pick that quiz would find
 * plenty of them easy. No research produces a "neutral-easy" Sunderland fact, so a hard floor
 * demands supply that cannot exist at any budget.
 *
 * So: fill to the target where supply exists, then top up from what's left, easiest-first (a
 * short quiz should drift harder, not start harder). Arsenal still gets its easy questions;
 * Sunderland gets a full 15 from medium and hard instead of a 404.
 *
 * `usedFactKeys` is shared across every pick INCLUDING the top-up, so a top-up can never pull a
 * question built on a fact already dealt.
 */
export function fillToSize<T extends { id: string; fact_key?: string | null }>(
  pools: Record<string, T[]>,
  mix: Record<string, number>,
  size: number,
  usedFactKeys: Set<string> = new Set()
): T[] {
  const order = Object.keys(mix);
  const picked = order.flatMap((d) => pickDistinctFacts(pools[d] ?? [], mix[d], usedFactKeys));
  if (picked.length >= size) return picked;

  const chosen = new Set(picked.map((q) => q.id));
  const leftovers = order.flatMap((d) => pools[d] ?? []).filter((q) => !chosen.has(q.id));
  return [...picked, ...pickDistinctFacts(leftovers, size - picked.length, usedFactKeys)];
}
