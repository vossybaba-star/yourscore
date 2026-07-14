/**
 * daily-nudge.ts — the per-user copy engine for the one daily play-reminder push.
 *
 * PURE + dependency-free on purpose: no `@/` imports, no Supabase, no Next. The
 * cron (src/app/api/cron/daily-nudge/route.ts) does all the data loading and
 * hands a ready NudgeContext to buildDailyNudge(); this file only decides what to
 * say. That keeps it unit-testable: run `scripts/notify/run-tests.sh` (the imports
 * are extensionless per repo convention, so Node's ESM loader can't run the test
 * file directly — the script compiles to CJS first, as scripts/draft does).
 *
 * Frequency guarantees (the "not overkill" contract):
 *  - At most ONE push per user per day (the cron uses a shared `daily-push:<date>`
 *    dedupe key + each user sits in a single send-hour bucket).
 *  - Nobody who already played today is nudged (they're already engaged).
 *  - A non-playing user is only nudged on set days since their last play
 *    (NUDGE_DAYS), so they are never pinged daily. The one exception is a live
 *    streak (they played yesterday) — that reminder is self-limiting because it
 *    stops the moment the streak breaks.
 *
 * Priority ladder (first match wins). Higher = more specific / higher intent:
 *   1 streak at risk · 2 rival in reach · 3 beat your last score ·
 *   4 play with friends · 5 win-back by game (8+ days idle) ·
 *   6 the daily WC drop (the founder's locked copy) / a light generic nudge.
 *
 * House style: no em-dashes, "friend" not "mate", natural sentences, ~1 emoji.
 */

export type PrimaryGame = "wc" | "38" | "quiz" | null;

export type NudgeKind =
  | "streak"
  | "rival"
  | "beat-last"
  | "friends"
  | "winback-wc"
  | "winback-38"
  | "winback-quiz"
  | "wc-daily"
  | "generic";

export interface NudgeContext {
  /** First name (or handle) for greetings; null → no greeting. */
  firstName: string | null;
  /** Played any game today (UK day)? If so we never nudge. */
  playedToday: boolean;
  /** Whole days since their most recent play; null = never played. */
  daysSinceLastPlay: number | null;
  /** Consecutive play-days ending today or yesterday. */
  dayStreak: number;
  hasFriends: boolean;
  primaryGame: PrimaryGame;
  /** From get_yourscore_rank: the player one rank above + the gap to them. */
  aheadName: string | null;
  aheadGap: number | null;
  /** Their most recent quiz score + the pack it was on (for "beat your last"). */
  lastPackName: string | null;
  lastScore: number | null;
  /** Is today's daily World Cup Mastermind pack published? Drives the fallback. */
  wcPackLive: boolean;
}

export interface NudgeCopy {
  title: string;
  body: string;
  url: string;
  kind: NudgeKind;
}

// A 2+ day run is worth protecting; a single day isn't a "streak" yet.
export const STREAK_MIN = 2;
// Roughly what one good game can close — keeps the rival hook believable.
export const RIVAL_GAP_MAX = 1500;
// Days-since-last-play on which a non-player may be nudged. Deliberately sparse
// so re-engagement never becomes a daily nag; sunsets after 30 days idle.
export const NUDGE_DAYS: ReadonlySet<number> = new Set([1, 3, 7, 14, 30]);
// A user idle this long is in win-back territory (matches the "cooling"+ tiers).
const WINBACK_MIN_DAYS = 8;

const GAME_URL: Record<Exclude<PrimaryGame, null>, string> = {
  wc: "/38-0/wc",
  "38": "/38-0",
  quiz: "/play",
};
function gameUrl(g: PrimaryGame): string {
  return g ? GAME_URL[g] : "/play";
}

export function buildDailyNudge(ctx: NudgeContext): NudgeCopy | null {
  // Never nudge someone who already played today — they're engaged.
  if (ctx.playedToday) return null;

  const name = ctx.firstName?.trim() || null;

  // 1. Streak at risk — highest intent, self-limiting (only exists while playing).
  if (ctx.dayStreak >= STREAK_MIN) {
    return {
      kind: "streak",
      title: `🔥 ${name ? `${name}, keep` : "Keep"} your streak alive`,
      body: `You're on a ${ctx.dayStreak}-day run. One game today keeps it going.`,
      url: gameUrl(ctx.primaryGame),
    };
  }

  // Everything below is a spaced re-engagement nudge: only on set days since the
  // last play, so a non-player is never pinged daily.
  const days = ctx.daysSinceLastPlay;
  if (days == null || !NUDGE_DAYS.has(days)) return null;

  // 2. Rival in reach — social + concrete.
  if (ctx.aheadName && ctx.aheadGap != null && ctx.aheadGap > 0 && ctx.aheadGap <= RIVAL_GAP_MAX) {
    return {
      kind: "rival",
      title: `You're closing in on ${ctx.aheadName}`,
      body: `Just ${ctx.aheadGap.toLocaleString()} points behind them. One good game and you're past.`,
      url: gameUrl(ctx.primaryGame),
    };
  }

  // 3. Beat your last score — references their actual last game.
  if (ctx.lastPackName && ctx.lastScore != null && ctx.lastScore > 0) {
    return {
      kind: "beat-last",
      title: `Can you beat ${ctx.lastScore.toLocaleString()}? 🎯`,
      body: `That was your last score on ${ctx.lastPackName}. Have another go.`,
      url: "/play",
    };
  }

  // 4. Play with friends — only when they actually have friends to play.
  if (ctx.hasFriends) {
    return {
      kind: "friends",
      title: "Line up a game with your friends 👥",
      body: "Challenge a friend and see who really knows their football.",
      url: gameUrl(ctx.primaryGame),
    };
  }

  // 5. Win-back by the game they actually play (8+ days idle).
  if (days >= WINBACK_MIN_DAYS) {
    if (ctx.primaryGame === "wc") {
      return {
        kind: "winback-wc",
        title: `${name ? `${name}, today` : "Today"}'s World Cup XI is live 🧠`,
        body: "Draft yours and climb back up the board.",
        url: "/38-0/wc",
      };
    }
    if (ctx.primaryGame === "38") {
      return {
        kind: "winback-38",
        title: "Your 38-0 team's gone stale",
        body: "Build a fresh XI and go get a result.",
        url: "/38-0",
      };
    }
    if (ctx.primaryGame === "quiz") {
      return {
        kind: "winback-quiz",
        title: "Fresh quiz on today ⚽",
        body: "See if you've still got the knowledge.",
        url: "/play",
      };
    }
  }

  // 6. Fallback — the daily World Cup drop (the founder's LOCKED copy, verbatim)
  // when today's pack is live.
  if (ctx.wcPackLive) {
    return {
      kind: "wc-daily",
      title: "World Cup Mastermind Daily is live 🧠",
      body: "Draft your XI Now! Nail it and top the board!",
      url: "/38-0/wc",
    };
  }

  // 6b. No WC pack today — a light, game-appropriate nudge.
  return {
    kind: "generic",
    title: "Ready for today's game? ⚽",
    body: "Jump in and put a score on the board.",
    url: gameUrl(ctx.primaryGame),
  };
}
