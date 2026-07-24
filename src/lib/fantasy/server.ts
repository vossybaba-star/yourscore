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
import { buildRound, clientView, grade, type Round } from "@/lib/gates/serve";
import type { GateQuestion } from "@/lib/gates/types";
import {
  applyTransfer, cashOverflow, CHIPS, creditsForRound, GAMEWEEKS_PER_CHIP, grantBaseline, halfOf,
  perfectRoundReward, scoreEntry, smartDefaults, transferCost, validateSelection, validateSquad,
  RuleError, type Chip, type LockedSelection, type PoolPlayer, type Squad, type SquadPick,
} from "./engine";
import { aggregateFixtures, fetchGwFixtures, toPlayerScores } from "./ingest";
import { FORM_WINDOW_GWS, type NewsClubRun } from "./news";
import { SCORING_VERSION, ZERO_FACTS, type MatchFacts } from "./values";
import { enginePool, fantasyPool, pricedPool } from "./pool";
import { currentLiveGw, isOpenForEdits, type GwRow } from "./gameweeks";
import { planTransfers, type OptimisedMove, type PlanResult, type PlayerVerdict, type ProjectedPoints } from "./optimiser";
import {
  flagSquad, resolveAvailability, unwrapRead, buildPlayerProfile, fetchAllPaged,
  BENCH_WINDOW_GWS, type AvailabilityInfo, type SquadFlag, type ProfileGw,
} from "./advice";
// THE single permitted points-per-game module. Neither export may be
// reimplemented here — see its header for the two definitions and why they are
// deliberately different.
import { seasonAverageScores } from "./ppg";

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
  chips: number; chip_progress: number; wildcards: number;
  wildcard_half: number | null; bonus_wildcard_half: number | null;
}
/** One transfer as persisted on the gameweek's entry row. */
export interface RecordedTransfer {
  out: number; in: number; outTenths: number; inTenths: number;
  paid: "free" | "credit" | "hit";
}
export interface EntryRow {
  user_id: string; gw: number; status: string;
  round_version: string | null; round_answers: (number | null)[];
  round_correct: number; round_credits: number; round_done_at: string | null;
  /** Every transfer booked this gameweek, in order, each tagged with how it was
   *  paid for. Typed (it used to be `unknown[]`) because the planner reports how
   *  many moves are already booked and removeChip reads the `paid` tags. */
  transfers: RecordedTransfer[]; hits: number; chip: Chip | null; cash_points: number;
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
  // A live season owns the game outright, so ANY live row wins — not just when the
  // lowest-numbered gameweek happens to be live. Reading mode off gws[0] meant a
  // single leftover replay demo row (which sorts first) silently put the whole game
  // back in replay: every squad priced at seed, every sale refunded at what you paid.
  //
  // That rule now lives in gameweeks.ts so this function and any caller with no
  // user at all read the identical definition instead of two copies drifting.
  let live: GwRow | null;
  try { live = await currentLiveGw(db); } catch (e) { throw new HttpError(500, (e as Error).message); }
  if (live) return live;

