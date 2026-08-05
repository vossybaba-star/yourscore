import "server-only";
/**
 * League-mate challenges (Phase 1C) — the game-agnostic wrapper around
 * challengeGames.ts's registry. member_challenges tracks WHO challenged WHOM,
 * over WHICH game, and its lifecycle; the game itself (today only
 * quiz_battle) does its own scoring elsewhere and is pointed at via
 * result_id. See challengeGames.ts's file doc for the winner/tie/expiry
 * rules this reads off Quiz Battle's h2h_challenges row.
 *
 * Security posture matches migration 61 / 255: every write here runs with
 * the service-role client, and member_challenges carries no client write
 * policy — this file (and the /api/fantasy/challenges/* routes that call it)
 * IS the authority.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/fantasy/server";
import { challengeGame } from "@/lib/fantasy/challengeGames";
import { blockedActorIds } from "@/lib/social/safety";
import { notifyFantasy } from "@/lib/fantasy/notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const H2H_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // matches /api/h2h/from-attempt's own 3-day expiry

const OPEN_STATUSES = new Set(["pending", "accepted", "active"]);

// Same shape as safety.ts's UUID_RE — validated before any id is interpolated
// into a raw PostgREST .or() filter string (pairStatus), never passed through unchecked.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MemberChallengeRow {
  id: string;
  challenger_id: string;
  opponent_id: string;
  league_id: string;
  game_type: string;
  status: string;
  result_id: string | null;
  winner_id: string | null;
  created_at: string;
  accepted_at: string | null;
  expires_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Same membership check chat.ts's requireMemberLeague performs, duplicated
 *  here rather than imported — chat.ts's version is a private, unexported
 *  helper, and importing chat.ts here (to post the chat card, below) would
 *  make chat.ts and challenges.ts import each other. */
async function requireMemberLeagueByCode(db: Db, code: string, userId: string) {
  const { data: league } = await db.from("fantasy_leagues")
    .select("id, name, owner_id").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!league) throw new HttpError(404, "league not found");
  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!member) throw new HttpError(403, "not in this league");
  return league as { id: string; name: string; owner_id: string };
}

async function isLeagueMember(db: Db, leagueId: string, userId: string): Promise<boolean> {
  const { data } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
  return !!data;
}

/** Status derived at read time from the linked game session, persisted when it
 *  changes so lists stay cheap (no join-and-recompute on every subsequent
 *  read). Only ever moves a row OUT of pending/accepted/active — a terminal
 *  status (declined/expired/completed/cancelled) is never revisited. */
export async function reconcile(db: Db, row: MemberChallengeRow): Promise<MemberChallengeRow> {
  if (!OPEN_STATUSES.has(row.status)) return row;

  if (row.game_type === "quiz_battle" && row.result_id) {
    const { data: h2h } = await db.from("h2h_challenges")
      .select("challenger_id, challenger_score, opponent_score, expires_at")
      .eq("id", row.result_id).maybeSingle();
    if (h2h && h2h.opponent_score !== null) {
      const winnerId = h2h.opponent_score > h2h.challenger_score
        ? row.opponent_id
        : h2h.opponent_score < h2h.challenger_score
          ? row.challenger_id
          : null; // a tie completes with no winner
      const patch = { status: "completed", winner_id: winnerId, completed_at: new Date().toISOString() };
      const { data: updated } = await db.from("member_challenges")
        .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
      return (updated as MemberChallengeRow) ?? { ...row, ...patch };
    }
    // Not played — expiry rides the h2h row's OWN expires_at (challengeGames.ts's
    // doc comment), not member_challenges.expires_at, which is only a copy taken
    // at creation for cheap listing.
    if (h2h && new Date(h2h.expires_at) < new Date()) {
      const patch = { status: "expired" };
      const { data: updated } = await db.from("member_challenges")
        .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
      return (updated as MemberChallengeRow) ?? { ...row, ...patch };
    }
  }

  // Fallback: no linked session found, or a future game_type with no adapter
  // wired in here yet — fall back to member_challenges' own expiry.
  if (new Date(row.expires_at) < new Date()) {
    const patch = { status: "expired" };
    const { data: updated } = await db.from("member_challenges")
      .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
    return (updated as MemberChallengeRow) ?? { ...row, ...patch };
  }
  return row;
}

/** The open (or most recent) challenge between two members, either direction
 *  — the chip in MemberActionSheet reads this once on open. leagueId scopes
 *  it to one league when given; omitted, it's the most recent between the
 *  pair anywhere. Null when there's never been one. */
