import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { TIMEOUT_PENALTY, calculatePerfectRoundBonus } from "@/lib/scoring";

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
    .select("id, status, created_by, question_count, questions_json, current_question_idx")
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
      // Fetch their current scores, then deduct penalty (floor at 0)
      const { data: scoreRows } = await sb
        .from("room_scores")
        .select("user_id, total_score")
        .eq("room_id", roomId)
        .in("user_id", unanswered);

      const scoreMap: Record<string, number> = {};
      (scoreRows ?? []).forEach((s) => { scoreMap[s.user_id as string] = s.total_score ?? 0; });

      for (const uid of unanswered) {
        const cur = scoreMap[uid] ?? 0;
        const newScore = Math.max(0, cur + TIMEOUT_PENALTY);
        await sb.from("room_scores").upsert(
          { room_id: roomId, user_id: uid, total_score: newScore },
          { onConflict: "room_id,user_id" }
        );
      }
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

    for (const s of (scores ?? [])) {
      const bonus = calculatePerfectRoundBonus(s.correct_answers ?? 0, room.question_count);
      if (bonus > 0) {
        await sb
          .from("room_scores")
          .update({ total_score: (s.total_score ?? 0) + bonus })
          .eq("room_id", roomId)
          .eq("user_id", s.user_id as string);
        // Propagate to global profile
        await sb.rpc("increment_profile_score", { p_user_id: s.user_id as string, p_points: bonus });
        await sb.rpc("update_league_member_stats", { p_user_id: s.user_id as string, p_points: bonus, p_is_correct: false });
      }
    }

    // Mark room completed
    await sb
      .from("rooms")
      .update({ status: "completed", current_question_idx: nextIdx })
      .eq("id", roomId);

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
