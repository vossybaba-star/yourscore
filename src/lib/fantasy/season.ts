import "server-only";
/**
 * The season engine — the thing that makes this a game rather than a demo.
 *
 * Until now nothing in the codebase ever locked a gameweek, ingested a match, or
 * scored anybody: it happened only when a user pressed "Lock it in", and in live
 * mode that path returned a 403. A live gameweek was an unrecoverable dead end —
 * the squad never snapshotted, `scored_at` stayed null, and the user was frozen
 * on that gameweek forever.
 *
 * The season now runs itself, on a clock, whether anyone opens the app or not:
 *
 *     open ──(deadline passes)──> locked ──(matches end)──> scored ──> final
 *
 * Three rules this file exists to honour, all from the locked design:
 *
 *   1. THE ROLL-OVER RULE (D:281-287). Miss the deadline and your squad plays
 *      anyway, unchanged. So the lock snapshots EVERY squad — including people
 *      who never opened the app that week. Their team still counts on the table;
 *      they simply earn no credits. A fantasy manager who forgets is not punished
 *      with a blank.
 *
 *   2. SCORING IS A PURE RECOMPUTE from the locked snapshot, never an accumulation.
 *      Every tick re-derives the whole gameweek from `fantasy_player_scores`. That
 *      is what makes a stat correction safe — it just re-scores — and it is what
 *      lets the league tables sum on read without ever going stale.
 *
 *   3. THE FEED-DOWNTIME LAW (D:309-310). If SportMonks is down or returns nothing,
 *      we do NOT advance the state machine and we do NOT write partial scores. We
 *      hold, and try again next tick. Never lock stale data. "Reliability at the
 *      deadline is sacred."
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accrueChip, halfOf, scoreEntry, type Chip, type LockedSelection, type SquadPick } from "./engine";
import { aggregateFixtures, fetchGwFixtures, toPlayerScores } from "./ingest";
import { enginePool } from "./pool";
import { SCORING_VERSION, ZERO_FACTS, type MatchFacts } from "./values";

// Same loose client type server.ts uses — the generated row types model jsonb as
// `Json`, which fights every SquadPick/MatchFacts read and write in this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface SeasonGw {
  gw: number; season: string; mode: string;
  window_start: string; window_end: string;
  deadline: string | null; status: string; sm_season_id: number;
}

/** A gameweek's matches are done ~3h after the last kickoff (a match runs ~2h;
 *  the extra hour absorbs stoppages and a late finish). A POSTPONED fixture never
 *  finishes, so waiting on "all fixtures FT" would hang the season forever —
 *  the design settles this: a postponed player simply scores 0 this week and the
 *  rescheduled match scores in the gameweek it's actually played (D:302-304). */
const MATCHES_DONE_AFTER_LAST_KICKOFF_MS = 3 * 60 * 60 * 1000;
/** Stat corrections land within a day; after that the gameweek is closed for good. */
const FINALISE_AFTER_MATCHES_DONE_MS = 24 * 60 * 60 * 1000;

const ms = (iso: string) => new Date(iso).getTime();

// ── lock: the missing snapshot ───────────────────────────────────────────────
/**
 * Snapshot every squad into its entry. Idempotent: a squad already locked for
 * this gameweek is left alone, so a re-tick can never overwrite a real lock.
 */
export async function lockGameweek(db: Db, gw: SeasonGw): Promise<{ locked: number; rolledOver: number }> {
  const { data: squads, error } = await db.from("fantasy_squads")
    .select("user_id, picks, xi, bench, captain, vice");
  if (error) throw new Error(`lock: ${error.message}`);

  const { data: existing } = await db.from("fantasy_entries")
    .select("user_id, locked_at, round_done_at").eq("gw", gw.gw);
  const entryOf = new Map((existing ?? []).map((e: { user_id: string; locked_at: string | null; round_done_at: string | null }) => [e.user_id, e]));

  const lockedAt = new Date().toISOString();
  const rows = [];
  let rolledOver = 0;
  for (const s of (squads ?? []) as { user_id: string; picks: SquadPick[]; xi: number[]; bench: number[]; captain: number; vice: number }[]) {
    const prior = entryOf.get(s.user_id);
    if (prior?.locked_at) continue; // already locked — never re-snapshot
    // No round played this week = the roll-over. The squad still plays.
    if (!prior?.round_done_at) rolledOver++;
    rows.push({
      user_id: s.user_id, gw: gw.gw, status: "locked",
      picks: s.picks, xi: s.xi, bench: s.bench, captain: s.captain, vice: s.vice,
      locked_at: lockedAt,
    });
  }
  if (rows.length) {
    const { error: upErr } = await db.from("fantasy_entries")
      .upsert(rows, { onConflict: "user_id,gw" });
    if (upErr) throw new Error(`lock upsert: ${upErr.message}`);
  }
  await db.from("fantasy_gameweeks").update({ status: "locked" }).eq("gw", gw.gw);

  await issueWildcards(db, halfOf(gw.gw));
  return { locked: rows.length, rolledOver };
}

