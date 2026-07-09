/**
 * Your PL XI warm-up — the pure economy: grants + prices. No imports, safe
 * everywhere (API route, page, measurement script). Tuning dials live here;
 * deal logic (which needs the player pool) lives in warmup-deals.ts.
 */

export const r10 = (x: number) => Math.round(x * 10) / 10;

// ── Grants (£m) ───────────────────────────────────────────────────────────────
// Calibrated against what a DEAL can actually sell (founder, round 2): a random
// club's best option at one position usually tops out ~£6–8, so grants sit near
// that — not the £15 superstar ceiling.
export const GRANT_CORRECT = 6;
export const GRANT_WRONG = 4; // = the cheapest player's price: never stranded, zero slack
export const GRANT_STREAK_BONUS = 0.5; // per consecutive correct beyond the first…
export const GRANT_STREAK_CAP = 2; // …capped at +£1 (2 steps)

/** The budget grant (£m) for an answer given the streak AFTER it. */
export function grantFor(correct: boolean, streak: number): number {
  if (!correct) return GRANT_WRONG;
  const bonus = Math.min(GRANT_STREAK_CAP, Math.max(0, streak - 1)) * GRANT_STREAK_BONUS;
  return r10(GRANT_CORRECT + bonus);
}

// ── Perfection milestones ─────────────────────────────────────────────────────
// One-off scouting bonuses when TOTAL correct answers cross a threshold — the
// lever that lets a near-perfect round genuinely afford superstars (measured:
// without these, even 11/11 tops out around strength 78 = mid-table forever).
// Spread across the last three thresholds so the money lands while there are
// still picks that can absorb it (the attacking slots draft last in 4-3-3).
export const MILESTONES: { at: number; bonus: number }[] = [
  { at: 9, bonus: 10 },
  { at: 10, bonus: 10 },
  { at: 11, bonus: 10 },
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
