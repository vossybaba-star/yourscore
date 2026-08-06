import "server-only";
/**
 * League-mate challenges (Phase 1C, adapters expanded Phase 3B) — the
 * game-agnostic wrapper around challengeGames.ts's registry. member_challenges
 * tracks WHO challenged WHOM, over WHICH game, and its lifecycle; the game
 * itself does its own scoring elsewhere and is pointed at via result_id. See
 * challengeGames.ts's file doc for each game's winner/tie/expiry rules.
 *
 * Three adapters today, two shapes:
 *   - quiz_battle / gameday_quiz ("scorecard" mode) — an EXISTING quiz_attempts
 *     scorecard published as an h2h_challenges row at creation; only the
 *     opponent has anything left to play. gameday_quiz is the identical path
 *     plus a pack-metadata gate (isGamedayPack).
 *   - quiz_duel ("duel" mode) — the h2h row is created before EITHER side has
 *     played; both grade through h2h_duel_attempts (kept off the public,
 *     RLS-open h2h_challenges row until both exist — see migration 259).
 * reconcile() and challengeCardsFor() branch on game_type/mode to stay
 * correct for both shapes without duplicating the shared bookkeeping
 * (idempotent completion, chat ping, notifications).
 *
 * Security posture matches migration 61 / 255: every write here runs with
 * the service-role client, and member_challenges carries no client write
 * policy — this file (and the /api/fantasy/challenges/* routes that call it)
 * IS the authority.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/fantasy/server";
import { challengeGame, type ChallengeGame } from "@/lib/fantasy/challengeGames";
import { blockedActorIds } from "@/lib/social/safety";
import { notifyFantasy } from "@/lib/fantasy/notify";
import { maxPointsForDifficulty } from "@/lib/scoring";
import {
  normalizeChallengeMessage, normalizeCreatedFrom, deriveDuelOutcome, isGamedayPack,
} from "@/lib/fantasy/challenges-pure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const H2H_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // matches /api/h2h/from-attempt's own 3-day expiry

// awaiting_opponent is OPEN, not terminal — a duel sits here between "one side
// has played" and "both have" (see reconcileDuel), and must stay reconcilable
// forward to completed rather than being treated as a dead end.
const OPEN_STATUSES = new Set(["pending", "accepted", "active", "awaiting_opponent"]);

/** quiz_battle and gameday_quiz ride the exact same h2h_challenges "scorecard"
 *  shape (mode 'scorecard', challenger already played) — one reconcile path
 *  for both, differing only in the scoring_version stamped on completion. */
const SCORECARD_GAME_TYPES = new Set(["quiz_battle", "gameday_quiz"]);

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
  // Phase 3A (migration 258)
  message: string | null;
  created_from: string | null;
  created_from_entity_id: string | null;
  rematch_of_challenge_id: string | null;
  series_id: string | null;
  sent_at: string;
  declined_at: string | null;
  cancelled_at: string | null;
  scoring_version: string | null;
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

/** Fetch the human-readable name of the quiz a challenge rides, best-effort
 *  ("a quiz" if the linked h2h row or its name is missing — notifications
 *  must never throw over a cosmetic lookup). Every adapter today (quiz_battle,
 *  gameday_quiz, quiz_duel) points result_id at an h2h_challenges row, so this
 *  isn't game-type-gated — only "is there a result_id to look up". */
async function quizNameFor(db: Db, row: MemberChallengeRow): Promise<string> {
  if (!row.result_id) return "a quiz";
  const { data: h2h } = await db.from("h2h_challenges").select("quiz_pack_name").eq("id", row.result_id).maybeSingle();
  return (h2h?.quiz_pack_name as string | undefined) ?? "a quiz";
}

/** Phase 3A result publication (product decision, locked): a completed
 *  challenge gets ONE new compact chat message on top of the original card
 *  updating in place — the card itself is re-derived live from the row
 *  (challengeCardsFor), this is the separate "ping" everyone in chat sees.
 *  Only ever called from the update that WON the completed transition —
 *  reconcile's guard above is the entire idempotency mechanism here. */
