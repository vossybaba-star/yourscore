/**
 * Fantasy server orchestration — the only layer that touches the DB. Pure rules
 * live in engine.ts; question serving reuses the gates layer verbatim. Credits
 * are minted in exactly one place (completeRound inside stepRound) and spent in
 * exactly one place (applyTransferTx). Scoring recomputes from the locked
 * snapshot — never accumulates — so re-runs are harmless.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import poolJson from "@/data/gates/pool.json";
import { buildRound, clientView, grade, questionKey, type Round } from "@/lib/gates/serve";
import type { GateQuestion } from "@/lib/gates/types";
import {
  applyTransfer, availableChips, BASELINE_CREDITS_PER_GW, CHIPS, chipPlayable, creditsForRound,
  grantBaseline, playedChipThisMonth, raisePending, scoreEntry, smartDefaults, transferCost,
  validateSelection, validateSquad,
  RuleError, type Chip, type ChipPlay, type LockedSelection, type Squad, type SquadPick,
} from "./engine";
import { monthKeyOf } from "./months";
import { aggregateFixtures, fetchGwFixtures, toPlayerScores } from "./ingest";
import { SCORING_VERSION, ZERO_FACTS, type MatchFacts } from "./values";
import { enginePool, fantasyPool, pricedPool } from "./pool";
import { loadFixtureSet, fixtureStatusFor } from "./captainAssist";
import { isOpenForEdits, type GwRow } from "./gameweeks";
import { FORM_WINDOW_GWS, type NewsClubRun, type NewsTickerCell, type NewsDoc } from "./news";
import {
  flagSquad, resolveAvailability, unwrapRead, buildPlayerProfile,
  type AvailabilityInfo, type ProfileGw, type SquadUpdateItem, type SquadUpdateStatus,
  type SeasonTotals, type Projection,
} from "./advice";
import { fetchFplBootstrapCached, type FplBootstrap } from "@/lib/gates/fpl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const GATES = poolJson as unknown as { version: string; questions: GateQuestion[] };
const ROUND_LEN = 11;

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") { super(message); }
}
const asHttp = (e: unknown): never => {
  if (e instanceof RuleError) throw new HttpError(400, e.message, e.code);
  throw e;
};

// ── rows ──────────────────────────────────────────────────────────────────────
export interface SquadRow {
  user_id: string; picks: SquadPick[]; bank_tenths: number; credits: number;
  xi: number[]; bench: number[]; captain: number; vice: number; version: number;
  created_gw: number;
  chip_log: ChipPlay[];
  pending_credits: number; pending_gameday_done: boolean; pending_source: string | null;
}
export interface EntryRow {
  user_id: string; gw: number; status: string;
  round_version: string | null; round_answers: (number | null)[];
  round_correct: number; round_credits: number; round_done_at: string | null;
  transfers: unknown[]; hits: number; chip: Chip | null; cash_points: number;
  picks: SquadPick[] | null; xi: number[] | null; bench: number[] | null;
  captain: number | null; vice: number | null; locked_at: string | null;
  points: number | null; points_breakdown: unknown | null;
  autosubs: unknown | null; captain_used: number | null; scored_at: string | null;
}

const squadShape = (r: SquadRow): Squad => ({ picks: r.picks, bankTenths: r.bank_tenths });

/** Which gameweek are we on?
 *
 *  LIVE: the gameweek belongs to the SEASON, not to you. Everyone is on the same
 *  one and it moves at the deadline whether you opened the app or not — so it's
 *  read off the calendar's own status, which the cron drives (season.ts).
 *
 *  REPLAY: the sandbox is single-player and self-paced, so it stays per-user —
 *  the earliest gameweek you haven't finalised. A just-scored week stays put
 *  until you choose to move on. */
async function currentGw(db: Db, userId: string): Promise<GwRow> {
  const { data: gws, error } = await db.from("fantasy_gameweeks")
    .select("*").order("gw", { ascending: true });
  if (error) throw new HttpError(500, error.message);
  if (!gws?.length) throw new HttpError(409, "no gameweeks", "no-gw");

  // A live season owns the game outright, so ANY live row wins — not just when the
  // lowest-numbered gameweek happens to be live. Reading mode off gws[0] meant a
  // single leftover replay demo row (which sorts first) silently put the whole game
  // back in replay: every squad priced at seed, every sale refunded at what you paid.
  const live = (gws as GwRow[]).filter((g) => g.mode === "live");
  if (live.length) {
    return (live.find((g) => g.status !== "final") ?? live[live.length - 1]) as GwRow;
  }

  const { data: entries } = await db.from("fantasy_entries")
    .select("gw, status").eq("user_id", userId);
  const finalOf = new Map((entries ?? []).map((e: { gw: number; status: string }) => [e.gw, e.status]));
  const current = gws.find((g: GwRow) => finalOf.get(g.gw) !== "final") ?? gws[gws.length - 1];
  return current as GwRow;
}

/** How many gameweeks in the season, and how many the user has finalised. */
async function seasonProgress(db: Db, userId: string, gw: GwRow) {
  const { data: gws } = await db.from("fantasy_gameweeks").select("gw");
  const total = gws?.length ?? 1;
  const { data: done } = await db.from("fantasy_entries")
    .select("gw").eq("user_id", userId).eq("status", "final");
  return { gw: gw.gw, total, finalised: done?.length ?? 0 };
}
async function getSquad(db: Db, userId: string): Promise<SquadRow | null> {
  const { data, error } = await db.from("fantasy_squads").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return (data as SquadRow) ?? null;
}
async function getEntry(db: Db, userId: string, gw: number): Promise<EntryRow | null> {
  const { data, error } = await db.from("fantasy_entries")
    .select("*").eq("user_id", userId).eq("gw", gw).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return (data as EntryRow) ?? null;
}
/** Has the user ever locked a gameweek? (i.e. their season has started.) */
async function hasLockedEntry(db: Db, userId: string): Promise<boolean> {
  const { data } = await db.from("fantasy_entries")
    .select("gw").eq("user_id", userId).not("locked_at", "is", null).limit(1);
  return !!data?.length;
}
/** Free squad rebuild is allowed ONLY pre-season — before you've ever locked a
 *  gameweek. Once the season has started, the team changes via transfers only.
 *  (The demo stepper's "Squad setup" resets to pre-season for testing.) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _gw kept for call-site symmetry
async function canRebuild(db: Db, userId: string, _gw: GwRow): Promise<boolean> {
  return !(await hasLockedEntry(db, userId));
}

async function ensureEntry(db: Db, userId: string, gw: number): Promise<EntryRow> {
  const existing = await getEntry(db, userId, gw);
  if (existing) return existing;
  const { error } = await db.from("fantasy_entries")
    .insert({ user_id: userId, gw }).select().single();
  if (error && !error.message.includes("duplicate")) throw new HttpError(500, error.message);
  return (await getEntry(db, userId, gw))!;
}

// ── state (the one-call hub payload) ─────────────────────────────────────────
/**
 * Which of a manager's players the feed has actually reported on yet.
 *
 * A row in `fantasy_player_scores` exists only once the player's fixture has been
 * ingested, so its presence is what separates the three live states the result
 * card could not previously tell apart:
 *
 *   row + minutes > 0  → played (or playing)
 *   row + minutes = 0  → in the squad, didn't get on
 *   no row             → their match hasn't been ingested yet, still to come
 *
 * Without this the breakdown fills missing players in with ZERO_FACTS, so a
 * Sunday-evening kickoff was indistinguishable from an unused substitute — both
 * rendered "Didn't play" while the points were still to come.
 */
