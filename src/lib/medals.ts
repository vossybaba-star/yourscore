/**
 * Medals — the achievement set.
 *
 * Two rules hold this together.
 *
 * 1. **Pride comes from rarity, not from box size.** Every medal carries the
 *    real share of players holding it. `pct` is measured against ACTIVE players
 *    (7,090 — anyone with a quiz attempt, lobby, WC run or season) on
 *    **2026-07-21**. Re-measure with `scripts/medal-rarity.sql`; a stale number
 *    here is a lie told confidently, so treat each as a dated fact.
 *
 * 2. **Thresholds are calibrated to the real distribution, never to instinct.**
 *    The measured base is far thinner than it feels: only 0.7% of players have
 *    ever answered 100 quiz questions, and 67% have a 38-0 win. So the 38-0
 *    ladder carries the volume and quiz tiers sit at 15/50/150 — an earlier
 *    draft gated an *accuracy* medal behind 100 answers, which made it a
 *    volume medal wearing an accuracy label.
 *
 * Social medals are deliberately absent: no player has 5 friends, so a social
 * ladder would be ~96% locked and would advertise an unused feature.
 */

export type MedalInputs = {
  playedAnything: boolean;
  matchWins: number;
  bestSeasonWins: number;
  invincibleSeason: boolean;
  wcTitles: number;
  wcFlawless: boolean;
  answered: number;
  lifetimeAccuracy: number | null; // 0..1
  perfectQuiz: boolean;
  fastCorrectMs: number | null; // quickest correct answer seen
  daysPlayed: number;
  gameTypesPlayed: number;
};

export type MedalGroup = "Start" | "38-0" | "Season" | "World Cup" | "Quiz" | "Habit" | "Range";

export type Medal = {
  id: string;
  label: string;
  glyph: string;
  group: MedalGroup;
  /** % of active players holding it, measured 2026-07-21 against prod. */
  pct: number;
  earned: boolean;
  /** Shown when locked — a target, never a scolding. */
  goal: string;
};

/** Rarer than this reads as legendary rather than merely good. */
export const LEGENDARY_PCT = 1;
export const RARE_PCT = 5;

const remain = (n: number, target: number) => Math.max(0, target - n);

