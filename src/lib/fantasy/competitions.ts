import "server-only";
/**
 * League-wide competitions (Wave 1 foundation) — the game-agnostic wrapper
 * around a single shared window every league member can enter, as opposed to
 * member_challenges' two-player shape (challenges.ts). Two formats this wave
 * (competitionFormats.ts): league_quiz (highest score wins) and beat_target
 * (beat a target score, no cap on winners) — both read the SAME quiz_attempts
 * scorecard every other quiz surface writes; a competition never owns a
 * second copy of anyone's answers.
 *
 * Status machine (see migration 260's file doc for the full state list):
 * scheduled/open are lazy, time-driven transitions (deriveCompetitionStatus,
 * competitions-pure.ts); locked -> calculating -> completed/void is DB-driven,
 * settle-side, guarded by the exact same atomic
 * `update ... .eq("status", X) ... select().maybeSingle()` idempotency
 * pattern challenges.ts's reconcile() uses — the winner of that race does the
 * side effects (freeze standings, post the result card, notify), everyone
 * else gets null back and does nothing.
 *
 * Security posture matches migration 260: every write here runs with the
 * service-role client, and neither table carries a client write policy —
 * this file (and the /api/fantasy/leagues/[code]/competitions/* routes that
 * call it) IS the authority.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/fantasy/server";
import { syntheticActors } from "@/lib/fantasy/feed";
import { notifyFantasy } from "@/lib/fantasy/notify";
import { competitionFormat } from "@/lib/fantasy/competitionFormats";
import {
  deriveCompetitionStatus, isEligibleAttempt, viewerIneligibleReason, rankLeagueQuiz, resolveBeatTarget, competitionResultLine,
  type CompetitionFormatId, type QuizAttemptForRanking,
} from "@/lib/fantasy/competitions-pure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** The official Gameday competition's window — a single named constant
 *  rather than a magic "+24h" scattered through ensureOfficialGamedayCompetitions. */
export const OFFICIAL_WINDOW_HOURS = 24;

/** scoring_version stamped at creation, per format — mirrors challengeGames.ts's
 *  own per-game scoring_version convention (quiz_battle_v1 etc.), a version to
 *  bump if either format's math ever changes rather than a silent behaviour
 *  change on old, already-settled rows. */
const SCORING_VERSION: Record<CompetitionFormatId, string> = {
  league_quiz: "league_quiz_v1",
  beat_target: "beat_target_v1",
};

const ACTIVE_STATUSES = ["scheduled", "open", "live", "locked", "calculating"];
const FROZEN_STATUSES = ["completed", "void"];
const RECENT_COMPLETED_CAP = 10;

export interface LeagueCompetitionRow {
  id: string;
  league_id: string;
  format: string;
  status: string;
  source: string;
  created_by: string | null;
  pack_id: string | null;
  target_score: number | null;
  title: string;
  opens_at: string;
  closes_at: string;
  settled_at: string | null;
  recurrence_key: string | null;
  series_key: string | null;
  scoring_version: string;
  winner_user_id: string | null;
  entrant_count: number | null;
  created_at: string;
}

interface StandingRow { userId: string; score: number; completedAt: string; rank: number | null; result: string }

/** Same membership check chat.ts's/challenges.ts's own requireMemberLeague
 *  performs, duplicated rather than imported — each of those is a private,
 *  unexported helper in its own file, and this file already sits downstream
 *  of neither (same reasoning as games.ts's own copy). Exported here (unlike
 *  the others) because the admin-create route needs a resolved league_id
 *  before it can call createCompetition, and there's nowhere closer to put it. */
export async function resolveLeagueByCode(
  db: Db, code: string, userId: string,
): Promise<{ id: string; name: string; owner_id: string }> {
  const { data: league } = await db.from("fantasy_leagues")
    .select("id, name, owner_id").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!league) throw new HttpError(404, "league not found");
  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!member) throw new HttpError(403, "not in this league");
  return league as { id: string; name: string; owner_id: string };
}

async function leagueOwnerId(db: Db, leagueId: string): Promise<string | null> {
  const { data } = await db.from("fantasy_leagues").select("owner_id").eq("id", leagueId).maybeSingle();
  return (data?.owner_id as string | undefined) ?? null;
}