/**
 * One issued wildcard per half, use-it-or-lose-it (D:147-149).
 *
 * Two separate questions, and they need two separate columns — collapsing them
 * into one is a bug that would only surface in December:
 *   - `wildcard_half`: the half the wildcards you HOLD are valid in. Crossing into
 *     a new half kills them (that IS the expiry).
 *   - `issued_half`:   the half we last handed out the standard wildcard for.
 * A bonus wildcard from a perfect round also sets `wildcard_half`. If the issuer
 * keyed off that, a player who quizzed 11/11 in the first week of a half would
 * look "already issued" and would silently never receive their own wildcard —
 * punished for a perfect round. `issued_half` is what makes it idempotent.
 */
async function issueWildcards(db: Db, half: 1 | 2): Promise<void> {
  const { data: squads, error } = await db.from("fantasy_squads")
    .select("user_id, wildcards, wildcard_half, issued_half").range(0, 9999);
  if (error) throw new Error(`wildcard issuance: ${error.message}`);

  for (const s of (squads ?? []) as {
    user_id: string; wildcards: number; wildcard_half: number | null; issued_half: number | null;
  }[]) {
    if (s.issued_half === half && s.wildcard_half === half) continue; // already settled for this half
    // Anything held for a previous half is dead. Expire, then issue.
    const live = s.wildcard_half === half ? s.wildcards : 0;
    const grant = s.issued_half === half ? 0 : 1;
    await db.from("fantasy_squads")
      .update({ wildcards: live + grant, wildcard_half: half, issued_half: half })
      .eq("user_id", s.user_id);
  }
}

// ── ingest: SportMonks → fantasy_player_scores ───────────────────────────────
/**
 * Pull the gameweek's match facts and upsert them. Returns the last kickoff so
 * the caller knows when the gameweek's football is actually over.
 * Throws if the feed gives us nothing — the caller must then HOLD, not advance.
 */
export async function ingestGameweek(db: Db, gw: SeasonGw): Promise<{ players: number; lastKickoff: number | null }> {
  const key = process.env.SPORTMONKS_API_KEY;
  if (!key) throw new Error("SPORTMONKS_API_KEY not configured");

  const fixtures = await fetchGwFixtures(gw.sm_season_id, gw.window_start, gw.window_end, key);
  if (!fixtures.length) throw new Error(`no fixtures returned for gw ${gw.gw} — holding`);

  const kickoffs = fixtures
    .map((f) => (f as { starting_at?: string }).starting_at)
    .filter(Boolean)
    .map((s) => new Date(`${(s as string).replace(" ", "T")}Z`).getTime());
  const lastKickoff = kickoffs.length ? Math.max(...kickoffs) : null;

  const facts = aggregateFixtures(fixtures);
  const pool = enginePool().map((p) => ({ id: p.id, smId: p.smId!, pos: p.pos, name: p.name }));
  const { scores } = toPlayerScores(facts, pool);
  // Zero scores while matches are in play is normal; zero scores AFTER they've
  // been played means the feed is lying to us. Either way, writing nothing is
  // safe — we simply try again on the next tick.
  if (!scores.length) return { players: 0, lastKickoff };

  const { error } = await db.from("fantasy_player_scores").upsert(
    scores.map((s) => ({
      gw: gw.gw, player_id: s.playerId, minutes: s.facts.minutes,
      facts: s.facts, points: s.points, updated_at: new Date().toISOString(),
    })),
    { onConflict: "gw,player_id" },
  );
  if (error) throw new Error(`ingest upsert: ${error.message}`);
  return { players: scores.length, lastKickoff };
}

