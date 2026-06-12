import "server-only";

/**
 * Server side of the solo interactive shootout (ranked async + challenge links).
 *
 * A drawn 90' inserts the draft_matches row as `detail.outcome = "pens_pending"`
 * with NOTHING credited — points, streaks and lifecycle emails all wait for the
 * shootout. The user plays it kick-by-kick via /api/draft/match/pens; every
 * outcome is resolved here with the peppered seed (the client only ever sends a
 * zone choice). Abandonment is settled by `settleStalePens` before the user can
 * start anything new: submitted inputs are honored, the rest auto-fill seeded —
 * quitting is never better than playing, and never locks in a draw.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pensSeed } from "./pens-server";
import {
  resolveRound, shootoutStatus, resolveInteractiveShootout,
  type PenKick, type PenZone, type PenColumn, type ShootoutInputs,
} from "./pens";
import { creditResult, applyTeamStreak } from "./live-server";
import { GLOBAL_LEAGUE, type TeamSnapshot } from "./server";
import { asLeague } from "./types";
import type { DraftDatabase } from "@/types/draft-db";
import { createServiceClient } from "@/lib/supabase/service";
import { sendFirst38GameEmail, sendH2HResultEmail } from "@/lib/email/senders";

type Db = SupabaseClient<DraftDatabase>;

export type PensState = {
  /** The interactive player (quick match: challenger; challenge link: accepter). */
  userId: string;
  /** Which stored side they are (a = challenger orientation, like resolveMatch). */
  userSide: "a" | "b";
  /** quick → first-match email + user-only streak; challenge → H2H email + both streaks. */
  flow: "quick" | "challenge";
  shots: PenZone[];
  dives: PenColumn[];
  startedAt: string;
};

export type PendingRow = {
  id: string;
  challenger_id: string | null;
  opponent_id: string | null;
  challenger_team: TeamSnapshot;
  opponent_team: TeamSnapshot;
  league_id: string | null;
  competition: string | null;
  detail: {
    outcome: string;
    single?: boolean;
    pens: { a: number; b: number } | null;
    report: unknown;
    pensState?: PensState;
    pensKicks?: { a: PenKick[]; b: PenKick[] };
  };
};

const PENDING_COLS =
  "id, challenger_id, opponent_id, challenger_team, opponent_team, league_id, competition, detail";

export function isPending(row: PendingRow): boolean {
  return row.detail?.outcome === "pens_pending" && !!row.detail.pensState;
}

export const inputsFor = (s: PensState): ShootoutInputs =>
  s.userSide === "a" ? { aShots: s.shots, aDives: s.dives } : { bShots: s.shots, bDives: s.dives };

/** Replay the kicks taken so far — the server-side mirror of the client view.
 *  Side a always kicks first; the user shoots on their side's kicks and dives on
 *  the opponent's, stopping where the next input hasn't been submitted yet. */
export function replayPending(matchId: string, s: PensState): { a: PenKick[]; b: PenKick[] } {
  const seed = pensSeed(`${matchId}:pens`);
  const a: PenKick[] = [];
  const b: PenKick[] = [];
  for (;;) {
    const st = shootoutStatus(a, b, "alternating");
    if (st.decided || !st.next) break;
    const side = st.next;
    const arr = side === "a" ? a : b;
    if (side === s.userSide) {
      const shot = s.shots[arr.length];
      if (shot === undefined) break;
      arr.push(resolveRound(seed, side, arr.length + 1, { shot }));
    } else {
      const dive = s.dives[arr.length];
      if (dive === undefined) break;
      arr.push(resolveRound(seed, side, arr.length + 1, { dive }));
    }
  }
  return { a, b };
}

/** What the client renders: kicks + role from the user's POV. */
export function pendingView(row: PendingRow) {
  const s = row.detail.pensState!;
  const settledKicks = row.detail.pensKicks;
  const kicks = settledKicks ?? replayPending(row.id, s);
  const st = shootoutStatus(kicks.a, kicks.b, "alternating");
  const decided = !!settledKicks || st.decided;
  const winnerSide = settledKicks ? (row.detail.outcome === "A" ? "a" : "b") : st.winner;
  const score = settledKicks && row.detail.pens ? row.detail.pens : { a: st.aGoals, b: st.bGoals };
  return {
    myKicks: s.userSide === "a" ? kicks.a : kicks.b,
    oppKicks: s.userSide === "a" ? kicks.b : kicks.a,
    suddenDeath: st.suddenDeath,
    role: decided ? ("done" as const) : st.next === s.userSide ? ("shoot" as const) : ("dive" as const),
    final: decided
      ? {
          outcome: winnerSide === s.userSide ? ("you" as const) : ("opp" as const),
          pens: s.userSide === "a" ? { you: score.a, opp: score.b } : { you: score.b, opp: score.a },
        }
      : null,
  };
}

/**
 * Finalize a pens_pending row: full deterministic resolution (honoring submitted
 * inputs verbatim — identical to the per-kick replay), then the deferred work:
 * winner_id, detail, standings credit for both sides, streaks, lifecycle emails.
 */