async function postCompletedResult(db: Db, won: MemberChallengeRow) {
  await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: won.league_id, user_id: won.challenger_id,
    body: "Challenge result", kind: "challenge_result", payload: { challengeId: won.id },
  });

  const { data: profs } = await db.from("profiles").select("id, display_name")
    .in("id", [won.challenger_id, won.opponent_id]);
  const nameOf = (id: string) => ((profs ?? []) as { id: string; display_name: string | null }[])
    .find((p) => p.id === id)?.display_name ?? "Someone";
  const winnerName = won.winner_id ? nameOf(won.winner_id) : null;
  const game = challengeGame(won.game_type);
  const quizName = await quizNameFor(db, won);

  void notifyFantasy({
    userIds: [won.challenger_id, won.opponent_id],
    title: winnerName ? `${winnerName} won the challenge` : "The challenge finished level",
    body: `${game?.name ?? won.game_type} · ${quizName}`,
    url: `/h2h/${won.result_id}`,
    dedupeKey: `challenge_result:${won.id}`,
    type: "challenge_result",
    subjectType: "member_challenge",
    subjectId: won.id,
  });
}

/** Discreet expiry notice (product decision, locked): no chat post — an
 *  expired, never-played challenge isn't a result worth a card — just a
 *  quiet nudge to the challenger. Same win-guard idempotency as
 *  postCompletedResult: only the update that actually flipped the row calls
 *  this. */
async function notifyExpired(db: Db, won: MemberChallengeRow) {
  const { data: profile } = await db.from("profiles").select("display_name").eq("id", won.opponent_id).maybeSingle();
  const opponentName = profile?.display_name ?? "Someone";
  const quizName = await quizNameFor(db, won);
  void notifyFantasy({
    userIds: [won.challenger_id],
    title: `Your challenge to ${opponentName} expired`,
    body: quizName,
    dedupeKey: `challenge_expire:${won.id}`,
    type: "challenge_expired",
    subjectType: "member_challenge",
    subjectId: won.id,
  });
}

/** Quiz Duel's "your turn" nudge (Phase 3B, product decision, locked): fired
 *  only on the transition INTO awaiting_opponent (reconcileDuel's own
 *  win-guard), to whichever side hasn't played yet. No chat post — that's
 *  reserved for the challenge card's own pending/active copy and the eventual
 *  completed ping, not a second event mid-flight. */
async function notifyDuelTurn(db: Db, won: MemberChallengeRow, doneUserId: string, notDoneUserId: string) {
  const { data: profile } = await db.from("profiles").select("display_name").eq("id", doneUserId).maybeSingle();
  const doneName = profile?.display_name ?? "Someone";
  const quizName = await quizNameFor(db, won);
  void notifyFantasy({
    userIds: [notDoneUserId],
    title: `${doneName} has played. Your turn`,
    body: quizName,
    url: `/h2h/${won.result_id}`,
    dedupeKey: `challenge_turn:${won.id}`,
    type: "challenge_your_turn",
    subjectType: "member_challenge",
    subjectId: won.id,
  });
}

/** member_challenges' own expiry copy (set to match the h2h row's at
 *  creation) — the shared tail every adapter below falls through to when it
 *  found nothing worth completing. */
async function expiryFallback(db: Db, row: MemberChallengeRow): Promise<MemberChallengeRow> {
  if (new Date(row.expires_at) < new Date()) {
    const patch = { status: "expired" };
    const { data: updated } = await db.from("member_challenges")
      .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
    if (updated) await notifyExpired(db, updated as MemberChallengeRow);
    return (updated as MemberChallengeRow) ?? { ...row, ...patch };
  }
  return row;
}

/** quiz_battle / gameday_quiz — both ride h2h_challenges' "scorecard" shape
 *  (challenger_score always set at creation; opponent_score set the moment
 *  the opponent plays). Expiry rides the h2h row's OWN expires_at
 *  (challengeGames.ts's doc comment), not member_challenges.expires_at, which
 *  is only a copy taken at creation for cheap listing — kept as-is from
 *  Phase 1C rather than switched to expiryFallback, since a pre-3A h2h row
 *  can predate the member_challenges copy. */