// ── score: pure recompute for every locked entry ─────────────────────────────
/** Form for the armband fallback — the last 3 scored gameweeks, not price. */
async function formFor(db: Db, gw: number): Promise<Map<number, number>> {
  const prior = [gw - 3, gw - 2, gw - 1].filter((g) => g >= 1);
  const byPlayer = new Map<number, number>();
  if (prior.length) {
    const { data } = await db.from("fantasy_player_scores")
      .select("player_id, points").in("gw", prior);
    for (const r of (data ?? []) as { player_id: number; points: number }[])
      byPlayer.set(r.player_id, (byPlayer.get(r.player_id) ?? 0) + r.points);
  }
  return byPlayer.size ? byPlayer : new Map(enginePool().map((p) => [p.id, p.priceTenths]));
}

/**
 * Re-derive every locked entry's score from the snapshot. Safe to run on every
 * tick: provisional through the weekend, then again when the stats settle. It
 * never accumulates, so running it twice produces exactly the same number.
 */
export async function scoreGameweek(db: Db, gw: SeasonGw, opts: { final: boolean }): Promise<{ scored: number }> {
  const { data: scoreRows } = await db.from("fantasy_player_scores")
    .select("player_id, points, facts").eq("gw", gw.gw).range(0, 9999);
  const scores = new Map(
    ((scoreRows ?? []) as { player_id: number; points: number; facts: MatchFacts }[])
      .map((r) => [r.player_id, { points: r.points, facts: r.facts }]),
  );
  if (!scores.size) return { scored: 0 }; // nothing ingested yet — hold

  const { data: entries } = await db.from("fantasy_entries")
    .select("user_id, hits, picks, xi, bench, captain, vice, chip, cash_points")
    .eq("gw", gw.gw).not("locked_at", "is", null).range(0, 9999);

  const form = await formFor(db, gw.gw);
  const scoredAt = new Date().toISOString();
  let scored = 0;

  for (const e of (entries ?? []) as {
    user_id: string; hits: number; picks: SquadPick[];
    xi: number[]; bench: number[]; captain: number; vice: number; chip: Chip | null;
    cash_points: number | null;
  }[]) {
    const sel: LockedSelection = {
      picks: e.picks, xi: e.xi, bench: e.bench, captain: e.captain, vice: e.vice,
    };
    const engineScores = new Map(
      e.picks.map((p) => {
        const s = scores.get(p.id);
        return [p.id, { points: s?.points ?? 0, facts: s?.facts ?? ZERO_FACTS }] as const;
      }),
    );
    // The chip is part of the locked snapshot: whatever was played before the
    // deadline, a re-score always re-applies it — never a different one.
    const result = scoreEntry(sel, e.hits, engineScores, form, e.chip, e.cash_points ?? 0);
    await db.from("fantasy_entries").update({
      // Provisional scores land while the football is still on; the entry only
      // becomes "scored" when the gameweek's matches are actually over.
      status: opts.final ? "scored" : "locked",
      points: result.total, points_breakdown: result.breakdown,
      autosubs: result.subs, captain_used: result.captainUsed,
      scoring_version: SCORING_VERSION,
      scored_at: scoredAt,
    }).eq("user_id", e.user_id).eq("gw", gw.gw);
    scored++;
  }

  if (opts.final) await db.from("fantasy_gameweeks").update({ status: "scored" }).eq("gw", gw.gw);
  return { scored };
}

/**
 * Close the gameweek for good — stat corrections are past, the table is settled.
 *
 * Chip accrual (loyalty for a PLAYED gameweek, D:123-127) happens inside this
 * same status transition, not as a separate pass: `.eq("status", "scored")`
 * means only entries that are ACTUALLY moving scored → final on this call come
 * back in `transitioned`. Finalising twice finds nothing left in "scored" the
 * second time, so `transitioned` is empty and accrual is a no-op — that's the
 * whole idempotency guarantee, no separate "already accrued" flag needed. A
 * rolled-over week (never played the round) is filtered out before accruing, so
 * it advances nobody's chip progress (D:91-93).
 */
