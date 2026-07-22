import { afLogEvent } from "@/lib/native/appsflyer";
import type { GameId } from "@/lib/analytics/trackGame";

// ── AppsFlyer semantic event layer ───────────────────────────────────────────
// One place that defines EVERY AppsFlyer in-app event + its parameters, so the
// event taxonomy stays consistent and the SKAN conversion schema / cohort reports
// have stable names to key on. Every helper is native-only (afLogEvent no-ops when
// isNative() === false) — but because the native app is a remote-URL wrapper of
// yourscore.app, these calls fire from ordinary web code when it runs inside the app.
//
// Naming: we use AppsFlyer's STANDARD event names (af_*) where one maps cleanly, so
// SRN partners (Meta/TikTok) and the dashboards give them rich treatment; custom
// names for the YourScore-specific moments. Keep names in sync with the SKAN schema.

// Fire an AppsFlyer in-app event once per device+key (used for milestones like the
// first game / a given streak day). Guarded so a null/unavailable storage never throws.
function onceKey(key: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    const k = `af:once:${key}`;
    if (window.localStorage.getItem(k)) return false;
    window.localStorage.setItem(k, "1");
    return true;
  } catch {
    return true; // storage blocked → don't suppress the event
  }
}

export type Game = GameId; // "38-0" | "quiz"
// Product modes are open-ended (draft, match, world_cup_run, live_h2h, multiplayer,
// solo, group, …) so `mode`/`result` are plain strings — we pass through whatever the
// call site already tags, rather than force a lossy enum.
export type OpponentType = "human" | "shadow" | "cpu";
export type InviteSurface =
  | "scorecard"
  | "shadow-revenge"
  | "league"
  | "h2h"
  | "live-result"
  | "lobby"
  | "other";

// ── Activation ───────────────────────────────────────────────────────────────

/** Enriched registration. Method = how they signed in; convertedFromGuest = they
 *  played as a guest first. Complements the base af_complete_registration in SignupPixel. */
export function afRegistration(opts: {
  method?: "apple" | "google" | "email" | "magic" | "unknown";
  convertedFromGuest?: boolean;
} = {}): void {
  void afLogEvent("af_complete_registration", {
    af_registration_method: opts.method ?? "unknown",
    converted_from_guest: !!opts.convertedFromGuest,
  });
}

/** Finished the native first-run onboarding carousel. AppsFlyer standard tutorial event. */
export function afOnboardingComplete(): void {
  void afLogEvent("af_tutorial_completion", { af_success: true });
}

// ── Play depth ───────────────────────────────────────────────────────────────

/** A completed game. Fire on every finished play-through. Also emits a one-time
 *  first_game_complete — the single best "this install is a real player" signal, the
 *  activation milestone the SKAN schema and quality-CPI analysis key on. */
export function afGameComplete(opts: {
  game: Game;
  mode: string;
  competition?: string; // WC | PL | LaLiga | custom pack id …
  result?: string; // win | loss | draw | …
  score?: number;
  isShadow?: boolean;
}): void {
  const params = {
    game: opts.game,
    mode: opts.mode,
    competition: opts.competition ?? "",
    result: opts.result ?? "",
    score: typeof opts.score === "number" ? opts.score : "",
    is_shadow: !!opts.isShadow,
  };
  void afLogEvent("game_complete", params);
  if (onceKey("first_game_complete")) {
    void afLogEvent("first_game_complete", params);
  }
}

/** Entered matchmaking for a multiplayer/versus game. opponentType captures the
 *  Human → Shadow → CPU chain so we can see how deep real players get. */
export function afVersusMatchmake(opts: {
  game: Game;
  opponentType: OpponentType;
  packId?: string;
}): void {
  void afLogEvent("versus_matchmake", {
    game: opts.game,
    opponent_type: opts.opponentType,
    pack_id: opts.packId ?? "",
  });
}

// ── Virality ─────────────────────────────────────────────────────────────────

/** A share/invite was sent. THE viral event — powers K-factor and paid→organic
 *  uplift. surface = which product surface, channel = share sheet / copy / social. */
export function afInviteSent(opts: { surface: InviteSurface; channel?: string }): void {
  void afLogEvent("af_invite", {
    af_invite_channel: opts.channel ?? "share_sheet",
    surface: opts.surface,
  });
}

// ── Social lock-in ───────────────────────────────────────────────────────────

export function afLeagueCreate(opts: { leagueType?: string } = {}): void {
  void afLogEvent("league_create", { league_type: opts.leagueType ?? "" });
}

export function afLeagueJoin(opts: { leagueType?: string } = {}): void {
  void afLogEvent("league_join", { league_type: opts.leagueType ?? "" });
}

// ── Retention / habit ────────────────────────────────────────────────────────

/** The player came back and played on a *later calendar day* than their first-ever
 *  play — the D2+ retention milestone. Fires once per device. This is the "did they
 *  return" signal ad pixels need to build repeat-player audiences and lookalikes off
 *  genuinely retained users; the web fan-out lives in trackGame's fireReturnPlay, and
 *  this is its native (AppsFlyer) arm. Once-guarded here too, belt-and-braces, since a
 *  milestone must never double-count. `daysSinceFirst` = calendar days since first play.
 *  (A finer-grained per-day streak_day event was considered and deliberately left out —
 *  the one return milestone is the audience-defining signal; per-day counts add noise.) */
export function afReturnPlay(game: Game, daysSinceFirst: number): void {
  if (!onceKey("return_play")) return;
  void afLogEvent("return_play", { game, days_since_first: daysSinceFirst });
}

/** User opted in to push. Retention lever + audience. Once-guarded because push
 *  registration re-runs on every launch/resume. */
export function afPushOptIn(): void {
  if (!onceKey("push_opt_in")) return;
  void afLogEvent("push_opt_in", {});
}
