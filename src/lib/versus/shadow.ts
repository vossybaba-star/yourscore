import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";
import { notifyUsers } from "@/lib/notify";

// Shadow matches — play the ghost of a real player's previous run. ONE POOL
// (founder call): a run counts whether it was a multiplayer/Versus game OR a
// solo quiz attempt — solo is where most play happens, so it makes the pool
// deep from day one.
//   • Multiplayer source: the shadow Lobby copies the source room's
//     questions_json VERBATIM (rooms shuffle per room, so copying is what makes
//     sequence-based replay exact).
//   • Solo source: quiz_attempts are graded in PACK ORDER (solo-complete checks
//     answers[i] vs pack.questions[i]), so the shadow Lobby uses the pack's
//     questions in pack order, sliced to the attempt's length — idx maps 1:1 to
//     sequence, letters map to pack option order.
// The rooms.shadow jsonb carries the persona + the source pointers; /api/answer
// replays the recorded answer per question; the shadow owner's own stats are
// never touched.

export interface ShadowInfo {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Exactly one of these is set — which table the recording lives in. */
  sourceRoomId: string | null;
  sourceAttemptId?: string | null;
  /** When the source run was played (ISO) — honest-reveal copy. */
  playedAt: string | null;
  /** Per-question time_taken_ms by sequence — client presence tick only. */
  times: (number | null)[];
  originalScore: number;
}

export interface ShadowRun {
  userId: string;
  packId: string;
  sourceRoomId?: string | null;
  sourceAttemptId?: string | null;
  /** Recency for cross-pool ordering. */
  at: string | null;
}

/** Solo attempt answer log entry (written by /api/quiz/solo-complete). */
interface AttemptLogEntry { idx: number; selected: string; correct: boolean; points: number; elapsed_ms: number }

function attemptLog(answers: unknown): AttemptLogEntry[] | null {
  if (!Array.isArray(answers) || answers.length < 3) return null;
  const first = answers[0] as AttemptLogEntry | undefined;
  if (!first || typeof first.selected !== "string" || typeof first.elapsed_ms !== "number") return null;
  return answers as AttemptLogEntry[];
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

/** Rerun-exclusion keys for the sources this player has already shadowed. */
function seenKey(run: { sourceRoomId?: string | null; sourceAttemptId?: string | null; userId: string }): string {
  return run.sourceAttemptId ? `att:${run.sourceAttemptId}:${run.userId}` : `${run.sourceRoomId}:${run.userId}`;
}

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
    if (s?.userId && (s.sourceRoomId || s.sourceAttemptId)) seen.add(seenKey(s));
  }
  return seen;
}

