"use strict";
/**
 * Fame / difficulty index — the linchpin of the generator.
 *
 * A per-player "how well-known are you" score (0–100) built from FPL ownership %,
 * price, and minutes. It does double duty:
 *   1. drives question DIFFICULTY (a question about two obscure players is harder), and
 *   2. keeps the EASY questions about famous players so beginners aren't lost.
 *
 * Fame is relative to the supplied pool (min–max normalized per metric), so it
 * self-calibrates each gameweek as prices/ownership move.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAME_WEIGHTS = void 0;
exports.buildFameIndex = buildFameIndex;
exports.closeness = closeness;
exports.comparisonDifficulty = comparisonDifficulty;
/** Weightings for the three fame signals (tunable). */
exports.FAME_WEIGHTS = { ownership: 0.4, price: 0.4, minutes: 0.2 };
function clamp01(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}
/** Build a fame index over a player pool. */
function buildFameIndex(players) {
    if (players.length === 0)
        return { fame: () => 0 };
    const maxOwn = Math.max(1, ...players.map((p) => p.ownership));
    const prices = players.map((p) => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = Math.max(0.1, maxPrice - minPrice);
    const maxMin = Math.max(1, ...players.map((p) => p.minutes));
    const map = new Map();
    for (const p of players) {
        const o = clamp01(p.ownership / maxOwn);
        const pr = clamp01((p.price - minPrice) / priceRange);
        const m = clamp01(p.minutes / maxMin);
        const f = exports.FAME_WEIGHTS.ownership * o + exports.FAME_WEIGHTS.price * pr + exports.FAME_WEIGHTS.minutes * m;
        map.set(p.id, Math.round(clamp01(f) * 100));
    }
    return { fame: (id) => map.get(id) ?? 0 };
}
/**
 * Closeness of two values, 0–100 (100 = identical, 0 = one is zero / far apart).
 * Closer values → a harder Higher/Lower question.
 */
function closeness(a, b) {
    const hi = Math.max(Math.abs(a), Math.abs(b));
    if (hi === 0)
        return 100;
    return Math.round((1 - Math.abs(a - b) / hi) * 100);
}
/**
 * Difficulty (0–100) for a two-player comparison: harder when the players are
 * obscure (low average fame) AND the values are close.
 */
function comparisonDifficulty(fameA, fameB, valueCloseness) {
    const obscurity = 100 - (fameA + fameB) / 2;
    const d = 0.5 * obscurity + 0.5 * valueCloseness;
    return Math.max(0, Math.min(100, Math.round(d)));
}
