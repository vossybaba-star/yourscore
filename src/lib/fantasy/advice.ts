/**
 * Fantasy transfer advice — L1 (score) + L2 (solve). Pure, isomorphic, no DB, no
 * fetch, no Date.now(), no randomness — same discipline as engine.ts, and for the
 * same reason: the whole point of this module is that its output is mechanically
 * checkable (scripts/fantasy/run-tests.sh) and safe to import from a "use client"
 * page.
 *
 * HARD RULE: this file may only take `import type` from "./news" — never a value
 * import. "./news" (and "./pool") start with `import "server-only"`, which THROWS
 * at runtime outside a server/RSC context. `src/app/fantasy/transfers/page.tsx` is
 * a client component, so a value import here would break it. Everything this
 * module needs (Squad, PoolPlayer[], form rows, fixture runs) is passed in as
 * plain data by the caller — exactly how transfers/page.tsx already holds
 * `pool`/`form`/`state` in useState today.
 *
 * L3 (the LLM judgement layer) lives in tips.ts, not here — this module never
 * computes prose, never calls a model, and never decides what to SAY, only what
 * is legal and how good it looks by a legible heuristic.
 */
import {
  applyTransfer, sellPrice, transferCost, RuleError,
  FIXTURE_BONUS,
  type Squad, type PoolPlayer, type FantasyPos,
} from "./engine";
import type { NewsClubRun, NewsFormRow, Difficulty, NewsDoubt, NewsTickerCell } from "./news";
// optimiser.ts is pure (no server-only, no DB, no fetch — see its own module
// doc), so this is a real value-safe boundary, but we only ever need its
// TYPES here: the cron is the only caller of optimiseTransfers itself, this
// file just describes the shape of what comes back.
import type { OptimiseResult } from "./optimiser";

export type FplStatus = "a" | "d" | "i" | "s" | "u";
export interface AvailabilityInfo { status: FplStatus; chance: number | null; news: string }

// ── L1: score ─────────────────────────────────────────────────────────────────
/** A legible heuristic, NOT an xP model — deliberately (locked plan §1/§8: no
 *  xG, no evidence a projection survives without one, so we ship a heuristic and
 *  label it as one). `formPoints` is the same number the transfers page and the
 *  news feed already show (last-5 YourScore points); the fixture bonus reuses
 *  `news.ts`'s own Difficulty bands, no new difficulty logic.
 *
 *  Availability is deliberately NEVER folded in here — it's a hard filter in L2
 *  (buildCandidates), not a penalty here, so this number stays legible ("this
 *  many points, this fixture run") instead of a black-box composite. */
export function moveScore(formPoints: number, run: NewsClubRun | undefined, lookahead = 3): number {
  const cells = run?.cells.slice(0, lookahead) ?? [];
  let bonus = 0;
  for (const c of cells) {
    if (c.difficulty === "kind") bonus += FIXTURE_BONUS;
    else if (c.difficulty === "tough") bonus -= FIXTURE_BONUS;
    // FIXTURE_BONUS is defined in engine.ts — see the note there on why.
  }
  return formPoints + bonus;
}

/** Pool-wide L1 pass: id -> moveScore. Pure function of already-fetched data —
 *  callers (the cron, the transfers page) fetch `form`/`runs` once and share this
 *  one pass across every candidate enumeration. */
export function scorePool(pool: PoolPlayer[], form: NewsFormRow[], runs: NewsClubRun[]): Map<number, number> {
  const formById = new Map(form.map((f) => [f.playerId, f.points]));
  const runByClub = new Map(runs.map((r) => [r.clubId, r]));
  const scores = new Map<number, number>();
  for (const p of pool) scores.set(p.id, moveScore(formById.get(p.id) ?? 0, runByClub.get(p.clubId)));
  return scores;
}

// ── L2: solve ─────────────────────────────────────────────────────────────────
export interface CandidateMove {
  out: { id: number; sellTenths: number };
  in: { id: number; priceTenths: number; moveScore: number };
  scoreDelta: number;
  paid: "credit" | "hit" | "free";
  bankAfterTenths: number;
}

/** What a squad member actually raises if sold NOW — FPL's half-the-rise rule
 *  against the CURRENT pool price, or `buyTenths` if he's left the pool entirely
 *  (sold-player-missing-from-pool). Identical to the fallback `applyTransfer`
 *  itself uses, computed the SAME way here so a payload's `sellTenths` equals
 *  what the server will actually accept BY CONSTRUCTION, not by coincidence. */
function sellTenthsFor(pick: { buyTenths: number }, poolPlayer: PoolPlayer | undefined): number {
  return poolPlayer ? sellPrice(pick.buyTenths, poolPlayer.priceTenths) : pick.buyTenths;
}

/** L2 — enumerate every legal swap. THE property this build exists to guarantee:
 *  every returned move has already been run through `applyTransfer()` and
 *  survived. There is no separate "legality check" — the legality check IS the
 *  enumeration. `availability` is null in no-availability/degrade mode (season-
 *  epoch mismatch or an FPL fetch failure) — when non-null, any `in` whose
 *  status is i/s/u is excluded by a hard filter BEFORE `applyTransfer` is even
 *  attempted, never left to the prompt. */