export async function completePendingPens(db: Db, row: PendingRow): Promise<PendingRow> {
  const s = row.detail.pensState!;
  const full = resolveInteractiveShootout(pensSeed(`${row.id}:pens`), inputsFor(s), "alternating");
  const outcome: "A" | "B" = full.winner === "a" ? "A" : "B";
  const winnerId = outcome === "A" ? row.challenger_id ?? GLOBAL_LEAGUE : row.opponent_id ?? GLOBAL_LEAGUE;
  const detail = {
    ...row.detail,
    outcome,
    pens: full.score,
    pensKicks: { a: full.a, b: full.b },
  };

  // Conditional on still-pending so a racing duplicate can't credit twice.
  const { data: updated } = await db
    .from("draft_matches")
    .update({ winner_id: winnerId, detail: detail as unknown as never })
    .eq("id", row.id)
    .filter("detail->>outcome", "eq", "pens_pending")
    .select(PENDING_COLS)
    .maybeSingle();
  if (!updated) return row; // lost the race — the other writer credited

  const competition = asLeague(row.competition);
  const chName = row.challenger_team?.name ?? "Player";
  const oppName = row.opponent_team?.name ?? "Player";
  const chRes = outcome === "A" ? ("win" as const) : ("loss" as const);
  const oppRes = outcome === "A" ? ("loss" as const) : ("win" as const);

  if (row.challenger_id) {
    await creditResult(db, row.challenger_id, chName, chRes, GLOBAL_LEAGUE, competition);
    if (row.league_id) await creditResult(db, row.challenger_id, chName, chRes, row.league_id, competition);
  }
  if (row.opponent_id) {
    await creditResult(db, row.opponent_id, oppName, oppRes, GLOBAL_LEAGUE, competition);
    if (row.league_id) await creditResult(db, row.opponent_id, oppName, oppRes, row.league_id, competition);
  }
  // Quick match only streaks the player who was actually here (matches the live
  // resolve path); a challenge streaks both managers (matches the challenge path).
  if (s.flow === "challenge") {
    if (row.challenger_id) await applyTeamStreak(db, row.challenger_id, chRes, competition);
    if (row.opponent_id) await applyTeamStreak(db, row.opponent_id, oppRes, competition);
  } else {
    const userRes = s.userSide === "a" ? chRes : oppRes;
    await applyTeamStreak(db, s.userId, userRes, competition);
  }

  // Deferred lifecycle emails (fire-and-forget, mirroring the non-pens paths).
  void sendDeferredEmails(db, updated as unknown as PendingRow, s).catch(() => {});
  return updated as unknown as PendingRow;
}

async function sendDeferredEmails(db: Db, row: PendingRow, s: PensState): Promise<void> {
  const goalsA = (row.detail as { report?: { a?: { goals?: number } } }).report?.a?.goals ?? 0;
  const goalsB = (row.detail as { report?: { b?: { goals?: number } } }).report?.b?.goals ?? 0;
  if (s.flow === "challenge" && row.challenger_id) {
    const svc = createServiceClient();
    const { data: u } = await svc.auth.admin.getUserById(row.challenger_id).catch(() => ({ data: null }));
    const email = u?.user?.email;
    if (!email) return;
    await sendH2HResultEmail({
      challengerUserId: row.challenger_id,
      challengerEmail: email,
      opponentName: row.opponent_team?.name ?? "Player",
      teamName: row.challenger_team?.name ?? "Your team",
      myScore: goalsA,
      oppScore: goalsB,
      matchId: row.id,
    });
    return;
  }
  if (s.flow === "quick" && row.challenger_id) {
    const { count } = await db
      .from("draft_matches")
      .select("id", { count: "exact", head: true })
      .or(`challenger_id.eq.${row.challenger_id},opponent_id.eq.${row.challenger_id}`);
    if ((count ?? 0) !== 1) return;
    const svc = createServiceClient();
    const { data: u } = await svc.auth.admin.getUserById(row.challenger_id).catch(() => ({ data: null }));
    const email = u?.user?.email;
    if (!email) return;
    const won = row.detail.outcome === "A";
    await sendFirst38GameEmail({
      userId: row.challenger_id,
      email,
      teamName: row.challenger_team?.name ?? "Your team",
      opponent: row.opponent_team?.name ?? "Opponent",
      myScore: goalsA,
      oppScore: goalsB,
      strength: Math.round(row.challenger_team?.strength ?? 0),
      w: won ? 1 : 0,
      d: 0,
      l: won ? 0 : 1,
    });
  }
}

/**
 * Settle any shootouts this user walked away from — called before they can find,
 * resolve or accept anything new. Submitted kicks are honored; the rest auto-fill.
 */
export async function settleStalePens(db: Db, userId: string): Promise<void> {
  const { data: rows } = await db
    .from("draft_matches")
    .select(PENDING_COLS)
    .filter("detail->>outcome", "eq", "pens_pending")
    .filter("detail->pensState->>userId", "eq", userId)
    .limit(3);
  for (const row of (rows ?? []) as unknown as PendingRow[]) {
    if (isPending(row)) await completePendingPens(db, row);
  }
}

/** Settle pendings older than `hours` regardless of user — cron belt-and-braces. */
export async function settleExpiredPens(db: Db, hours = 1, cap = 20): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data: rows } = await db
    .from("draft_matches")
    .select(PENDING_COLS)
    .filter("detail->>outcome", "eq", "pens_pending")
    .lt("played_at", cutoff)
    .limit(cap);
  let n = 0;
  for (const row of (rows ?? []) as unknown as PendingRow[]) {
    if (isPending(row)) { await completePendingPens(db, row); n++; }
  }
  return n;
}

export { PENDING_COLS };