async function profilesById(db: Db, ids: string[]): Promise<Map<string, { display_name: string | null; username: string | null; avatar_url: string | null }>> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (!unique.length) return new Map();
  const { data } = await db.from("profiles").select("id, display_name, username, avatar_url").in("id", unique);
  return new Map(((data ?? []) as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[])
    .map((p) => [p.id, p]));
}

function nameFromProfile(p: { display_name: string | null; username: string | null } | undefined): string {
  return p?.display_name ?? (p?.username ? `@${p.username}` : "Player");
}

// ── Standings (shared by settle and every live-preview read) ─────────────

/** The ranked/resolved standings for a competition's window, off the raw
 *  quiz_attempts scorecards — the SAME computation whether it's a live,
 *  provisional preview (competitionsForLeague/competitionDetail, pre-lock) or
 *  the authoritative freeze at settlement (settleCompetition). One function,
 *  not two copies drifting apart (games.ts's own file doc states the same
 *  rule for its leaderboard).
 *
 *  League members only, minus synthetic actors (syntheticActors() — the same
 *  belt feed.ts/games.ts apply, never weakened here) — a bot drill account
 *  must never appear in a real league's standings. */
async function computeStandings(db: Db, comp: LeagueCompetitionRow): Promise<StandingRow[]> {
  if (!comp.pack_id) return [];

  const { data: memberRows } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", comp.league_id).range(0, 9999);
  const bots = syntheticActors();
  const memberIds = ((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => !bots.has(id));
  if (!memberIds.length) return [];

  const { data: attemptRows } = await db.from("quiz_attempts")
    .select("user_id, score, completed_at").eq("pack_id", comp.pack_id).in("user_id", memberIds);
  const eligible = ((attemptRows ?? []) as { user_id: string; score: number; completed_at: string }[])
    .filter((a) => isEligibleAttempt({ completedAt: a.completed_at }, comp.opens_at, comp.closes_at))
    .map((a): QuizAttemptForRanking => ({ userId: a.user_id, score: a.score, completedAt: a.completed_at }));

  if (comp.format === "league_quiz") {
    return rankLeagueQuiz(eligible).map((r) => ({
      userId: r.userId, score: r.score, completedAt: r.completedAt, rank: r.rank,
      result: r.rank === 1 ? "winner" : "placed",
    }));
  }
  if (comp.format === "beat_target") {
    return resolveBeatTarget(eligible, comp.target_score ?? 0).map((r, i) => ({
      userId: r.userId, score: r.score, completedAt: r.completedAt, rank: i + 1, result: r.result,
    }));
  }
  return [];
}

// ── Chat card ──────────────────────────────────────────────────────────────

/** One league chat comment per competition, carrying only its id — the card
 *  is re-derived live from the row on every read (same "never trust the
 *  payload beyond an id" idiom challenge cards use), never edited in place.
 *
 *  Called from two race-prone spots (the insert that just created the row,
 *  and the reconcile transition into 'open') — guarded here, not there, by
 *  checking for an existing competition_card comment for this competition_id
 *  first. The schema (migration 260) carries no card_comment_id column to
 *  guard on instead — this existence check IS the guard. */
export async function postCompetitionCard(db: Db, comp: LeagueCompetitionRow): Promise<void> {
  const { data: existing } = await db.from("comments").select("id")
    .eq("subject_type", "fantasy_league").eq("subject_id", comp.league_id)
    .eq("kind", "competition_card").eq("payload->>competitionId", comp.id)
    .is("deleted_at", null).limit(1);
  if (existing && existing.length) return; // already posted — never a duplicate

  const actorId = comp.created_by ?? (await leagueOwnerId(db, comp.league_id));
  if (!actorId) return; // defensive — a league always has an owner; nothing to post as otherwise

  await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: comp.league_id, user_id: actorId,
    body: comp.title, kind: "competition_card", payload: { competitionId: comp.id },
  });
}

/** Posted exactly once — only from the calculating -> completed transition
 *  that actually won the race (settleCompetition's own guard is the whole
 *  idempotency mechanism, same as challenges.ts's postCompletedResult). Never
 *  called for a 'void' settlement (zero entrants is a quiet card state, not a
 *  result worth a chat post — see settleCompetition). */