export function buildCandidates(
  squad: Squad, pool: PoolPlayer[], scores: Map<number, number>,
  availability: Map<number, AvailabilityInfo> | null,
  creditsLeft: number, wildcardActive: boolean, maxMoves = 8,
  // 0, not 1: the baseline move everyone gets is granted as a credit by
  // `grantBaseline` at gameweek rollover, so it already sits in `creditsLeft`.
  // Defaulting this to 1 would hand out that same move twice and price the
  // first paid transfer as free when it is not.
  weeklyFreeLeft = 0,
): CandidateMove[] {
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const ownedIds = new Set(squad.picks.map((p) => p.id));
  const { paid } = transferCost(creditsLeft, wildcardActive, weeklyFreeLeft);

  const survivors: CandidateMove[] = [];
  for (const out of squad.picks) {
    const outScore = scores.get(out.id) ?? 0;
    for (const inn of pool) {
      if (inn.pos !== out.pos) continue;
      if (ownedIds.has(inn.id)) continue;
      const av = availability?.get(inn.id);
      if (av && (av.status === "i" || av.status === "s" || av.status === "u")) continue;

      let next: Squad;
      try {
        next = applyTransfer(squad, out.id, inn.id, pool);
      } catch (e) {
        if (e instanceof RuleError) continue; // illegal move — exactly the discard this build exists for
        throw e;
      }

      survivors.push({
        out: { id: out.id, sellTenths: sellTenthsFor(out, poolById.get(out.id)) },
        in: { id: inn.id, priceTenths: inn.priceTenths, moveScore: scores.get(inn.id) ?? 0 },
        scoreDelta: (scores.get(inn.id) ?? 0) - outScore,
        paid,
        bankAfterTenths: next.bankTenths,
      });
    }
  }
  return survivors.sort((a, b) => b.scoreDelta - a.scoreDelta).slice(0, maxMoves);
}

/** Pure interpretation of FPL availability rows into a lookup the filters use.
 *  Returns null (no-availability mode) when there are no rows at all, which is
 *  what makes "FPL told us nobody is injured" and "we could not read FPL"
 *  distinguishable — the caller degrades to no hard filter rather than to a
 *  clean bill of health.
 *
 *  EPOCH. This used to take a season string and drop any row whose `fpl_season`
 *  didn't match, because its source (`fantasy_player_status`) accumulated rows
 *  across seasons and FPL served last season's for weeks. That table is gone
 *  (migration 219 — it was a second source of truth for one fact). Availability
 *  now comes from `fantasy_fpl_snapshot`, which is immutable and keyed on
 *  `captured_at`, so the epoch guard moved to the READ: the caller selects the
 *  single newest `captured_at` for the right `is_rehearsal` and passes only
 *  those rows. There is no stale-season row to filter here because there is no
 *  mixed-epoch table to read from — which is why this no longer takes a season.
 *
 *  `status` is FPL's own letter, passed through rather than re-derived: 'a'
 *  available, 'd' doubtful, 'i' injured, 's' suspended, 'u' unavailable. A row
 *  with an unrecognised status is treated as unavailable-unknown ('u') rather
 *  than silently as available — the safe direction for a fact we cannot read. */
export function resolveAvailability(
  rows: { playerId: number; status: string | null; chance: number | null; news: string | null }[],
  ): Map<number, AvailabilityInfo> | null {
  if (!rows.length) return null;
  const known: FplStatus[] = ["a", "d", "i", "s", "u"];
  return new Map(rows.map((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    const status = (known as string[]).includes(s) ? (s as FplStatus) : "u";
    return [r.playerId, { status, chance: r.chance, news: r.news ?? "" }];
  }));
}

/** Doubts from FPL's own availability feed — the REAL source, replacing an
 *  inference that never fired.
 *
 *  `diffPredictedXI` above infers a doubt from a player vanishing between two
 *  predicted-XI snapshots. Measured 2026-07-22: that inference is dead and has
 *  probably always been. Our SportMonks plan 403s the `expectedLineups`
 *  include (still, even after the odds licence upgrade), and the `lineups`
 *  include only populates AFTER kickoff — eight genuinely upcoming fixtures
 *  returned zero lineup rows each. `fetchPredictedXI` swallows that into `[]`,
 *  `buildNewsDoc` skips a club whose XI is empty, and the section renders
 *  empty. No error anywhere: "no injuries this week" and "this feature does
 *  not work" look identical.
 *
 *  `fantasy_fpl_snapshot` (migration 210) already carries FPL's own per-player
 *  `status`, `chance_of_playing_next_round` and a human-readable `news` string
 *  ("Knee injury - Expected back 01 Apr"). It's free, it's keyed on our exact
 *  pool ids (FPL element id = YourScore pool id), and it's a stated fact rather
 *  than a guess — which also means the grounded tips layer can finally SAY
 *  "injury" honestly, because it can cite it.
 *
 *  This is the ONE owning source for the fact. An earlier build had a second
 *  table (`fantasy_player_status`) carrying the same three columns from the same
 *  upstream feed; migration 219 dropped it. Two sources for one fact is the
 *  exact shape of bug this codebase keeps shipping — do not add a third.
 *
 *  Only pool players are flagged (others are noise), and only a player FPL
 *  says isn't fully available. Pure. */