async function reconcileScorecard(db: Db, row: MemberChallengeRow): Promise<MemberChallengeRow> {
  const { data: h2h } = await db.from("h2h_challenges")
    .select("challenger_id, challenger_score, opponent_score, expires_at")
    .eq("id", row.result_id!).maybeSingle();
  if (h2h && h2h.opponent_score !== null) {
    const winnerId = h2h.opponent_score > h2h.challenger_score
      ? row.opponent_id
      : h2h.opponent_score < h2h.challenger_score
        ? row.challenger_id
        : null; // a tie completes with no winner
    const patch = {
      status: "completed", winner_id: winnerId, completed_at: new Date().toISOString(),
      scoring_version: row.game_type === "gameday_quiz" ? "gameday_quiz_v1" : "quiz_battle_v1",
    };
    const { data: updated } = await db.from("member_challenges")
      .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
    // The update returning a row IS the "I won the transition" signal — a
    // losing racer gets null back here and must NOT post/notify (that's
    // the whole idempotency mechanism, no separate lock needed). Awaited,
    // not fire-and-forget: the chat insert is a real write that must land
    // before this request/serverless invocation ends, unlike notifyFantasy
    // itself (best-effort by design, see notify.ts's file doc).
    if (updated) await postCompletedResult(db, updated as MemberChallengeRow);
    return (updated as MemberChallengeRow) ?? { ...row, ...patch };
  }
  if (h2h && new Date(h2h.expires_at) < new Date()) {
    const patch = { status: "expired" };
    const { data: updated } = await db.from("member_challenges")
      .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
    if (updated) await notifyExpired(db, updated as MemberChallengeRow);
    return (updated as MemberChallengeRow) ?? { ...row, ...patch };
  }
  return expiryFallback(db, row);
}

/** quiz_duel — reads h2h_duel_attempts (service role, bypasses its own-row-only
 *  RLS) rather than h2h_challenges, since a duel's scores don't land on the
 *  public row until both sides have played (see migration 259's file doc).
 *  Two attempts → complete (deriveDuelOutcome, pure). Exactly one → the OPEN
 *  awaiting_opponent status, with a "your turn" nudge to whoever hasn't
 *  played (only on the transition that actually lands it — same win-guard
 *  idempotency as everywhere else here). Zero → falls through to expiry. */
async function reconcileDuel(db: Db, row: MemberChallengeRow): Promise<MemberChallengeRow> {
  const { data: attempts } = await db.from("h2h_duel_attempts")
    .select("user_id, score").eq("h2h_id", row.result_id!);
  const rows = (attempts ?? []) as { user_id: string; score: number }[];
  const outcome = deriveDuelOutcome(rows.map((r) => ({ userId: r.user_id, score: r.score })));

  if (outcome.status === "completed") {
    const patch = {
      status: "completed", winner_id: outcome.winnerId, completed_at: new Date().toISOString(),
      scoring_version: "quiz_duel_v1",
    };
    const { data: updated } = await db.from("member_challenges")
      .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
    if (updated) await postCompletedResult(db, updated as MemberChallengeRow);
    return (updated as MemberChallengeRow) ?? { ...row, ...patch };
  }

  if (rows.length === 1 && (row.status === "pending" || row.status === "active")) {
    const doneId = rows[0].user_id;
    const notDoneId = doneId === row.challenger_id ? row.opponent_id : row.challenger_id;
    const patch = { status: "awaiting_opponent" };
    const { data: updated } = await db.from("member_challenges")
      .update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
    if (updated) await notifyDuelTurn(db, updated as MemberChallengeRow, doneId, notDoneId);
    return (updated as MemberChallengeRow) ?? { ...row, ...patch };
  }

  return expiryFallback(db, row);
}

/** Status derived at read time from the linked game session, persisted when it
 *  changes so lists stay cheap (no join-and-recompute on every subsequent
 *  read). Moves a row out of pending/accepted/active/awaiting_opponent only —
 *  a terminal status (declined/expired/completed/cancelled) is never
 *  revisited. Adapter dispatch keyed on game_type; a future game_type with no
 *  adapter wired in here yet falls straight to the shared expiry fallback. */