async function postSettleResult(db: Db, comp: LeagueCompetitionRow, entries: StandingRow[]): Promise<void> {
  const winnerName = comp.winner_user_id
    ? nameFromProfile((await profilesById(db, [comp.winner_user_id])).get(comp.winner_user_id))
    : null;
  const placedCount = comp.format === "beat_target" ? entries.filter((e) => e.result === "placed").length : 0;
  const line = competitionResultLine({
    format: comp.format as CompetitionFormatId, entrantCount: entries.length, winnerName, placedCount,
  });

  const actorId = comp.created_by ?? (await leagueOwnerId(db, comp.league_id));
  if (actorId) {
    await db.from("comments").insert({
      subject_type: "fantasy_league", subject_id: comp.league_id, user_id: actorId,
      body: line, kind: "competition_result", payload: { competitionId: comp.id },
    });
  }

  const entrantIds = entries.map((e) => e.userId);
  if (entrantIds.length) {
    void notifyFantasy({
      userIds: entrantIds,
      title: comp.title,
      body: line,
      dedupeKey: `competition_result:${comp.id}`,
      type: "competition_result",
      subjectType: "league_competition",
      subjectId: comp.id,
    });
  }
}

// ── Create ──────────────────────────────────────────────────────────────

export interface CreateCompetitionInput {
  leagueId: string;
  source: "official" | "admin";
  createdBy: string | null;
  format: string;
  packId?: string | null;
  targetScore?: number | null;
  title: string;
  opensAt: string;
  closesAt: string;
  recurrenceKey?: string | null;
}

/** Create a league competition — validates, inserts (status 'scheduled' or
 *  'open' if the window already started), posts the chat card, returns the
 *  row. Idempotent on recurrence_key (migration 260's partial unique index):
 *  a 23505 on that constraint returns the ALREADY-existing row rather than
 *  erroring the caller — this is what makes
 *  ensureOfficialGamedayCompetitions safe to call more than once for the
 *  same pack. */
export async function createCompetition(db: Db, input: CreateCompetitionInput): Promise<LeagueCompetitionRow> {
  const fmt = competitionFormat(input.format);
  if (!fmt || !fmt.supported) throw new HttpError(400, "That competition format isn't available yet");

  const packId = typeof input.packId === "string" ? input.packId : null;
  if (!packId) throw new HttpError(400, "Pick a quiz first");
  const { data: pack } = await db.from("quiz_packs").select("id").eq("id", packId).maybeSingle();
  if (!pack) throw new HttpError(404, "Quiz not found");

  let targetScore: number | null = null;
  if (fmt.id === "beat_target") {
    targetScore = typeof input.targetScore === "number" ? input.targetScore : null;
    if (!targetScore || targetScore <= 0) throw new HttpError(400, "Set a target score above zero");
  }

  const opensAt = new Date(input.opensAt);
  const closesAt = new Date(input.closesAt);
  if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) throw new HttpError(400, "bad window");
  if (!(closesAt.getTime() > opensAt.getTime())) throw new HttpError(400, "The window must close after it opens");

  if (input.source === "admin") {
    if (!input.createdBy) throw new HttpError(400, "missing creator");
    const ownerId = await leagueOwnerId(db, input.leagueId);
    if (!ownerId) throw new HttpError(404, "league not found");
    if (ownerId !== input.createdBy) throw new HttpError(403, "only the league owner can create a competition");
  }

  const now = new Date();
  const status = opensAt.getTime() <= now.getTime() ? "open" : "scheduled";
  const recurrenceKey = input.recurrenceKey ?? null;

  const { data: inserted, error } = await db.from("league_competitions").insert({
    league_id: input.leagueId, format: fmt.id, status, source: input.source,
    created_by: input.createdBy, pack_id: packId, target_score: targetScore, title: input.title,
    opens_at: opensAt.toISOString(), closes_at: closesAt.toISOString(),
    recurrence_key: recurrenceKey, scoring_version: SCORING_VERSION[fmt.id as CompetitionFormatId],
  }).select("*").maybeSingle();

  if (error || !inserted) {
    // 23505 = unique_violation on (league_id, recurrence_key) — the exact
    // race ensureOfficialGamedayCompetitions must survive on a re-run.
    if (error?.code === "23505" && recurrenceKey) {
      const { data: existing } = await db.from("league_competitions")
        .select("*").eq("league_id", input.leagueId).eq("recurrence_key", recurrenceKey).maybeSingle();
      if (existing) return existing as LeagueCompetitionRow;
    }
    throw new HttpError(500, error?.message ?? "Could not create the competition");
  }

  const comp = inserted as LeagueCompetitionRow;
  await postCompetitionCard(db, comp);
  return comp;
}

