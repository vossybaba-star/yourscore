import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { TIMEOUT_PENALTY, calculatePerfectRoundBonus } from "@/lib/scoring";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";
import { notifyUsers } from "@/lib/notify";
import type { ShadowInfo } from "@/lib/versus/shadow";

const QUESTION_DURATION_MS = 20_000;

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { roomId?: string; expectedIdx?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { roomId, expectedIdx } = body;
  if (!roomId || expectedIdx === undefined)
    return NextResponse.json({ error: "roomId and expectedIdx required" }, { status: 400 });

  const sb = createServiceClient();

  // Fetch room
  const { data: room, error: roomErr } = await sb
    .from("rooms")
    .select("id, status, created_by, question_count, questions_json, current_question_idx, pack_id, shadow")
    .eq("id", roomId)
    .single();

  if (roomErr || !room) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
  if (room.created_by !== user.id) return NextResponse.json({ error: "Only host can advance" }, { status: 403 });
  if (room.status !== "live") return NextResponse.json({ error: "Lobby not live" }, { status: 409 });

  // Idempotency: only advance if we're still at the expected index
  if (room.current_question_idx !== expectedIdx) {
    return NextResponse.json({ ok: true, skipped: true, currentIdx: room.current_question_idx });
  }

  // ── Find the just-closed question event ─────────────────────────────────
  const { data: closedEvent } = await sb
    .from("question_events")
    .select("id")
    .eq("room_id", roomId)
    .eq("sequence_number", expectedIdx + 1)
    .single();

  // Close it
  await sb
    .from("question_events")
    .update({ status: "closed" })
    .eq("room_id", roomId)
    .eq("sequence_number", expectedIdx + 1);

  // ── Timeout penalty: deduct from players who didn't answer ───────────────
  if (closedEvent) {
    const [{ data: members }, { data: answeredRows }] = await Promise.all([
      sb.from("room_members").select("user_id").eq("room_id", roomId),
      sb.from("answers").select("user_id").eq("question_event_id", closedEvent.id),
    ]);

    const answeredIds = new Set<string>((answeredRows ?? []).map((a) => a.user_id as string));
    const unanswered: string[] = (members ?? [])
      .map((m) => m.user_id as string)
      .filter((uid: string) => !answeredIds.has(uid));

    if (unanswered.length > 0) {
      // Set-based: one UPDATE for every unanswered player in a single round-trip
      // (was one upsert per player — up to max_players sequential round-trips
      // while the next question was blocked). GREATEST(0, …) floors at zero.
      await sb.rpc("apply_timeout_penalty", {
        p_room_id: roomId,
        p_user_ids: unanswered,
        p_penalty: TIMEOUT_PENALTY,
      });
    }
  }

  const nextIdx = expectedIdx + 1;
  const isDone = nextIdx >= room.question_count;

  if (isDone) {
    // ── Perfect round bonus: +500 for players who got every question right ──
    const { data: scores } = await sb
      .from("room_scores")
      .select("user_id, total_score, correct_answers")
      .eq("room_id", roomId);

    // Award perfect-round bonuses concurrently (was sequential: 3 round-trips
    // per player, one player at a time). Each player's three writes are
    // independent, so fan them all out with Promise.all.
    const finalScores = new Map<string, number>();
    await Promise.all(
      (scores ?? []).map(async (s) => {
        const uid = s.user_id as string;
        const bonus = calculatePerfectRoundBonus(s.correct_answers ?? 0, room.question_count);
        finalScores.set(uid, (s.total_score ?? 0) + Math.max(0, bonus));
        if (bonus <= 0) return;
        await Promise.all([
          sb
            .from("room_scores")
            .update({ total_score: (s.total_score ?? 0) + bonus })
            .eq("room_id", roomId)
            .eq("user_id", uid),
          // Propagate to global profile + league standings — but never for the
          // CPU/shadow seat (it must stay off global rank + league boards).
          ...(uid === QUIZ_BOT_ID ? [] : [
            sb.rpc("increment_profile_score", { p_user_id: uid, p_points: bonus }),
            sb.rpc("update_league_member_stats", { p_user_id: uid, p_points: bonus, p_is_correct: false }),
          ]),
        ]);
      })
    );

    // Mark room completed
    await sb
      .from("rooms")
      .update({ status: "completed", current_question_idx: nextIdx })
      .eq("id", roomId);

    // Shadow match finished → tell the run's owner (fire-and-forget; never
    // blocks the response). Dedupe by room, opt-in gated by default.
    const shadow = (room.shadow ?? null) as ShadowInfo | null;
    if (shadow?.userId) {
      void (async () => {
        const humanId = room.created_by as string;
        const humanScore = finalScores.get(humanId) ?? 0;
        const shadowScore = finalScores.get(QUIZ_BOT_ID) ?? 0;
        const [{ data: humanProfile }, { data: pack }] = await Promise.all([
          sb.from("profiles").select("display_name").eq("id", humanId).maybeSingle(),
          room.pack_id ? sb.from("quiz_packs").select("name").eq("id", room.pack_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        const humanName = humanProfile?.display_name ?? "Someone";
        const packName = pack?.name ?? "a quiz";
        const beaten = humanScore > shadowScore;
        await notifyUsers({
          userIds: [shadow.userId],
          title: beaten ? "Your run got beaten" : "Your run held them off",
          body: beaten
            ? `${humanName} beat your ${packName} run ${humanScore.toLocaleString()}–${shadowScore.toLocaleString()} — get revenge`
            : `${humanName} couldn't beat your ${packName} run (${shadowScore.toLocaleString()}–${humanScore.toLocaleString()})`,
          url: `/versus/shadow/${humanId}`,
          dedupeKey: `shadow-result:${roomId}`,
        });
      })().catch(() => {});
    }

    return NextResponse.json({ ok: true, done: true });
  }

  // ── Fire next question ───────────────────────────────────────────────────
  const questions = Array.isArray(room.questions_json) ? room.questions_json : [];
  const nextQ = questions[nextIdx] as Record<string, unknown>;
  if (!nextQ) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  const now = new Date();
  const closesAt = new Date(now.getTime() + QUESTION_DURATION_MS);

  const { data: event, error: eventErr } = await sb
    .from("question_events")
    .insert({
      room_id: roomId,
      question_id: nextQ.id as string,
      fired_at: now.toISOString(),
      closes_at: closesAt.toISOString(),
      status: "live",
      sequence_number: nextIdx + 1,
    })
    .select()
    .single();

  if (eventErr) return NextResponse.json({ error: eventErr.message }, { status: 500 });

  await sb
    .from("rooms")
    .update({
      current_question_idx: nextIdx,
      question_started_at: now.toISOString(),
    })
    .eq("id", roomId);

  return NextResponse.json({ ok: true, done: false, eventId: event.id, closesAt: closesAt.toISOString() });
}
