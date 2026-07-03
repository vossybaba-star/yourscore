import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { scoreAnswer } from "@/lib/scoring";
import { QUIZ_BOT_ID, QUIZ_BOT_NAME } from "@/lib/versus/quizBot";

// Quiz Battle instant matchmaking — mirrors the proven 38-0 design
// (lib/draft/live-server.ts queueOrPair): the `quiz_pair` RPC atomically claims
// the oldest fresh waiter (FOR UPDATE SKIP LOCKED) or enqueues the caller; the
// claimer then creates a 1v1 Lobby seating both players. The waiter discovers
// the Lobby on their next poll via findInstantLobby. Both land in the standard
// /play/[roomId] lobby → live flow.

/** Lobby name doubles as the marker that a room was matchmade (vs hand-created),
 *  so polling waiters only ever get pulled into rooms this flow created. */
export const INSTANT_MATCH_NAME = "Instant Match";

export interface InstantOpponent { id: string; name: string; avatarUrl: string | null }
export type QuizQueueResult =
  | { status: "matched"; roomId: string; code: string; opponent: InstantOpponent | null }
  | { status: "waiting" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/1/I (same as room/create)
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function profileOf(db: Db, userId: string | null): Promise<InstantOpponent | null> {
  if (!userId) return null;
  const { data } = await db.from("profiles").select("id, display_name, avatar_url").eq("id", userId).maybeSingle();
  return data ? { id: data.id, name: data.display_name ?? "Player", avatarUrl: data.avatar_url } : null;
}

/** The user's live instant-match Lobby (as either seat), or null. This is how a
 *  waiting player discovers they've been paired — the claimer created the room
 *  and seated them. Recency-bounded so stale lobbies never resurrect. */
async function findInstantLobby(db: Db, userId: string): Promise<{ roomId: string; code: string; opponent: InstantOpponent | null } | null> {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: memberships } = await db
    .from("room_members")
    .select("room_id, rooms!inner(id, code, name, status, room_mode, created_at)")
    .eq("user_id", userId)
    .eq("rooms.room_mode", "h2h")
    .eq("rooms.name", INSTANT_MATCH_NAME)
    .in("rooms.status", ["lobby", "live"])
    .gte("rooms.created_at", tenMinAgo)
    .order("joined_at", { ascending: false })
    .limit(1);
  const m = memberships?.[0] as { room_id: string; rooms: { code: string } } | undefined;
  if (!m) return null;
  const { data: other } = await db
    .from("room_members").select("user_id").eq("room_id", m.room_id).neq("user_id", userId).limit(1);
  return { roomId: m.room_id, code: m.rooms.code, opponent: await profileOf(db, other?.[0]?.user_id ?? null) };
}

/** Pick the quiz for an instant match: the newest featured pack, falling back to
 *  the newest published pack. Both players get the same questions — that's the
 *  whole game. */
async function pickInstantPack(db: Db): Promise<string | null> {
  const { data: featured } = await db
    .from("quiz_packs").select("id").eq("status", "published").eq("featured", true)
    .order("created_at", { ascending: false }).limit(1);
  if (featured?.[0]) return featured[0].id;
  const { data: newest } = await db
    .from("quiz_packs").select("id").eq("status", "published")
    .order("created_at", { ascending: false }).limit(1);
  return newest?.[0]?.id ?? null;
}

/** Poll the queue: resume an existing pairing, claim a waiter (creating the
 *  Lobby), or wait. Safe to call repeatedly — polling refreshes enqueued_at. */
export async function queueOrPairQuiz(userId: string): Promise<QuizQueueResult> {
  const db = createServiceClient();

  // 1. Already paired? (the waiter's discovery path; also stops double-pairing)
  const existing = await findInstantLobby(db, userId);
  if (existing) return { status: "matched", ...existing };

  // 2. Claim the oldest fresh waiter, or enqueue self.
  const { data: oppId } = await db.rpc("quiz_pair", { p_user: userId });
  if (!oppId) return { status: "waiting" };

  // 3. Paired — create the 1v1 Lobby and seat both. The waiter was first, but the
  //    claimer hosts (they're mid-flow on the found screen and presses Start).
  const packId = await pickInstantPack(db);
  if (!packId) throw new Error("No quiz available right now");

  let room: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    const { data, error } = await db.from("rooms").insert({
      code: genCode(), name: INSTANT_MATCH_NAME, type: "player", status: "lobby",
      created_by: userId, max_players: 2, room_mode: "h2h",
      question_count: 10, pack_id: packId, category_filter: null,
      difficulty_filter: "mixed", current_question_idx: 0,
    }).select("id, code").maybeSingle();
    if (data) room = data;
    else if (error && !`${error.message}`.toLowerCase().includes("duplicate")) throw new Error(error.message);
  }
  if (!room) throw new Error("Could not create the match — try again");

  const { error: memberErr } = await db.from("room_members").insert([
    { room_id: room.id, user_id: userId },
    { room_id: room.id, user_id: oppId },
  ]);
  if (memberErr) throw new Error(memberErr.message);

  return { status: "matched", roomId: room.id, code: room.code, opponent: await profileOf(db, oppId) };
}

export async function cancelQuizQueue(userId: string): Promise<void> {
  const db = createServiceClient();
  await db.from("quiz_queue").delete().eq("user_id", userId);
}