/** Official Gameday competitions (called from the gameday-publish cron once a
 *  fixture's pack is live) — one league_quiz competition per fantasy league
 *  with at least 2 members, opening now and closing OFFICIAL_WINDOW_HOURS
 *  later. Idempotent via recurrence_key `gameday:<packId>` (createCompetition's
 *  own 23505 handling), so a re-run for the same pack (a retried cron tick, a
 *  publish repair) never creates a second competition per league.
 *
 *  Per-league failures are isolated (try/catch inside the loop) — one
 *  league's bad state must never stop every OTHER league's competition from
 *  being created, and the caller (the cron route) wraps this whole call in
 *  its own try/catch on top so a total failure here never breaks pack
 *  publishing itself. */
export async function ensureOfficialGamedayCompetitions(db: Db, packId: string): Promise<void> {
  // A single-column select, grouped client-side — Supabase-js has no groupBy,
  // and this runs once per gameday pack publish, not per-request. Paged in
  // 1000-row steps because PostgREST's max-rows setting caps ANY read at 1000
  // regardless of the .range() asked for — a single big range would silently
  // truncate and quietly skip every league past the cutoff.
  const counts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data: memberRows } = await db.from("fantasy_league_members")
      .select("league_id").order("league_id").range(from, from + 999);
    const page = (memberRows ?? []) as { league_id: string }[];
    for (const r of page) counts.set(r.league_id, (counts.get(r.league_id) ?? 0) + 1);
    if (page.length < 1000) break;
  }
  const eligibleLeagueIds = Array.from(counts.entries()).filter(([, c]) => c >= 2).map(([id]) => id);
  if (!eligibleLeagueIds.length) return;

  const now = new Date();
  const closesAt = new Date(now.getTime() + OFFICIAL_WINDOW_HOURS * 60 * 60 * 1000);
  const recurrenceKey = `gameday:${packId}`;

  for (const leagueId of eligibleLeagueIds) {
    try {
      await createCompetition(db, {
        leagueId, source: "official", createdBy: null, format: "league_quiz", packId,
        title: "Gameday League Quiz", opensAt: now.toISOString(), closesAt: closesAt.toISOString(),
        recurrenceKey,
      });
    } catch (e) {
      console.error("[fantasy:competitions] ensureOfficialGamedayCompetitions failed for league", leagueId, e);
    }
  }
}

// ── Reconcile / settle ────────────────────────────────────────────────────

/** Lazy status transitions on read, same shape as challenges.ts's reconcile():
 *  scheduled/open recomputed via deriveCompetitionStatus (pure), the
 *  transition itself landed with an atomic `.eq("status", row.status)` CAS so
 *  only one caller's update ever wins it; a winning transition INTO 'open'
 *  posts the chat card (guarded against the creation-time post above already
 *  having landed it). A row that reads (or lands) as 'locked' is handed
 *  straight to settleCompetition — which has its own separate CAS into
 *  'calculating', so reconcile racing itself (two concurrent reads) never
 *  double-settles. */
export async function reconcileCompetition(db: Db, row: LeagueCompetitionRow): Promise<LeagueCompetitionRow> {
  let current = row;
  const now = new Date();

  if (current.status === "scheduled" || current.status === "open") {
    const derived = deriveCompetitionStatus(
      { status: current.status, opensAt: current.opens_at, closesAt: current.closes_at }, now,
    );
    if (derived !== current.status) {
      const { data: updated } = await db.from("league_competitions")
        .update({ status: derived }).eq("id", current.id).eq("status", current.status).select("*").maybeSingle();
      if (updated) {
        current = updated as LeagueCompetitionRow;
        if (derived === "open") await postCompetitionCard(db, current);
      } else {
        // Lost the race — someone else's reconcile call already moved it.
        // Re-read rather than trust our stale copy.
        const { data: fresh } = await db.from("league_competitions").select("*").eq("id", current.id).maybeSingle();
        if (fresh) current = fresh as LeagueCompetitionRow;
      }
    }
  }

  if (current.status === "locked") return settleCompetition(db, current.id);
  return current;
}