export function doubtsFromAvailability(
  rows: { playerId: number; status: string; chance: number | null; news: string }[],
  pool: { id: number; smId: number | null; name: string; club: string }[],
): NewsDoubt[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const out: NewsDoubt[] = [];
  for (const r of rows) {
    if (r.status === "a") continue; // available — nothing to say
    const p = byId.get(r.playerId);
    if (!p || p.smId === null) continue;
    // FPL's own words when it gives them; a plain status phrase when it
    // doesn't. Never invent a cause — an unexplained doubt still says only
    // what we can defend.
    const reason = r.news.trim()
      || (r.status === "s" ? "suspended"
        : r.status === "i" ? "injured"
        : r.status === "d" ? (r.chance !== null ? `${r.chance}% chance of playing` : "a doubt")
        : "unavailable");
    out.push({ smId: p.smId, name: p.name, club: p.club, reason });
  }
  return out;
}

// ── Flagging YOUR players ────────────────────────────────────────────────────
/**
 * Availability has only ever been a filter on who you may BUY. Nothing looked
 * at the fifteen you already own and said "he isn't playing Saturday, move him
 * on" — which is the single most useful thing a transfer tool can tell a
 * manager, and the thing they most often miss because it happens on a Thursday
 * when they aren't looking.
 *
 * TWO INDEPENDENT SIGNALS, deliberately kept apart rather than blended into a
 * score. A manager can act on "injured" and on "hasn't played in a fortnight";
 * they cannot act on 0.73.
 *
 *  1. FPL's own status feed — authoritative, and it knows BEFORE he misses a
 *     game ("Knee injury - Expected back 01 Apr"). It is live-only: there is no
 *     historical archive of it, so this signal cannot be backtested.
 *  2. No minutes in the recent past — weaker and slower, because it only knows
 *     once he has already sat out. But it is derivable from history, which
 *     makes it the one we CAN measure, and it catches a case the status feed
 *     never reports at all: the perfectly fit player who has simply lost his
 *     place.
 *
 * So what ships is a superset of what we can prove. Whatever the backtest says
 * signal 2 is worth is a FLOOR on the pair, which is the honest direction for
 * an unverifiable claim to err in.
 */
export type FlagKind = "out" | "doubt" | "benched";
export interface SquadFlag {
  playerId: number;
  kind: FlagKind;
  /** `high` — he is very unlikely to play. `medium` — worth a look, not a panic. */
  severity: "high" | "medium";
  /** FPL's own words where it has them, a plain phrase where it doesn't.
   *  Never a cause we inferred — an unexplained doubt says only what we can
   *  defend, same rule `doubtsFromAvailability` already follows. */
  reason: string;
}

/** Gameweeks of zero minutes before we call someone benched. Two, because one
 *  is a rest, a knock, or a rotation for a cup tie — normal football, and
 *  flagging it would make the tool cry wolf every single week. */
export const BENCH_WINDOW_GWS = 2;

export function flagSquad(args: {
  squad: Squad;
  /** null in no-availability/degrade mode — the minutes signal still works. */
  availability: Map<number, AvailabilityInfo> | null;
  /** playerId -> minutes per gameweek, MOST RECENT LAST. A player absent from
   *  this map has no history and is never flagged as benched: a new signing has
   *  not failed to play, he has not had the chance. */
  recentMinutes?: Map<number, number[]>;
}): SquadFlag[] {
  const { squad, availability, recentMinutes } = args;
  const flags: SquadFlag[] = [];

  for (const pick of squad.picks) {
    const av = availability?.get(pick.id);
    const news = av?.news?.trim() ?? "";

    if (av && (av.status === "i" || av.status === "s" || av.status === "u")) {
      flags.push({
        playerId: pick.id, kind: "out", severity: "high",
        reason: news || (av.status === "s" ? "suspended" : av.status === "i" ? "injured" : "unavailable"),
      });
      continue;
    }

    if (av && av.status === "d") {
      // FPL's chance is 0/25/50/75/100. At half or less he is more likely to
      // miss than play, which is a different message from "keep an eye on him".
      const bad = av.chance !== null && av.chance <= 50;
      flags.push({
        playerId: pick.id, kind: "doubt", severity: bad ? "high" : "medium",
        reason: news || (av.chance !== null ? `${av.chance}% chance of playing` : "a doubt"),
      });
      continue;
    }

    // No status concern — but has he actually been playing? Only ask when we
    // have a full window of history for him, so a mid-season arrival with one
    // recorded gameweek is never called benched on a sample of one.
    const mins = recentMinutes?.get(pick.id);
    if (mins && mins.length >= BENCH_WINDOW_GWS) {
      const window = mins.slice(-BENCH_WINDOW_GWS);
      if (window.every((m) => m === 0)) {
        flags.push({
          playerId: pick.id, kind: "benched", severity: "medium",
          reason: `hasn't played in ${BENCH_WINDOW_GWS} gameweeks`,
        });
      }
    }
  }

  // Worst first: a manager scanning this should hit the player who definitely
  // isn't playing before the one who might not.
  const rank = (f: SquadFlag) =>
    (f.severity === "high" ? 0 : 10) + (f.kind === "out" ? 0 : f.kind === "doubt" ? 1 : 2);
  return flags.sort((a, b) => rank(a) - rank(b) || a.playerId - b.playerId);
}