export async function reconcile(db: Db, row: MemberChallengeRow): Promise<MemberChallengeRow> {
  if (!OPEN_STATUSES.has(row.status)) return row;

  if (row.result_id && SCORECARD_GAME_TYPES.has(row.game_type)) return reconcileScorecard(db, row);
  if (row.result_id && row.game_type === "quiz_duel") return reconcileDuel(db, row);

  return expiryFallback(db, row);
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
  /** Phase 3A — an optional line the challenger attaches, shown quoted under
   *  the chat card's header. See normalizeChallengeMessage. */
  message?: unknown;
  /** Phase 3A — which surface started this challenge (attribution only, see
   *  normalizeCreatedFrom); unrecognised/omitted falls back silently. */
  createdFrom?: unknown;
}

/** Shared post-insert bookkeeping every createChallenge path ends with — the
 *  chat card and the invite notification are identical no matter which game
 *  adapter built the row. */
async function postCreateChallenge(
  db: Db, userId: string, league: { id: string }, opponentId: string,
  mc: { id: string }, h2h: { id: string }, game: ChallengeGame, challengerName: string, quizName: string,
) {
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
    body: `${game.name} · ${quizName}`,
    url: `/h2h/${h2h.id}`,
    dedupeKey: `challenge:${mc.id}`,
    type: "challenge_invite",
    actorId: userId,
    subjectType: "member_challenge",
    subjectId: mc.id,
  });
}

/** quiz_battle / gameday_quiz: publish an EXISTING quiz_attempts scorecard as
 *  an h2h_challenges row — only the opponent has anything left to play.
 *  gameday_quiz is byte-identical except the pack must carry the gameday
 *  metadata marker (isGamedayPack). */
async function createScorecardChallenge(
  db: Db, userId: string, league: { id: string }, opponentId: string,
  gameType: string, game: ChallengeGame, packId: string, message: string | null, createdFrom: string,
) {
  if (!packId) throw new HttpError(400, "Pick a quiz first");

  // Same authoritative-attempt read as /api/h2h/from-attempt: your own stored
  // scorecard for this pack, never a client-trusted score.
  const { data: attempt } = await db.from("quiz_attempts")
    .select("score, max_score, correct_count, answers")
    .eq("user_id", userId).eq("pack_id", packId).maybeSingle();
  if (!attempt) throw new HttpError(400, "Play that quiz first, then send the challenge");

  const { data: pack } = await db.from("quiz_packs").select("name, questions, metadata").eq("id", packId).maybeSingle();
  if (!pack) throw new HttpError(404, "Quiz not found");
  if (gameType === "gameday_quiz" && !isGamedayPack(pack.metadata)) {
    throw new HttpError(400, "Pick a Gameday pack for this one");
  }
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

  // Insert the h2h row exactly as from-attempt does — same shape, same mode
  // ('scorecard', the column default) — for both quiz_battle and gameday_quiz.
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
      message,
      created_from: createdFrom,
    })
    .select("id")
    .single();
  if (mcError || !mc) {
    // 23505 = unique_violation — the partial unique index caught a race the
    // pre-check above missed.
    if (mcError?.code === "23505") throw new HttpError(409, "You already have an open challenge with them");
    throw new HttpError(500, "Could not create the challenge");
  }

  await postCreateChallenge(db, userId, league, opponentId, mc, h2h, game, challengerName, pack.name);
  return { id: mc.id, h2hId: h2h.id as string };
}

/** quiz_duel: neither side has played yet. The h2h row is created up front
 *  (mode 'duel') with EVERY score/correct/answers field null — migration 259
 *  drops the NOT NULL constraints that assumed a scorecard shape — and picks
 *  up real values only once /api/h2h/play copies both h2h_duel_attempts rows
 *  across on completion. max_score is derived from the pack's own questions
 *  (maxPointsForDifficulty summed, no perfect-round bonus) rather than read
 *  off a stored attempt — same convention quiz/solo-complete's own max_score
 *  column uses, so a duel's % bar reads the same as any other quiz's. */