async function reportedPlayers(db: Db, gw: number, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from("fantasy_player_scores")
    .select("player_id").eq("gw", gw).in("player_id", ids);
  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as { player_id: number }[]).map((r) => r.player_id);
}

export async function getState(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  const entry = squad ? await getEntry(db, userId, gw.gw) : null;
  // Only while a score exists — one extra read on the live/result screens, none
  // on the open ones.
  const reported = entry?.scored_at && squad
    ? await reportedPlayers(db, gw.gw, squad.picks.map((p) => p.id))
    : [];
  return {
    gw,
    season: await seasonProgress(db, userId, gw),
    poolVersion: fantasyPool().version,
    openForEdits: isOpenForEdits(gw, entry),
    squad: squad && {
      picks: squad.picks, bankTenths: squad.bank_tenths, credits: squad.credits,
      xi: squad.xi, bench: squad.bench, captain: squad.captain, vice: squad.vice,
      version: squad.version,
      // "Earned for next week": the pending tray. Visible now, spendable when the
      // next gameweek opens (finaliseGameweek pours it into `credits`).
      earnedForNextGw: squad.pending_credits, earnedSource: squad.pending_source,
    },
    chips: squad && {
      // Monthly rotation: what you can play right now, and whether this month's
      // one is already spent. No "held count" — you simply have the current set.
      available: availableChips(squad.chip_log, monthKeyOf(gw)),
      playedThisMonth: playedChipThisMonth(squad.chip_log, monthKeyOf(gw)),
      playedThisGw: entry?.chip ?? null,
    },
    entry: entry && {
      status: entry.status,
      round: {
        answered: entry.round_answers.length, correct: entry.round_correct,
        creditsEarned: entry.round_credits, done: !!entry.round_done_at,
      },
      transfers: entry.transfers.length, hits: entry.hits,
      lockedAt: entry.locked_at,
      result: entry.scored_at ? {
        points: entry.points, breakdown: entry.points_breakdown,
        autosubs: entry.autosubs, captainUsed: entry.captain_used,
        /** PROVISIONAL while the entry is still `locked` — the tick re-scores every
         *  10 minutes through the weekend and only promotes the status once the
         *  matches are actually over. Without this flag the hub read `scored_at`
         *  as "finished" and headlined a Saturday-lunchtime total as the final
         *  result, three fixtures into a ten-fixture gameweek. */
        provisional: entry.status === "locked",
        scoredAt: entry.scored_at,
        /** Players whose fixture the feed has reported. See reportedPlayers(). */
        reported: reported,
      } : null,
    },
    canRebuild: squad ? await canRebuild(db, userId, gw) : true,
  };
}

// ── squad build / pre-season rebuild ─────────────────────────────────────────
// First build inserts. A player who hasn't started their season (or is in the
// replay sandbox) can freely REBUILD — the whole squad is replaced, no wipe to
// an empty slate. Once the live season starts, only transfers change the team.
export async function createSquad(db: Db, userId: string, body: {
  pickIds: number[]; xi?: number[]; bench?: number[]; captain?: number; vice?: number;
}) {
  const gw = await currentGw(db, userId);
  const existing = await getSquad(db, userId);
  if (existing && !(await canRebuild(db, userId, gw)))
    throw new HttpError(409, "your season has started — change your team with transfers, not a rebuild", "started");

  let squad: Squad;
  const priced = await pricedPool(db, gw.gw);
  try { squad = validateSquad(body.pickIds, priced); } catch (e) { asHttp(e); throw e; }
  const sel = body.xi && body.bench && body.captain && body.vice
    ? (() => { try { return validateSelection(squad, body.xi!, body.bench!, body.captain!, body.vice!); } catch (e) { asHttp(e); throw e; } })()
    : smartDefaults(squad, priced);

  const row = {
    user_id: userId, picks: squad.picks, bank_tenths: squad.bankTenths,
    // The baseline transfer for the gameweek you're joining. Everywhere else it
    // is granted when the PREVIOUS gameweek finalises, which means the very first
    // week of a season handed out nothing — a manager built a squad and had zero
    // moves while the screen above it read "everyone gets a move each gameweek",
    // and the only way to change anything was a −4 hit. A fixed value, not an
    // increment, so a pre-season rebuild resets it rather than farming it.
    credits: BASELINE_CREDITS_PER_GW,
    xi: sel.xi, bench: sel.bench, captain: sel.captain, vice: sel.vice,
    created_gw: gw.gw, updated_at: new Date().toISOString(),
  };
  // Upsert so a rebuild replaces the row in place (credits reset — you're pre-season).
  const { error } = await db.from("fantasy_squads").upsert(row, { onConflict: "user_id" });
  if (error) throw new HttpError(500, error.message);
  // Rebuilding clears the current gameweek's entry so a fresh round/lock starts clean.
  if (existing) await db.from("fantasy_entries").delete().eq("user_id", userId).eq("gw", gw.gw);
  return getState(db, userId);
}

// ── full reset (dev/testing only: wipe squad + all entries) ──────────────────
/** Destroys a season: the squad and every entry, scores and history included.
 *  Replay/demo only — in a live season a stray POST here would wipe a real
 *  manager's year with nothing to restore it from. */
export async function resetSquad(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  if (gw.mode !== "replay") throw new HttpError(403, "reset is disabled during a live season", "live");
  await db.from("fantasy_entries").delete().eq("user_id", userId);
  await db.from("fantasy_squads").delete().eq("user_id", userId);
  return { ok: true };
}

/** Recent YourScore points per player, for the gameweeks already scored.
 *
 *  A transfer is the sharp end of this game — you spend a hard-earned credit, or
 *  4 points — and until now you made it blind, choosing off price alone. This is
 *  the evidence: what each player has ACTUALLY scored in our scoring, not FPL's.
 *  Ordered oldest → newest so the array reads left-to-right like a form guide. */