// ── L3 payload assembly (numbers only — L3 itself lives in tips.ts) ──────────
export interface AdvicePayloadSquadRow {
  name: string; club: string; pos: FantasyPos; sellTenths: number; moveScore: number;
  availability: AvailabilityInfo | null;
}
export interface AdvicePayloadCandidate {
  out: { id: number; name: string; sellTenths: number };
  in: {
    id: number; name: string; priceTenths: number; moveScore: number;
    fixtures: { opp: string; homeOrAway: "home" | "away"; difficulty: Difficulty }[];
    availability: AvailabilityInfo | null;
  };
  scoreDelta: number;
  paid: "credit" | "hit" | "free";
  bankAfterTenths: number;
}
/** The optimiser's own ordered plan (optimiser.ts's `optimiseTransfers`), reshaped
 *  into the same display-ready shape `candidates` already uses — names, prices,
 *  `sellTenths`, fixtures, availability — so the LLM (and the transfers page) can
 *  treat a recommended move exactly like a candidate. THE ONE THING candidates
 *  don't carry that this does: `position`. The optimiser's 2nd/3rd moves are only
 *  legal AFTER the earlier ones are applied (an "out" player two steps in may be
 *  someone THIS SAME sequence bought a step earlier) — `buildCandidates` only
 *  enumerates swaps from the ORIGINAL squad, so those later moves will not appear
 *  there at all. `position` is the sequence's dependency order, not a display rank:
 *  apply position 1 before position 2. */
export interface AdvicePayloadRecommendedMove {
  position: number;
  out: { id: number; name: string; sellTenths: number };
  in: {
    id: number; name: string; priceTenths: number; moveScore: number;
    fixtures: { opp: string; homeOrAway: "home" | "away"; difficulty: Difficulty }[];
    availability: AvailabilityInfo | null;
  };
  paid: "credit" | "hit" | "free";
  gain: number;
}
export interface AdvicePayloadRecommended {
  moves: AdvicePayloadRecommendedMove[];
  totalGain: number;
  hitsTaken: number;
  /** True when the optimiser found nothing worth doing (moves is then always
   *  empty) — a real, positive result, not a missing one. The transfers page and
   *  the LLM both need to render this as "no move beats holding", not as an
   *  absent/broken card. */
  hold: boolean;
  /** True when the optimiser did NOT actually run this pass at all — a
   *  projection or optimiseTransfers failure in the cron's degrade path (see
   *  route.ts's catch around optimiseTransfers). This field is what tells
   *  apart the two paths that otherwise produce the IDENTICAL hold-shaped
   *  value ({moves:[], totalGain:0, hitsTaken:0, hold:true}): a genuine
   *  optimiser conclusion that nothing beats holding (degraded: false, hold:
   *  true — a real, positive result) vs. the optimiser simply never having
   *  run (degraded: true). Before this field existed the transfers page could
   *  only see "hold: true" either way and told the user "we checked every
   *  combination and nothing pays for itself" even when nothing was checked
   *  at all. */
  degraded: boolean;
}

export interface AdvicePayload {
  gameweek: number;
  user: { bankTenths: number; credits: number; chipsHeld: number; wildcardHeld: number };
  squad: AdvicePayloadSquadRow[];
  candidates: AdvicePayloadCandidate[];
  /** Always present. When the optimiser didn't run this pass (a projection or
   *  optimiser failure — see the cron's degrade path) this is the same
   *  hold-shaped value as a genuine "nothing beats holding" result: empty moves,
   *  zero gain, hold true. `candidates` stays the fallback list for the LLM to
   *  reason about either way. */
  recommended: AdvicePayloadRecommended;
}

/** Assembles the exact L3 payload shape from the locked plan §1. Every number in
 *  here is already computed — the LLM layer (tips.ts's generateAdvice) never
 *  computes a number, a price, or a legality decision, it only reads this. */