/** Atomic guard: locked -> calculating claims the settle, only the caller
 *  that wins it computes/writes standings. Zero eligible entrants settles
 *  straight to 'void' (no comment spam — one quiet card state, per the
 *  brief); otherwise standings freeze into league_competition_entries, the
 *  row flips to 'completed', and the result posts exactly once. */
export async function settleCompetition(db: Db, id: string): Promise<LeagueCompetitionRow> {
  const { data: row } = await db.from("league_competitions").select("*").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "competition not found");
  const comp = row as LeagueCompetitionRow;
  if (comp.status !== "locked") return comp; // nothing to settle — already settling/settled, or not there yet

  const { data: claimed } = await db.from("league_competitions")
    .update({ status: "calculating" }).eq("id", id).eq("status", "locked").select("*").maybeSingle();
  if (!claimed) {
    // Lost the race — another caller is settling (or already has).
    const { data: fresh } = await db.from("league_competitions").select("*").eq("id", id).maybeSingle();
    return (fresh as LeagueCompetitionRow) ?? comp;
  }
  const won = claimed as LeagueCompetitionRow;

  const standings = await computeStandings(db, won);

  if (!standings.length) {
    const { data: voided } = await db.from("league_competitions")
      .update({ status: "void", settled_at: new Date().toISOString(), entrant_count: 0 })
      .eq("id", id).eq("status", "calculating").select("*").maybeSingle();
    return (voided as LeagueCompetitionRow) ?? { ...won, status: "void" };
  }

  const settledAt = new Date().toISOString();
  await db.from("league_competition_entries").upsert(
    standings.map((s) => ({
      competition_id: id, user_id: s.userId, score: s.score, rank: s.rank, result: s.result,
      entered_at: s.completedAt, settled_at: settledAt,
    })),
    { onConflict: "competition_id,user_id" },
  );

  const winnerUserId = won.format === "league_quiz" ? (standings.find((s) => s.rank === 1)?.userId ?? null) : null;

  const { data: completed } = await db.from("league_competitions")
    .update({ status: "completed", settled_at: settledAt, winner_user_id: winnerUserId, entrant_count: standings.length })
    .eq("id", id).eq("status", "calculating").select("*").maybeSingle();
  const final = (completed as LeagueCompetitionRow) ?? { ...won, status: "completed" };

  // Side effects ONCE — only the update that actually won the calculating ->
  // completed transition fires these (same idempotency guard as everywhere
  // else in this file — a losing racer here would have gotten null above and
  // returned already via the fallback branches, so `completed` truthy IS the
  // "I won" signal).
  if (completed) await postSettleResult(db, final, standings);
  return final;
}

// ── Read (list / detail) ──────────────────────────────────────────────────

export interface CompetitionEntryDTO { userId: string; name: string; avatarUrl: string | null; score: number; rank: number | null; result: string }
export interface CompetitionCardDTO {
  id: string; format: string; title: string; status: string; source: string;
  opensAt: string; closesAt: string; packId: string | null; targetScore: number | null;
  myEntry: { score: number; rank: number | null; result: string } | null;
  entrantCount: number;
  /** Live standings preview while open/locked/calculating (provisional:
   *  true), the frozen top 3 once completed/void (provisional: false) — a
   *  card must never label a live preview as final. */
  topThree: CompetitionEntryDTO[];
  /** Only ever set once status is 'completed' — a beat_target competition
   *  (no single winner) and an in-progress one both read null here, same
   *  "never leak a result ahead of the real thing" rule ChallengeCardData's
   *  challengerScore/opponentScore follow. */
  winner: { userId: string; name: string } | null;
  provisional: boolean;
  /** beat_target only — how many of the FULL standings (not just topThree)
   *  scored >= target, i.e. how many actually placed. Always 0 for
   *  league_quiz (the format has no "placed" concept beyond its single
   *  winner) — a card needs this alongside topThree because topThree is
   *  capped at 3 and can't answer "how many total" on its own. */
  placedCount: number;
}