/** Multiplayer candidates on a pack, newest-first. */
async function roomCandidates(db: Db, packId: string): Promise<ShadowRun[]> {
  const { data: rooms } = await db
    .from("rooms")
    .select("id, question_count, created_at")
    .eq("pack_id", packId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(50);
  if (!rooms?.length) return [];
  const runs = await fullRunsIn(db, rooms, new Set());
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  return runs.map((r) => ({
    userId: r.user_id, packId, sourceRoomId: r.room_id, sourceAttemptId: null,
    at: roomById.get(r.room_id)?.created_at ?? null,
  }));
}

/** Solo candidates on a pack, newest-first (attempts with a usable answer log). */
async function soloCandidates(db: Db, packId: string): Promise<ShadowRun[]> {
  const { data: attempts } = await db
    .from("quiz_attempts")
    .select("id, user_id, completed_at, answers")
    .eq("pack_id", packId)
    .not("answers", "is", null)
    .order("completed_at", { ascending: false })
    .limit(50);
  return (attempts ?? [])
    .filter((a) => attemptLog(a.answers) !== null)
    .map((a) => ({ userId: a.user_id, packId, sourceRoomId: null, sourceAttemptId: a.id, at: a.completed_at ?? null }));
}

/** One pool: solo + multiplayer runs on the pack, newest first. */
async function allCandidates(db: Db, packId: string): Promise<ShadowRun[]> {
  const [rooms, solos] = await Promise.all([roomCandidates(db, packId), soloCandidates(db, packId)]);
  return [...rooms, ...solos].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Most recent run on a pack by someone else this player hasn't shadowed. */
export async function findShadowRun(db: Db, packId: string, forUserId: string): Promise<ShadowRun | null> {
  const exclude = EXCLUDED_RUNNERS();
  exclude.add(forUserId);
  const [candidates, seen] = await Promise.all([
    allCandidates(db, packId),
    alreadyShadowed(db, forUserId),
  ]);
  return candidates.find((c) => !exclude.has(c.userId) && !seen.has(seenKey(c))) ?? null;
}

/** A specific player's most recent run on a pack (revenge — reruns allowed). */
export async function findRunOfUser(db: Db, shadowUserId: string, packId: string): Promise<ShadowRun | null> {
  const candidates = await allCandidates(db, packId);
  return candidates.find((c) => c.userId === shadowUserId) ?? null;
}

/** Build the ShadowInfo payload for a run: persona + per-sequence times + score. */
export async function buildShadowInfo(db: Db, run: ShadowRun): Promise<ShadowInfo | null> {
  // Solo source: everything lives on the attempt row.
  if (run.sourceAttemptId) {
    const [{ data: profile }, { data: attempt }] = await Promise.all([
      db.from("profiles").select("display_name, avatar_url").eq("id", run.userId).maybeSingle(),
      db.from("quiz_attempts").select("answers, score, completed_at").eq("id", run.sourceAttemptId).maybeSingle(),
    ]);
    const log = attemptLog(attempt?.answers);
    if (!attempt || !log) return null;
    return {
      userId: run.userId,
      name: profile?.display_name ?? "A player",
      avatarUrl: profile?.avatar_url ?? null,
      sourceRoomId: null,
      sourceAttemptId: run.sourceAttemptId,
      playedAt: attempt.completed_at ?? null,
      times: log.map((e) => e.elapsed_ms ?? null),
      originalScore: attempt.score ?? 0,
    };
  }

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
    sourceRoomId: run.sourceRoomId ?? null,
    sourceAttemptId: null,
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
  // Solo source: the attempt log is idx-ordered and the shadow Lobby uses the
  // pack's questions in the same order — sequence maps 1:1.
  if (shadow.sourceAttemptId) {
    const { data: attempt } = await db
      .from("quiz_attempts").select("answers").eq("id", shadow.sourceAttemptId).maybeSingle();
    const log = attemptLog(attempt?.answers);
    const e = log?.[sequenceNumber - 1];
    if (!e) return null;
    return { selected: String(e.selected).toLowerCase(), isCorrect: !!e.correct, elapsedMs: e.elapsed_ms };
  }

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

/** The revenge library: a player's shadowable runs (solo + multiplayer, one
 *  pool), latest per pack. */
export async function shadowRunsOf(db: Db, userId: string): Promise<ShadowableRun[]> {
  const [{ data: scores }, { data: attempts }] = await Promise.all([
    db.from("room_scores").select("room_id, total_score, total_answers").eq("user_id", userId).limit(200),
    db.from("quiz_attempts").select("id, pack_id, score, completed_at, answers").eq("user_id", userId).not("answers", "is", null).order("completed_at", { ascending: false }).limit(100),
  ]);

  // Latest full run per pack — a solo attempt and a multiplayer run compete on
  // recency; the newer one represents that quiz in the library.
  const perPack = new Map<string, { score: number; playedAt: string | null; questionCount: number }>();
  const consider = (packId: string, entry: { score: number; playedAt: string | null; questionCount: number }) => {
    const cur = perPack.get(packId);
    if (!cur || (entry.playedAt ?? "") > (cur.playedAt ?? "")) perPack.set(packId, entry);
  };

  for (const a of attempts ?? []) {
    const log = attemptLog(a.answers);
    if (!log || !a.pack_id) continue;
    consider(a.pack_id, { score: a.score ?? 0, playedAt: a.completed_at ?? null, questionCount: log.length });
  }

  if (scores?.length) {
    const { data: rooms } = await db
      .from("rooms")
      .select("id, pack_id, question_count, created_at")
      .in("id", scores.map((s) => s.room_id))
      .eq("status", "completed")
      .not("pack_id", "is", null)
      .order("created_at", { ascending: false });
    const scoreByRoom = new Map((scores ?? []).map((s) => [s.room_id, s]));
    for (const r of rooms ?? []) {
      const s = scoreByRoom.get(r.id);
      if (!s || (s.total_answers ?? 0) < (r.question_count ?? 10)) continue; // full runs only
      consider(r.pack_id!, { score: s.total_score ?? 0, playedAt: r.created_at, questionCount: r.question_count ?? 10 });
    }
  }
  if (perPack.size === 0) return [];

  const { data: packs } = await db
    .from("quiz_packs")
    .select("id, name, metadata")
    .in("id", Array.from(perPack.keys()));
  const packById = new Map((packs ?? []).map((p) => [p.id, p]));

  return Array.from(perPack.entries())
    .map(([packId, entry]) => {
      const pack = packById.get(packId);
      const meta = (pack?.metadata ?? null) as { cover_image?: string } | null;
      return {
        packId,
        packName: pack?.name ?? "Quiz",
        cover: meta?.cover_image ?? null,
        score: entry.score,
        playedAt: entry.playedAt,
        questionCount: entry.questionCount,
      };
    })
    .sort((a, b) => (b.playedAt ?? "").localeCompare(a.playedAt ?? ""));
}

// ── Result notification (founder safeguard: never pester the run's owner) ─────
// A popular run can be shadowed many times. Rules:
//   • RALLY BYPASS: when the owner and the beater are actively trading blows
//     (the owner played the beater's shadow within the last 7 days), every beat
//     notifies INSTANTLY — no cap. The back-and-forth is the game; playing a
//     full quiz (~2-3 min) is the natural rate limit.
//   • Otherwise, at most ONE shadow-result push per owner per rolling 24h —
//     anything inside the quiet window is silently absorbed. This protects a
//     popular run's owner from a crowd of strangers, never from a rival.
//   • BEATS OPEN THE PUSH, holds never do: a push only sends when at least one
//     pending play (this one, or one absorbed since the last push) beat the run.
//     Holds simply ride along in the aggregate copy.
//   • The capped push AGGREGATES everything pending: "Feran and 2 others took
//     on your runs — 2 beat you. Get revenge."
//   • Opt-in gating + per-key dedupe still apply inside notifyUsers.

const QUIET_WINDOW_MS = 24 * 3600_000;
const AGGREGATE_LOOKBACK_MS = 7 * 24 * 3600_000; // first-ever push looks back this far
const RALLY_WINDOW_MS = 7 * 24 * 3600_000;       // reverse-direction play this recent = active rally

export async function notifyShadowResult(
  db: Db,
  args: { roomId: string; shadow: ShadowInfo; humanId: string; humanName: string; packName: string; humanScore: number; shadowScore: number }
): Promise<void> {
  const owner = args.shadow.userId;

  // 0. Rally bypass: a beat inside an active back-and-forth notifies instantly.
  //    "Active" = the owner has played THIS beater's shadow recently (so the
  //    original beat, the revenge, and every re-revenge all flow uncapped).
  if (args.humanScore > args.shadowScore) {
    const { data: reverse } = await db
      .from("rooms")
      .select("id")
      .eq("status", "completed")
      .eq("created_by", owner)
      .eq("shadow->>userId", args.humanId)
      .gte("created_at", new Date(Date.now() - RALLY_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle();
    if (reverse) {
      await notifyUsers({
        userIds: [owner],
        title: `${args.humanName} hit back!`,
        body: `They beat your ${args.packName} run ${args.humanScore.toLocaleString()}–${args.shadowScore.toLocaleString()} — your turn`,
        url: `/versus/shadow/${args.humanId}`,
        dedupeKey: `shadow-result:${args.roomId}`,
      });
      return;
    }
  }

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
    title = `${args.humanName} beat your run 👻`;
    body = `They edged your ${args.packName} run ${args.humanScore.toLocaleString()}-${args.shadowScore.toLocaleString()}. Go again and take it back.`;
  } else {
    const others = plays - 1;
    title = "Your runs got taken on 👻";
    body = `${beaterName ?? "Someone"} and ${others} other${others === 1 ? "" : "s"} played your runs. ${beats} beat you. Get your revenge.`;
  }

  await notifyUsers({
    userIds: [owner],
    title,
    body,
    url: `/versus/shadow/${beaterId ?? args.humanId}`,
    dedupeKey: `shadow-result:${args.roomId}`,
  });
}