async function createDuelChallenge(
  db: Db, userId: string, league: { id: string }, opponentId: string,
  game: ChallengeGame, packId: string, message: string | null, createdFrom: string,
) {
  if (!packId) throw new HttpError(400, "Pick a quiz first");

  const { data: pack } = await db.from("quiz_packs").select("name, questions, status").eq("id", packId).maybeSingle();
  if (!pack || pack.status !== "published") throw new HttpError(404, "Quiz not found");

  // Neither participant may have an existing scorecard for this pack — that's
  // the whole point of a duel (both play it fresh). Checked for both sides at
  // creation; the /api/h2h/play submit path never re-checks this (an attempt
  // already existing there just means they've already played their DUEL side,
  // handled by the h2h_duel_attempts unique constraint instead).
  const { data: attempts } = await db.from("quiz_attempts")
    .select("user_id").eq("pack_id", packId).in("user_id", [userId, opponentId]);
  if ((attempts ?? []).length > 0) throw new HttpError(400, "Pick a quiz neither of you has played");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions = (Array.isArray(pack.questions) ? pack.questions : []) as any[];
  const totalQuestions = questions.length;
  const maxScore = questions.reduce((s, q) => s + maxPointsForDifficulty(q?.difficulty ?? "medium"), 0);

  const { data: profile } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const challengerName = profile?.display_name ?? "Someone";

  const h2hExpiresAt = new Date(Date.now() + H2H_EXPIRY_MS).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: h2h, error: h2hError } = await (db as any)
    .from("h2h_challenges")
    .insert({
      quiz_pack_id: packId,
      quiz_pack_name: pack.name,
      challenger_id: userId,
      // The sender IS known at creation — only their SCORE isn't (they
      // haven't played yet) — so this is populated same as scorecard, unlike
      // challenger_score/correct/answers below.
      challenger_name: challengerName,
      challenger_score: null,
      challenger_correct: null,
      challenger_answers: null,
      total_questions: totalQuestions,
      max_score: maxScore,
      invited_user_id: opponentId,
      status: "awaiting_opponent",
      expires_at: h2hExpiresAt,
      mode: "duel",
    })
    .select("id")
    .single();
  if (h2hError || !h2h) throw new HttpError(500, "Could not create the challenge");

  const { data: mc, error: mcError } = await db.from("member_challenges")
    .insert({
      challenger_id: userId,
      opponent_id: opponentId,
      league_id: league.id,
      game_type: "quiz_duel",
      status: "pending",
      result_id: h2h.id,
      expires_at: h2hExpiresAt,
      message,
      created_from: createdFrom,
    })
    .select("id")
    .single();
  if (mcError || !mc) {
    if (mcError?.code === "23505") throw new HttpError(409, "You already have an open challenge with them");
    throw new HttpError(500, "Could not create the challenge");
  }

  await postCreateChallenge(db, userId, league, opponentId, mc, h2h, game, challengerName, pack.name);
  return { id: mc.id, h2hId: h2h.id as string };
}

/** Create a league-mate challenge — dispatches to the game's adapter once the
 *  shared checks (membership, blocks, duplicate-open-challenge) pass. The
 *  registry backstops an unsupported/unknown gameType with a 400. */
export async function createChallenge(db: Db, userId: string, input: CreateChallengeInput) {
  const opponentId = typeof input.opponentId === "string" ? input.opponentId : "";
  const leagueCode = typeof input.leagueCode === "string" ? input.leagueCode : "";
  const gameType = typeof input.gameType === "string" ? input.gameType : "";
  const packId = typeof input.packId === "string" ? input.packId : "";
  if (!opponentId || !leagueCode || !gameType) throw new HttpError(400, "missing fields");
  if (opponentId === userId) throw new HttpError(400, "You can't challenge yourself");

  // Validated up front — a bad message 400s before anything is written (the
  // h2h + member_challenges inserts below), rather than after.
  const messageResult = normalizeChallengeMessage(input.message);
  if (!messageResult.ok) throw new HttpError(400, messageResult.error);
  const message = messageResult.message;
  const createdFrom = normalizeCreatedFrom(input.createdFrom);

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

  switch (gameType) {
    case "quiz_battle":
    case "gameday_quiz":
      return createScorecardChallenge(db, userId, league, opponentId, gameType, game, packId, message, createdFrom);
    case "quiz_duel":
      return createDuelChallenge(db, userId, league, opponentId, game, packId, message, createdFrom);
    default:
      throw new HttpError(400, "That game isn't available for a challenge yet");
  }
}

