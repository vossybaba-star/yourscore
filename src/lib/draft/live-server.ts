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
import { GLOBAL_LEAGUE, genJoinCode, validateAndScore, type TeamSnapshot } from "./server";
import { seededRng, scoreTeam, canPlay, playerIdentity } from "./score";
import { slotsFor } from "./formations";
import { spin } from "./pool";
import { seededBot, realisticOpponentName } from "./opponent";
import type { Formation, League } from "./types";
import { asLeague } from "./types";
import {
  LIVE_CONFIG, nextPhase, resolveShootout, aggregate, simulateHalf, buildReport,
  type LivePhase, type MatchSim,
} from "./live-score";
import type { PlacedPlayer } from "./types";

export type Outcome = "p1" | "p2" | "draw";

// ─── Standings credit (points ladder: Win=3, Draw=1) ──────────────────────────

/**
 * Credit one match result to a player's standings (daily + all-time) for a board.
 * Delegates to the `draft_credit_result` Postgres function so the increment is a
 * single atomic statement (INSERT … ON CONFLICT … SET col = col + 1) — concurrent
 * finalizes for the same user can't lose increments (was a read-modify-write race).
 * The function also does the lazy daily reset of today-counters.
 */
export async function creditResult(
  db: SupabaseClient<DraftDatabase>,
  userId: string,
  displayName: string,
  result: "win" | "draw" | "loss",
  leagueId: string = GLOBAL_LEAGUE,
  competition: League = "PL"
): Promise<void> {
  await db.rpc("draft_credit_result", { p_user: userId, p_name: displayName, p_result: result, p_league: leagueId, p_competition: competition });
}