export async function recentForm(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  const gws = [gw.gw - 3, gw.gw - 2, gw.gw - 1].filter((g) => g >= 1);
  if (!gws.length) return { gws: [], points: {} as Record<number, number[]> };

  const { data, error } = await db.from("fantasy_player_scores")
    .select("gw, player_id, points").in("gw", gws);
  if (error) throw new HttpError(500, error.message);

  const byPlayer = new Map<number, Map<number, number>>();
  for (const r of (data ?? []) as { gw: number; player_id: number; points: number }[]) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, new Map());
    byPlayer.get(r.player_id)!.set(r.gw, r.points);
  }
  // A player absent from a scored gameweek didn't feature — that's a 0, and it's
  // information, so don't leave a hole in the form line.
  const points: Record<number, number[]> = {};
  byPlayer.forEach((m, pid) => { points[pid] = gws.map((g) => m.get(g) ?? 0); });
  return { gws, points };
}

// ── demo jump (replay sandbox only) — set the prototype to a named phase so the
//    weekly journey can be walked and evaluated: open ↔ result. "setup" (squad
//    build/rebuild) is a client route; "preseason" clears the entry like "open"
//    but the UI frames it as pre-kickoff. ────────────────────────────────────
export async function demoJump(db: Db, userId: string, phase: string) {
  const gw = await currentGw(db, userId);
  if (gw.mode !== "replay") throw new HttpError(403, "demo controls are replay-only", "live");
  if (!(await getSquad(db, userId))) throw new HttpError(409, "build a squad first", "no-squad");
  if (phase === "setup") {
    // Back to pre-season: clear ALL entries so no gameweek is locked → free rebuild.
    await db.from("fantasy_entries").delete().eq("user_id", userId);
    return getState(db, userId);
  }
  if (phase === "open" || phase === "preseason") {
    await db.from("fantasy_entries").delete().eq("user_id", userId).eq("gw", gw.gw);
    return getState(db, userId);
  }
  if (phase === "result") {
    const entry = await getEntry(db, userId, gw.gw);
    if (entry?.scored_at) return getState(db, userId);
    return lockAndScore(db, userId); // snapshot + score the current squad now
  }
  throw new HttpError(400, "unknown demo phase", "phase");
}

// ── advance to the next gameweek (finalise the current, scored week) ─────────
export async function advanceGw(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  // In a live season you don't advance the gameweek — the season does, at the
  // deadline, for everyone at once (season.ts). Letting a user step forward would
  // put them on a different week from their own league.
  if (gw.mode !== "replay") throw new HttpError(403, "the season advances at the deadline", "live");
  const entry = await getEntry(db, userId, gw.gw);
  if (!entry?.scored_at) throw new HttpError(409, "finish this gameweek first", "not-scored");
  // CAS on status so a double-tap can't grant two baseline transfers.
  const { data: moved } = await db.from("fantasy_entries").update({ status: "final" })
    .eq("user_id", userId).eq("gw", gw.gw).neq("status", "final").select("user_id");
  if (moved?.length) {
    // The baseline transfer for the week now opening — the replay twin of what
    // finaliseGameweek does for the live season.
    const squad = await getSquad(db, userId);
    if (squad) {
      const next = grantBaseline(squad.credits);
      if (next !== squad.credits) {
        await db.from("fantasy_squads").update({ credits: next }).eq("user_id", userId);
      }
    }
  }
  return getState(db, userId); // currentGw now points at the next week
}

// ── knowledge round ───────────────────────────────────────────────────────────
/** The questions a user has already met this season, so a round can avoid them.
 *
 *  Derived, not stored: rounds are deterministic per (gameweek, user), so
 *  replaying every prior gameweek the user actually STARTED reproduces exactly
 *  what they were served — no seen-questions table to keep in step, and nothing
 *  that could disagree with the round they answered. Stable by construction: the
 *  set of started gameweeks below `gw` is frozen (a locked gameweek's round never
 *  changes), so rebuilding an old round always yields the same eleven, which is
 *  the property grading and viewRun depend on.
 *
 *  Replayed FORWARD, each round excluding the ones before it, so the reproduced
 *  exclusion matches the one that was live when the round was first served. */
async function seenBefore(db: Db, userId: string, gw: number): Promise<Set<string>> {
  const { data } = await db.from("fantasy_entries")
    .select("gw").eq("user_id", userId).lt("gw", gw)
    .not("round_version", "is", null).order("gw", { ascending: true });
  const priorGws = ((data ?? []) as { gw: number }[]).map((r) => r.gw);
  const seen = new Set<string>();
  for (const g of priorGws) {
    const r = buildRound(GATES.questions, { gameweek: `fantasy:${g}`, userId, formation: "4-3-3", exclude: seen });
    for (const q of r.questions) seen.add(questionKey(q));
  }
  return seen;
}

async function roundFor(db: Db, gw: number, userId: string): Promise<Round> {
  const exclude = await seenBefore(db, userId, gw);
  return buildRound(GATES.questions, { gameweek: `fantasy:${gw}`, userId, formation: "4-3-3", exclude });
}

export async function startRound(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  if (!(await getSquad(db, userId))) throw new HttpError(409, "build a squad first", "no-squad");
  let entry = await ensureEntry(db, userId, gw.gw);
  if (!entry.round_version) {
    await db.from("fantasy_entries").update({ round_version: GATES.version })
      .eq("user_id", userId).eq("gw", gw.gw);
    entry = (await getEntry(db, userId, gw.gw))!;
  }
  if (entry.round_version !== GATES.version)
    throw new HttpError(409, "question pool changed — round restarted", "stale-pool");
  const round = await roundFor(db, gw.gw, userId);
  return {
    gw: gw.gw,
    questions: clientView(round),
    answered: entry.round_answers.length,
    correct: entry.round_correct,
    done: !!entry.round_done_at,
    creditsEarned: entry.round_credits,
  };
}

/** Round-completion side effects: the round earns for NEXT gameweek. Raise the
 *  pending "earned for next week" tray to the better of what's there and what
 *  this round scored (override-upward — a worse round never lowers it). It never
 *  touches the spendable bank; settlement (finaliseGameweek) pours the tray into
 *  `credits` when the next gameweek opens, then resets it.
 *
 *  Called at most once per round: stepRound only reaches here after winning the
 *  round's own idempotency guard, so this never has to protect against running
 *  twice. (Quizzes earn transfers ONLY — the perfect-round wildcard was removed
 *  28 Jul, so a perfect 11/11 is rewarded purely by its 4 credits.) */
async function completeRound(db: Db, userId: string, squad: SquadRow, minted: number) {
  const pending = raisePending(squad.pending_credits, minted);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    version: squad.version + 1,
    pending_credits: pending,
  };
  // Source is display-only. The round leads whenever it reaches (or ties) the top
  // of the tray — "the round can override the first gameday quiz, but only if it
  // scores at least as well."
  if (minted >= squad.pending_credits) patch.pending_source = "round";

  const { error } = await db.from("fantasy_squads").update(patch).eq("user_id", userId);
  if (error) throw new HttpError(500, error.message);
}