export function buildAdvicePayload(args: {
  gw: number; bankTenths: number; credits: number; chipsHeld: number; wildcardHeld: number;
  squad: Squad; pool: PoolPlayer[]; scores: Map<number, number>;
  availability: Map<number, AvailabilityInfo> | null;
  runs: NewsClubRun[]; candidates: CandidateMove[];
  /** The optimiser's result for THIS user, or undefined when the cron's
   *  degrade path skipped/failed it — either way `recommended` below is always
   *  a well-formed, hold-shaped-by-default field (never absent, never throws). */
  optimised?: OptimiseResult;
}): AdvicePayload {
  const poolById = new Map(args.pool.map((p) => [p.id, p]));
  const runByClub = new Map(args.runs.map((r) => [r.clubId, r]));
  const nameOf = (id: number) => poolById.get(id)?.name ?? `#${id}`;

  const squad: AdvicePayloadSquadRow[] = args.squad.picks.map((p) => {
    const player = poolById.get(p.id);
    return {
      name: player?.name ?? `#${p.id}`,
      club: player?.club ?? "",
      pos: p.pos,
      sellTenths: sellTenthsFor(p, player),
      moveScore: args.scores.get(p.id) ?? 0,
      availability: args.availability?.get(p.id) ?? null,
    };
  });

  const fixturesFor = (clubId: number | undefined, lookahead = 3) =>
    (clubId !== undefined ? runByClub.get(clubId)?.cells.slice(0, lookahead) : undefined)?.map((c) => ({
      opp: c.oppShort, homeOrAway: c.home ? ("home" as const) : ("away" as const), difficulty: c.difficulty,
    })) ?? [];

  const candidates: AdvicePayloadCandidate[] = args.candidates.map((c) => ({
    out: { id: c.out.id, name: nameOf(c.out.id), sellTenths: c.out.sellTenths },
    in: {
      id: c.in.id, name: nameOf(c.in.id), priceTenths: c.in.priceTenths, moveScore: c.in.moveScore,
      fixtures: fixturesFor(poolById.get(c.in.id)?.clubId),
      availability: args.availability?.get(c.in.id) ?? null,
    },
    scoreDelta: c.scoreDelta, paid: c.paid, bankAfterTenths: c.bankAfterTenths,
  }));

  // ── recommended: the optimiser's ordered plan, reshaped to the candidates'
  //    display shape. Replayed sequentially through applyTransfer starting from
  //    the ACTUAL squad — not just to fetch each step's `sellTenths` correctly
  //    (a later move's "out" player may be someone THIS sequence bought a step
  //    earlier, so his buyTenths only exists after that earlier step is
  //    applied), but as a second, independent legality check on top of the
  //    optimiser's own `replayValidate`. Never trusted blindly: if a step
  //    somehow fails here, that step and everything after it is dropped rather
  //    than rendering a move that doesn't survive engine rules — the DEFENSIVE
  //    default (0 sellTenths / empty in-fixtures) never reaches the earlier,
  //    already-applied steps, only ones this replay itself couldn't verify. ────
  let replaySquad = args.squad;
  const recommendedMoves: AdvicePayloadRecommendedMove[] = [];
  for (const m of args.optimised?.moves ?? []) {
    const outPick = replaySquad.picks.find((p) => p.id === m.outId);
    if (!outPick) break; // defensive: should never happen, optimiser guarantees this via replayValidate

    // APPLY FIRST, then record. The reverse order — push, then try to apply —
    // meant a step that FAILED this replay was still emitted: the break landed
    // after the push, so exactly one unverified move survived into the payload,
    // and because groundAdvice builds its valid-pair set from recommended.moves
    // it then whitelisted the model to recommend that move too. The whole point
    // of this replay is that nothing unverified reaches a user, so verification
    // has to happen before the record exists, not after.
    let next: Squad;
    try { next = applyTransfer(replaySquad, m.outId, m.inId, args.pool); } catch { break; }

    recommendedMoves.push({
      position: recommendedMoves.length + 1,
      out: { id: m.outId, name: nameOf(m.outId), sellTenths: sellTenthsFor(outPick, poolById.get(m.outId)) },
      in: {
        id: m.inId, name: nameOf(m.inId), priceTenths: poolById.get(m.inId)?.priceTenths ?? 0,
        moveScore: args.scores.get(m.inId) ?? 0,
        fixtures: fixturesFor(poolById.get(m.inId)?.clubId),
        availability: args.availability?.get(m.inId) ?? null,
      },
      paid: m.paid,
      gain: m.gain,
    });
    replaySquad = next;
  }
  const recommended: AdvicePayloadRecommended = {
    moves: recommendedMoves,
    totalGain: args.optimised?.totalGain ?? 0,
    hitsTaken: args.optimised?.hitsTaken ?? 0,
    hold: args.optimised?.hold ?? true,
    degraded: args.optimised === undefined,
  };

  return {
    gameweek: args.gw,
    user: {
      bankTenths: args.bankTenths, credits: args.credits,
      chipsHeld: args.chipsHeld, wildcardHeld: args.wildcardHeld,
    },
    squad,
    candidates,
    recommended,
  };
}

