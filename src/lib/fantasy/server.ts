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
  applyTransfer, bankCredits, creditsForRound, scoreEntry, smartDefaults,
  transferCost, validateSelection, validateSquad, RuleError,
  type LockedSelection, type Squad, type SquadPick,
} from "./engine";
import { aggregateFixtures, fetchGwFixtures, toPlayerScores } from "./ingest";
import { ZERO_FACTS, type MatchFacts } from "./values";
import { enginePool, fantasyPool } from "./pool";
import { isOpenForEdits, type GwRow } from "./gameweeks";

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
}
export interface EntryRow {
  user_id: string; gw: number; status: string;
  round_version: string | null; round_answers: (number | null)[];
  round_correct: number; round_credits: number; round_done_at: string | null;
  transfers: unknown[]; hits: number;
  picks: SquadPick[] | null; xi: number[] | null; bench: number[] | null;
  captain: number | null; vice: number | null; locked_at: string | null;
  points: number | null; points_breakdown: unknown | null;
  autosubs: unknown | null; captain_used: number | null; scored_at: string | null;
}

const squadShape = (r: SquadRow): Squad => ({ picks: r.picks, bankTenths: r.bank_tenths });

async function currentGw(db: Db): Promise<GwRow> {
  const { data, error } = await db.from("fantasy_gameweeks")
    .select("*").eq("status", "open").order("gw", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(409, "no open gameweek", "no-gw");
  return data as GwRow;
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
  const gw = await currentGw(db);
  const squad = await getSquad(db, userId);
  const entry = squad ? await getEntry(db, userId, gw.gw) : null;
  return {
    gw,
    poolVersion: fantasyPool().version,
    openForEdits: isOpenForEdits(gw, entry),
    squad: squad && {
      picks: squad.picks, bankTenths: squad.bank_tenths, credits: squad.credits,
      xi: squad.xi, bench: squad.bench, captain: squad.captain, vice: squad.vice,
      version: squad.version,
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
  };
}

// ── squad reset (Phase 1 / replay testing: wipe squad + entries, start over) ──
export async function resetSquad(db: Db, userId: string) {
  const gw = await currentGw(db);
  if (gw.mode !== "replay") {
    // In the live game you never rebuild a persisted squad — you transfer/wildcard.
    // Only allow a full reset before you've ever locked a gameweek.
    const { data } = await db.from("fantasy_entries")
      .select("gw").eq("user_id", userId).not("locked_at", "is", null).limit(1);
    if (data?.length) throw new HttpError(409, "your season has started — use transfers, not a rebuild", "started");
  }
  await db.from("fantasy_entries").delete().eq("user_id", userId);
  await db.from("fantasy_squads").delete().eq("user_id", userId);
  return { ok: true };
}

// ── squad creation ────────────────────────────────────────────────────────────
export async function createSquad(db: Db, userId: string, body: {
  pickIds: number[]; xi?: number[]; bench?: number[]; captain?: number; vice?: number;
}) {
  const gw = await currentGw(db);
  if (await getSquad(db, userId)) throw new HttpError(409, "squad already exists", "exists");
  let squad: Squad;
  try { squad = validateSquad(body.pickIds, enginePool()); } catch (e) { asHttp(e); throw e; }
  const sel = body.xi && body.bench && body.captain && body.vice
    ? (() => { try { return validateSelection(squad, body.xi!, body.bench!, body.captain!, body.vice!); } catch (e) { asHttp(e); throw e; } })()
    : smartDefaults(squad, enginePool());
  const { error } = await db.from("fantasy_squads").insert({
    user_id: userId, picks: squad.picks, bank_tenths: squad.bankTenths,
    xi: sel.xi, bench: sel.bench, captain: sel.captain, vice: sel.vice, created_gw: gw.gw,
  });
  if (error) throw new HttpError(500, error.message);
  return getState(db, userId);
}

// ── knowledge round ───────────────────────────────────────────────────────────
const roundFor = (gw: number, userId: string): Round =>
  buildRound(GATES.questions, { gameweek: `fantasy:${gw}`, userId, formation: "4-3-3" });

export async function startRound(db: Db, userId: string) {
  const gw = await currentGw(db);
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

export async function stepRound(db: Db, userId: string, k: number, optionId: number | null) {
  const gw = await currentGw(db);
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
  const { error } = await db.from("fantasy_entries").update(patch)
    .eq("user_id", userId).eq("gw", gw.gw).is("round_done_at", null);
  if (error) throw new HttpError(500, error.message);
  if (isLast && minted >= 0) {
    const squad = (await getSquad(db, userId))!;
    await db.from("fantasy_squads")
      .update({ credits: bankCredits(squad.credits, minted), updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }
  return {
    correct, answerId: q.answerId, correctCount,
    answered: answers.length, done: isLast,
    creditsEarned: isLast ? minted : null,
  };
}

// ── transfers + selection ─────────────────────────────────────────────────────
export async function applyTransferTx(db: Db, userId: string, outId: number, inId: number) {
  const gw = await currentGw(db);
  const squad = await getSquad(db, userId);
  if (!squad) throw new HttpError(409, "no squad", "no-squad");
  const entry = await ensureEntry(db, userId, gw.gw);
  if (!isOpenForEdits(gw, entry)) throw new HttpError(409, "gameweek is locked", "locked");

  let next: Squad;
  try { next = applyTransfer(squadShape(squad), outId, inId, enginePool()); } catch (e) { asHttp(e); throw e; }
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
  const gw = await currentGw(db);
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

// ── scoring ──────────────────────────────────────────────────────────────────
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
    scores.map((s) => ({ gw: gw.gw, player_id: s.playerId, minutes: s.facts.minutes, facts: s.facts, points: s.points })),
    { onConflict: "gw,player_id" },
  );
  if (upErr) throw new HttpError(500, upErr.message);
  return new Map(scores.map((s) => [s.playerId, { points: s.points, facts: s.facts as never }]));
}

/** Replay-mode lock: snapshot the squad into the entry, then score immediately. */
export async function lockAndScore(db: Db, userId: string) {
  const gw = await currentGw(db);
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
  const form = new Map(enginePool().map((p) => [p.id, p.priceTenths]));
  const result = scoreEntry(sel, entry.hits, engineScores, form);
  await db.from("fantasy_entries").update({
    status: "scored", points: result.total, points_breakdown: result.breakdown,
    autosubs: result.subs, captain_used: result.captainUsed,
    scored_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("gw", gw.gw);
  return { points: result.total, breakdown: result.breakdown, subs: result.subs, captainUsed: result.captainUsed, hitsDeducted: result.hitsDeducted };
}