// ── CPU fallback (mirrors 38-0's bot fallback) ────────────────────────────────
// When no human is waiting after a few seconds, the client asks for a CPU match:
// a normal h2h Lobby whose second seat is the dedicated CPU user. The CPU's
// answers are written server-side in /api/answer (seeded per question) when the
// human answers, and the room page fakes its "answered" tick locally — the CPU
// never touches global rank or league stats.

/** Deterministic [0,1) from a string seed — reproducible bot behaviour. */
function seeded01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** Leave the queue and start a CPU match now. */
export async function createBotQuizLobby(userId: string): Promise<QuizQueueResult> {
  const db = createServiceClient();

  // A real pairing may have landed in the gap — play that instead.
  const existing = await findInstantLobby(db, userId);
  if (existing) return { status: "matched", ...existing };
  await db.from("quiz_queue").delete().eq("user_id", userId);

  const packId = await pickInstantPack(db);
  if (!packId) throw new Error("No quiz available right now");

  let room: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    const { data, error } = await db.from("rooms").insert({
      code: genCode(), name: INSTANT_MATCH_NAME, type: "player", status: "lobby",
      created_by: userId, max_players: 2, room_mode: "h2h",
      question_count: 10, pack_id: packId, category_filter: null,
      difficulty_filter: "mixed", current_question_idx: 0,
    }).select("id, code").maybeSingle();
    if (data) room = data;
    else if (error && !`${error.message}`.toLowerCase().includes("duplicate")) throw new Error(error.message);
  }
  if (!room) throw new Error("Could not start the match — try again");

  const { error: memberErr } = await db.from("room_members").insert([
    { room_id: room.id, user_id: userId },
    { room_id: room.id, user_id: QUIZ_BOT_ID },
  ]);
  if (memberErr) throw new Error(memberErr.message);

  return { status: "matched", roomId: room.id, code: room.code, opponent: { id: QUIZ_BOT_ID, name: QUIZ_BOT_NAME, avatarUrl: null } };
}

/**
 * Write the CPU's answer for one question in a CPU room. Called from /api/answer
 * right after the human's answer commits; no-op in human-vs-human rooms. Seeded
 * by the event id, so retries are idempotent. Only touches answers + room_scores —
 * never increment_profile_score / league stats.
 */
export async function maybeBotAnswer(
  db: Db,
  args: { questionEventId: string; roomId: string; correctAnswer: string; difficulty: string; windowMs: number }
): Promise<void> {
  try {
    const { data: member } = await db.from("room_members")
      .select("user_id").eq("room_id", args.roomId).eq("user_id", QUIZ_BOT_ID).maybeSingle();
    if (!member) return; // not a CPU room

    const { data: already } = await db.from("answers")
      .select("id").eq("question_event_id", args.questionEventId).eq("user_id", QUIZ_BOT_ID).maybeSingle();
    if (already) return;

    // Seeded personality: ~62% accuracy, 2.8–10.5s answers.
    const rCorrect = seeded01(`${args.questionEventId}:hit`);
    const rSpeed = seeded01(`${args.questionEventId}:spd`);
    const rPick = seeded01(`${args.questionEventId}:pick`);
    const isCorrect = rCorrect < 0.62;
    const elapsedMs = Math.round(2800 + rSpeed * 7700);
    const correct = args.correctAnswer.toLowerCase();
    const wrong = ["a", "b", "c", "d"].filter((l) => l !== correct);
    const selected = isCorrect ? correct : wrong[Math.floor(rPick * wrong.length) % wrong.length];

    const { data: scoreRow } = await db.from("room_scores")
      .select("current_streak, wrong_streak, total_score, correct_answers, total_answers, best_streak, avg_answer_speed_ms, fastest_answer_ms")
      .eq("room_id", args.roomId).eq("user_id", QUIZ_BOT_ID).maybeSingle();

    const s = scoreAnswer({
      isCorrect, elapsedMs, difficulty: args.difficulty,
      correctStreak: scoreRow?.current_streak ?? 0,
      wrongStreak: scoreRow?.wrong_streak ?? 0,
      windowMs: args.windowMs,
    });

    const totalAnswers = (scoreRow?.total_answers ?? 0) + 1;
    const prevAvg = scoreRow?.avg_answer_speed_ms ?? null;
    await Promise.all([
      db.from("answers").insert({
        question_event_id: args.questionEventId, user_id: QUIZ_BOT_ID, room_id: args.roomId,
        match_id: null, selected_answer: selected, is_correct: isCorrect,
        time_taken_ms: elapsedMs, points_awarded: s.points,
      }),
      db.from("room_scores").upsert({
        room_id: args.roomId, user_id: QUIZ_BOT_ID,
        total_score: Math.max(0, (scoreRow?.total_score ?? 0) + s.points),
        correct_answers: (scoreRow?.correct_answers ?? 0) + (isCorrect ? 1 : 0),
        total_answers: totalAnswers,
        current_streak: s.nextCorrectStreak,
        wrong_streak: s.nextWrongStreak,
        best_streak: Math.max(scoreRow?.best_streak ?? 0, s.nextCorrectStreak),
        avg_answer_speed_ms: prevAvg != null ? Math.round((prevAvg * (totalAnswers - 1) + elapsedMs) / totalAnswers) : elapsedMs,
        fastest_answer_ms: scoreRow?.fastest_answer_ms != null ? Math.min(scoreRow.fastest_answer_ms, elapsedMs) : elapsedMs,
      }, { onConflict: "room_id,user_id" }),
    ]);
  } catch { /* the CPU failing to answer must never break the human's answer */ }
}
