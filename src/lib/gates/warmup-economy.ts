/**
 * YourScore Fantasy Football warm-up — the pure economy: grants + prices. No
 * imports, safe everywhere (API route, page, measurement script). Tuning dials
 * live here; deal logic (which needs the player pool) lives in warmup-deals.ts.
 */

export const r10 = (x: number) => Math.round(x * 10) / 10;

// ── Grants (£m) ───────────────────────────────────────────────────────────────
// COPY FPL (founder, round 4/5): the economy anchors to FPL — but FPL's £100m
// buys FIFTEEN players; the four-man bench eats ~£17m, so the honest XI budget
// is £83m. A PERFECT round earns exactly £83.0m — "FPL's £100m minus a real
// bench". 11 × £7 + (2+2+2) milestone = £83.0. Wrong = £4 (FPL's price floor:
// never stranded, zero slack). Measured (measure.sh): cutting the per-answer
// grant instead (£6 + big milestones) sank 8/11 to str 77 — the mid-tier lives
// on the per-answer grant, so the £17m bench comes out of the milestones. No
// streak cash — the streak's reward is bigger clubs in deals (warmup-deals.ts).
export const GRANT_CORRECT = 7;
export const GRANT_WRONG = 4;

/** The budget grant (£m) for an answer. (Streak drives deals, not cash.) */
export function grantFor(correct: boolean, _streak: number): number {
  return correct ? GRANT_CORRECT : GRANT_WRONG;
}

// ── Perfection milestones ─────────────────────────────────────────────────────
// One-off scouting bonuses when TOTAL correct answers cross a threshold — the
// lever that lets a near-perfect round genuinely afford superstars (measured:
// without these, even 11/11 tops out around strength 78 = mid-table forever).
// Spread across the last three thresholds so the money lands while there are
// still picks that can absorb it (the attacking slots draft last in 4-3-3).
export const MILESTONES: { at: number; bonus: number }[] = [
  { at: 9, bonus: 2 },
  { at: 10, bonus: 2 },
  { at: 11, bonus: 2 },
];

/** Bonus £m released by moving from `prevCorrect` to `nowCorrect` total correct. */
export function milestoneBonus(prevCorrect: number, nowCorrect: number): number {
  let sum = 0;
  for (const m of MILESTONES) if (prevCorrect < m.at && nowCorrect >= m.at) sum += m.bonus;
  return sum;
}

// ── Prices ────────────────────────────────────────────────────────────────────
/** Rating → price (£m). ONE global curve — a 75 costs the same at Watford as at
 *  City. 60 → £4.2 · 70 → £5.0 · 75 → £5.9 · 80 → £7.4 · 85 → £9.5 · 93 → £15. */
export const PRICE_EXP = 4.2;
export function priceOf(overall: number): number {
  const ov = Math.max(40, Math.min(93, overall));
  return r10(4 + 11 * Math.pow((ov - 40) / 53, PRICE_EXP));
}

/** Inverse of priceOf — gives 26/27-mode players a sim rating from their price. */
export function overallFromPrice(price: number): number {
  const p = Math.max(4, Math.min(15, price));
  return Math.round(40 + 53 * Math.pow((p - 4) / 11, 1 / PRICE_EXP));
}
