import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";
import { notifyUsers } from "@/lib/notify";

// Shadow matches — play the ghost of a real player's previous multiplayer run.
// A shadow Lobby is a normal CPU-seat room (p2 = QUIZ_BOT_ID) whose questions
// are copied VERBATIM from the source run's room (same questions, same order,
// same options — rooms shuffle per room, so copying is what makes sequence-
// based replay exact). The rooms.shadow jsonb carries the persona + the source
// pointers; /api/answer replays the recorded answer per question; the shadow
// owner's own stats are never touched.

export interface ShadowInfo {
  userId: string;
  name: string;
  avatarUrl: string | null;
  sourceRoomId: string;
  /** When the source run was played (ISO) — honest-reveal copy. */
  playedAt: string | null;
  /** Per-question time_taken_ms by sequence — client presence tick only. */
  times: (number | null)[];
  originalScore: number;
}

export interface ShadowRun {
  userId: string;
  sourceRoomId: string;
  packId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

/** The health-check QA account — its runs are synthetic, never shadow-worthy. */
const EXCLUDED_RUNNERS = () => new Set([QUIZ_BOT_ID, process.env.HEALTH_BOT_USER_ID ?? ""].filter(Boolean));

/** Full-run scores for a set of completed rooms, minus excluded users. */
async function fullRunsIn(db: Db, rooms: { id: string; question_count: number }[], excludeUserIds: Set<string>) {
  if (rooms.length === 0) return [] as { user_id: string; room_id: string; total_score: number }[];
  const byRoom = new Map(rooms.map((r) => [r.id, r.question_count]));
  const { data } = await db
    .from("room_scores")
    .select("user_id, room_id, total_score, total_answers")
    .in("room_id", rooms.map((r) => r.id));
  return (data ?? []).filter((s) =>
    !excludeUserIds.has(s.user_id) &&
    (s.total_answers ?? 0) >= (byRoom.get(s.room_id) ?? Infinity)
  );
}

/** sourceRoomId:userId pairs this player has already shadowed (avoid reruns). */
async function alreadyShadowed(db: Db, userId: string): Promise<Set<string>> {
  const { data } = await db
    .from("rooms")
    .select("shadow")
    .eq("created_by", userId)
    .not("shadow", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const s = r.shadow as ShadowInfo | null;
    if (s?.sourceRoomId && s?.userId) seen.add(`${s.sourceRoomId}:${s.userId}`);
  }
  return seen;
}

/** Most recent full run on a pack by someone else this player hasn't shadowed. */
export async function findShadowRun(db: Db, packId: string, forUserId: string): Promise<ShadowRun | null> {
  const { data: rooms } = await db
    .from("rooms")
    .select("id, question_count")
    .eq("pack_id", packId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (!rooms?.length) return null;

  const exclude = EXCLUDED_RUNNERS();
  exclude.add(forUserId);
  const [runs, seen] = await Promise.all([
    fullRunsIn(db, rooms, exclude),
    alreadyShadowed(db, forUserId),
  ]);

  // rooms are newest-first; take the first qualifying run in that order.
  const order = new Map(rooms.map((r, i) => [r.id, i]));
  runs.sort((a, b) => (order.get(a.room_id) ?? 99) - (order.get(b.room_id) ?? 99));
  const hit = runs.find((r) => !seen.has(`${r.room_id}:${r.user_id}`));
  return hit ? { userId: hit.user_id, sourceRoomId: hit.room_id, packId } : null;
}

/** A specific player's most recent full run on a pack (revenge — reruns allowed). */
export async function findRunOfUser(db: Db, shadowUserId: string, packId: string): Promise<ShadowRun | null> {
  const { data: rooms } = await db
    .from("rooms")
    .select("id, question_count")
    .eq("pack_id", packId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (!rooms?.length) return null;
  const runs = await fullRunsIn(db, rooms, new Set());
  const order = new Map(rooms.map((r, i) => [r.id, i]));
  const hit = runs
    .filter((r) => r.user_id === shadowUserId)
    .sort((a, b) => (order.get(a.room_id) ?? 99) - (order.get(b.room_id) ?? 99))[0];
  return hit ? { userId: hit.user_id, sourceRoomId: hit.room_id, packId } : null;
}

/** Build the ShadowInfo payload for a run: persona + per-sequence times + score. */
export async function buildShadowInfo(db: Db, run: ShadowRun): Promise<ShadowInfo | null> {
  const [{ data: profile }, { data: src }, { data: score }] = await Promise.all([
    db.from("profiles").select("display_name, avatar_url").eq("id", run.userId).maybeSingle(),
    db.from("rooms").select("question_count, created_at").eq("id", run.sourceRoomId).maybeSingle(),
    db.from("room_scores").select("total_score").eq("room_id", run.sourceRoomId).eq("user_id", run.userId).maybeSingle(),
  ]);
  if (!src) return null;

  const { data: events } = await db
    .from("question_events")
    .select("id, sequence_number")
    .eq("room_id", run.sourceRoomId);
  const eventIds = (events ?? []).map((e) => e.id);
  const { data: answers } = eventIds.length
    ? await db.from("answers").select("question_event_id, time_taken_ms").eq("user_id", run.userId).in("question_event_id", eventIds)
    : { data: [] as { question_event_id: string; time_taken_ms: number }[] };
  const timeByEvent = new Map((answers ?? []).map((a) => [a.question_event_id, a.time_taken_ms]));

  const times: (number | null)[] = Array.from({ length: src.question_count ?? 10 }, () => null);
  for (const e of events ?? []) {
    const t = timeByEvent.get(e.id);
    if (e.sequence_number != null && t != null) times[e.sequence_number - 1] = t;
  }

  return {
    userId: run.userId,
    name: profile?.display_name ?? "A player",
    avatarUrl: profile?.avatar_url ?? null,
    sourceRoomId: run.sourceRoomId,
    playedAt: src.created_at ?? null,
    times,
    originalScore: score?.total_score ?? 0,
  };
}

/** The recorded answer for a source run at one sequence position, or null if
 *  the shadow player never answered that question (their timeout stays a
 *  timeout — the replay is honest). */
export async function shadowAnswerFor(
  db: Db, shadow: ShadowInfo, sequenceNumber: number
): Promise<{ selected: string; isCorrect: boolean; elapsedMs: number } | null> {
  const { data: ev } = await db
    .from("question_events")
    .select("id")
    .eq("room_id", shadow.sourceRoomId)
    .eq("sequence_number", sequenceNumber)
    .maybeSingle();
  if (!ev) return null;
  const { data: a } = await db
    .from("answers")
    .select("selected_answer, is_correct, time_taken_ms")
    .eq("question_event_id", ev.id)
    .eq("user_id", shadow.userId)
    .maybeSingle();
  if (!a) return null;
  return { selected: a.selected_answer, isCorrect: a.is_correct, elapsedMs: a.time_taken_ms };
}

export interface ShadowableRun {
  packId: string;
  packName: string;
  cover: string | null;
  score: number;
  playedAt: string | null;
  questionCount: number;
}

/** The revenge library: a player's shadowable runs, latest per pack. */
export async function shadowRunsOf(db: Db, userId: string): Promise<ShadowableRun[]> {
  const { data: scores } = await db
    .from("room_scores")
    .select("room_id, total_score, total_answers")
    .eq("user_id", userId)
    .limit(200);
  if (!scores?.length) return [];

  const { data: rooms } = await db
    .from("rooms")
    .select("id, pack_id, question_count, created_at")
    .in("id", scores.map((s) => s.room_id))
    .eq("status", "completed")
    .not("pack_id", "is", null)
    .order("created_at", { ascending: false });
  if (!rooms?.length) return [];

  const scoreByRoom = new Map(scores.map((s) => [s.room_id, s]));
  const perPack = new Map<string, { room: (typeof rooms)[number]; score: number }>();
  for (const r of rooms) {
    const s = scoreByRoom.get(r.id);
    if (!s || (s.total_answers ?? 0) < (r.question_count ?? 10)) continue; // full runs only
    if (!perPack.has(r.pack_id!)) perPack.set(r.pack_id!, { room: r, score: s.total_score ?? 0 }); // newest-first
  }
  if (perPack.size === 0) return [];

  const { data: packs } = await db
    .from("quiz_packs")
    .select("id, name, metadata")
    .in("id", Array.from(perPack.keys()));
  const packById = new Map((packs ?? []).map((p) => [p.id, p]));

  return Array.from(perPack.entries()).map(([packId, { room, score }]) => {
    const pack = packById.get(packId);
    const meta = (pack?.metadata ?? null) as { cover_image?: string } | null;
    return {
      packId,
      packName: pack?.name ?? "Quiz",
      cover: meta?.cover_image ?? null,
      score,
      playedAt: room.created_at,
      questionCount: room.question_count ?? 10,
    };
  });
}

// ── Result notification (founder safeguard: never pester the run's owner) ─────
// A popular run can be shadowed many times. Rules:
//   • At most ONE shadow-result push per owner per rolling 24h — anything inside
//     the quiet window is silently absorbed.
//   • BEATS OPEN THE PUSH, holds never do: a push only sends when at least one
//     pending play (this one, or one absorbed since the last push) beat the run.
//     A flattering-but-passive hold can't burn the daily slot and silence a
//     revenge-worthy beat; holds simply ride along in the aggregate copy.
//   • The push AGGREGATES everything pending: "Feran and 2 others took on your
//     runs — 2 beat you. Get revenge."
//   • Opt-in gating + per-key dedupe still apply inside notifyUsers.

const QUIET_WINDOW_MS = 24 * 3600_000;
const AGGREGATE_LOOKBACK_MS = 7 * 24 * 3600_000; // first-ever push looks back this far

export async function notifyShadowResult(
  db: Db,
  args: { roomId: string; shadow: ShadowInfo; humanId: string; humanName: string; packName: string; humanScore: number; shadowScore: number }
): Promise<void> {
  const owner = args.shadow.userId;

  // 1. Quiet window: latest shadow push to this owner, any room.
  const { data: lastPush } = await db
    .from("notification_log")
    .select("sent_at")
    .eq("user_id", owner)
    .like("key", "shadow-result:%")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastPush && Date.now() - Date.parse(lastPush.sent_at) < QUIET_WINDOW_MS) return; // absorbed

  // 2. Everything since the last push (or a week) — including this match —
  //    so the absorbed plays surface in this push instead of being lost.
  const since = new Date(lastPush ? Date.parse(lastPush.sent_at) : Date.now() - AGGREGATE_LOOKBACK_MS).toISOString();
  const { data: recent } = await db
    .from("rooms")
    .select("id, created_by")
    .eq("status", "completed")
    .eq("shadow->>userId", owner)
    .gte("created_at", since)
    .limit(50);
  const rooms = (recent ?? []).filter((r) => r.id !== args.roomId);

  let plays = 1;
  let beats = args.humanScore > args.shadowScore ? 1 : 0;
  // The push names (and deep-links to) someone who BEAT the run — revenge needs
  // a target. Defaults to the current player when they're the beater.
  let beaterId = beats > 0 ? args.humanId : null;
  let beaterName = beats > 0 ? args.humanName : null;
  if (rooms.length > 0) {
    const { data: scores } = await db
      .from("room_scores")
      .select("room_id, user_id, total_score")
      .in("room_id", rooms.map((r) => r.id));
    const byRoomUser = new Map((scores ?? []).map((s) => [`${s.room_id}:${s.user_id}`, s.total_score ?? 0]));
    for (const r of rooms) {
      plays++;
      const human = byRoomUser.get(`${r.id}:${r.created_by}`) ?? 0;
      const bot = byRoomUser.get(`${r.id}:${QUIZ_BOT_ID}`) ?? 0;
      if (human > bot) {
        beats++;
        if (!beaterId && r.created_by) beaterId = r.created_by;
      }
    }
    if (beaterId && !beaterName) {
      const { data: p } = await db.from("profiles").select("display_name").eq("id", beaterId).maybeSingle();
      beaterName = p?.display_name ?? "Someone";
    }
  }

  // 3. Beats open the push. No pending beat → stay quiet; these plays keep
  //    accumulating and surface whenever a beat finally lands.
  if (beats === 0) return;

  // 4. Copy: detailed for a single play (necessarily the beat), aggregated when
  //    other plays were absorbed alongside it. Named player = a beater, always.
  let title: string, body: string;
  if (plays === 1) {
    title = "Your run got beaten";
    body = `${args.humanName} beat your ${args.packName} run ${args.humanScore.toLocaleString()}–${args.shadowScore.toLocaleString()} — get revenge`;
  } else {
    const others = plays - 1;
    title = "Your runs got taken on";
    body = `${beaterName ?? "Someone"} and ${others} other${others === 1 ? "" : "s"} took on your runs — ${beats} beat you. Get revenge`;
  }

  await notifyUsers({
    userIds: [owner],
    title,
    body,
    url: `/versus/shadow/${beaterId ?? args.humanId}`,
    dedupeKey: `shadow-result:${args.roomId}`,
  });
}