async function toCardDTO(db: Db, comp: LeagueCompetitionRow, viewerId: string): Promise<CompetitionCardDTO> {
  const isFrozen = FROZEN_STATUSES.includes(comp.status);
  const standings: StandingRow[] = isFrozen ? await frozenStandings(db, comp.id) : await computeStandings(db, comp);

  const top = standings.slice(0, 3);
  const placedCount = comp.format === "beat_target" ? standings.filter((s) => s.result === "placed").length : 0;
  const profileIds = [...top.map((s) => s.userId), ...(comp.winner_user_id ? [comp.winner_user_id] : [])];
  const profOf = await profilesById(db, profileIds);
  const mine = standings.find((s) => s.userId === viewerId) ?? null;

  return {
    id: comp.id, format: comp.format, title: comp.title, status: comp.status, source: comp.source,
    opensAt: comp.opens_at, closesAt: comp.closes_at, packId: comp.pack_id, targetScore: comp.target_score,
    myEntry: mine ? { score: mine.score, rank: mine.rank, result: mine.result } : null,
    entrantCount: isFrozen ? (comp.entrant_count ?? standings.length) : standings.length,
    topThree: top.map((s) => ({
      userId: s.userId, name: nameFromProfile(profOf.get(s.userId)), avatarUrl: profOf.get(s.userId)?.avatar_url ?? null,
      score: s.score, rank: s.rank, result: s.result,
    })),
    winner: comp.status === "completed" && comp.winner_user_id
      ? { userId: comp.winner_user_id, name: nameFromProfile(profOf.get(comp.winner_user_id)) }
      : null,
    provisional: !isFrozen,
    placedCount,
  };
}

/** The frozen standings off league_competition_entries — sorted rank asc
 *  (nulls, i.e. every beat_target row, last) then score desc, entirely in JS
 *  rather than relying on a Postgrest nullsFirst option this codebase has no
 *  other precedent for. */
async function frozenStandings(db: Db, competitionId: string): Promise<StandingRow[]> {
  const { data } = await db.from("league_competition_entries")
    .select("user_id, score, rank, result, entered_at").eq("competition_id", competitionId);
  const rows = ((data ?? []) as { user_id: string; score: number; rank: number | null; result: string; entered_at: string }[])
    .map((r) => ({ userId: r.user_id, score: r.score, completedAt: r.entered_at, rank: r.rank, result: r.result }));
  return rows.sort((a, b) => {
    if (a.rank !== b.rank) {
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    }
    return b.score - a.score;
  });
}

/** Active (scheduled/open/live/locked/calculating) + recent completed/void
 *  (capped at 10) competitions for a league, card-ready. Reconciles each row
 *  lazily on read (same as challenges.ts's challengeCardsFor) so a card never
 *  shows a stale status. Resolves membership itself off the league CODE
 *  (mirrors leagueGamesOverview/leagueChat's own convention — the caller only
 *  ever has the code from the URL, not a pre-resolved id). */
export async function competitionsForLeague(db: Db, userId: string, code: string): Promise<CompetitionCardDTO[]> {
  const league = await resolveLeagueByCode(db, code, userId);

  const [{ data: activeRows }, { data: recentRows }] = await Promise.all([
    db.from("league_competitions").select("*").eq("league_id", league.id).in("status", ACTIVE_STATUSES).order("opens_at", { ascending: true }),
    db.from("league_competitions").select("*").eq("league_id", league.id).in("status", FROZEN_STATUSES).order("settled_at", { ascending: false }).limit(RECENT_COMPLETED_CAP),
  ]);
  const rows = [...((activeRows ?? []) as LeagueCompetitionRow[]), ...((recentRows ?? []) as LeagueCompetitionRow[])];
  const reconciled = await Promise.all(rows.map((r) => reconcileCompetition(db, r)));
  return Promise.all(reconciled.map((r) => toCardDTO(db, r, userId)));
}

