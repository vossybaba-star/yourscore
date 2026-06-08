/**
 * 38-0 Live Multiplayer — server-side match lifecycle (authoritative).
 *
 * The match is one `draft_live_matches` row advanced through the phase machine by
 * `advanceMatch`. Transitions are idempotent: each is a conditional UPDATE gated
 * on the expected current phase (`WHERE phase = $current`), so concurrent callers
 * (both clients pinging at the deadline) race once and only the winner mutates.
 * Goal/penalty resolution and swap validation all run here — the client is never
 * trusted for a rating or an outcome (mirrors server.ts).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftDatabase, DraftLiveMatchRow } from "@/types/draft-db";
import { GLOBAL_LEAGUE, validateAndScore, type TeamSnapshot } from "./server";
import { seededRng } from "./score";
import {
  LIVE_CONFIG, nextPhase, resolveHalfGoals, resolveShootout, aggregate,
  type LivePhase,
} from "./live-score";
import type { PlacedPlayer } from "./types";

export type Outcome = "p1" | "p2" | "draw";

// ─── Standings credit (points ladder: Win=3, Draw=1) ──────────────────────────

/**
 * Credit one match result to a player's standings (daily + all-time) for a board.
 * Lazy daily reset: today-counters zero when the last game was on a prior day.
 * Replaces the win-only creditWin now that ranked matches can draw.
 */
export async function creditResult(
  db: SupabaseClient<DraftDatabase>,
  userId: string,
  displayName: string,
  result: "win" | "draw" | "loss",
  leagueId: string = GLOBAL_LEAGUE
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: cur } = await db
    .from("draft_standings")
    .select("wins_today, draws_today, losses_today, wins_all_time, draws_all_time, losses_all_time, last_played_date, last_win_date")
    .eq("user_id", userId)
    .eq("league_id", leagueId)
    .maybeSingle();

  const sameDay = cur?.last_played_date === today;
  const t = {
    wins: sameDay ? cur!.wins_today : 0,
    draws: sameDay ? cur!.draws_today : 0,
    losses: sameDay ? cur!.losses_today : 0,
  };
  t[result === "win" ? "wins" : result === "draw" ? "draws" : "losses"] += 1;

  await db.from("draft_standings").upsert(
    {
      user_id: userId,
      display_name: displayName,
      league_id: leagueId,
      wins_today: t.wins,
      draws_today: t.draws,
      losses_today: t.losses,
      wins_all_time: (cur?.wins_all_time ?? 0) + (result === "win" ? 1 : 0),
      draws_all_time: (cur?.draws_all_time ?? 0) + (result === "draw" ? 1 : 0),
      losses_all_time: (cur?.losses_all_time ?? 0) + (result === "loss" ? 1 : 0),
      last_played_date: today,
      last_win_date: result === "win" ? today : (cur?.last_win_date ?? null),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,league_id" }
  );
}