/** One-tap accept (product decision, locked): there is no separate Accept
 *  step — the opponent's "Play" tap in chat/MemberActionSheet calls this,
 *  then navigates into /h2h/[id] on success. Only the opponent, only from
 *  'pending'. Idempotent for a genuine repeat tap (double network request,
 *  navigating back and tapping Play again): if the row is ALREADY active
 *  with accepted_at set for this same opponent, this returns ok silently —
 *  no second notification, matching the atomic update's own idempotency
 *  guard in reconcile(). Any other state 409s ("isn't open anymore") rather
 *  than leaving the caller's Play button looking like it worked. */
export async function acceptChallenge(db: Db, userId: string, challengeId: unknown) {
  const id = typeof challengeId === "string" ? challengeId : "";
  if (!id) throw new HttpError(400, "bad challenge id");
  const { data: row } = await db.from("member_challenges").select("*").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "challenge not found");
  const mc = row as MemberChallengeRow;
  if (mc.opponent_id !== userId) throw new HttpError(403, "only the challenged player can accept");

  if (mc.status === "active" && mc.accepted_at) return { ok: true, h2hId: mc.result_id };
  if (mc.status !== "pending") throw new HttpError(409, "This challenge isn't open anymore");

  const now = new Date().toISOString();
  const { data: updated, error } = await db.from("member_challenges")
    .update({ status: "active", accepted_at: now, started_at: now })
    .eq("id", id).eq("status", "pending").select("*").maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!updated) throw new HttpError(409, "This challenge isn't open anymore");
  const won = updated as MemberChallengeRow;

  // Notify only on the FIRST successful transition — the atomic .eq("status",
  // "pending") above is what guarantees this branch runs once.
  const { data: profile } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const opponentName = profile?.display_name ?? "Someone";
  const game = challengeGame(won.game_type);
  const quizName = await quizNameFor(db, won);
  void notifyFantasy({
    userIds: [won.challenger_id],
    title: `${opponentName} accepted your challenge`,
    body: `${game?.name ?? won.game_type} · ${quizName}`,
    url: `/h2h/${won.result_id}`,
    dedupeKey: `challenge_accept:${won.id}`,
    type: "challenge_accepted",
    actorId: userId,
    subjectType: "member_challenge",
    subjectId: won.id,
  });

  return { ok: true, h2hId: won.result_id };
}

/** Only the challenger can withdraw, and only while it's still 'pending' —
 *  once the opponent has accepted there's a live game underway on their
 *  side, cancel no longer applies (see the OPEN_STATUSES/status machine). */
export async function cancelChallenge(db: Db, userId: string, challengeId: unknown) {
  const id = typeof challengeId === "string" ? challengeId : "";
  if (!id) throw new HttpError(400, "bad challenge id");
  const { data: row } = await db.from("member_challenges").select("*").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "challenge not found");
  const mc = row as MemberChallengeRow;
  if (mc.challenger_id !== userId) throw new HttpError(403, "only the challenger can cancel");
  if (mc.status !== "pending") throw new HttpError(409, "This challenge can't be cancelled anymore");

  const now = new Date().toISOString();
  const { data: updated, error } = await db.from("member_challenges")
    .update({ status: "cancelled", cancelled_at: now }).eq("id", id).eq("status", "pending").select("*").maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!updated) throw new HttpError(409, "This challenge can't be cancelled anymore");
  const won = updated as MemberChallengeRow;

  // Discreet (product decision, locked) — a quiet notice, no chat card change.
  const { data: profile } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const challengerName = profile?.display_name ?? "Someone";
  const quizName = await quizNameFor(db, won);
  void notifyFantasy({
    userIds: [won.opponent_id],
    title: `${challengerName} withdrew their challenge`,
    body: quizName,
    dedupeKey: `challenge_cancel:${won.id}`,
    type: "challenge_cancelled",
    actorId: userId,
    subjectType: "member_challenge",
    subjectId: won.id,
  });

  return { ok: true };
}

/** Decline is discreet (product decision, locked): the challenger gets a
 *  quiet notification, never a shaming chat message — the card itself just
 *  flips to a muted terminal line (LeagueChatView's ChallengeCardMsg). */