/** Hydrated chat-card data for one or more competitions — batched (one query
 *  set per id list) rather than N+1, mirroring challenges.ts's
 *  challengeCardsFor for the exact same reason (a chat window can reference
 *  several competitions across its message window). Reconciles each row
 *  first (a chat card must never show a stale status), then reuses the SAME
 *  toCardDTO every other card-shaped read in this file goes through — one
 *  card shape, not a second one drifting apart for chat specifically. */
export async function competitionCardsByIds(db: Db, ids: string[], viewerId: string): Promise<Map<string, CompetitionCardDTO>> {
  const out = new Map<string, CompetitionCardDTO>();
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (!uniqueIds.length) return out;

  const { data: rows } = await db.from("league_competitions").select("*").in("id", uniqueIds);
  const compRows = (rows ?? []) as LeagueCompetitionRow[];
  if (!compRows.length) return out;

  const reconciled = await Promise.all(compRows.map((r) => reconcileCompetition(db, r)));
  const cards = await Promise.all(reconciled.map((r) => toCardDTO(db, r, viewerId)));
  for (const c of cards) out.set(c.id, c);
  return out;
}

export interface CompetitionDetailDTO {
  id: string; format: string; title: string; status: string; source: string;
  opensAt: string; closesAt: string; packId: string | null; targetScore: number | null;
  standings: CompetitionEntryDTO[];
  winner: { userId: string; name: string } | null;
  provisional: boolean;
  /** True when THIS viewer played the competition's pack, but outside the
   *  window (almost always: before it opened) — quiz_attempts is unique per
   *  (user, pack), so they can never earn a fresh, eligible attempt. Always
   *  false once they have a standings entry, and always false for a guest.
   *  Computed here, not inferred client-side, because only the server can
   *  see the viewer's own (possibly excluded) attempt row. */
  viewerIneligible: boolean;
}

/** One competition's full standings — live/provisional pre-lock, frozen once
 *  completed/void. Viewer must belong to the competition's OWN league (read
 *  off the row itself, not any URL segment) — null both when the id doesn't
 *  exist and when the viewer isn't a member, same "doesn't exist vs. not
 *  yours" collapse challengeByH2h uses, so a stranger probing an id learns
 *  nothing either way. */
export async function competitionDetail(db: Db, competitionId: string, viewerId: string): Promise<CompetitionDetailDTO | null> {
  const { data: row } = await db.from("league_competitions").select("*").eq("id", competitionId).maybeSingle();
  if (!row) return null;
  const comp = row as LeagueCompetitionRow;

  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", comp.league_id).eq("user_id", viewerId).maybeSingle();
  if (!member) return null;

  const reconciled = await reconcileCompetition(db, comp);
  const isFrozen = FROZEN_STATUSES.includes(reconciled.status);
  const standings = isFrozen ? await frozenStandings(db, reconciled.id) : await computeStandings(db, reconciled);

  const profOf = await profilesById(db, [...standings.map((s) => s.userId), ...(reconciled.winner_user_id ? [reconciled.winner_user_id] : [])]);

  // Eligibility (P2, 6 Aug) — a viewer who played this pack before the window
  // opened never appears in `standings` above (isEligibleAttempt already
  // excluded their row) and quiz_attempts' unique (user, pack) index means
  // they can never earn a fresh one. Only worth the extra read when they're
  // actually missing AND there's a real pack to have played.
  let viewerIneligible = false;
  if (reconciled.pack_id && !standings.some((s) => s.userId === viewerId)) {
    const { data: attemptRow } = await db.from("quiz_attempts")
      .select("completed_at").eq("pack_id", reconciled.pack_id).eq("user_id", viewerId).maybeSingle();
    const attempt = attemptRow ? { completedAt: (attemptRow as { completed_at: string }).completed_at } : null;
    viewerIneligible = viewerIneligibleReason(attempt, reconciled.opens_at, reconciled.closes_at) === true;
  }

  return {
    id: reconciled.id, format: reconciled.format, title: reconciled.title, status: reconciled.status, source: reconciled.source,
    opensAt: reconciled.opens_at, closesAt: reconciled.closes_at, packId: reconciled.pack_id, targetScore: reconciled.target_score,
    standings: standings.map((s) => ({
      userId: s.userId, name: nameFromProfile(profOf.get(s.userId)), avatarUrl: profOf.get(s.userId)?.avatar_url ?? null,
      score: s.score, rank: s.rank, result: s.result,
    })),
    viewerIneligible,
    winner: reconciled.status === "completed" && reconciled.winner_user_id
      ? { userId: reconciled.winner_user_id, name: nameFromProfile(profOf.get(reconciled.winner_user_id)) }
      : null,
    provisional: !isFrozen,
  };
}