// ── cost guard (criterion 9) ──────────────────────────────────────────────────
/** Pure so the cap logic is unit-testable without the DB-counting wiring the
 *  cron route does around it (that wiring is manual-verification, per the
 *  engineering plan — this is the one piece of it worth pulling out pure). */
export function capReached(countSoFar: number, cap: number): boolean {
  return countSoFar >= cap;
}

// ── pagination (scale defect S1) ─────────────────────────────────────────────
/** PostgREST silently caps an unpaginated `select()` at 1,000 rows — a known,
 *  documented gotcha in this repo. Past 1,000 `fantasy_squads` (or
 *  `fantasy_entries` for a busy gw), a plain read would silently cover only
 *  some users, with NO error and NO signal in the response — exactly the
 *  "invisible partial coverage" this exists to make impossible.
 *
 *  Loops on `.range(from, to)` until a page comes back short of `pageSize`,
 *  which is the only correct terminal condition for range-based pagination
 *  (a `count` alone can't tell you when to stop — rows can be added or removed
 *  between pages). `expectedCount`, when the caller supplies it on the first
 *  page, lets the caller cross-check `rows.length` against it afterwards and
 *  LOG a mismatch instead of silently trusting the loop — belt and suspenders
 *  against a table that's being written to mid-pagination.
 *
 *  Pure with respect to the actual transport: `fetchPage` is injected, so this
 *  is unit-testable with an in-memory fake and needs no live Supabase client.
 *  Callers MUST supply a stable `order()` on their query — range pagination
 *  over an unordered read can skip or repeat rows under concurrent writes;
 *  that ordering lives in the caller's query, not here. */
export interface PagedFetchResult<T> { rows: T[]; count: number | null }
export interface PagedResult<T> { rows: T[]; expectedCount: number | null }

export async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => Promise<PagedFetchResult<T>>,
  pageSize = 1000,
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  let expectedCount: number | null = null;
  let from = 0;
  for (;;) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (expectedCount === null && page.count !== null) expectedCount = page.count;
    rows.push(...page.rows);
    if (page.rows.length < pageSize) break;
    from += pageSize;
  }
  return { rows, expectedCount };
}

// ── resumability across runs (scale defect S2) ───────────────────────────────
/** The dedupe/settle rule the cron uses to decide whether a cached row already
 *  answers today's payload — pulled out pure (was inline in the route) so it's
 *  unit-testable and reusable by the ordering pass below. A row only counts as
 *  settled if its stored hash matches THIS run's payload hash — a stale row
 *  (squad or prices changed since) is never "settled", however final its old
 *  `issue`/`advice` looked. */
export interface CachedAdviceRow { payload_hash: string; advice: unknown; issue: string | null }
/** A row only counts as settled when its stored issue is a DETERMINISTIC
 *  conclusion — retrying it against the SAME payload can't produce a
 *  different answer, so there's no point ever spending another call on it:
 *  - "failed-grounding": the model's own output didn't survive the grounding
 *    check against this exact payload — the payload hasn't changed, so it
 *    would fail the same way again.
 *  - "no-candidates" (F9): buildCandidates found nothing legal to move on —
 *    a pure function of the payload, no model involved, so there is nothing
 *    a retry could discover that this run's candidates list doesn't already
 *    settle.
 *  "no-key" (F8) is deliberately EXCLUDED from this list — an absent
 *  ANTHROPIC_API_KEY is a transient OPS condition, not a property of the
 *  payload. Treating it as settled meant a row generated while the key was
 *  unset stayed null-advice FOREVER, even after the key came back: the hash
 *  matched (nothing about the squad had changed) so adviceSettled kept
 *  saying "done" for a user who was never actually served anything. */
export function adviceSettled(cached: CachedAdviceRow | null | undefined, hash: string): boolean {
  if (!cached || cached.payload_hash !== hash) return false;
  return cached.advice != null || cached.issue === "failed-grounding" || cached.issue === "no-candidates";
}

/** Cheap, PRE-optimiser proxy for "this user probably needs a fresh call this
 *  run" — orders Pass 1's expensive per-user work (buildCandidates +
 *  optimiseTransfers, ~950ms/user measured) by likely need BEFORE it runs,
 *  not after (F1). The old code built every eligible user's full payload
 *  (running the optimiser for each) in whatever order fantasy_squads happened
 *  to return them, and only THEN ordered by real need via orderByNeedsCall —
 *  by which point the expensive work was already done for everyone, so at
 *  real user counts the run died mid-Pass-1 with zero rows written, and the
 *  ordering never got a chance to matter.
 *
 *  The real, exact answer (adviceSettled) needs the full payload hash, which
 *  needs the optimiser to have already run for THIS user — a chicken-and-egg
 *  problem this sidesteps with cheap, DB-only signals: no cached row at all,
 *  the squad having changed since the cached row was generated (`updated_at`
 *  newer than the cached row's `generated_at`), or a cached "no-key" issue
 *  (F8: never permanently settled, must keep floating to the front). A wrong
 *  "probably needs a call" only costs queue position — adviceSettled still
 *  runs, exact and unconditional, on every user right before any DB write, so
 *  nothing this gets wrong ever reaches a user. Pure. */