export function allMedals(i: MedalInputs): Medal[] {
  const acc = i.lifetimeAccuracy;
  const accOver = (min: number, pct: number) => i.answered >= min && acc !== null && acc >= pct;

  return [
    // ── Start ── every new player should clear something in week one.
    { id: "debut", label: "Debut", glyph: "👋", group: "Start", pct: 100, earned: i.playedAnything, goal: "Play a game" },
    { id: "first-win", label: "First Blood", glyph: "⚔️", group: "Start", pct: 67.3, earned: i.matchWins >= 1, goal: "Win a 38-0 match" },
    { id: "opener", label: "Opener", glyph: "📖", group: "Start", pct: 14.7, earned: i.answered >= 15, goal: `${remain(i.answered, 15)} more answers` },

    // ── 38-0 ── the flagship, and where the player base actually is.
    { id: "winner", label: "Winner", glyph: "🥅", group: "38-0", pct: 15.0, earned: i.matchWins >= 10, goal: `${remain(i.matchWins, 10)} more wins` },
    { id: "veteran", label: "Veteran", glyph: "🎖️", group: "38-0", pct: 3.2, earned: i.matchWins >= 50, goal: `${remain(i.matchWins, 50)} more wins` },
    { id: "centurion", label: "Centurion", glyph: "💯", group: "38-0", pct: 1.1, earned: i.matchWins >= 100, goal: `${remain(i.matchWins, 100)} more wins` },
    { id: "double-century", label: "Double Ton", glyph: "⚡", group: "38-0", pct: 0.1, earned: i.matchWins >= 200, goal: `${remain(i.matchWins, 200)} more wins` },
    { id: "legend", label: "Legend", glyph: "👑", group: "38-0", pct: 0.03, earned: i.matchWins >= 500, goal: `${remain(i.matchWins, 500)} more wins` },

    // ── Season ──
    { id: "half-century", label: "Half Century", glyph: "📈", group: "Season", pct: 36.2, earned: i.bestSeasonWins >= 19, goal: "Win 19 in a season" },
    { id: "so-close", label: "So Close", glyph: "😤", group: "Season", pct: 0.69, earned: i.bestSeasonWins >= 35, goal: "Win 35 in a season" },
    { id: "invincible", label: "Invincible", glyph: "🛡️", group: "Season", pct: 0.1, earned: i.invincibleSeason, goal: i.bestSeasonWins > 0 ? `${38 - i.bestSeasonWins} wins short` : "Go 38-0" },

    // ── World Cup ──
    { id: "champion", label: "Champion", glyph: "🏆", group: "World Cup", pct: 19.9, earned: i.wcTitles >= 1, goal: "Win a WC run" },
    { id: "flawless", label: "Flawless", glyph: "✨", group: "World Cup", pct: 12.6, earned: i.wcFlawless, goal: "Win a run 8-0-0" },
    { id: "back-to-back", label: "Back to Back", glyph: "🔁", group: "World Cup", pct: 6.35, earned: i.wcTitles >= 2, goal: `${remain(i.wcTitles, 2)} more titles` },
    { id: "dynasty", label: "Dynasty", glyph: "🏛️", group: "World Cup", pct: 1.5, earned: i.wcTitles >= 5, goal: `${remain(i.wcTitles, 5)} more titles` },

    // ── Quiz ──
    { id: "quickdraw", label: "Quickdraw", glyph: "⚡", group: "Quiz", pct: 7.49, earned: i.fastCorrectMs !== null && i.fastCorrectMs < 2000, goal: "Correct in under 2s" },
    { id: "perfect", label: "Perfect", glyph: "🧠", group: "Quiz", pct: 1.1, earned: i.perfectQuiz, goal: "Full marks in a quiz" },
    { id: "sharp", label: "Sharp", glyph: "🎯", group: "Quiz", pct: 1.4, earned: accOver(50, 0.7), goal: i.answered < 50 ? `${remain(i.answered, 50)} more answers` : "Hit 70% accuracy" },
    { id: "marksman", label: "Marksman", glyph: "🏹", group: "Quiz", pct: 0.55, earned: accOver(50, 0.8), goal: i.answered < 50 ? `${remain(i.answered, 50)} more answers` : "Hit 80% accuracy" },
    { id: "scholar", label: "Scholar", glyph: "🎓", group: "Quiz", pct: 0.23, earned: i.answered >= 150, goal: `${remain(i.answered, 150)} more answers` },

    // ── Habit ── Ever-Present has NO holders. Deliberate: an unclaimed medal at
    // the top of the shelf is a real target, and "0 players have this" is the
    // strongest line on the page.
    { id: "regular", label: "Regular", glyph: "🔥", group: "Habit", pct: 8.8, earned: i.daysPlayed >= 3, goal: `Play ${remain(i.daysPlayed, 3)} more days` },
    { id: "devoted", label: "Devoted", glyph: "📅", group: "Habit", pct: 1.7, earned: i.daysPlayed >= 7, goal: `Play ${remain(i.daysPlayed, 7)} more days` },
    { id: "fortnight", label: "Fortnight", glyph: "🗓️", group: "Habit", pct: 0.24, earned: i.daysPlayed >= 14, goal: `Play ${remain(i.daysPlayed, 14)} more days` },
    { id: "ever-present", label: "Ever-Present", glyph: "🌟", group: "Habit", pct: 0, earned: i.daysPlayed >= 30, goal: `Play ${remain(i.daysPlayed, 30)} more days` },

    // ── Range ──
    { id: "all-rounder", label: "All-Rounder", glyph: "🎪", group: "Range", pct: 8.14, earned: i.gameTypesPlayed >= 3, goal: "Play all 3 games" },
  ];
}

/**
 * Shelf order: what you've won first (rarest first, so the flex leads), then
 * what's left with the COMMONEST first — the nearest rung, not the wildest
 * dream. A locked shelf led by "500 wins" tells a new player to give up.
 */
export function shelfOrder(medals: Medal[]): Medal[] {
  return [...medals].sort(
    (a, b) => Number(b.earned) - Number(a.earned) || (a.earned ? a.pct - b.pct : b.pct - a.pct)
  );
}

/** Colour by scarcity, so the eye ranks the shelf without reading a number. */
export function medalColor(pct: number): string {
  if (pct <= LEGENDARY_PCT) return "#ffc233";
  if (pct <= RARE_PCT) return "#00d8c0";
  return "#aeea00";
}