/** Win/loss/streak loop on a player's live team. Draws leave the streak untouched. */
export async function applyTeamStreak(
  db: SupabaseClient<DraftDatabase>,
  userId: string,
  result: "win" | "draw" | "loss"
): Promise<void> {
  if (result === "draw") return;
  const { data: t } = await db.from("draft_teams").select("win_streak").eq("user_id", userId).maybeSingle();
  if (!t) return;
  await db
    .from("draft_teams")
    .update({ win_streak: result === "win" ? (t.win_streak ?? 0) + 1 : 0, status: "active", updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

// ─── Deadlines ────────────────────────────────────────────────────────────────

const TIMERS = LIVE_CONFIG.timers as Record<string, number>;

/** ISO deadline for a phase, or null for phases with no clock (lobby/terminal). */
function deadlineFor(phase: LivePhase, now: number): string | null {
  const secs = TIMERS[phase];
  return secs ? new Date(now + secs * 1000).toISOString() : null;
}

// ─── Derived state ────────────────────────────────────────────────────────────

/** A bot opponent has no client, so it is always "ready" to start (lobby). For
 *  timed phases the deadline drives advancement; Phase 6 adds human-like timing. */
function bothReadyFor(row: DraftLiveMatchRow): boolean {
  const p2Ready = row.is_bot ? true : row.p2_ready;
  if (row.phase === "draw_decision") {
    const p2Decided = row.is_bot ? true : row.p2_wants_pens !== null;
    return row.p1_wants_pens !== null && p2Decided;
  }
  return row.p1_ready && p2Ready;
}

function expired(row: DraftLiveMatchRow, now: number): boolean {
  return row.phase_deadline !== null && now >= Date.parse(row.phase_deadline);
}

function aggregateOf(row: DraftLiveMatchRow): { a: number; b: number; level: boolean } {
  return aggregate(
    { a: row.h1_p1 ?? 0, b: row.h1_p2 ?? 0 },
    { a: row.h2_p1 ?? 0, b: row.h2_p2 ?? 0 }
  );
}

function outcomeOf(row: DraftLiveMatchRow): Outcome {
  if (row.pens_p1 !== null && row.pens_p2 !== null) return row.pens_p1 > row.pens_p2 ? "p1" : "p2";
  const agg = aggregateOf(row);
  return agg.a > agg.b ? "p1" : agg.b > agg.a ? "p2" : "draw";
}

// ─── Transition ───────────────────────────────────────────────────────────────

/** Columns written when ENTERING a phase (goal/penalty resolution + the bot's
 *  draw-decision choice). The phase being entered resolves its own values. */
function resolutionForEntering(target: LivePhase, row: DraftLiveMatchRow): Partial<DraftLiveMatchRow> {
  const a = Number(row.p1_strength ?? 0);
  const b = Number(row.p2_strength ?? 0);
  switch (target) {
    case "half1": {
      const g = resolveHalfGoals(a, b, seededRng(`${row.id}:h1`));
      return { h1_p1: g.a, h1_p2: g.b };
    }
    case "half2": {
      const g = resolveHalfGoals(a, b, seededRng(`${row.id}:h2`));
      return { h2_p1: g.a, h2_p2: g.b };
    }
    case "draw_decision": {
      // A disguised bot decides immediately (deterministic; Phase 6 adds delay).
      return row.is_bot ? { p2_wants_pens: seededRng(`${row.id}:botpens`)() < 0.5 } : {};
    }
    case "penalties": {
      const p = resolveShootout(a, b, seededRng(`${row.id}:pens`));
      return { pens_p1: p.a, pens_p2: p.b };
    }
    default:
      return {};
  }
}

/**
 * Advance a match one phase if its transition condition is met. Idempotent: the
 * conditional UPDATE (`WHERE phase = $current`) means concurrent callers race once
 * and only the winner transitions; everyone re-reads the fresh row. On entering
 * `result`, finalizes the permanent record + standings (once).
 */
export async function advanceMatch(
  db: SupabaseClient<DraftDatabase>,
  matchId: string
): Promise<DraftLiveMatchRow | null> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
  if (!row) return null;

  const now = Date.now();
  const agg = aggregateOf(row);
  const target = nextPhase({
    phase: row.phase as LivePhase,
    bothReady: bothReadyFor(row),
    expired: expired(row, now),
    level: agg.level,
    bothWantPens: row.p1_wants_pens === true && row.p2_wants_pens === true,
  });
  if (target === row.phase) return row; // nothing to do

  const patch: Partial<DraftLiveMatchRow> = {
    phase: target,
    phase_deadline: deadlineFor(target, now),
    p1_ready: false,
    p2_ready: false,
    updated_at: new Date().toISOString(),
    ...resolutionForEntering(target, row),
  };
  if (target === "result") {
    patch.resolved_at = new Date().toISOString();
    const outcome = outcomeWith(row, patch);
    patch.winner_id = outcome === "p1" ? row.p1_id : outcome === "p2" && !row.is_bot ? row.p2_id : null;
  }

  // Conditional, idempotent transition.
  const { data: updated } = await db
    .from("draft_live_matches")
    .update(patch)
    .eq("id", matchId)
    .eq("phase", row.phase)
    .select("*")
    .maybeSingle();

  if (!updated) {
    // Lost the race — someone already advanced. Return the current row.
    const { data: fresh } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
    return fresh ?? row;
  }

  if (updated.phase === "result") await finalize(db, updated);
  return updated;
}

/** Outcome combining the row with the patch about to be written (so the final
 *  transition sees freshly-resolved penalties/goals). */
function outcomeWith(row: DraftLiveMatchRow, patch: Partial<DraftLiveMatchRow>): Outcome {
  const merged = { ...row, ...patch } as DraftLiveMatchRow;
  return outcomeOf(merged);
}

// ─── Finalize (once, on entering result) ──────────────────────────────────────

function sideSnapshot(squad: unknown, formation: string | null, strength: number | null, name: string | null): TeamSnapshot {
  return { name: name ?? "Player", formation: (formation ?? "4-3-3") as never, squad: (squad ?? []) as PlacedPlayer[], strength: Number(strength ?? 0), projected: null };
}

async function finalize(db: SupabaseClient<DraftDatabase>, row: DraftLiveMatchRow): Promise<void> {
  const agg = aggregateOf(row);
  const outcome = outcomeOf(row);
  const league = row.league_id ?? null;

  await db.from("draft_matches").insert({
    id: row.id,
    challenger_id: row.p1_id,
    opponent_id: row.is_bot ? null : row.p2_id,
    challenger_team: sideSnapshot(row.p1_squad, row.p1_formation, row.p1_strength, row.p1_name) as unknown as never,
    opponent_team: sideSnapshot(row.p2_squad, row.p2_formation, row.p2_strength, row.p2_name) as unknown as never,
    challenger_strength: Number(row.p1_strength ?? 0),
    opponent_strength: Number(row.p2_strength ?? 0),
    winner_id: outcome === "p1" ? row.p1_id : outcome === "p2" && !row.is_bot ? row.p2_id : null,
    league_id: league,
    challenger_goals: agg.a,
    opponent_goals: agg.b,
    detail: { outcome, h1: { a: row.h1_p1, b: row.h1_p2 }, h2: { a: row.h2_p1, b: row.h2_p2 }, pens: row.pens_p1 !== null ? { a: row.pens_p1, b: row.pens_p2 } : null } as unknown as never,
    played_at: new Date().toISOString(),
  });

  if (!row.ranked) return; // friendlies/casual don't touch the ladder

  const p1Res: "win" | "draw" | "loss" = outcome === "p1" ? "win" : outcome === "draw" ? "draw" : "loss";
  const p2Res: "win" | "draw" | "loss" = outcome === "p2" ? "win" : outcome === "draw" ? "draw" : "loss";

  if (row.p1_id) {
    await creditResult(db, row.p1_id, row.p1_name ?? "Player", p1Res);
    if (league) await creditResult(db, row.p1_id, row.p1_name ?? "Player", p1Res, league);
    await applyTeamStreak(db, row.p1_id, p1Res);
  }
  // A bot has no auth user / standings row; only real opponents are credited.
  if (row.p2_id && !row.is_bot) {
    await creditResult(db, row.p2_id, row.p2_name ?? "Player", p2Res);
    if (league) await creditResult(db, row.p2_id, row.p2_name ?? "Player", p2Res, league);
    await applyTeamStreak(db, row.p2_id, p2Res);
  }
}

// ─── Player-facing mutations ──────────────────────────────────────────────────

/** Which side a user is on, or null if not a participant. */
export function sideOf(row: DraftLiveMatchRow, userId: string): "p1" | "p2" | null {
  if (row.p1_id === userId) return "p1";
  if (row.p2_id === userId) return "p2";
  return null;
}

/** Mark a player ready/done for the current phase, then try to advance. */
export async function setReady(db: SupabaseClient<DraftDatabase>, matchId: string, userId: string): Promise<DraftLiveMatchRow | null> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
  if (!row) return null;
  const side = sideOf(row, userId);
  if (!side) throw new Error("Not a participant");
  await db.from("draft_live_matches").update({ [`${side}_ready`]: true, updated_at: new Date().toISOString() } as Partial<DraftLiveMatchRow>).eq("id", matchId);
  return advanceMatch(db, matchId);
}

/** Record a draw-decision choice (penalties vs take the draw), then try to advance. */
export async function setDrawChoice(db: SupabaseClient<DraftDatabase>, matchId: string, userId: string, wantsPens: boolean): Promise<DraftLiveMatchRow | null> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
  if (!row) return null;
  if (row.phase !== "draw_decision") throw new Error("Not in the draw decision");
  const side = sideOf(row, userId);
  if (!side) throw new Error("Not a participant");
  await db.from("draft_live_matches").update({ [`${side}_wants_pens`]: wantsPens, updated_at: new Date().toISOString() } as Partial<DraftLiveMatchRow>).eq("id", matchId);
  return advanceMatch(db, matchId);
}