export async function stepRound(db: Db, userId: string, k: number, optionId: number | null) {
  const gw = await currentGw(db, userId);
  const entry = await getEntry(db, userId, gw.gw);
  if (!entry?.round_version) throw new HttpError(409, "round not started", "no-round");
  if (entry.round_done_at) throw new HttpError(409, "round already complete", "done");
  if (entry.round_version !== GATES.version) throw new HttpError(409, "stale pool", "stale-pool");
  if (k !== entry.round_answers.length || k >= ROUND_LEN)
    throw new HttpError(409, `expected question ${entry.round_answers.length}`, "order");
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");

  const round = await roundFor(db, gw.gw, userId);
  const q = round.questions[k];
  if (!q) throw new HttpError(500, "round shorter than expected");
  let correct = false;
  if (optionId !== null) {
    const g = grade(round, k, optionId);
    if (!g) throw new HttpError(400, "not one of the offered options", "bad-option");
    correct = g.correct;
  }
  const answers = [...entry.round_answers, optionId];
  const correctCount = entry.round_correct + (correct ? 1 : 0);
  const isLast = answers.length === ROUND_LEN;
  const patch: Record<string, unknown> = { round_answers: answers, round_correct: correctCount };
  let minted = 0;
  if (isLast) {
    minted = creditsForRound(correctCount);
    patch.round_credits = minted;
    patch.round_done_at = new Date().toISOString();
  }
  // Guarded by round_done_at IS NULL: if two requests race the final question,
  // only one can win this write — and only the winner may mint the round's
  // rewards below, so a race can never credit (or chip-reward) the same round twice.
  const { data: written, error } = await db.from("fantasy_entries").update(patch)
    .eq("user_id", userId).eq("gw", gw.gw).is("round_done_at", null).select("gw");
  if (error) throw new HttpError(500, error.message);
  if (isLast && written?.length) {
    const squad = (await getSquad(db, userId))!;
    await completeRound(db, userId, squad, minted);
  }
  return {
    correct, answerId: q.answerId, correctCount,
    answered: answers.length, done: isLast,
    creditsEarned: isLast ? minted : null,
  };
}