export async function finaliseGameweek(db: Db, gw: SeasonGw): Promise<{ finalised: number; chipsAccrued: number }> {
  const { data: transitioned, error } = await db.from("fantasy_entries")
    .update({ status: "final" }).eq("gw", gw.gw).eq("status", "scored")
    .select("user_id, round_done_at");
  if (error) throw new Error(`finalise: ${error.message}`);
  await db.from("fantasy_gameweeks").update({ status: "final" }).eq("gw", gw.gw);

  const played = ((transitioned ?? []) as { user_id: string; round_done_at: string | null }[])
    .filter((e) => e.round_done_at != null);
  let chipsAccrued = 0;
  if (played.length) {
    const { data: squads, error: sqErr } = await db.from("fantasy_squads")
      .select("user_id, chips, chip_progress").in("user_id", played.map((e) => e.user_id));
    if (sqErr) throw new Error(`finalise chip lookup: ${sqErr.message}`);
    for (const s of (squads ?? []) as { user_id: string; chips: number; chip_progress: number }[]) {
      const next = accrueChip(s.chip_progress, s.chips);
      const { error: chErr } = await db.from("fantasy_squads")
        .update({ chip_progress: next.progress, chips: next.held })
        .eq("user_id", s.user_id);
      if (chErr) throw new Error(`finalise chip accrual: ${chErr.message}`);
      if (next.minted) chipsAccrued++;
    }
  }
  return { finalised: transitioned?.length ?? 0, chipsAccrued };
}

// ── the tick ─────────────────────────────────────────────────────────────────
export interface TickReport {
  gw: number;
  action: "locked" | "provisional" | "scored" | "finalised" | "held" | "waiting";
  detail: string;
}

/**
 * Drive the season forward. Runs often (every ~10 min); does the least work it
 * can; never advances a state it isn't sure about.
 *
 * Deliberately processes EVERY non-final live gameweek whose deadline has passed,
 * not just the newest — if a cron run is missed, or SportMonks was down for a day,
 * the next tick quietly catches the season up instead of leaving a gameweek
 * stranded forever.
 */
export async function tickSeason(db: Db, now = Date.now()): Promise<TickReport[]> {
  const { data: gws, error } = await db.from("fantasy_gameweeks")
    .select("*").eq("mode", "live").order("gw", { ascending: true });
  if (error) throw new Error(`tick: ${error.message}`);

  const out: TickReport[] = [];
  for (const gw of (gws ?? []) as SeasonGw[]) {
    if (gw.status === "final") continue;
    if (!gw.deadline) { out.push({ gw: gw.gw, action: "held", detail: "no deadline set" }); continue; }
    if (now < ms(gw.deadline)) {
      out.push({ gw: gw.gw, action: "waiting", detail: `deadline ${gw.deadline}` });
      continue; // still open — nothing to do, and nothing may touch it
    }

    // 1. The deadline has passed and it's still open → lock. DB-only, so a dead
    //    feed can never stop the lock from happening on time.
    if (gw.status === "open") {
      const { locked, rolledOver } = await lockGameweek(db, gw);
      out.push({ gw: gw.gw, action: "locked", detail: `${locked} squads locked (${rolledOver} rolled over unplayed)` });
      gw.status = "locked";
    }

    // 2. Ingest + score. Any feed failure HOLDS the gameweek where it is — we
    //    never advance the state machine on data we don't trust.
    let lastKickoff: number | null = null;
    try {
      const r = await ingestGameweek(db, gw);
      lastKickoff = r.lastKickoff;
      if (!r.players) { out.push({ gw: gw.gw, action: "held", detail: "feed returned no player stats yet" }); continue; }
    } catch (e) {
      out.push({ gw: gw.gw, action: "held", detail: `feed error, holding: ${(e as Error).message}` });
      continue;
    }

    const matchesDone = lastKickoff !== null && now >= lastKickoff + MATCHES_DONE_AFTER_LAST_KICKOFF_MS;
    const { scored } = await scoreGameweek(db, gw, { final: matchesDone });

    if (!matchesDone) {
      out.push({ gw: gw.gw, action: "provisional", detail: `${scored} entries scored provisionally — matches still on` });
      continue;
    }
    out.push({ gw: gw.gw, action: "scored", detail: `${scored} entries scored` });

    // 3. Once the corrections window has passed, close it.
    if (lastKickoff !== null && now >= lastKickoff + MATCHES_DONE_AFTER_LAST_KICKOFF_MS + FINALISE_AFTER_MATCHES_DONE_MS) {
      const { finalised, chipsAccrued } = await finaliseGameweek(db, gw);
      out.push({ gw: gw.gw, action: "finalised", detail: `stat-correction window closed (${finalised} entries, ${chipsAccrued} chips accrued)` });
    }
  }
  return out;
}