/** Win/loss/streak loop on a player's live team. Draws leave the streak untouched. */
export async function applyTeamStreak(
  db: SupabaseClient<DraftDatabase>,
  userId: string,
  result: "win" | "draw" | "loss",
  competition: League = "PL"
): Promise<void> {
  if (result === "draw") return;
  const { data: t } = await db.from("draft_teams").select("win_streak").eq("user_id", userId).eq("competition", competition).maybeSingle();
  if (!t) return;
  await db
    .from("draft_teams")
    .update({ win_streak: result === "win" ? (t.win_streak ?? 0) + 1 : 0, status: "active", updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("competition", competition);
}

// ─── Deadlines ────────────────────────────────────────────────────────────────

const TIMERS = LIVE_CONFIG.timers as Record<string, number>;

/** Once BOTH players are present, they have this long to ready up or the lobby is
 *  abandoned (so a queue/bot opponent who never readies can't hang the other). */
export const LOBBY_SECONDS = 60;
const isoIn = (secs: number): string => new Date(Date.now() + secs * 1000).toISOString();

/** ISO deadline for a phase, or null for phases with no clock (lobby/terminal). */
function deadlineFor(phase: LivePhase, now: number): string | null {
  const secs = TIMERS[phase];
  return secs ? new Date(now + secs * 1000).toISOString() : null;
}

// ─── Derived state ────────────────────────────────────────────────────────────

/** A bot opponent has no client, so it is always "ready" to start (lobby). For
 *  swap phases the client fires setBotReady 2 s after the human clicks Done, which
 *  sets p2_ready = true — this function then sees it and advances immediately. */
function bothReadyFor(row: DraftLiveMatchRow): boolean {
  if (row.phase === "draw_decision") {
    const p2Decided = row.is_bot ? true : row.p2_wants_pens !== null;
    return row.p1_wants_pens !== null && p2Decided;
  }
  // Bot is auto-ready for lobby (no client). For pregame_swap / halftime_swap the
  // client marks p2_ready explicitly (2 s after the human taps Done), so check the
  // column normally — gives the human the 2-second "thinking" window.
  const p2Ready = row.is_bot ? (row.phase === "lobby" || row.p2_ready) : row.p2_ready;
  return row.p1_ready && p2Ready;
}

/** A disguised bot makes its own changes server-side: re-spin `count` random
 *  slots (seeded, reproducible) and re-score — so its XI evolves between halves
 *  like a human's, and its second-half Strength shifts accordingly. */
function applyBotSwaps(squad: PlacedPlayer[], formation: Formation, count: number, seed: string): { squad: PlacedPlayer[]; strength: number } {
  const rng = seededRng(seed);
  const slots = slotsFor(formation);
  let next = squad.slice();
  for (let i = 0; i < count && next.length > 0; i++) {
    const target = next[Math.floor(rng() * next.length)];
    const slot = slots.find((s) => s.id === target.slot);
    if (!slot) continue;
    const usedIds = new Set(next.filter((p) => p.slot !== target.slot).map((p) => p.player_season_id));
    const usedNames = new Set(next.filter((p) => p.slot !== target.slot).map((p) => playerIdentity(p.name)));
    const legal = spin([slot.pos], usedIds, usedNames, rng).players.filter((p) => canPlay(p.position, slot.pos));
    if (legal.length === 0) continue;
    const c = legal[Math.floor(rng() * legal.length)];
    next = next.map((p) => p.slot === target.slot
      ? { slot: slot.id, slotPos: slot.pos, player_season_id: c.id, name: c.name, club: c.club, season: c.season, overall: c.overall, position: c.position }
      : p);
  }
  return { squad: next, strength: scoreTeam(next, formation) };
}

function botSwapPatch(row: DraftLiveMatchRow, count: number, seed: string): Partial<DraftLiveMatchRow> {
  if (!row.is_bot || !row.p2_squad) return {};
  const r = applyBotSwaps(row.p2_squad as PlacedPlayer[], (row.p2_formation ?? "4-3-3") as Formation, count, seed);
  return { p2_squad: r.squad as unknown as never, p2_strength: r.strength };
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
    case "pregame_swap":
      // Bot makes its 1 pre-match change as the window opens.
      return botSwapPatch(row, 1, `${row.id}:botpre`);
    case "halftime_swap":
      // Bot makes 1–2 changes at the break (human-like variation).
      return botSwapPatch(row, seededRng(`${row.id}:botn`)() < 0.5 ? 1 : 2, `${row.id}:bothalf`);
    case "half1": {
      // Full sim (goals + corners/throw-ins/scorers/assists/ratings) over the XIs
      // as they stand entering H1. side a = p1, b = p2.
      const s = simulateHalf((row.p1_squad ?? []) as PlacedPlayer[], (row.p2_squad ?? []) as PlacedPlayer[], 1, `${row.id}:h1`);
      return { h1_p1: s.goals.a, h1_p2: s.goals.b, sim: { h1: s } as unknown as never };
    }
    case "half2": {
      // Uses the post-halftime-swap squads/strengths; merge onto the stored H1.
      // Halftime subs carry an impact boost — the player you brought on is far
      // more likely to be the name on an H2 goal (columns added in migration 29;
      // absent pre-migration they read undefined → no boost, fail-soft).
      const r = row as DraftLiveMatchRow & { p1_sub_ids?: string[] | null; p2_sub_ids?: string[] | null };
      const s = simulateHalf(
        (row.p1_squad ?? []) as PlacedPlayer[], (row.p2_squad ?? []) as PlacedPlayer[], 2, `${row.id}:h2`,
        { impactA: r.p1_sub_ids ?? [], impactB: r.p2_sub_ids ?? [] }
      );
      const prev = (row.sim ?? {}) as MatchSim;
      return { h2_p1: s.goals.a, h2_p2: s.goals.b, sim: { ...prev, h2: s } as unknown as never };
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
  if (target === "result" || target === "abandoned") patch.resolved_at = new Date().toISOString();
  if (target === "result") {
    const outcome = outcomeWith(row, patch);
    patch.winner_id = outcome === "p1" ? row.p1_id : outcome === "p2" && !row.is_bot ? row.p2_id : null;
  }

  // Conditional, idempotent transition. `resolved_at IS NULL` is belt-and-braces so
  // a terminal phase can never be entered (and thus finalized) twice.
  const { data: updated } = await db
    .from("draft_live_matches")
    .update(patch)
    .eq("id", matchId)
    .eq("phase", row.phase)
    .is("resolved_at", null)
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
  if (!row.p1_id) return; // a match always has a creator; defensive against corrupt rows
  const agg = aggregateOf(row);
  const outcome = outcomeOf(row);
  const league = row.league_id ?? null;
  const comp = asLeague(row.competition);

  // Permanent record keyed on the match id — ON CONFLICT DO NOTHING so a stray
  // second finalize can never double-insert (and the credits below won't double-run,
  // since finalize is only reached once via the resolved_at-guarded transition).
  await db.from("draft_matches").upsert({
    id: row.id,
    challenger_id: row.p1_id,
    opponent_id: row.is_bot ? null : row.p2_id,
    challenger_team: sideSnapshot(row.p1_squad, row.p1_formation, row.p1_strength, row.p1_name) as unknown as never,
    opponent_team: sideSnapshot(row.p2_squad, row.p2_formation, row.p2_strength, row.p2_name) as unknown as never,
    challenger_strength: Number(row.p1_strength ?? 0),
    opponent_strength: Number(row.p2_strength ?? 0),
    winner_id: outcome === "p1" ? row.p1_id : outcome === "p2" && !row.is_bot ? row.p2_id : null,
    league_id: league,
    competition: comp,
    challenger_goals: agg.a,
    opponent_goals: agg.b,
    detail: { outcome, h1: { a: row.h1_p1, b: row.h1_p2 }, h2: { a: row.h2_p1, b: row.h2_p2 }, pens: row.pens_p1 !== null ? { a: row.pens_p1, b: row.pens_p2 } : null, report: buildReport((row.sim ?? {}) as MatchSim) } as unknown as never,
    played_at: new Date().toISOString(),
  }, { onConflict: "id", ignoreDuplicates: true });

  if (!row.ranked) return; // friendlies/casual don't touch the ladder

  const p1Res: "win" | "draw" | "loss" = outcome === "p1" ? "win" : outcome === "draw" ? "draw" : "loss";
  const p2Res: "win" | "draw" | "loss" = outcome === "p2" ? "win" : outcome === "draw" ? "draw" : "loss";

  if (row.p1_id) {
    await creditResult(db, row.p1_id, row.p1_name ?? "Player", p1Res, GLOBAL_LEAGUE, comp);
    if (league) await creditResult(db, row.p1_id, row.p1_name ?? "Player", p1Res, league, comp);
    await applyTeamStreak(db, row.p1_id, p1Res, comp);
  }
  // A bot has no auth user / standings row; only real opponents are credited.
  if (row.p2_id && !row.is_bot) {
    await creditResult(db, row.p2_id, row.p2_name ?? "Player", p2Res, GLOBAL_LEAGUE, comp);
    if (league) await creditResult(db, row.p2_id, row.p2_name ?? "Player", p2Res, league, comp);
    await applyTeamStreak(db, row.p2_id, p2Res, comp);
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

/** Mark the bot (p2) ready in a bot match, triggering an immediate advance.
 *  Only the human player (p1) may call this, and only during a swap window.
 *  The client fires this ~2 s after the human taps Done so the bot "mirrors" them. */
export async function setBotReady(db: SupabaseClient<DraftDatabase>, matchId: string, userId: string): Promise<DraftLiveMatchRow | null> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
  if (!row) return null;
  if (!row.is_bot) throw new Error("Not a bot match");
  if (row.p1_id !== userId) throw new Error("Not a participant");
  if (row.phase !== "pregame_swap" && row.phase !== "halftime_swap") throw new Error("Not a swap window");
  await db.from("draft_live_matches").update({ p2_ready: true, updated_at: new Date().toISOString() }).eq("id", matchId);
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

  // Halftime subs are recorded so the H2 sim can boost the incoming player's
  // scorer/assist odds (the "impact sub" mechanic). Each side only ever writes its
  // own column, so concurrent p1/p2 swaps can't clobber each other. Pregame swaps
  // play the whole match — no impact tag.
  const rowWithSubs = row as DraftLiveMatchRow & { p1_sub_ids?: string[] | null; p2_sub_ids?: string[] | null };
  const subPatch = row.phase === "halftime_swap"
    ? { [`${side}_sub_ids`]: [...(rowWithSubs[`${side}_sub_ids`] ?? []), newPlayerId] }
    : {};

  // `.gt(budgetCol, 0)` makes the decrement atomic: two concurrent swaps (double-
  // click / two tabs) serialize on the row lock, and the second re-evaluates the
  // guard against the now-0 budget and writes nothing — so the budget can't be
  // bypassed to fish for extra spins.
  const doUpdate = (extra: Record<string, unknown>) => db
    .from("draft_live_matches")
    .update({
      [`${side}_squad`]: scored.squad as unknown as never,
      [`${side}_strength`]: scored.strength,
      [budgetCol]: budget - 1,
      ...extra,
      updated_at: new Date().toISOString(),
    } as Partial<DraftLiveMatchRow>)
    .eq("id", matchId)
    .eq("phase", row.phase)
    .gt(budgetCol, 0)
    .select("*")
    .maybeSingle();

  const first = await doUpdate(subPatch);
  let updated = first.data;
  // Pre-migration-29 fallback: if the sub-tracking column doesn't exist yet, the
  // swap itself must still go through (just without the impact tag).
  if (!updated && first.error && Object.keys(subPatch).length > 0) {
    ({ data: updated } = await doUpdate({}));
  }
  if (!updated) throw new Error("No changes left");
  return updated;
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────

type Side = { squad: PlacedPlayer[]; formation: string; strength: number; name: string };
export type MatchmakeOpts = { ranked: boolean; leagueId: string | null; competition?: League };

/** A user's active saved XI as a match side, or null if they have no team yet. */
async function loadUserSide(db: SupabaseClient<DraftDatabase>, userId: string, competition: League = "PL"): Promise<Side | null> {
  // A user can hold one active team PER competition, so the competition is required
  // to pick the right one (a bare query would multi-row and throw on maybeSingle).
  const { data } = await db
    .from("draft_teams")
    .select("display_name, formation, squad, strength_rating")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("competition", competition)
    .maybeSingle();
  if (!data) return null;
  return {
    squad: (data.squad ?? []) as PlacedPlayer[],
    formation: data.formation,
    strength: Number(data.strength_rating),
    name: data.display_name ?? "Player",
  };
}

/** The user's current non-terminal match (as either side), or null. Used to enforce
 *  one active match per user so a queue pairing + a bot-fallback can't both spawn. */
async function findActiveMatch(db: SupabaseClient<DraftDatabase>, userId: string): Promise<DraftLiveMatchRow | null> {
  const { data } = await db.from("draft_live_matches").select("*")
    .or(`p1_id.eq.${userId},p2_id.eq.${userId}`)
    .not("phase", "in", "(result,abandoned)")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/** Friend lobby: create an open match with a shareable code (retries on collision). */
export async function createFriendMatch(db: SupabaseClient<DraftDatabase>, userId: string, opts: MatchmakeOpts): Promise<DraftLiveMatchRow> {
  const competition = asLeague(opts.competition);
  const side = await loadUserSide(db, userId, competition);
  if (!side) throw new Error("Save a team first");
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await db.from("draft_live_matches").insert({
      phase: "lobby", join_code: genJoinCode(), ranked: opts.ranked, league_id: opts.leagueId, competition, is_bot: false,
      p1_id: userId, p1_name: side.name, p1_squad: side.squad as unknown as never, p1_formation: side.formation, p1_strength: side.strength,
    }).select("*").maybeSingle();
    if (data) return data;
    if (error && !`${error.message}`.toLowerCase().includes("duplicate")) throw new Error(error.message);
  }
  throw new Error("Could not create a lobby — try again");
}

/** Friend join by code: claim the open p2 seat. */
export async function joinByCode(db: SupabaseClient<DraftDatabase>, userId: string, code: string): Promise<DraftLiveMatchRow> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!row) throw new Error("Lobby not found");
  if (row.phase !== "lobby") throw new Error("That game has already started");
  if (row.p1_id === userId) throw new Error("You're already in this lobby");
  if (row.p2_id) throw new Error("Lobby is full");
  // Join with the team in the lobby's competition (a PL lobby needs your PL XI).
  const side = await loadUserSide(db, userId, asLeague(row.competition));
  if (!side) throw new Error("Save a team first");
  // Claiming the seat also starts the lobby ready-clock (both players now present).
  const { data: updated } = await db.from("draft_live_matches").update({
    p2_id: userId, p2_name: side.name, p2_squad: side.squad as unknown as never, p2_formation: side.formation, p2_strength: side.strength,
    phase_deadline: isoIn(LOBBY_SECONDS),
  }).eq("id", row.id).eq("phase", "lobby").is("p2_id", null).select("*").maybeSingle();
  if (!updated) throw new Error("Lobby is full");
  return updated;
}

/** Random queue: discover an existing pairing, claim a waiter, or report waiting. */
export async function queueOrPair(
  db: SupabaseClient<DraftDatabase>, userId: string, opts: MatchmakeOpts
): Promise<{ status: "matched"; match: DraftLiveMatchRow } | { status: "waiting" }> {
  // 1. Already in a match? (a claimed waiter discovers it here; also enforces
  //    one-active-match so we never double-pair the same user)
  const existing = await findActiveMatch(db, userId);
  if (existing) return { status: "matched", match: existing };

  const competition = asLeague(opts.competition);
  const me = await loadUserSide(db, userId, competition);
  if (!me) throw new Error("Save a team first");

  // 2. Claim the oldest compatible waiter (same competition), or enqueue self.
  // p_league is genuinely nullable at the DB (the SQL pairs with
  // `league_id is not distinct from p_league`, i.e. null = the public queue).
  // The generated type declares it non-null, so cast to preserve the null value.
  const { data: oppId } = await db.rpc("draft_live_pair", { p_user: userId, p_ranked: opts.ranked, p_league: opts.leagueId as string, p_competition: competition });
  if (!oppId) return { status: "waiting" };

  const opp = await loadUserSide(db, oppId as string, competition);
  if (!opp) {
    // The matched waiter no longer has an active team — drop them and requeue self
    // rather than throwing at this (blameless) caller; keep finding.
    await db.from("draft_live_queue").delete().eq("user_id", oppId as string);
    await db.from("draft_live_queue").upsert({ user_id: userId, ranked: opts.ranked, league_id: opts.leagueId, competition }, { onConflict: "user_id" });
    return { status: "waiting" };
  }
  // The waiter (opp) was here first → becomes p1; the caller is p2. Both present, so
  // the lobby ready-clock starts immediately.
  const { data: match } = await db.from("draft_live_matches").insert({
    phase: "lobby", phase_deadline: isoIn(LOBBY_SECONDS), join_code: null, ranked: opts.ranked, league_id: opts.leagueId, competition, is_bot: false,
    p1_id: oppId as string, p1_name: opp.name, p1_squad: opp.squad as unknown as never, p1_formation: opp.formation, p1_strength: opp.strength,
    p2_id: userId, p2_name: me.name, p2_squad: me.squad as unknown as never, p2_formation: me.formation, p2_strength: me.strength,
  }).select("*").maybeSingle();
  if (!match) throw new Error("Matchmaking failed — try again");
  return { status: "matched", match };
}

/** Bot fallback: leave the queue and start a disguised ranked bot match now. */
export async function createBotMatch(db: SupabaseClient<DraftDatabase>, userId: string, opts: MatchmakeOpts): Promise<DraftLiveMatchRow> {
  // If a real pairing landed in the gap before this bot-fallback fired, play that
  // instead of spawning a second (concurrent) match for the same user.
  const existing = await findActiveMatch(db, userId);
  if (existing) return existing;

  const competition = asLeague(opts.competition);
  const me = await loadUserSide(db, userId, competition);
  if (!me) throw new Error("Save a team first");
  await db.from("draft_live_queue").delete().eq("user_id", userId);
  const id = crypto.randomUUID();
  const bot = seededBot(me.formation as Formation, id, competition);
  const { data: match } = await db.from("draft_live_matches").insert({
    id, phase: "lobby", phase_deadline: isoIn(LOBBY_SECONDS), join_code: null, ranked: opts.ranked, league_id: opts.leagueId, competition, is_bot: true,
    p1_id: userId, p1_name: me.name, p1_squad: me.squad as unknown as never, p1_formation: me.formation, p1_strength: me.strength,
    p2_id: null, p2_name: realisticOpponentName(id),
    p2_squad: bot.team.squad as unknown as never, p2_formation: bot.team.formation, p2_strength: bot.team.strength,
  }).select("*").maybeSingle();
  if (!match) throw new Error("Could not start a match");
  return match;
}

export async function leaveQueue(db: SupabaseClient<DraftDatabase>, userId: string): Promise<void> {
  await db.from("draft_live_queue").delete().eq("user_id", userId);
}

// ─── League directed challenges (Live-only leagues) ───────────────────────────
// A league match is a live invite aimed at one opponent: the challenger opens a
// lobby with invited_id set (no shareable code), the opponent accepts and claims
// the p2 seat, and both drop into the same live engine — which already credits the
// league board on finalize. Both players are expected online (the board only lets
// you challenge an online manager); an unaccepted challenge auto-expires.

/** How long a sent challenge stays open before it lapses (lobby deadline → the
 *  phase machine abandons it on the next advance). Short, because it's live. */
export const CHALLENGE_TTL_SECONDS = 150;

/** Open a directed league challenge against one opponent. Both must be league
 *  members; the challenger may only have one live match in flight (a second
 *  create resumes the existing one). */
export async function createLeagueChallenge(
  db: SupabaseClient<DraftDatabase>, challengerId: string, leagueId: string, opponentId: string, competitionRaw: League = "PL"
): Promise<DraftLiveMatchRow> {
  if (challengerId === opponentId) throw new Error("You can't challenge yourself");
  const competition = asLeague(competitionRaw);

  const { data: members } = await db
    .from("draft_league_members").select("user_id")
    .eq("league_id", leagueId).in("user_id", [challengerId, opponentId]);
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  if (!memberIds.has(challengerId) || !memberIds.has(opponentId)) {
    throw new Error("Both players must be in this league");
  }

  // One live match per challenger — resume rather than spawn a duplicate.
  const existing = await findActiveMatch(db, challengerId);
  if (existing) return existing;

  const side = await loadUserSide(db, challengerId, competition);
  if (!side) throw new Error("Save a team first");

  const id = crypto.randomUUID();
  const { data: match } = await db.from("draft_live_matches").insert({
    id, phase: "lobby", phase_deadline: isoIn(CHALLENGE_TTL_SECONDS), join_code: null,
    ranked: true, league_id: leagueId, competition, invited_id: opponentId, is_bot: false,
    p1_id: challengerId, p1_name: side.name, p1_squad: side.squad as unknown as never,
    p1_formation: side.formation, p1_strength: side.strength,
  }).select("*").maybeSingle();
  if (!match) throw new Error("Could not send the challenge — try again");
  return match;
}

/** Accept a directed challenge: claim the p2 seat (invited player only) and start
 *  the lobby ready-clock. Refuses if the accepter is mid-match elsewhere. */
export async function acceptChallenge(
  db: SupabaseClient<DraftDatabase>, userId: string, matchId: string
): Promise<DraftLiveMatchRow> {
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", matchId).maybeSingle();
  if (!row) throw new Error("Challenge not found");
  if (row.invited_id !== userId) throw new Error("This challenge isn't for you");
  if (row.phase !== "lobby") throw new Error("That challenge has expired");
  if (row.p2_id) throw new Error("Already accepted");

  const existing = await findActiveMatch(db, userId);
  if (existing && existing.id !== matchId) throw new Error("Finish your current match first");

  const side = await loadUserSide(db, userId, asLeague(row.competition));
  if (!side) throw new Error("Save a team first");

  // The challenger (p1) was here first; the accepter takes p2. Both present now →
  // start the ready clock (guarded so a double-accept can't reopen a claimed seat).
  const { data: updated } = await db.from("draft_live_matches").update({
    p2_id: userId, p2_name: side.name, p2_squad: side.squad as unknown as never,
    p2_formation: side.formation, p2_strength: side.strength,
    phase_deadline: isoIn(LOBBY_SECONDS), updated_at: new Date().toISOString(),
  }).eq("id", matchId).eq("phase", "lobby").is("p2_id", null).select("*").maybeSingle();
  if (!updated) throw new Error("That challenge has expired");
  return updated;
}

/** Decline (invited) or cancel (challenger) an unaccepted challenge. */
export async function dismissChallenge(
  db: SupabaseClient<DraftDatabase>, userId: string, matchId: string
): Promise<void> {
  const { data: row } = await db.from("draft_live_matches")
    .select("id, p1_id, invited_id, phase, p2_id").eq("id", matchId).maybeSingle();
  if (!row) return;
  if (row.p1_id !== userId && row.invited_id !== userId) throw new Error("Not your challenge");
  if (row.p2_id) throw new Error("That challenge was already accepted");
  await db.from("draft_live_matches")
    .update({ phase: "abandoned", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", matchId).eq("phase", "lobby").is("p2_id", null);
}

/** Pending + in-progress live matches relevant to a user inside one league, for
 *  the board: challenges they've been sent, and any match they're currently in. */
export async function leagueLiveStateFor(
  db: SupabaseClient<DraftDatabase>, leagueId: string, userId: string
): Promise<{
  incoming: { matchId: string; fromId: string; fromName: string; fromStrength: number }[];
  activeMatchId: string | null;
}> {
  const { data: rows } = await db.from("draft_live_matches")
    .select("id, p1_id, p2_id, invited_id, p1_name, p1_strength, phase")
    .eq("league_id", leagueId)
    .not("phase", "in", "(result,abandoned)");
  const incoming: { matchId: string; fromId: string; fromName: string; fromStrength: number }[] = [];
  let activeMatchId: string | null = null;
  for (const r of rows ?? []) {
    if ((r.p1_id === userId || r.p2_id === userId) && r.phase !== "lobby") activeMatchId = r.id;
    if (r.phase === "lobby" && r.invited_id === userId && !r.p2_id) {
      incoming.push({ matchId: r.id, fromId: r.p1_id ?? "", fromName: r.p1_name ?? "A manager", fromStrength: Number(r.p1_strength ?? 0) });
    }
    // A challenger waiting on their own sent challenge should also be able to resume it.
    if (r.phase === "lobby" && r.p1_id === userId && !r.p2_id) activeMatchId = activeMatchId ?? r.id;
  }
  return { incoming, activeMatchId };
}