// ── Cancel ──────────────────────────────────────────────────────────────

/** Only the league owner, only an 'admin'-sourced competition (an official
 *  one can't be cancelled via the API this wave — founder's call, matches how
 *  challenges.ts scopes cancelChallenge to the challenger only), only while
 *  scheduled/open (the same CAS-guarded update pattern as
 *  cancelChallenge/declineChallenge — the `.in("status", [...])` clause on
 *  the update IS the atomicity, not the earlier read). */
export async function cancelCompetition(db: Db, userId: string, competitionId: string): Promise<{ ok: true }> {
  const { data: row } = await db.from("league_competitions").select("*").eq("id", competitionId).maybeSingle();
  if (!row) throw new HttpError(404, "competition not found");
  const comp = row as LeagueCompetitionRow;

  if (comp.source !== "admin") throw new HttpError(400, "Official competitions can't be cancelled");

  const ownerId = await leagueOwnerId(db, comp.league_id);
  if (!ownerId || ownerId !== userId) throw new HttpError(403, "only the league owner can cancel a competition");
  if (comp.status !== "scheduled" && comp.status !== "open") throw new HttpError(409, "This competition can't be cancelled anymore");

  const { data: updated, error } = await db.from("league_competitions")
    .update({ status: "cancelled" }).eq("id", competitionId).in("status", ["scheduled", "open"]).select("id").maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!updated) throw new HttpError(409, "This competition can't be cancelled anymore");
  return { ok: true };
}

// ── Sweep (fantasy-tick cron) ──────────────────────────────────────────────

/** Every competition due a status check right now: scheduled ones whose
 *  opens_at has passed (so a quiet, never-visited league still opens on
 *  time), open ones whose closes_at has passed, and anything stuck mid-settle
 *  (locked/calculating) that a prior tick may have left claimed but
 *  unfinished — reconcileCompetition itself decides what, if anything,
 *  changes; this query is just "who's worth checking". Capped so one tick
 *  can't run away on a bad backlog. */
export async function sweepDueCompetitions(db: Db, cap = 50): Promise<{ checked: number; acted: number }> {
  const nowIso = new Date().toISOString();
  const { data } = await db.from("league_competitions").select("*")
    .in("status", ["scheduled", "open", "locked", "calculating"])
    .or(`opens_at.lte.${nowIso},closes_at.lte.${nowIso}`)
    .limit(cap);
  const rows = (data ?? []) as LeagueCompetitionRow[];
  let acted = 0;
  for (const row of rows) {
    try {
      let current = row;
      // Crash recovery: a row stuck in 'calculating' means a prior settle
      // claimed it and died before finishing (reconcile/settle both no-op on
      // 'calculating' by design — the claim IS the lock). A healthy settle
      // finishes in seconds, so anything still claimed 30+ minutes after its
      // window closed is abandoned, not in flight: CAS it back to 'locked' so
      // this same pass can re-settle it (entry upserts are idempotent).
      if (current.status === "calculating"
        && Date.now() - new Date(current.closes_at).getTime() > 30 * 60 * 1000) {
        const { data: released } = await db.from("league_competitions")
          .update({ status: "locked" }).eq("id", current.id).eq("status", "calculating")
          .is("settled_at", null).select("*").maybeSingle();
        if (released) current = released as LeagueCompetitionRow;
      }
      const before = row.status;
      const after = await reconcileCompetition(db, current);
      if (after.status !== before) acted++;
    } catch (e) {
      console.error("[fantasy:competitions] sweep failed for", row.id, e);
    }
  }
  return { checked: rows.length, acted };
}