// ── transfers + selection ─────────────────────────────────────────────────────
export async function applyTransferTx(db: Db, userId: string, outId: number, inId: number) {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await ensureEntry(db, userId, gw.gw);
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");

  let next: Squad;
  const priced = await pricedPool(db, gw.gw);
  try { next = applyTransfer(squadShape(squad), outId, inId, priced); } catch (e) { asHttp(e); throw e; }
  const { paid } = transferCost(squad.credits);
  const swap = (arr: number[]) => arr.map((id) => (id === outId ? inId : id));
  const patch = {
    picks: next.picks, bank_tenths: next.bankTenths,
    credits: paid === "credit" ? squad.credits - 1 : squad.credits,
    xi: swap(squad.xi), bench: swap(squad.bench),
    captain: squad.captain === outId ? inId : squad.captain,
    vice: squad.vice === outId ? inId : squad.vice,
    version: squad.version + 1, updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("fantasy_squads").update(patch)
    .eq("user_id", userId).eq("version", squad.version).select("version");
  if (error) throw new HttpError(500, error.message);
  if (!data?.length) throw new HttpError(409, "squad changed elsewhere — retry", "conflict");

  const out = squad.picks.find((p) => p.id === outId)!;
  const inn = next.picks.find((p) => p.id === inId)!;
  await db.from("fantasy_entries").update({
    transfers: [...entry.transfers, { out: outId, in: inId, outTenths: out.buyTenths, inTenths: inn.buyTenths, paid }],
    hits: paid === "hit" ? entry.hits + 1 : entry.hits,
  }).eq("user_id", userId).eq("gw", gw.gw);
  return { paid, bankTenths: next.bankTenths, credits: patch.credits };
}

export async function setSelection(db: Db, userId: string, sel: {
  xi: number[]; bench: number[]; captain: number; vice: number;
}) {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await getEntry(db, userId, gw.gw);
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");
  try { validateSelection(squadShape(squad), sel.xi, sel.bench, sel.captain, sel.vice); }
  catch (e) { asHttp(e); }
  const { error } = await db.from("fantasy_squads").update({
    xi: sel.xi, bench: sel.bench, captain: sel.captain, vice: sel.vice,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

// ── chips (monthly rotation) ─────────────────────────────────────────────────
/** Play a chip for the current gameweek. The rules are monthly (founder 28 Jul):
 *  ONE chip a month, and a chip can't come back until the other two have been
 *  used (a fresh set of three each quarter). Both are derived from the append-only
 *  chip_log; playing appends {chip, month}. The entry write is the gate (CAS on
 *  chip IS NULL): only the request that wins it may go on to append, so a
 *  double-tap can never play two. */
export async function playChip(db: Db, userId: string, chip: Chip) {
  if (!CHIPS.includes(chip)) throw new HttpError(400, "unknown chip", "unknown-chip");
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await ensureEntry(db, userId, gw.gw);
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");
  if (entry.chip) throw new HttpError(409, "you've already played a chip this gameweek", "chip-played");

  const month = monthKeyOf(gw);
  const { ok, reason } = chipPlayable(squad.chip_log, chip, month);
  if (!ok) {
    if (reason === "month") throw new HttpError(409, "you've already played a chip this month", "chip-month");
    throw new HttpError(409, "use your other chips before this one comes back", "chip-set");
  }

  const { data: claimed, error: eErr } = await db.from("fantasy_entries")
    .update({ chip }).eq("user_id", userId).eq("gw", gw.gw).is("chip", null).select("gw");
  if (eErr) throw new HttpError(500, eErr.message);
  if (!claimed?.length) throw new HttpError(409, "you've already played a chip this gameweek", "chip-played");

  // Append this play to the log (newest last). CAS on version so a concurrent
  // change can't clobber it; on a lost race, undo the entry claim.
  const spendPatch = { chip_log: [...squad.chip_log, { chip, month }], version: squad.version + 1 };
  const { data: spent, error: sErr } = await db.from("fantasy_squads").update(spendPatch)
    .eq("user_id", userId).eq("version", squad.version).select("version");
  if (sErr) throw new HttpError(500, sErr.message);
  if (!spent?.length) {
    await db.from("fantasy_entries").update({ chip: null }).eq("user_id", userId).eq("gw", gw.gw);
    throw new HttpError(409, "squad changed elsewhere — retry", "conflict");
  }
  return getState(db, userId);
}

/** Un-play before the deadline. A mis-tap must be reversible — same gate,
 *  mirrored: CAS on the entry still holding this exact chip, then POP the log.
 *  Only the current gameweek's chip is ever un-playable and it's always the most
 *  recent play, so removal is a clean last-in-first-out pop. */
export async function removeChip(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await getEntry(db, userId, gw.gw);
  if (!entry?.chip) throw new HttpError(409, "no chip played this gameweek", "no-chip-played");
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");
  const chip = entry.chip;

  // A chip whose effect has already FIRED cannot be un-played — otherwise you
  // could take the 50/50, undo Insight, and spend the refunded chip on Triple
  // Captain. Triple Captain / Bench Boost only act at scoring, so they stay
  // freely undoable until the deadline.
  const extras = entry as unknown as { round_hint_k: number | null };
  if (chip === "insight" && extras.round_hint_k !== null)
    throw new HttpError(409, "Insight is already used this round — it can't be taken back", "consumed");

  const { data: cleared, error: eErr } = await db.from("fantasy_entries")
    .update({ chip: null }).eq("user_id", userId).eq("gw", gw.gw).eq("chip", chip).select("gw");
  if (eErr) throw new HttpError(500, eErr.message);
  if (!cleared?.length) throw new HttpError(409, "no chip played this gameweek", "no-chip-played");

  const refundPatch = { chip_log: squad.chip_log.slice(0, -1), version: squad.version + 1 };
  const { data: refunded, error: sErr } = await db.from("fantasy_squads").update(refundPatch)
    .eq("user_id", userId).eq("version", squad.version).select("version");
  if (sErr) throw new HttpError(500, sErr.message);
  if (!refunded?.length) {
    // Squad moved under us — restore the played chip rather than lose the refund.
    await db.from("fantasy_entries").update({ chip }).eq("user_id", userId).eq("gw", gw.gw);
    throw new HttpError(409, "squad changed elsewhere — retry", "conflict");
  }
  return getState(db, userId);
}

// ── scoring ──────────────────────────────────────────────────────────────────
/** Form for the armband fallback: points over the last 3 scored gameweeks.
 *  Before anything has scored (gameweek 1) there IS no form, so price stands in
 *  — the same proxy smartDefaults uses pre-season. Every later gameweek uses the
 *  real thing: the design says the third-choice armband goes to the in-form
 *  player, not the dearest one. */
async function formFor(db: Db, gw: number): Promise<Map<number, number>> {
  const prior = [gw - 3, gw - 2, gw - 1].filter((g) => g >= 1);
  const byPlayer = new Map<number, number>();
  if (prior.length) {
    const { data, error } = await db.from("fantasy_player_scores")
      .select("player_id, points").in("gw", prior);
    if (error) throw new HttpError(500, error.message);
    for (const r of (data ?? []) as { player_id: number; points: number }[])
      byPlayer.set(r.player_id, (byPlayer.get(r.player_id) ?? 0) + r.points);
  }
  return byPlayer.size ? byPlayer : new Map(enginePool().map((p) => [p.id, p.priceTenths]));
}

async function ensurePlayerScores(db: Db, gw: GwRow): Promise<Map<number, { points: number; facts: MatchFacts }>> {
  const { data, error } = await db.from("fantasy_player_scores")
    .select("player_id, points, facts").eq("gw", gw.gw);
  if (error) throw new HttpError(500, error.message);
  if (data?.length)
    return new Map(data.map((r: { player_id: number; points: number; facts: MatchFacts }) =>
      [r.player_id, { points: r.points, facts: r.facts }]));

  const key = process.env.SPORTMONKS_API_KEY;
  if (!key) throw new HttpError(500, "SPORTMONKS_API_KEY not configured");
  const fixtures = await fetchGwFixtures(gw.sm_season_id, gw.window_start, gw.window_end, key);
  const facts = aggregateFixtures(fixtures);
  const pool = enginePool().map((p) => ({ id: p.id, smId: p.smId!, pos: p.pos, name: p.name }));
  const { scores } = toPlayerScores(facts, pool);
  if (!scores.length) throw new HttpError(502, "ingest produced no scores");
  const { error: upErr } = await db.from("fantasy_player_scores").upsert(
    // updated_at is set explicitly: on a re-ingest (stat correction) the column
    // default only fires on INSERT, so without this it would still read as the
    // moment we first saw the gameweek — useless as a freshness signal.
    scores.map((s) => ({
      gw: gw.gw, player_id: s.playerId, minutes: s.facts.minutes,
      facts: s.facts, points: s.points, updated_at: new Date().toISOString(),
    })),
    { onConflict: "gw,player_id" },
  );
  if (upErr) throw new HttpError(500, upErr.message);
  return new Map(scores.map((s) => [s.playerId, { points: s.points, facts: s.facts as never }]));
}

/** Replay-mode lock: snapshot the squad into the entry, then score immediately. */
export async function lockAndScore(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  if (gw.mode !== "replay") throw new HttpError(403, "live gameweeks lock at the deadline", "live");
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await ensureEntry(db, userId, gw.gw);
  if (entry.locked_at) throw new HttpError(409, "already locked", "locked");

  const lockedAt = new Date().toISOString();
  await db.from("fantasy_entries").update({
    status: "locked", picks: squad.picks, xi: squad.xi, bench: squad.bench,
    captain: squad.captain, vice: squad.vice, locked_at: lockedAt,
  }).eq("user_id", userId).eq("gw", gw.gw);

  const scores = await ensurePlayerScores(db, gw);
  const sel: LockedSelection = {
    picks: squad.picks, xi: squad.xi, bench: squad.bench,
    captain: squad.captain, vice: squad.vice,
  };
  const engineScores = new Map(
    squad.picks.map((p) => {
      const s = scores.get(p.id);
      return [p.id, { points: s?.points ?? 0, facts: s?.facts ?? ZERO_FACTS }] as const;
    }),
  );
  const form = await formFor(db, gw.gw);
  const result = scoreEntry(sel, entry.hits, engineScores, form, entry.chip, entry.cash_points ?? 0);
  await db.from("fantasy_entries").update({
    status: "scored", points: result.total, points_breakdown: result.breakdown,
    autosubs: result.subs, captain_used: result.captainUsed,
    scoring_version: SCORING_VERSION,
    scored_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("gw", gw.gw);
  return { points: result.total, breakdown: result.breakdown, subs: result.subs, captainUsed: result.captainUsed, hitsDeducted: result.hitsDeducted };
}

// ── view a friend's run (D:222-224) ──────────────────────────────────────────
/**
 * A league-mate's completed round — their questions, their picks, right or
 * wrong — visible AFTER their answers can no longer help you. The banter fuel:
 * "you didn't know THAT?"
 *
 * Rounds are deterministic per (gameweek, user), so nothing extra is stored:
 * we rebuild the target's round and read their answers off the entry.
 *
 * Gates, all server-side:
 *   - viewer and target share a league (banter is league-scoped), or viewer IS target
 *   - the target's round is done AND their entry is locked
 *   - live: the gameweek is past its deadline; replay (self-paced): the VIEWER
 *     has also finished their own round, so seeing answers can't help them.
 */
export async function viewRun(db: Db, viewerId: string, targetUserId: string, leagueCode: string) {
  const { data: league } = await db.from("fantasy_leagues")
    .select("id").eq("join_code", leagueCode.toUpperCase()).maybeSingle();
  if (!league) throw new HttpError(404, "league not found");
  if (viewerId !== targetUserId) {
    const { data: both } = await db.from("fantasy_league_members")
      .select("user_id").eq("league_id", league.id).in("user_id", [viewerId, targetUserId]);
    if ((both ?? []).length < 2) throw new HttpError(403, "not in this league");
  }

  const gw = await currentGw(db, viewerId);
  const target = await getEntry(db, targetUserId, gw.gw);
  if (!target?.round_done_at || !target.locked_at)
    throw new HttpError(409, "their round isn't finished and locked yet", "not-ready");
  if (gw.mode === "replay") {
    const mine = await getEntry(db, viewerId, gw.gw);
    if (viewerId !== targetUserId && !mine?.round_done_at)
      throw new HttpError(409, "finish your own round first", "play-first");
  } else if (isOpenForEdits(gw, target)) {
    throw new HttpError(409, "runs open up after the deadline", "not-ready");
  }

  const round = await roundFor(db, gw.gw, targetUserId);
  const answers = (target.round_answers ?? []) as (number | null)[];
  const { data: prof } = await db.from("profiles")
    .select("display_name, username").eq("id", targetUserId).maybeSingle();
  return {
    gw: gw.gw,
    name: prof?.display_name ?? (prof?.username ? `@${prof.username}` : "Player"),
    correct: target.round_correct,
    total: round.questions.length,
    questions: round.questions.map((q, idx) => ({
      prompt: q.prompt,
      picked: q.options.find((o) => o.id === answers[idx])?.label ?? null, // null = timed out
      answer: q.options.find((o) => o.id === q.answerId)?.label ?? "",
      right: answers[idx] === q.answerId,
    })),
  };
}

// ── the round chips: Insight + Second Chance (D:131) ─────────────────────────
/**
 * INSIGHT — a 50/50 on ONE question of your choosing. The chip must already be
 * played (entry.chip = 'insight', spent through the normal chip slot), and the
 * question it's spent on is stored: without round_hint_k, a "storage-free"
 * deterministic hint could be requested on every question in turn.
 * Eliminations are seeded, so a re-fetch of the same k returns the same two.
 */
export async function roundHint(db: Db, userId: string, k: number) {
  const gw = await currentGw(db, userId);
  const entry = await getEntry(db, userId, gw.gw);
  if (!entry?.round_version) throw new HttpError(409, "round not started", "no-round");
  if (entry.round_done_at) throw new HttpError(409, "round already complete", "done");
  if (entry.chip !== "insight") throw new HttpError(409, "play the Insight chip first", "no-chip");
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");
  if (k !== entry.round_answers.length) throw new HttpError(409, "hint is for the question in front of you", "order");
  const hintK = (entry as unknown as { round_hint_k: number | null }).round_hint_k;
  if (hintK !== null && hintK !== k) throw new HttpError(409, "your Insight is already spent this round", "used");

  if (hintK === null) {
    // CAS claim: two racing requests can't spend one hint on two questions.
    const { data: claimed } = await db.from("fantasy_entries")
      .update({ round_hint_k: k }).eq("user_id", userId).eq("gw", gw.gw)
      .is("round_hint_k", null).select("gw");
    if (!claimed?.length) throw new HttpError(409, "your Insight is already spent this round", "used");
  }

  const round = await roundFor(db, gw.gw, userId);
  const q = round.questions[k];
  if (!q) throw new HttpError(500, "round shorter than expected");
  const { seededRng, shuffle } = await import("@/lib/gates/rng");
  const wrong = q.options.filter((o) => o.id !== q.answerId).map((o) => o.id);
  const eliminated = shuffle(wrong, seededRng(`insight:${gw.gw}:${userId}:${k}`))
    .slice(0, Math.max(0, q.options.length - 2));
  return { k, eliminated };
}

// ── the ledger: where did my transfer go? (Gate 3 trust) ─────────────────────
/**
 * A plain-English history of everything that touched your credits, chips and
 * transfers, newest first.
 *
 * DERIVED, not stored — every fact is already on the entry rows (`transfers`,
 * `round_credits`, `cash_points`, `chip`, `hits`, `points`), so there is no new
 * table to keep in step and no accumulation that could drift from the tables the
 * league standings sum on read. A manager asking "where did my transfer go?" or
 * "when did I earn that credit?" now has an answer that is, by construction, the
 * same data the game scored from.
 *
 * The baseline transfer is the one grant that isn't on the entry — it's applied
 * to the squad when the previous gameweek finalises. It's reconstructed here as
 * a line rather than left invisible: every finalised gameweek granted one (up to
 * the cap), and "everyone gets one" is exactly the promise a ledger should make
 * checkable.
 */
export interface LedgerItem {
  gw: number;
  kind: "round" | "cash" | "transfer" | "hit" | "chip" | "baseline";
  text: string;
  /** Signed where it means something: +2 credits, −4 points. Absent for prose. */
  delta?: string;
  at: string | null;
}

export async function getLedger(db: Db, userId: string): Promise<{ items: LedgerItem[] }> {
  const [{ data: rows }, nameMap] = await Promise.all([
    db.from("fantasy_entries")
      .select("gw, status, round_correct, round_credits, round_done_at, transfers, hits, chip, cash_points, points, scored_at, locked_at")
      .eq("user_id", userId).order("gw", { ascending: false }).range(0, 999),
    Promise.resolve(new Map(enginePool().map((p) => [p.id, p.name]))),
  ]);
  const nameOf = (id: number) => nameMap.get(id) ?? `#${id}`;
  const CHIP_LABEL: Record<string, string> = {
    triple_captain: "Triple Captain",
    bench_boost: "Bench Boost", insight: "Insight", second_chance: "Second Chance",
  };

  const items: LedgerItem[] = [];
  for (const e of (rows ?? []) as {
    gw: number; status: string; round_correct: number; round_credits: number;
    round_done_at: string | null; transfers: { out: number; in: number; paid: string }[];
    hits: number; chip: string | null; cash_points: number | null;
    points: number | null; scored_at: string | null; locked_at: string | null;
  }[]) {
    // A gameweek reads top to bottom in the order things happened: play the
    // round, spend on transfers, take the hits, play a chip, then it scores.
    if (e.round_done_at) {
      items.push({
        gw: e.gw, kind: "round", at: e.round_done_at,
        text: `Round: ${e.round_correct}/11 correct`,
        delta: e.round_credits > 0 ? `+${e.round_credits} transfer${e.round_credits === 1 ? "" : "s"}` : undefined,
      });
    }
    if ((e.cash_points ?? 0) > 0) {
      items.push({
        gw: e.gw, kind: "cash", at: e.round_done_at,
        text: "Credits over the cap cashed out",
        delta: `+${e.cash_points} pts`,
      });
    }
    for (const t of e.transfers ?? []) {
      const cost = t.paid === "hit" ? "−4 pts" : "used a transfer";
      items.push({
        gw: e.gw, kind: t.paid === "hit" ? "hit" : "transfer", at: e.locked_at,
        text: `${nameOf(t.out)} → ${nameOf(t.in)}`,
        delta: cost,
      });
    }
    if (e.chip) {
      items.push({
        gw: e.gw, kind: "chip", at: e.locked_at,
        text: `Played ${CHIP_LABEL[e.chip] ?? e.chip}`,
      });
    }
    // The baseline lands as the NEXT gameweek opens, i.e. when this one finalised.
    if (e.status === "final") {
      items.push({
        gw: e.gw + 1, kind: "baseline", at: e.scored_at,
        text: "Free transfer for the new gameweek",
        delta: "+1 transfer",
      });
    }
  }

  // A baseline is tagged with the gameweek it OPENS, which is one past the entry
  // it came from, so the flat list isn't in gameweek order by construction. Sort
  // it globally — newest gameweek first, and within a gameweek in the order the
  // week actually unfolds — so any consumer gets a sensible sequence, not just
  // the page that happens to regroup.
  const ORDER: Record<LedgerItem["kind"], number> = {
    baseline: 0, round: 1, cash: 2, transfer: 3, hit: 3, chip: 4,
  };
  items.sort((x, y) => (y.gw - x.gw) || (ORDER[x.kind] - ORDER[y.kind]));
  return { items };
}


// ─────────────────────────────────────────────────────────────────────────────
// Player decision profile (read-only). Grafted from the advisor merge — the
// injury/availability read, the club fixture look-up, and the profile builder.
// Kept minimal: the transfer planner and wildcard valuer are intentionally NOT
// brought over, so nothing here is wired into a transfer screen.
// ─────────────────────────────────────────────────────────────────────────────

/** Latest non-rehearsal FPL availability snapshot, resolved to per-player info.
 *  Null (not empty) when nothing has been collected yet, so a missing feed and
 *  a clean bill of health never look the same. */
async function availabilityFor(db: Db): Promise<Map<number, AvailabilityInfo> | null> {
  try {
    const latest = await db.from("fantasy_fpl_snapshot")
      .select("captured_at").eq("is_rehearsal", false)
      .order("captured_at", { ascending: false }).limit(1);
    const cutoff: string | undefined = (unwrapRead(latest, "snapshot cutoff read failed") ?? [])[0]?.captured_at;
    if (!cutoff) return null; // nothing collected yet — not "nobody is injured"

    const result = await db.from("fantasy_fpl_snapshot")
      .select("player_id, status, chance_of_playing_next_round, news")
      .eq("captured_at", cutoff).eq("is_rehearsal", false).range(0, 9999);
    const rows = (unwrapRead(result, "fantasy_fpl_snapshot availability read failed") ?? []) as {
      player_id: number; status: string | null;
      chance_of_playing_next_round: number | null; news: string | null;
    }[];
    return resolveAvailability(rows.map((r) => ({
      playerId: r.player_id, status: r.status,
      chance: r.chance_of_playing_next_round, news: r.news,
    })));
  } catch (e) {
    console.error("[fantasy] availability read failed — continuing without the injury filter", e);
    return null;
  }
}

/** This club's next few fixtures with difficulty, read from the cached news
 *  ticker. Empty array if the news doc hasn't been built — the profile just
 *  doesn't show a fixture row. */
async function upcomingFor(db: Db, clubId: number) {
  try {
    const result = await db.from("fantasy_news").select("doc").order("created_at", { ascending: false }).limit(1);
    const rows = (unwrapRead(result, "news read failed") ?? []) as { doc: unknown }[];
    const doc = rows[0]?.doc as { fixtures?: { runs?: NewsClubRun[] } } | undefined;
    const run = doc?.fixtures?.runs?.find((r) => r.clubId === clubId);
    return (run?.cells ?? []).slice(0, 3);
  } catch (e) {
    console.error("[fantasy] fixtures read failed — profile will omit them", e);
    return [];
  }
}

/** One player's profile — the questions a manager asks before keeping or selling
 *  him. Reads only the past; a gameweek in progress has no row yet. */
export async function playerProfile(db: Db, userId: string, playerId: number) {
  const gw = await currentGw(db, userId);
  const pool = await pricedPool(db, gw.gw);
  const p = pool.find((x) => x.id === playerId);
  if (!p) throw new HttpError(404, "player not in the pool", "unknown-player");

  // Every scored gameweek so far. Ranged explicitly — PostgREST silently caps
  // an unranged read at 1,000 rows.
  const result = await db.from("fantasy_player_scores")
    .select("gw, points, facts, minutes")
    .eq("player_id", playerId).lt("gw", gw.gw).order("gw").range(0, 49999);
  const rows = (unwrapRead(result, "player scores read failed") ?? []) as
    { gw: number; points: number; facts: MatchFacts; minutes: number }[];

  // Zero-fill: a player who didn't feature has NO row, and leaving a hole would
  // hide exactly the "stopped playing" signal the screen exists to show.
  const byGw = new Map(rows.map((r) => [r.gw, r]));
  const season: ProfileGw[] = [];
  for (let g = 1; g < gw.gw; g++) {
    const r = byGw.get(g);
    season.push(r
      ? { gw: g, facts: r.facts as never, points: r.points }
      : { gw: g, facts: { ...ZERO_FACTS } as never, points: 0 });
  }
  const recent = season.slice(-FORM_WINDOW_GWS);

  const availability = await availabilityFor(db);
  const squad = await getSquad(db, userId);
  const owned = squad?.picks?.some((x: { id: number }) => x.id === playerId) ?? false;
  const flag = owned && squad
    ? flagSquad({
        squad: squadShape(squad), availability,
        recentMinutes: new Map([[playerId, recent.map((r) => r.facts.minutes)]]),
      }).find((f) => f.playerId === playerId) ?? null
    : null;

  // Pre-season (no current-season appearance yet): pull last season's real
  // totals + FPL's forward projection from bootstrap-static, so the profile
  // shows something to judge instead of empty "no games yet" rows. pool id ==
  // FPL element id, so the map is direct. Degrades to null on any fetch failure.
  const scored = season.filter((r) => r.facts.minutes > 0).length;
  let lastSeasonTotals: SeasonTotals | null = null;
  let projection: Projection | null = null;
  let lastSeasonLabel: string | undefined;
  if (scored === 0) {
    const boot = await fetchFplBootstrapCached();
    const el = boot?.elements.find((e) => e.id === playerId);
    if (el) {
      lastSeasonTotals = {
        points: el.total_points ?? 0, minutes: el.minutes ?? 0, starts: el.starts ?? 0,
        goals: el.goals_scored ?? 0, assists: el.assists ?? 0,
        cleanSheets: el.clean_sheets ?? 0, saves: el.saves ?? 0, conceded: el.goals_conceded ?? 0,
      };
      lastSeasonLabel = previousSeasonLabel(boot);
      projection = {
        epNext: el.ep_next != null ? Number(el.ep_next) : null,
        form: el.form != null ? Number(el.form) : null,
        ownership: el.selected_by_percent != null ? Number(el.selected_by_percent) : null,
        available: el.status === "a",
        chance: el.chance_of_playing_next_round ?? null,
        news: el.news ? el.news : null,
      };
    }
  }

  return {
    name: p.name, club: p.club, priceTenths: p.priceTenths,
    profile: buildPlayerProfile({
      playerId, pos: p.pos, recent, season,
      flag,
      fixtures: await upcomingFor(db, p.clubId),
      lastSeasonTotals, lastSeasonLabel, projection,
    }),
  };
}

/** Derive last season's label ("2024/25") from the bootstrap's first upcoming
 *  event: its deadline year is the START year of the NEW season, so the totals
 *  the feed still carries pre-season belong to the season before that. */
function previousSeasonLabel(boot: FplBootstrap | null): string | undefined {
  const iso = boot?.events?.[0]?.deadline_time;
  if (!iso) return undefined;
  const startYear = new Date(iso).getFullYear();
  if (!Number.isFinite(startYear)) return undefined;
  return `${startYear - 1}/${String(startYear).slice(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Squad Update — the personalised head of the Scout Briefing.
//
// For each of the fifteen a manager already OWNS, the one fact that changes how
// they read the week: an availability flag from FPL's own feed (injury,
// suspension, doubt), or a blank gameweek for one of their starters. Facts only.
// It never suggests a replacement and never uses sell/bench/buy/avoid language —
// the manager reads the fact and decides. Composes the same private helpers the
// rest of this file uses (currentGw / getSquad / availabilityFor / flagSquad) and
// reads fixtures from the SAME feed doc the Briefing renders, so nothing here can
// disagree with the page around it.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise a factual reason to house style: FPL writes "Knee injury - Expected
 *  back 01 Apr" with a hyphen separator; the app's own idiom is " · ". Words are
 *  untouched — only the separator — so the fact is preserved verbatim. */
const factualReason = (s: string): string => s.trim().replace(/\s[-–—]\s/g, " · ");

/** Club → its upcoming fixture cells, from the newest feed doc (the same table
 *  and shape /fantasy/news renders). Empty map when the doc isn't built yet, which
 *  the caller treats as "we can't claim a blank gameweek", never as "everyone is
 *  blank" — missing data must not read as a fact. */
async function fixtureRunsByClub(db: Db): Promise<Map<number, NewsTickerCell[]>> {
  try {
    const result = await db.from("fantasy_news_feed").select("doc")
      .order("gw", { ascending: false }).limit(1);
    const rows = (unwrapRead(result, "news feed read failed") ?? []) as { doc: NewsDoc }[];
    const runs = rows[0]?.doc?.fixtures?.runs ?? [];
    return new Map(runs.map((r) => [r.clubId, r.cells]));
  } catch (e) {
    console.error("[fantasy] squad-update fixtures read failed — omitting blank-GW flags", e);
    return new Map();
  }
}

export async function squadUpdate(db: Db, userId: string): Promise<{ items: SquadUpdateItem[] }> {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad || !squad.picks.length) return { items: [] };

  const pool = await pricedPool(db, gw.gw);
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const availability = await availabilityFor(db);
  // Availability-only: the minutes ("hasn't played") signal that flagSquad can
  // also raise is deliberately NOT fed in here — it reads as "bench him", and
  // this surface states facts, it never tells you to bench anyone.
  const flags = flagSquad({
    squad: { picks: squad.picks, bankTenths: squad.bank_tenths }, availability,
  });

  const runsByClub = await fixtureRunsByClub(db);
  const cellsOf = (clubId: number) => runsByClub.get(clubId) ?? [];
  const nextFixtureOf = (clubId: number): string | null => {
    const c = cellsOf(clubId).filter((x) => x.gw >= gw.gw).sort((a, b) => a.gw - b.gw)[0];
    return c ? `${c.home ? "vs" : "@"} ${c.oppShort.toUpperCase()}` : null;
  };

  const items: SquadUpdateItem[] = [];
  const flagged = new Set<number>();

  for (const f of flags) {
    const p = poolById.get(f.playerId);
    if (!p) continue;
    flagged.add(f.playerId);
    const av = availability?.get(f.playerId);
    // flagSquad collapses injured / unavailable / suspended into kind "out"; split
    // them back by FPL's own status letter so the pill names the real category.
    // A rare 'u' (unavailable, e.g. left the club) has no status of its own here
    // and reads under Injured — the explanation string still carries the true fact.
    const status: SquadUpdateStatus =
      f.kind === "doubt" ? "Doubt"
      : av?.status === "s" ? "Suspended"
      : "Injured";
    items.push({
      playerId: p.id, name: p.name, club: p.club, position: p.pos,
      status, explanation: factualReason(f.reason), nextFixture: nextFixtureOf(p.clubId),
    });
  }

  // Blank gameweek — a STARTER whose club has no fixture this week. Read from the
  // captain engine's FPL-keyed fixture snapshot, NOT the news-doc fixture runs:
  // the runs are keyed by SportMonks club id while the squad/pool is keyed by FPL
  // club id, and the two only collide for a handful of clubs — matching across
  // them wrongly told most squads their players had "no fixture". The snapshot
  // shares the pool's FPL ids and carries a completeness signal, so a blank is
  // only claimed when the gameweek's fixtures are actually loaded AND the club is
  // genuinely absent (confirmed_blank). An unloaded/pre-season gameweek reads as
  // "unknown" and stays silent rather than crying blank for everyone.
  const fixtureSet = await loadFixtureSet(db, gw.gw);
  for (const id of squad.xi) {
    if (flagged.has(id)) continue;
    const p = poolById.get(id);
    if (!p) continue;
    if (fixtureStatusFor(fixtureSet, p.clubId) === "confirmed_blank") {
      items.push({
        playerId: p.id, name: p.name, club: p.club, position: p.pos,
        status: "No fixture",
        explanation: `No Premier League fixture in gameweek ${gw.gw}.`,
        nextFixture: nextFixtureOf(p.clubId),
      });
    }
  }

  return { items };
}
