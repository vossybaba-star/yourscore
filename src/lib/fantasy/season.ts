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
import { accrueChip, grantBaseline, scoreEntry, type Chip, type LockedSelection, type SquadPick } from "./engine";
import { aggregateFixtures, fetchGwFixtures, toPlayerScores } from "./ingest";
import { enginePool, gwPrices } from "./pool";
import { SCORING_VERSION, ZERO_FACTS, type MatchFacts } from "./values";
import { deadlineComms, monthWinnerComms, resultComms } from "./comms";
import { halftimeEarn } from "./halftime-link";
import { interpretHoldRead } from "./ops-diff";

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
/**
 * How close to its deadline a gameweek has to be before we freeze its prices.
 *
 * "Price at gameweek open" reads fine until you notice the whole calendar is
 * seeded `open` months in advance: on that rule the very first tick of the
 * season would stamp July's FPL prices onto gameweek 1 and — because
 * `ensurePrices` is deliberately idempotent — they would still be July's prices
 * when it actually kicked off in August. A gameweek is "open" for pricing only
 * once it is the week being played. Seven days covers the normal in-season case
 * (the previous gameweek finalises about five days before the next deadline)
 * without pricing anything a month early.
 */
const PRICE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

const ms = (iso: string) => new Date(iso).getTime();

/** PostgREST caps an unbounded select at 1000 rows and says nothing about it.
 *  Every read in this file is over "all managers", so an unbounded one silently
 *  stops locking, scoring or paying the 1001st person — with no error anywhere.
 *  `.range(0, 9999)` only moves the cliff, so the season's own reads page. */
const PAGE = 1000;
async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Split ids into batches small enough that an UPDATE … RETURNING can hand every
 *  changed row back inside PostgREST's cap. */
const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ── lock: the missing snapshot ───────────────────────────────────────────────
/**
 * Snapshot every squad into its entry. Idempotent: a squad already locked for
 * this gameweek is left alone, so a re-tick can never overwrite a real lock.
 */