export async function declineChallenge(db: Db, userId: string, challengeId: unknown) {
  const id = typeof challengeId === "string" ? challengeId : "";
  if (!id) throw new HttpError(400, "bad challenge id");
  const { data: row } = await db.from("member_challenges").select("*").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "challenge not found");
  const mc = row as MemberChallengeRow;
  if (mc.opponent_id !== userId) throw new HttpError(403, "only the challenged player can decline");
  if (mc.status !== "pending") throw new HttpError(409, "This challenge can't be declined anymore");

  const now = new Date().toISOString();
  const { data: updated, error } = await db.from("member_challenges")
    .update({ status: "declined", declined_at: now }).eq("id", id).eq("status", "pending").select("*").maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!updated) throw new HttpError(409, "This challenge can't be declined anymore");
  const won = updated as MemberChallengeRow;

  const { data: profile } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const opponentName = profile?.display_name ?? "Someone";
  const quizName = await quizNameFor(db, won);
  void notifyFantasy({
    userIds: [won.challenger_id],
    title: `${opponentName} passed on your challenge`,
    body: quizName,
    dedupeKey: `challenge_decline:${won.id}`,
    type: "challenge_declined",
    actorId: userId,
    subjectType: "member_challenge",
    subjectId: won.id,
  });

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
  /** Phase 3A — the challenger's optional line, rendered quoted under the
   *  card header (LeagueChatView's ChallengeCardMsg). Null if none was sent. */
  message: string | null;
  createdAt: string;
  /** Phase 3B — "duel" for quiz_duel, "scorecard" for quiz_battle/gameday_quiz.
   *  Lets the chat card render duel's "who's played" copy without hard-coding
   *  game_type strings into the component. */
  gameMode: "duel" | "scorecard";
  /** Phase 3B, duel only — has each side finished THEIR OWN attempt yet
   *  (h2h_duel_attempts, never the public h2h row's scores, which stay null
   *  pre-completion). Always false for a scorecard challenge — never read
   *  there, since scorecard has no "who's played" state to show pre-result. */
  challengerDone: boolean;
  opponentDone: boolean;
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

  // Every adapter today points result_id at an h2h_challenges row (quiz_battle,
  // gameday_quiz AND quiz_duel — a duel row exists from creation, just with
  // null scores pre-completion), so this isn't game-type-gated.
  const h2hIds = Array.from(new Set(reconciled.filter((r) => r.result_id).map((r) => r.result_id as string)));
  const { data: h2hRows } = h2hIds.length
    ? await db.from("h2h_challenges").select("id, quiz_pack_name").in("id", h2hIds)
    : { data: [] as { id: string; quiz_pack_name: string }[] };
  const quizNameByH2h = new Map(((h2hRows ?? []) as { id: string; quiz_pack_name: string }[]).map((r) => [r.id, r.quiz_pack_name]));

  // Duel done-flags — one batched .in() query for every duel h2h id in this
  // window, never per-row (see the file doc's N+1 note above). NEVER selects
  // score here — challengerDone/opponentDone are booleans only; a chat card
  // must not leak either side's score before the row itself completes.
  const duelH2hIds = Array.from(new Set(reconciled.filter((r) => r.game_type === "quiz_duel" && r.result_id).map((r) => r.result_id as string)));
  const { data: duelAttemptRows } = duelH2hIds.length
    ? await db.from("h2h_duel_attempts").select("h2h_id, user_id").in("h2h_id", duelH2hIds)
    : { data: [] as { h2h_id: string; user_id: string }[] };
  const duelDoneUsersByH2h = new Map<string, Set<string>>();
  for (const a of (duelAttemptRows ?? []) as { h2h_id: string; user_id: string }[]) {
    if (!duelDoneUsersByH2h.has(a.h2h_id)) duelDoneUsersByH2h.set(a.h2h_id, new Set());
    duelDoneUsersByH2h.get(a.h2h_id)!.add(a.user_id);
  }

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
    const doneUsers = r.result_id ? duelDoneUsersByH2h.get(r.result_id) : undefined;
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
      message: r.message ?? null,
      createdAt: r.created_at,
      gameMode: r.game_type === "quiz_duel" ? "duel" : "scorecard",
      challengerDone: !!doneUsers?.has(r.challenger_id),
      opponentDone: !!doneUsers?.has(r.opponent_id),
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