export function likelyNeedsCall(
  squadUpdatedAt: string,
  cached: { generated_at: string; issue: string | null } | null | undefined,
): boolean {
  if (!cached) return true;
  if (cached.issue === "no-key") return true;
  return new Date(squadUpdatedAt).getTime() > new Date(cached.generated_at).getTime();
}

// ── DB-read honesty (defect F6) ──────────────────────────────────────────────
/** supabase-js RETURNS a read failure on `.error`, it does NOT throw — a
 *  transient failure silently produces `data: null` (or an empty array for a
 *  list query), which a caller that destructures only `.data` can mistake for
 *  "genuinely nothing there" and degrade into treating a bad read as a good,
 *  empty one. F6: exactly this, on `fantasy_player_scores`, turned a
 *  transient read failure into an all-zero history, which the projection
 *  layer then reported as a real, healthy projection (`projectionUsed:
 *  true`), silently replacing perfectly good `scorePool` numbers with
 *  near-zero ones.
 *
 *  Every DB read in the cron route should go through this instead of
 *  destructuring `.data` alone: an error always throws (into the caller's own
 *  try/catch degrade path — this function never decides what "degrade" means,
 *  only that a failure is never silently indistinguishable from an empty
 *  success). `data` is allowed to be null on SUCCESS too (`.maybeSingle()`
 *  with no matching row) — only `.error` being set throws. Pure, no DB —
 *  trivially unit-testable with a fake result object. */