export async function lockGameweek(db: Db, gw: SeasonGw): Promise<{ locked: number; rolledOver: number }> {
  // Both reads page: this is the one moment in the week where missing a manager
  // costs them the whole gameweek, and an unbounded select would drop everyone
  // past the thousandth silently.
  const squads = await pageAll<{ user_id: string; picks: SquadPick[]; xi: number[]; bench: number[]; captain: number; vice: number }>(
    (from, to) => db.from("fantasy_squads").select("user_id, picks, xi, bench, captain, vice").range(from, to),
    "lock squads",
  );

  const existing = await pageAll<{ user_id: string; locked_at: string | null; round_done_at: string | null }>(
    (from, to) => db.from("fantasy_entries").select("user_id, locked_at, round_done_at").eq("gw", gw.gw).range(from, to),
    "lock entries",
  );
  const entryOf = new Map(existing.map((e) => [e.user_id, e]));

  const lockedAt = new Date().toISOString();
  const rows = [];
  let rolledOver = 0;
  for (const s of squads) {
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
  // Chunked so a big league doesn't post one enormous body — and so a partial
  // failure still leaves every earlier batch locked rather than nobody.
  for (const batch of chunk(rows, 500)) {
    const { error: upErr } = await db.from("fantasy_entries")
      .upsert(batch, { onConflict: "user_id,gw" });
    if (upErr) throw new Error(`lock upsert: ${upErr.message}`);
  }
  await db.from("fantasy_gameweeks").update({ status: "locked" }).eq("gw", gw.gw);
  return { locked: rows.length, rolledOver };
}

// ── prices: FPL → fantasy_player_prices, once at gameweek open ───────────────
/**
 * Snapshot this gameweek's prices from FPL and freeze them for the week.
 *
 * Taken ONCE, at gameweek open: your transfer on Saturday costs what it cost on
 * Tuesday. That is the design — keep FPL's price economy, delete its nightly
 * price-watching chore. Idempotent: a gameweek that already has prices is left
 * alone, so prices can never shift under a manager mid-week.
 *
 * FPL's `now_cost` is already in tenths, which is our internal unit — no
 * conversion, so no rounding drift between their prices and ours.
 */
export async function ensurePrices(db: Db, gw: SeasonGw): Promise<{ priced: number; source: "existing" | "fpl" }> {
  const existing = await gwPrices(db, gw.gw);
  if (existing.size) return { priced: existing.size, source: "existing" };

  const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!res.ok) throw new Error(`FPL bootstrap ${res.status}`);
  const boot = (await res.json()) as { elements?: { id: number; now_cost: number }[] };
  if (!boot.elements?.length) throw new Error("FPL bootstrap returned no players");

  // Only players in our pool — FPL carries the whole league, we carry a filtered
  // pool with SportMonks ids baked in.
  const ours = new Set(enginePool().map((p) => p.id));
  const rows = boot.elements
    .filter((e) => ours.has(e.id) && Number.isInteger(e.now_cost) && e.now_cost > 0)
    .map((e) => ({ gw: gw.gw, player_id: e.id, price_tenths: e.now_cost, updated_at: new Date().toISOString() }));

  // A thin fetch is worse than none: writing a partial snapshot would price the
  // missing half of the league at its seed and quietly corrupt a week of transfers.
  if (rows.length < ours.size * 0.9)
    throw new Error(`FPL priced only ${rows.length}/${ours.size} of the pool — holding`);

  const { error } = await db.from("fantasy_player_prices").upsert(rows, { onConflict: "gw,player_id" });
  if (error) throw new Error(`price snapshot: ${error.message}`);
  return { priced: rows.length, source: "fpl" };
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
export async function finaliseGameweek(db: Db, gw: SeasonGw): Promise<{ finalised: number; chipsAccrued: number; baselineGranted: number; held?: boolean }> {
  // fantasy-ops' veto (Guard B red on this gw's facts). A FRESH point-read, not
  // the `gw` object the caller is holding — that may be stale by however long
  // this tick has been running, and a hold set moments ago must be honoured
  // immediately, not on the next tick. This is the only thing that can stop a
  // scored → final transition; lock/ingest/scoring above this point are untouched.
  //
  // FAIL OPEN on the read itself: a watchdog that can crash the season it's
  // protecting (migration 210 not yet applied, a transient DB blip) is worse
  // than no watchdog at all. `interpretHoldRead` treats any read error as
  // "not held" — only an explicit ops_hold=true row ever vetoes.
  const { data: holdRow, error: holdErr } = await db
    .from("fantasy_gameweeks").select("ops_hold").eq("gw", gw.gw).maybeSingle();
  if (holdErr) console.error(`[finalise] ops_hold read failed for gw ${gw.gw} — failing OPEN (finalise proceeds): ${holdErr.message}`);
  if (interpretHoldRead(holdRow as { ops_hold: boolean } | null, holdErr)) {
    return { finalised: 0, chipsAccrued: 0, baselineGranted: 0, held: true };
  }

  // Find who is moving, then move them in batches. A single UPDATE … RETURNING
  // over the whole gameweek hands back at most 1000 rows, so past a thousand
  // managers the rest would transition without ever being paid their baseline
  // transfer or their chip progress. Each batch still filters on
  // status = 'scored', so the compare-and-swap — and the idempotency it buys —
  // is unchanged: a second run finds nothing left to move.
  const pending = await pageAll<{ user_id: string }>(
    (from, to) => db.from("fantasy_entries")
      .select("user_id").eq("gw", gw.gw).eq("status", "scored").range(from, to),
    "finalise scan",
  );

  const all: { user_id: string; round_done_at: string | null }[] = [];
  for (const batch of chunk(pending.map((p) => p.user_id), 500)) {
    const { data, error } = await db.from("fantasy_entries")
      .update({ status: "final" }).eq("gw", gw.gw).eq("status", "scored")
      .in("user_id", batch)
      .select("user_id, round_done_at");
    if (error) throw new Error(`finalise: ${error.message}`);
    all.push(...((data ?? []) as { user_id: string; round_done_at: string | null }[]));
  }
  await db.from("fantasy_gameweeks").update({ status: "final" }).eq("gw", gw.gw);

  // The baseline transfer for the gameweek now opening. Granted to EVERYONE who
  // had an entry, including the rolled-over manager who never opened the app —
  // "everyone gets one" means everyone. Sits here because the scored → final
  // transition is already a compare-and-swap, so a re-run of the tick can't hand
  // out a second one.
  let baselineGranted = 0;
  if (all.length) {
    const squads: { user_id: string; credits: number }[] = [];
    for (const batch of chunk(all.map((e) => e.user_id), 500)) {
      const { data, error: bErr } = await db.from("fantasy_squads")
        .select("user_id, credits").in("user_id", batch);
      if (bErr) throw new Error(`finalise baseline lookup: ${bErr.message}`);
      squads.push(...((data ?? []) as { user_id: string; credits: number }[]));
    }
    // Grouped by the balance each manager lands on — there are only six possible
    // values — so this is a few updates rather than one per manager.
    const byCredits = new Map<number, string[]>();
    for (const s of squads) {
      const next = grantBaseline(s.credits);
      if (next === s.credits) continue; // already at the cap
      const bucket = byCredits.get(next) ?? [];
      bucket.push(s.user_id);
      byCredits.set(next, bucket);
      baselineGranted++;
    }
    for (const [credits, ids] of Array.from(byCredits)) {
      for (const batch of chunk(ids, 500)) {
        const { error: gErr } = await db.from("fantasy_squads")
          .update({ credits }).in("user_id", batch);
        if (gErr) throw new Error(`finalise baseline grant: ${gErr.message}`);
      }
    }
  }

  const played = all.filter((e) => e.round_done_at != null);
  let chipsAccrued = 0;
  if (played.length) {
    const squads: { user_id: string; chips: number; chip_progress: number }[] = [];
    for (const batch of chunk(played.map((e) => e.user_id), 500)) {
      const { data, error: sqErr } = await db.from("fantasy_squads")
        .select("user_id, chips, chip_progress").in("user_id", batch);
      if (sqErr) throw new Error(`finalise chip lookup: ${sqErr.message}`);
      squads.push(...((data ?? []) as { user_id: string; chips: number; chip_progress: number }[]));
    }
    // Only sixteen reachable (progress, held) states, so grouping collapses a
    // per-manager loop into a handful of updates.
    const byState = new Map<string, { progress: number; held: number; ids: string[] }>();
    for (const s of squads) {
      const next = accrueChip(s.chip_progress, s.chips);
      const key = `${next.progress}:${next.held}`;
      const bucket = byState.get(key) ?? { progress: next.progress, held: next.held, ids: [] };
      bucket.ids.push(s.user_id);
      byState.set(key, bucket);
      if (next.minted) chipsAccrued++;
    }
    for (const { progress, held, ids } of Array.from(byState.values())) {
      for (const batch of chunk(ids, 500)) {
        const { error: chErr } = await db.from("fantasy_squads")
          .update({ chip_progress: progress, chips: held }).in("user_id", batch);
        if (chErr) throw new Error(`finalise chip accrual: ${chErr.message}`);
      }
    }
  }
  return { finalised: all.length, chipsAccrued, baselineGranted };
}

// ── the tick ─────────────────────────────────────────────────────────────────
export interface TickReport {
  gw: number;
  action: "locked" | "provisional" | "scored" | "finalised" | "held" | "waiting" | "priced";
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

  const live = (gws ?? []) as SeasonGw[];
  // The gameweek being PLAYED right now — the lowest-numbered one that hasn't
  // closed. Only this one gets prices and a deadline nudge. Without that test,
  // the first tick of the season walks all 38 future gameweeks and snapshots
  // today's FPL prices into every one of them; because `ensurePrices` is
  // idempotent, gameweek 38 would then keep its July prices for the whole
  // season. Prices are taken at a gameweek's OWN open, not in advance.
  const current = live.find((g) => g.status !== "final");

  const out: TickReport[] = [];
  for (const gw of live) {
    if (gw.status === "final") continue;
    if (!gw.deadline) { out.push({ gw: gw.gw, action: "held", detail: "no deadline set" }); continue; }
    if (now < ms(gw.deadline)) {
      if (gw.gw !== current?.gw) continue; // a future gameweek needs nothing yet
      // Still open. The one thing an open gameweek needs is its prices — taken
      // once, when it comes into range, then frozen for the week. A failure here
      // must NOT stop the season: last week's prices standing for another week is
      // survivable, a stalled tick is not.
      if (ms(gw.deadline) - now <= PRICE_WITHIN_MS) {
        try {
          const p = await ensurePrices(db, gw);
          if (p.source === "fpl") out.push({ gw: gw.gw, action: "priced", detail: `${p.priced} players priced from FPL` });
        } catch (e) {
          out.push({ gw: gw.gw, action: "held", detail: `price snapshot failed, will retry: ${(e as Error).message}` });
        }
      }
      // Inside 24h of the deadline: the personal nudge email (claimed once per
      // user in notification_log, gated on FANTASY_EMAILS_ENABLED). Failure-soft
      // — a mail outage must never hold the season.
      if (ms(gw.deadline) - now < 24 * 60 * 60 * 1000) {
        try {
          const n = await deadlineComms(db, gw);
          if (n) out.push({ gw: gw.gw, action: "waiting", detail: `deadline nudge emailed to ${n}` });
        } catch (e) { console.error("[tick] deadline comms failed:", e); }
      }
      out.push({ gw: gw.gw, action: "waiting", detail: `deadline ${gw.deadline}` });
      continue; // nothing else may touch an open gameweek
    }

    // 1. The deadline has passed and it's still open → lock. DB-only, so a dead
    //    feed can never stop the lock from happening on time.
    if (gw.status === "open") {
      const { locked, rolledOver } = await lockGameweek(db, gw);
      out.push({ gw: gw.gw, action: "locked", detail: `${locked} squads locked (${rolledOver} rolled over unplayed)` });
      gw.status = "locked";
    }

    // The halftime link sweeps while the weekend is in play: a good halftime
    // quiz banks a credit for NEXT gameweek (this one is locked — nothing here
    // can touch the week in play). It runs BEFORE ingest on purpose: quiz
    // earnings must not hinge on the SportMonks feed being alive. Failure-soft,
    // idempotent per attempt.
    try {
      const ht = await halftimeEarn(db, gw);
      if (ht.minted) out.push({ gw: gw.gw, action: "provisional", detail: `halftime link minted ${ht.minted} credit(s)` });
    } catch (e) { console.error("[tick] halftime link failed:", e); }

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
      const { finalised, chipsAccrued, held } = await finaliseGameweek(db, gw);
      if (held) {
        out.push({ gw: gw.gw, action: "held", detail: "ops_hold set — finalise vetoed" });
        continue; // vetoed — no comms for a gameweek that didn't actually close
      }
      out.push({ gw: gw.gw, action: "finalised", detail: `stat-correction window closed (${finalised} entries, ${chipsAccrued} chips accrued)` });
      // The retention loop fires off the back of finality: your result lands, and
      // if this gameweek closed its month, every league announces its winner.
      // Failure-soft — comms must never hold the season (that's the tick's job).
      try {
        const r = await resultComms(db, gw);
        const m = await monthWinnerComms(db, gw, (gws ?? []) as SeasonGw[]);
        out.push({ gw: gw.gw, action: "finalised", detail: `comms: ${r.pushed} pushed · ${r.emailed} emailed${m ? ` · ${m} month titles announced` : ""}` });
      } catch (e) { console.error("[tick] result comms failed:", e); }
    }
  }
  return out;
}
