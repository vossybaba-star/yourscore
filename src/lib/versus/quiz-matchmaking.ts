import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

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