  const { data: gws, error } = await db.from("fantasy_gameweeks")
    .select("*").order("gw", { ascending: true });
  if (error) throw new HttpError(500, error.message);
  if (!gws?.length) throw new HttpError(409, "no gameweeks", "no-gw");

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
export async function getState(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  const entry = squad ? await getEntry(db, userId, gw.gw) : null;
  return {
    gw,
    season: await seasonProgress(db, userId, gw),
    poolVersion: fantasyPool().version,
    openForEdits: isOpenForEdits(gw, entry),
    squad: squad && {
      picks: squad.picks, bankTenths: squad.bank_tenths, credits: squad.credits,
      xi: squad.xi, bench: squad.bench, captain: squad.captain, vice: squad.vice,
      version: squad.version,
    },
    chips: squad && {
      held: squad.chips, progress: squad.chip_progress, gameweeksPerChip: GAMEWEEKS_PER_CHIP,
      wildcards: squad.wildcards, wildcardHalf: squad.wildcard_half,
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
    credits: 0, xi: sel.xi, bench: sel.bench, captain: sel.captain, vice: sel.vice,
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
const roundFor = (gw: number, userId: string): Round =>
  buildRound(GATES.questions, { gameweek: `fantasy:${gw}`, userId, formation: "4-3-3" });

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
  const round = roundFor(gw.gw, userId);
  return {
    gw: gw.gw,
    questions: clientView(round),
    answered: entry.round_answers.length,
    correct: entry.round_correct,
    done: !!entry.round_done_at,
    creditsEarned: entry.round_credits,
  };
}

/** Round-completion side effects: bank the round's transfer credits, and on a
 *  PERFECT round mint the bonus reward — a wildcard (the first perfect round of
 *  the half) or one more banked credit (any perfect round after that, so elite
 *  quizzers can't stockpile wildcards weekly — D:150-154). Called at most once
 *  per round: stepRound only reaches here after winning the round's own
 *  idempotency guard, so this never has to protect against running twice. */
async function completeRound(
  db: Db, userId: string, gw: GwRow, squad: SquadRow, correctCount: number, minted: number,
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), version: squad.version + 1 };
  let toBank = minted;

  const half = halfOf(gw.gw);
  const reward = perfectRoundReward(correctCount, ROUND_LEN, squad.bonus_wildcard_half === half);
  if (reward.wildcard) {
    // Expire first, THEN add. Wildcards held for the previous half are dead
    // (use-it-or-lose-it), and adding to them would quietly convert an unused
    // first-half wildcard into a live second-half one — i.e. reward you for not
    // using it, which is the exact opposite of the rule.
    const live = squad.wildcard_half === half ? squad.wildcards : 0;
    patch.wildcards = live + 1;
    patch.wildcard_half = half;
    patch.bonus_wildcard_half = half;
  } else if (reward.credits) {
    toBank += reward.credits;
  }

  // Everything the round minted goes through ONE place, so nothing is silently
  // lost: the bank takes what it can hold, the rest cashes out at 4 points each.
  // That is what stops a perfect 11/11 paying zero to a manager at the cap who
  // never wants a transfer.
  const { credits, points } = cashOverflow(squad.credits, toBank);
  patch.credits = credits;

  const { error } = await db.from("fantasy_squads").update(patch).eq("user_id", userId);
  if (error) throw new HttpError(500, error.message);

  if (points > 0) {
    const { error: cashErr } = await db.from("fantasy_entries")
      .update({ cash_points: points }).eq("user_id", userId).eq("gw", gw.gw);
    if (cashErr) throw new HttpError(500, cashErr.message);
  }
  return points;
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

  const round = roundFor(gw.gw, userId);
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
    await completeRound(db, userId, gw, squad, correctCount, minted);
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
  // A wildcard week's transfers are free — unlimited moves, not unlimited money;
  // budget and the club cap above still hold.
  const { paid } = transferCost(squad.credits, entry.chip === "wildcard");
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

// ── chips ────────────────────────────────────────────────────────────────────
/** Play a chip for the current gameweek. One per gameweek, spent the moment it's
 *  played — not when the gameweek scores — so held/progress in getState is always
 *  the truth, never a promise. The entry write is the gate (CAS on chip IS NULL):
 *  only the request that wins it may go on to spend a token, so a double-tap can
 *  never spend two. */
export async function playChip(db: Db, userId: string, chip: Chip) {
  if (!CHIPS.includes(chip)) throw new HttpError(400, "unknown chip", "unknown-chip");
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await ensureEntry(db, userId, gw.gw);
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");
  if (entry.chip) throw new HttpError(409, "you've already played a chip this gameweek", "chip-played");

  if (chip === "wildcard") {
    if (squad.wildcards <= 0 || squad.wildcard_half !== halfOf(gw.gw))
      throw new HttpError(409, "no wildcard to play", "no-wildcard");
  } else if (squad.chips <= 0) {
    throw new HttpError(409, "no chips to play", "no-chip");
  }

  const { data: claimed, error: eErr } = await db.from("fantasy_entries")
    .update({ chip }).eq("user_id", userId).eq("gw", gw.gw).is("chip", null).select("gw");
  if (eErr) throw new HttpError(500, eErr.message);
  if (!claimed?.length) throw new HttpError(409, "you've already played a chip this gameweek", "chip-played");

  const spendPatch = chip === "wildcard"
    ? { wildcards: squad.wildcards - 1, version: squad.version + 1 }
    : { chips: squad.chips - 1, version: squad.version + 1 };
  const { data: spent, error: sErr } = await db.from("fantasy_squads").update(spendPatch)
    .eq("user_id", userId).eq("version", squad.version).select("version");
  if (sErr) throw new HttpError(500, sErr.message);
  if (!spent?.length) {
    // Squad moved under us (a concurrent transfer bumped its version) — undo the
    // claim rather than strand a spent token nobody actually holds.
    await db.from("fantasy_entries").update({ chip: null }).eq("user_id", userId).eq("gw", gw.gw);
    throw new HttpError(409, "squad changed elsewhere — retry", "conflict");
  }
  return getState(db, userId);
}

/** Un-play before the deadline and refund exactly what was spent. Playing a chip
 *  is the biggest call of the week, so a mis-tap must be reversible — same gate,
 *  mirrored: CAS on the entry still holding this exact chip, then refund. */
export async function removeChip(db: Db, userId: string) {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await getEntry(db, userId, gw.gw);
  if (!entry?.chip) throw new HttpError(409, "no chip played this gameweek", "no-chip-played");
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");
  const chip = entry.chip;

  // A chip whose effect has already FIRED cannot be un-played — otherwise:
  // take the 50/50, undo Insight, spend the refunded token on Triple Captain.
  // Same for a retried answer, and for a wildcard that has already funded free
  // transfers. Triple Captain / Bench Boost only act at scoring, so they stay
  // freely undoable until the deadline.
  const extras = entry as unknown as { round_hint_k: number | null };
  if (chip === "insight" && extras.round_hint_k !== null)
    throw new HttpError(409, "Insight is already used this round — it can't be taken back", "consumed");
  if (chip === "wildcard" &&
      (entry.transfers as { paid?: string }[]).some((t) => t?.paid === "free"))
    throw new HttpError(409, "the wildcard has already funded free transfers — it can't be taken back", "consumed");

  const { data: cleared, error: eErr } = await db.from("fantasy_entries")
    .update({ chip: null }).eq("user_id", userId).eq("gw", gw.gw).eq("chip", chip).select("gw");
  if (eErr) throw new HttpError(500, eErr.message);
  if (!cleared?.length) throw new HttpError(409, "no chip played this gameweek", "no-chip-played");

  const refundPatch = chip === "wildcard"
    ? { wildcards: squad.wildcards + 1, version: squad.version + 1 }
    : { chips: squad.chips + 1, version: squad.version + 1 };
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

  const round = roundFor(gw.gw, targetUserId);
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

  const round = roundFor(gw.gw, userId);
  const q = round.questions[k];
  if (!q) throw new HttpError(500, "round shorter than expected");
  const { seededRng, shuffle } = await import("@/lib/gates/rng");
  const wrong = q.options.filter((o) => o.id !== q.answerId).map((o) => o.id);
  const eliminated = shuffle(wrong, seededRng(`insight:${gw.gw}:${userId}:${k}`))
    .slice(0, Math.max(0, q.options.length - 2));
  return { k, eliminated };
}


// ── the transfer planner ─────────────────────────────────────────────────────
/**
 * AVAILABILITY, from the one owning source.
 *
 * `fantasy_fpl_snapshot` (migration 210) carries FPL's own `status`,
 * `chance_of_playing_next_round` and `news` string. An earlier build read a
 * second table (`fantasy_player_status`) carrying the same three columns from
 * the same upstream feed; migration 219 dropped it. One fact, one source.
 *
 * The epoch guard is the READ, not a season filter: the snapshot is immutable
 * and keyed on `captured_at`, so taking only the newest capture makes a stale
 * row unreachable rather than something downstream has to remember to exclude.
 *
 * `is_rehearsal` is pinned FALSE. The rehearsal harness writes synthetic rows
 * into these very tables (they are append-only, so it cannot clean up after
 * itself) and without this guard a dry run's fake injuries would silently drive
 * a real manager's plan. Same guard captainAssist/captainShadow already carry —
 * see the Phase 1 note there.
 *
 * A transient failure degrades to NULL, meaning "no filter", never to an empty
 * map. Those look identical to a caller and only one of them is safe: an empty
 * map reads as a clean bill of health and would let the planner cheerfully buy
 * a player who is out for the season.
 */
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

/** Ids FPL says cannot be bought. `d` (doubtful) is deliberately NOT here: a
 *  doubt is surfaced to the manager as a fact to weigh, not acted on for them. */
const unavailableFrom = (av: Map<number, AvailabilityInfo> | null): Set<number> => {
  const out = new Set<number>();
  av?.forEach((info, id) => {
    if (info.status === "i" || info.status === "s" || info.status === "u") out.add(id);
  });
  return out;
};

/** Season-to-date average per gameweek elapsed, for every pool player.
 *
 *  The arithmetic itself lives in ppg.ts and MUST stay there — that file is the
 *  only module permitted to turn points into a per-game rate, precisely so the
 *  planner's denominator (gameweeks elapsed) can never be confused with
 *  captaincy's (appearances). This function is only the read.
 *
 *  Reads `fantasy_player_scores` and nothing else. `fantasy_fpl_snapshot`'s
 *  `total_points`/`minutes` hold LAST season's figures and must never appear on
 *  this path. Ranged explicitly: PostgREST silently caps an unranged read at
 *  1,000 rows, which across a full pool and a full season is a partial history
 *  presented as a complete one. */
async function seasonAverageFor(db: Db, gw: number, pool: PoolPlayer[]): Promise<Map<number, number> | null> {
  const gwsElapsed = gw - 1;
  if (gwsElapsed <= 0) return null; // ppg.ts would also return null; skip the read entirely
  type ScoreRow = { gw: number; player_id: number; points: number | null; minutes: number | null };
  const { rows } = await fetchAllPaged<ScoreRow>(async (from, to) => {
    const result = await db.from("fantasy_player_scores")
      .select("gw, player_id, points, minutes", { count: "exact" })
      .lt("gw", gw)
      .order("gw", { ascending: true }).order("player_id", { ascending: true })
      .range(from, to);
    return {
      rows: (unwrapRead(result, "fantasy_player_scores season-to-date read failed") ?? []) as ScoreRow[],
      count: result.count,
    };
  });
  return seasonAverageScores(rows, gwsElapsed, pool.map((p) => p.id));
}

/** A move with BOTH sides' averages attached, never just the difference. */
export interface PlannedMove extends OptimisedMove { outAvg: number; inAvg: number }
export interface PlannedVerdict extends PlayerVerdict { outAvg: number; inAvg: number | null }

export interface PlanTxResult extends PlanResult {
  moves: PlannedMove[];
  perPlayer: PlannedVerdict[];
  /** What the ranking was built from, so a silent degrade is visible rather than
   *  being read as a confident answer. */
  basis: "season-to-date-average" | "no-history-yet";
  credits: number;
  wildcardActive: boolean;
  /** How many moves are already booked this gameweek. Shown as a fact, not used
   *  as a budget — the credit balance is the budget. */
  transfersBooked: number;
  /** False when FPL's availability feed was unreadable, so the screen can say
   *  the injury half is missing instead of implying a clean bill of health. */
  availabilityLive: boolean;
}

/** Run the planner for one user against their live squad. Everything the search
 *  needs — the squad, prices, credits, whether a wildcard is up — is read here
 *  rather than trusted from the client; the request supplies only the list of
 *  players the manager marked. */
export async function planTransfersTx(db: Db, userId: string, considering: number[]): Promise<PlanTxResult> {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await ensureEntry(db, userId, gw.gw);
  const pool = await pricedPool(db, gw.gw);

  const avg = await seasonAverageFor(db, gw.gw, pool);
  // COLD START (gameweeks 1-5, and strictly before anything has been scored).
  // Before a single gameweek exists there is no history to rank on and no
  // honest projection to give, so every player projects FLAT: the search then
  // finds nothing worth doing and `basis` tells the screen why.
  //
  // The captain tool falls back to FPL's `ep_next` here and labels it Beta. The
  // planner deliberately does NOT. Captaincy picks one of eleven players the
  // manager already owns and the downside is a worse multiplier; a transfer
  // spends money and a credit and cannot be taken back. A confident-looking
  // wrong transfer plan in launch week is the exact disproven failure mode this
  // build exists to avoid, so the planner says "nothing yet" instead.
  const projected: ProjectedPoints = new Map(pool.map((p) => [p.id, [avg?.get(p.id) ?? 0]]));

  const availability = await availabilityFor(db);
  const unavailable = unavailableFrom(availability);

  const wildcardActive = entry.chip === "wildcard";
  const plan = planTransfers({
    squad: squadShape(squad), pool, projected, unavailable,
    // weeklyFree is 0: the baseline move everyone gets is granted as a CREDIT at
    // gameweek rollover (grantBaseline), so it is already inside squad.credits.
    // Passing 1 here would spend it twice.
    credits: squad.credits, weeklyFree: 0, wildcardActive,
    considering,
  });

  // Both sides of every comparison, not just the difference. A lone "+5.8"
  // reads as a promise of points; "0.0 a week against 5.8 a week" is a fact
  // about what has already happened and leaves the subtraction — and the
  // disagreeing — to the manager.
  const avgOf = (id: number) => projected.get(id)?.[0] ?? 0;

  return {
    ...plan,
    moves: plan.moves.map((m) => ({ ...m, outAvg: avgOf(m.outId), inAvg: avgOf(m.inId) })),
    perPlayer: plan.perPlayer.map((v) => ({
      ...v,
      outAvg: avgOf(v.outId),
      inAvg: v.bestInId === null ? null : avgOf(v.bestInId),
    })),
    basis: avg ? "season-to-date-average" : "no-history-yet",
    credits: squad.credits,
    wildcardActive,
    transfersBooked: entry.transfers.length,
    availabilityLive: availability !== null,
  };
}

export interface SquadFlagsResult {
  gw: number;
  flags: SquadFlag[];
  /** False when FPL's status feed was unreadable, so the screen can say the
   *  injury half is missing instead of implying a clean bill of health. An
   *  empty list and a broken feed must never look the same. */
  availabilityLive: boolean;
}

/** Which of YOUR players should you be looking at this week. The first thing
 *  the tool should tell a manager, and until now the one thing it never did. */
export async function squadFlags(db: Db, userId: string): Promise<SquadFlagsResult> {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");

  const availability = await availabilityFor(db);

  // Minutes for the gameweeks immediately before this one. Strictly the past —
  // the deadline hasn't passed, so this week's minutes do not exist yet, and
  // reading them would be looking at the answer.
  const recentMinutes = new Map<number, number[]>();
  const from = Math.max(1, gw.gw - BENCH_WINDOW_GWS);
  if (gw.gw > 1) {
    try {
      type MinutesRow = { player_id: number; gw: number; minutes: number };
      const { rows } = await fetchAllPaged<MinutesRow>(async (rangeFrom, rangeTo) => {
        const result = await db.from("fantasy_player_scores")
          .select("player_id, gw, minutes", { count: "exact" })
          .gte("gw", from).lt("gw", gw.gw)
          .order("gw", { ascending: true }).order("player_id", { ascending: true })
          .range(rangeFrom, rangeTo);
        return {
          rows: (unwrapRead(result, "fantasy_player_scores minutes read failed") ?? []) as MinutesRow[],
          count: result.count,
        };
      });
      const byPlayer = new Map<number, { gw: number; minutes: number }[]>();
      for (const r of rows) {
        if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
        byPlayer.get(r.player_id)!.push({ gw: r.gw, minutes: r.minutes ?? 0 });
      }
      // A player who didn't feature has NO row at all (ingest skips a zero-
      // minute appearance), so zero-fill the window before judging him —
      // otherwise "never played" reads as "no evidence" and never flags.
      const window: number[] = [];
      for (let g = from; g < gw.gw; g++) window.push(g);
      for (const pick of squad.picks) {
        const mine = new Map((byPlayer.get(pick.id) ?? []).map((r) => [r.gw, r.minutes]));
        recentMinutes.set(pick.id, window.map((g) => mine.get(g) ?? 0));
      }
    } catch (e) {
      console.error("[fantasy] minutes read failed — flagging on availability alone", e);
    }
  }

  return {
    gw: gw.gw,
    flags: flagSquad({ squad: squadShape(squad), availability, recentMinutes }),
    availabilityLive: availability !== null,
  };
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
 *  him. Reads only the past; a gameweek in progress has no row yet.
 *
 *  There is no goals-vs-expected line: xG would come from a column added by a
 *  migration that was never applied and whose feature was cut, so
 *  `buildPlayerProfile` is passed no xG and omits that stat rather than claiming
 *  the player had zero chances. */
export async function playerProfile(db: Db, userId: string, playerId: number) {
  const gw = await currentGw(db, userId);
  const pool = await pricedPool(db, gw.gw);
  const p = pool.find((x) => x.id === playerId);
  if (!p) throw new HttpError(404, "player not in the pool", "unknown-player");

  // Every scored gameweek so far. Ranged explicitly — PostgREST silently caps
  // an unranged read at 1,000 rows, and a season of one player is small but
  // the habit is what keeps the next query honest.
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

  return {
    name: p.name, club: p.club, priceTenths: p.priceTenths,
    profile: buildPlayerProfile({
      playerId, pos: p.pos, recent, season,
      flag,
      fixtures: await upcomingFor(db, p.clubId),
    }),
  };
}

export interface WildcardValue {
  gw: number;
  /** Moves a wildcard would let you make right now, best first. */
  moves: { outId: number; inId: number; gain: number; outAvg: number; inAvg: number }[];
  /** The DIFFERENCE between the two elevens' season averages. Not a forecast. */
  totalGain: number;
  /** What your starting eleven have averaged a week between them, so far. */
  currentXiAvg: number;
  /** What the eleven you could afford have averaged a week, so far. */
  improvedXiAvg: number;
  /** The same number computed against LAST gameweek's locked squad, or null
   *  when there isn't one yet. This is the whole point — a single figure is
   *  meaningless, a figure you watch climb is a decision. */
  previousGain: number | null;
  previousGw: number | null;
  /** Whether the manager actually holds one, and how long it lasts. Held
   *  separately from the value: what it is worth and whether you have it are
   *  different questions and conflating them hides one of them. */
  held: number;
  expiresAtGw: number | null;
  gameweeksLeft: number | null;
  basis: "season-to-date-average" | "no-history-yet";
}

/**
 * What a wildcard would be worth if you played it today.
 *
 * The founder's reframe, and it sidesteps the thing we cannot honestly do.
 * "When should I play my wildcard" is a forecast, and no chip-timing claim has
 * been tested — so answering it would be reasoning dressed up as evidence.
 * "What is it worth right now" is arithmetic: a wildcard makes every transfer
 * free, so its value is simply the sum of the moves you would make once cost
 * stops being a reason not to.
 *
 * The manager then watches that number across the weeks and calls it
 * themselves, which is the same bargain as everything else here — we show, they
 * decide.
 *
 * Every move still passes `applyTransfer`, so this is what a wildcard would
 * ACTUALLY buy you: budget, three-per-club and position quotas all respected.
 * It is not a fantasy of the perfect squad.
 */
export async function wildcardValue(db: Db, userId: string): Promise<WildcardValue> {
  const gw = await currentGw(db, userId);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const pool = await pricedPool(db, gw.gw);

  const avg = await seasonAverageFor(db, gw.gw, pool);
  const projected: ProjectedPoints = new Map(pool.map((p) => [p.id, [avg?.get(p.id) ?? 0]]));
  const unavailable = unavailableFrom(await availabilityFor(db));

  // ONLY THE ELEVEN WHO SCORE. Measured on a real squad: of a headline +54 a
  // week, 13.5 came from upgrading BENCH players — points that would never
  // reach the manager, because the bench doesn't score. Counting them is the
  // same mistake as every other one this feature has produced: totting up
  // something that never arrives at the outcome. A wildcard genuinely lets you
  // rebuild all fifteen, but what it is WORTH is what your starting eleven
  // gains.
  const valueOf = (
    picks: SquadPick[], bankTenths: number, xi: number[],
    market: PoolPlayer[], proj: ProjectedPoints,
  ) => {
    const starting = new Set(xi);
    return planTransfers({
      squad: { picks, bankTenths }, pool: market, projected: proj, unavailable,
      credits: squad.credits, weeklyFree: 0, wildcardActive: true,
      considering: picks.filter((p) => starting.has(p.id)).map((p) => p.id),
    });
  };

  const now = valueOf(squad.picks, squad.bank_tenths, squad.xi, pool, projected);

  // Last gameweek's figure, from the squad that was actually locked in then.
  // No new table for this: `fantasy_entries` already snapshots the picks, so
  // the trend is recoverable rather than something we have to start recording
  // and wait a month to show.
  let previousGain: number | null = null;
  let previousGw: number | null = null;
  if (gw.gw > 1) {
    try {
      const prev = await getEntry(db, userId, gw.gw - 1);
      if (prev?.picks?.length && prev.xi?.length) {
        // POINT-IN-TIME, or the comparison is worthless. Scoring last week's
        // squad against THIS week's prices and averages gives the same number
        // back whenever no transfers were made — identical by construction, and
        // presented as a trend it would be a lie.
        const prevPool = await pricedPool(db, gw.gw - 1);
        const prevAvg = await seasonAverageFor(db, gw.gw - 1, prevPool);
        const prevProj: ProjectedPoints = new Map(
          prevPool.map((p) => [p.id, [prevAvg?.get(p.id) ?? 0]]),
        );
        previousGain = valueOf(
          prev.picks, squad.bank_tenths, prev.xi, prevPool, prevProj,
        ).totalGain;
        previousGw = gw.gw - 1;
      }
    } catch (e) {
      // A missing trend is a missing sentence, not a broken screen.
      console.error("[fantasy] previous wildcard value failed — showing today's only", e);
    }
  }

  // The two elevens as totals. This is what the screen should lead with: a
  // single "+48" reads as points we are promising to deliver, and it is nothing
  // of the kind — it is the gap between what one set of players has averaged
  // and what another has. Past tense, checkable, and a manager can disagree
  // with it on the evidence rather than on trust.
  const avgOf = (id: number) => projected.get(id)?.[0] ?? 0;
  const startingIds = new Set(squad.xi);
  const currentXiAvg = squad.picks
    .filter((p) => startingIds.has(p.id))
    .reduce((t, p) => t + avgOf(p.id), 0);
  const improvedXiAvg = currentXiAvg + now.totalGain;

  // Chip state lives on the squad row, not a separate read.
  const expiresAtGw = squad.wildcard_half ?? null;

  return {
    gw: gw.gw,
    moves: now.moves.map((m) => ({
      outId: m.outId, inId: m.inId, gain: m.gain,
      outAvg: avgOf(m.outId), inAvg: avgOf(m.inId),
    })),
    totalGain: now.totalGain,
    currentXiAvg, improvedXiAvg,
    previousGain, previousGw,
    held: squad.wildcards ?? 0,
    expiresAtGw,
    gameweeksLeft: expiresAtGw !== null ? Math.max(0, expiresAtGw - gw.gw) : null,
    basis: avg ? "season-to-date-average" : "no-history-yet",
  };
}