export async function pairStatus(
  db: Db, userId: string, opponentId: string, leagueId?: string,
): Promise<MemberChallengeRow | null> {
  if (!UUID_RE.test(userId) || !UUID_RE.test(opponentId)) throw new HttpError(400, "bad user id");
  let q = db.from("member_challenges").select("*")
    .or(`and(challenger_id.eq.${userId},opponent_id.eq.${opponentId}),and(challenger_id.eq.${opponentId},opponent_id.eq.${userId})`)
    .order("created_at", { ascending: false }).limit(5);
  if (leagueId) q = q.eq("league_id", leagueId);
  const { data } = await q;
  const rows = (data ?? []) as MemberChallengeRow[];
  if (!rows.length) return null;

  // Reconcile each candidate (newest first) and surface the first still-open
  // one; if none are open, surface the newest as-is (so a just-completed/
  // declined challenge still explains the chip rather than silently vanishing).
  for (const row of rows) {
    const reconciled = await reconcile(db, row);
    if (OPEN_STATUSES.has(reconciled.status)) return reconciled;
  }
  return reconcile(db, rows[0]);
}

export interface CreateChallengeInput {
  opponentId: unknown;
  leagueCode: unknown;
  gameType: unknown;
  packId: unknown;
}

/** Create a league-mate challenge. Today only quiz_battle is supported (the
 *  registry backstops that — an unsupported/unknown gameType 400s). */
export async function createChallenge(db: Db, userId: string, input: CreateChallengeInput) {
  const opponentId = typeof input.opponentId === "string" ? input.opponentId : "";
  const leagueCode = typeof input.leagueCode === "string" ? input.leagueCode : "";
  const gameType = typeof input.gameType === "string" ? input.gameType : "";
  const packId = typeof input.packId === "string" ? input.packId : "";
  if (!opponentId || !leagueCode || !gameType) throw new HttpError(400, "missing fields");
  if (opponentId === userId) throw new HttpError(400, "You can't challenge yourself");

  const game = challengeGame(gameType);
  if (!game || !game.supported) throw new HttpError(400, "That game isn't available for a challenge yet");

  const league = await requireMemberLeagueByCode(db, leagueCode, userId);
  if (!(await isLeagueMember(db, league.id, opponentId)))
    throw new HttpError(403, "They're not in this league");

  const blocked = await blockedActorIds(db, userId);
  if (blocked.has(opponentId)) throw new HttpError(403, "You can't challenge them");

  // Friendly pre-check — the partial unique index (migration 255) is the real
  // backstop against a race, this just avoids a raw constraint-violation 500
  // for the common case of tapping Challenge twice.
  const existing = await pairStatus(db, userId, opponentId, league.id);
  if (existing && existing.status === "pending" && existing.challenger_id === userId && existing.game_type === gameType) {
    throw new HttpError(409, "You already have an open challenge with them");
  }

  if (gameType !== "quiz_battle") throw new HttpError(400, "That game isn't available for a challenge yet");
  if (!packId) throw new HttpError(400, "Pick a quiz first");

  // Same authoritative-attempt read as /api/h2h/from-attempt: your own stored
  // scorecard for this pack, never a client-trusted score.
  const { data: attempt } = await db.from("quiz_attempts")
    .select("score, max_score, correct_count, answers")
    .eq("user_id", userId).eq("pack_id", packId).maybeSingle();
  if (!attempt) throw new HttpError(400, "Play that quiz first, then send the challenge");

  const { data: pack } = await db.from("quiz_packs").select("name, questions").eq("id", packId).maybeSingle();
  if (!pack) throw new HttpError(404, "Quiz not found");
  const totalQuestions = Array.isArray(pack.questions) ? pack.questions.length : 0;

  const { data: profile } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const challengerName = profile?.display_name ?? "Someone";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAns = Array.isArray((attempt as any).answers) ? (attempt as any).answers : null;
  const challengerAnswers = rawAns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? rawAns.map((a: any) => ({ letter: a.selected ?? a.letter ?? null, correct: !!a.correct }))
    : null;

  const h2hExpiresAt = new Date(Date.now() + H2H_EXPIRY_MS).toISOString();

  // Insert the h2h row exactly as from-attempt does — same shape, same mode.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: h2h, error: h2hError } = await (db as any)
    .from("h2h_challenges")
    .insert({
      quiz_pack_id: packId,
      quiz_pack_name: pack.name,
      challenger_id: userId,
      challenger_name: challengerName,
      challenger_score: attempt.score ?? 0,
      challenger_correct: attempt.correct_count ?? 0,
      total_questions: totalQuestions,
      max_score: attempt.max_score ?? 0,
      challenger_answers: challengerAnswers,
      invited_user_id: opponentId,
      status: "awaiting_opponent",
      expires_at: h2hExpiresAt,
    })
    .select("id")
    .single();
  if (h2hError || !h2h) throw new HttpError(500, "Could not create the challenge");

  const { data: mc, error: mcError } = await db.from("member_challenges")
    .insert({
      challenger_id: userId,
      opponent_id: opponentId,
      league_id: league.id,
      game_type: gameType,
      status: "pending",
      result_id: h2h.id,
      expires_at: h2hExpiresAt,
    })
    .select("id")
    .single();
  if (mcError || !mc) {
    // 23505 = unique_violation — the partial unique index caught a race the
    // pre-check above missed.
    if (mcError?.code === "23505") throw new HttpError(409, "You already have an open challenge with them");
    throw new HttpError(500, "Could not create the challenge");
  }

  // Chat card — a raw insert rather than chat.ts's insertChatMessage (kept
  // private to that file; importing it here would make chat.ts and
  // challenges.ts import each other). Same base shape that helper writes.
  await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: "Challenge", kind: "challenge", payload: { challengeId: mc.id },
  });

  void notifyFantasy({
    userIds: [opponentId],
    title: `${challengerName} challenged you`,
    body: `${game.name} · ${pack.name}`,
    url: `/h2h/${h2h.id}`,
    dedupeKey: `challenge:${mc.id}`,
    type: "challenge_invite",
    actorId: userId,
    subjectType: "member_challenge",
    subjectId: mc.id,
  });

  return { id: mc.id, h2hId: h2h.id as string };
}