export function unwrapRead<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): T | null {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

/** Stable partition: everyone who still needs a call, in their original order,
 *  ahead of everyone who's already settled. `maxDuration=60` means a run can
 *  die mid-loop — putting not-yet-generated users first means whatever the run
 *  DOES get through is net-new coverage, and the next hourly run picks up
 *  exactly where this one was cut off, instead of re-walking the same prefix
 *  and re-confirming the same already-settled users every hour. */
export function orderByNeedsCall<T>(items: T[], needsCall: (item: T) => boolean): T[] {
  const need: T[] = [];
  const done: T[] = [];
  for (const item of items) (needsCall(item) ? need : done).push(item);
  return [...need, ...done];
}

// ── Player profile — the six questions a manager actually asks ───────────────
/**
 * What to show someone deciding whether to keep or sell a player.
 *
 * THE PRODUCT TURN (founder, 24 Jul 2026): this tool does not tell you what to
 * do. It gives you the arguments and you decide. That is a weaker-sounding
 * claim and a much stronger one — we could never prove our picks beat a real
 * manager's, but every number here is checkable, and the ones a hidden ranking
 * couldn't use are exactly the ones that read well as a sentence. xG added
 * almost nothing as a silent input and is the single most useful line on this
 * screen.
 *
 * WHAT MATTERS DEPENDS ON POSITION, and we don't guess at that — we read it off
 * the scoring table. A clean sheet pays a defender 4 and a forward 0, so a
 * forward's profile never mentions one. Saves pay only a keeper. Defensive
 * contribution pays everyone but keepers, who aren't eligible. Ordering each
 * profile by what actually scores that position is the whole rule.
 */
export interface ProfileStat {
  /** Short label, e.g. "Clean sheets". */
  label: string;
  /** The number as a display string — the caller never formats. */
  value: string;
  /** One line of plain-English reading, or null to show the number bare.
   *  Mechanical, never a model: a clear margin either way gets a sentence, a
   *  close call gets silence. A user can redo the arithmetic themselves. */
  note: string | null;
}

export interface PlayerProfile {
  playerId: number;
  pos: FantasyPos;
  /** Minutes per gameweek, oldest first — the "is he playing" row. */
  minutes: number[];
  /** Points per gameweek, oldest first — the "is he delivering" row. */
  points: number[];
  seasonPoints: number;
  /** Points per gameweek he actually appeared in. Null if he never played:
   *  dividing by games-played is the whole reason the season-average ranking
   *  was wrong, so a player with no appearances gets no rate, not a zero. */
  perGame: number | null;
  flag: SquadFlag | null;
  /** Position-appropriate, most valuable first. */
  stats: ProfileStat[];
  fixtures: { gw: number; oppShort: string; home: boolean; difficulty: Difficulty }[];
}

/** Facts for one gameweek, as stored. */
export interface ProfileGw { gw: number; facts: MatchFactsLike; points: number }
/** Structurally what values.ts MatchFacts is; declared here so this module
 *  keeps taking plain data and never value-imports the scoring engine. */
export interface MatchFactsLike {
  minutes: number; goals: number; assists: number; cleanSheet: number;
  conceded: number; saves: number; pensSaved: number; pensMissed: number;
  yellows: number; reds: number; ownGoals: number; dc: number; dcRec: number;
}

const sum = (rows: ProfileGw[], pick: (f: MatchFactsLike) => number) =>
  rows.reduce((s, r) => s + pick(r.facts), 0);

/** Games he actually appeared in — the correct denominator for any rate. */
const appearances = (rows: ProfileGw[]) => rows.filter((r) => r.facts.minutes > 0).length;

export function buildPlayerProfile(args: {
  playerId: number;
  pos: FantasyPos;
  /** Recent gameweeks, OLDEST FIRST. */
  recent: ProfileGw[];
  /** Whole-season rows for rate stats; defaults to `recent`. */
  season?: ProfileGw[];
  /** Expected goals across `season`, when we have it. */
  xg?: number | null;
  flag?: SquadFlag | null;
  fixtures?: NewsTickerCell[];
}): PlayerProfile {
  const { playerId, pos, recent, flag = null, fixtures = [] } = args;
  const season = args.season ?? recent;
  const apps = appearances(season);
  const seasonPoints = season.reduce((s, r) => s + r.points, 0);

  const stats: ProfileStat[] = [];
  const goals = sum(season, (f) => f.goals);
  const assists = sum(season, (f) => f.assists);
  const xg = args.xg ?? null;

  // "Due, or finished" — goals against the chances he got. The most useful
  // line we have, and only meaningful for players who are supposed to score.
  const dueOrFinished = (): ProfileStat | null => {
    if (xg === null || apps === 0) return null;
    const diff = goals - xg;
    // A margin of one goal is the threshold: below that it is noise over a
    // handful of games, and saying something either way would be false
    // precision dressed up as insight.
    const note = diff <= -1 ? "getting chances, not taking them"
      : diff >= 1 ? "scoring more than his chances suggest"
      : null;
    return { label: "Goals vs expected", value: `${goals} from ${xg.toFixed(1)} expected`, note };
  };

  const cs = season.filter((r) => r.facts.minutes >= 60 && r.facts.cleanSheet > 0).length;
  const dcHits = season.filter((r) =>
    pos === "DEF" ? r.facts.dc >= 10 : pos !== "GK" && r.facts.dcRec >= 12).length;
  const conceded = sum(season, (f) => f.conceded);
  const saves = sum(season, (f) => f.saves);

  const csStat = (): ProfileStat => ({
    label: "Clean sheets",
    value: apps ? `${cs} in ${apps} games` : "no games yet",
    note: apps >= 3 && cs / apps >= 0.4 ? "keeps them out more often than not"
      : apps >= 3 && cs === 0 ? "none yet — his points have to come from elsewhere"
      : null,
  });
  const dcStat = (): ProfileStat => ({
    label: "Defensive returns",
    value: apps ? `${dcHits} in ${apps} games` : "no games yet",
    // NO POINTS FIGURE IN THIS STRING. It used to read "reliable 2 points",
    // which was FPL's award written into copy on a branch whose values.ts had
    // been moved onto FPL's scale. This repo's values.ts has not: a defensive
    // return pays 5 here, so that sentence shipped a number that was wrong by
    // more than double. Stating the fact without the figure is true on either
    // scale — and a scoring value quoted in prose is exactly how the
    // scale-mismatch bugs in this codebase keep happening. If a number is ever
    // wanted here it must be read from values.ts, never typed out.
    note: apps >= 3 && dcHits / apps >= 0.5 ? "reliable returns even without a clean sheet" : null,
  });
  const attackStat = (): ProfileStat => ({
    label: "Goals and assists", value: `${goals}G ${assists}A`, note: null,
  });

  if (pos === "GK") {
    // No xG line: keepers do not shoot, and a goal is not part of the case for
    // owning one. Saves are, because every third save pays out (see values.ts
    // for the amount — deliberately not repeated here, it is scale-dependent).
    stats.push(csStat());
    stats.push({
      label: "Saves", value: apps ? `${saves} (${(saves / apps).toFixed(1)} a game)` : "no games yet",
      note: apps >= 3 && saves / apps >= 3 ? "busy enough to score on saves alone" : null,
    });
    stats.push({ label: "Goals conceded", value: `${conceded}`, note: null });
  } else if (pos === "DEF") {
    stats.push(csStat());
    stats.push(dcStat());
    stats.push(attackStat());
    const d = dueOrFinished();
    if (d) stats.push(d);
  } else if (pos === "MID") {
    stats.push(attackStat());
    const d = dueOrFinished();
    if (d) stats.push(d);
    stats.push(dcStat());
    stats.push(csStat());
  } else {
    // Forward: a clean sheet pays him nothing, so it is never mentioned.
    stats.push(attackStat());
    const d = dueOrFinished();
    if (d) stats.push(d);
    stats.push(dcStat());
  }

  return {
    playerId, pos,
    minutes: recent.map((r) => r.facts.minutes),
    points: recent.map((r) => r.points),
    seasonPoints,
    perGame: apps ? Math.round((seasonPoints / apps) * 10) / 10 : null,
    flag,
    stats,
    fixtures: fixtures.map((c) => ({
      gw: c.gw, oppShort: c.oppShort, home: c.home, difficulty: c.difficulty,
    })),
  };
}