/**
 * Apply one swap to a player's XI: replace `slotId`'s player with `newPlayerId`,
 * re-validate + re-score the whole XI authoritatively, and consume a change from
 * the current window's budget. Rejects out-of-phase / over-budget / past-deadline
 * / illegal swaps.
 */
export async function applyLiveSwap(
  db: SupabaseClient<DraftDatabase>,
  matchId: string,
  userId: string,
  slotId: string,
  newPlayerId: string
): Promise<DraftLiveMatchRow> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
  if (!row) throw new Error("Match not found");
  if (row.phase !== "pregame_swap" && row.phase !== "halftime_swap") throw new Error("Not a swap window");
  if (expired(row, Date.now())) throw new Error("Swap window closed");

  const side = sideOf(row, userId);
  if (!side) throw new Error("Not a participant");

  const budgetCol = row.phase === "pregame_swap" ? `${side}_pregame_left` : `${side}_half_left`;
  const budget = Number((row as unknown as Record<string, number>)[budgetCol] ?? 0);
  if (budget <= 0) throw new Error("No changes left");

  const squad = (side === "p1" ? row.p1_squad : row.p2_squad) as PlacedPlayer[] | null;
  const formation = side === "p1" ? row.p1_formation : row.p2_formation;
  if (!squad || !formation) throw new Error("No team to change");
  if (!squad.some((p) => p.slot === slotId)) throw new Error("Unknown slot");

  // Rebuild the XI with the swapped slot, then re-validate + re-score authoritatively.
  const input = squad.map((p) => ({ slot: p.slot, player_season_id: p.slot === slotId ? newPlayerId : p.player_season_id }));
  const scored = validateAndScore(formation, input);

  const { data: updated } = await db
    .from("draft_live_matches")
    .update({
      [`${side}_squad`]: scored.squad as unknown as never,
      [`${side}_strength`]: scored.strength,
      [budgetCol]: budget - 1,
      updated_at: new Date().toISOString(),
    } as Partial<DraftLiveMatchRow>)
    .eq("id", matchId)
    .eq("phase", row.phase)
    .select("*")
    .maybeSingle();
  if (!updated) throw new Error("Swap window closed");
  return updated;
}