export async function declineChallenge(db: Db, userId: string, challengeId: unknown) {
  const id = typeof challengeId === "string" ? challengeId : "";
  if (!id) throw new HttpError(400, "bad challenge id");
  const { data: row } = await db.from("member_challenges").select("*").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "challenge not found");
  const mc = row as MemberChallengeRow;
  if (mc.opponent_id !== userId) throw new HttpError(403, "only the challenged player can decline");
  if (mc.status !== "pending") throw new HttpError(409, "This challenge can't be declined anymore");

  const { data: updated, error } = await db.from("member_challenges")
    .update({ status: "declined" }).eq("id", id).eq("status", "pending").select("id").maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!updated) throw new HttpError(409, "This challenge can't be declined anymore");
  return { ok: true };
}

export interface ChallengeCardData {
  challengeId: string;
  status: string;
  gameName: string;
  quizName: string;
  challengerId: string; challengerName: string; challengerAvatarUrl: string | null;
  opponentId: string; opponentName: string; opponentAvatarUrl: string | null;
  expiresAt: string;
  h2hId: string | null;
  winnerId: string | null;
}

/** Hydrated chat-card data for one or more challenges — batched (one query
 *  set) rather than N+1, mirroring how leagueChat's feedCardById resolves
 *  every shared-post card in the window with a single Promise.all. Reconciles
 *  each row first (a chat card must never show a stale "pending" once the
 *  opponent has actually played). */
export async function challengeCardsFor(db: Db, ids: string[]): Promise<Map<string, ChallengeCardData>> {
  const out = new Map<string, ChallengeCardData>();
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (!uniqueIds.length) return out;

  const { data: rows } = await db.from("member_challenges").select("*").in("id", uniqueIds);
  const mcRows = (rows ?? []) as MemberChallengeRow[];
  if (!mcRows.length) return out;

  const reconciled = await Promise.all(mcRows.map((r) => reconcile(db, r)));

  const h2hIds = Array.from(new Set(reconciled.filter((r) => r.game_type === "quiz_battle" && r.result_id).map((r) => r.result_id as string)));
  const { data: h2hRows } = h2hIds.length
    ? await db.from("h2h_challenges").select("id, quiz_pack_name").in("id", h2hIds)
    : { data: [] as { id: string; quiz_pack_name: string }[] };
  const quizNameByH2h = new Map(((h2hRows ?? []) as { id: string; quiz_pack_name: string }[]).map((r) => [r.id, r.quiz_pack_name]));

  const userIds = Array.from(new Set(reconciled.flatMap((r) => [r.challenger_id, r.opponent_id])));
  const { data: profs } = userIds.length
    ? await db.from("profiles").select("id, display_name, username, avatar_url").in("id", userIds)
    : { data: [] as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[] };
  const profOf = new Map(((profs ?? []) as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
  const nameOf = (id: string) => {
    const p = profOf.get(id);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "Player");
  };

  for (const r of reconciled) {
    const game = challengeGame(r.game_type);
    out.set(r.id, {
      challengeId: r.id,
      status: r.status,
      gameName: game?.name ?? r.game_type,
      quizName: r.result_id ? (quizNameByH2h.get(r.result_id) ?? "a quiz") : "a quiz",
      challengerId: r.challenger_id, challengerName: nameOf(r.challenger_id), challengerAvatarUrl: profOf.get(r.challenger_id)?.avatar_url ?? null,
      opponentId: r.opponent_id, opponentName: nameOf(r.opponent_id), opponentAvatarUrl: profOf.get(r.opponent_id)?.avatar_url ?? null,
      expiresAt: r.expires_at,
      h2hId: r.result_id,
      winnerId: r.winner_id,
    });
  }
  return out;
}

/** One challenge's hydrated card — same shape a chat card gets, for a caller
 *  that only needs the single row (e.g. a future direct challenge-detail
 *  view). Null if it doesn't exist. */
export async function challengeCard(db: Db, _viewerId: string, challengeId: string): Promise<ChallengeCardData | null> {
  const map = await challengeCardsFor(db, [challengeId]);
  return map.get(challengeId) ?? null;
}
