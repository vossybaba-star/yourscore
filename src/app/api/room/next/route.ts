/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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
  const { data: room, error: roomErr } = await (sb as any)
    .from("rooms")
    .select("id, status, created_by, question_count, questions_json, current_question_idx")
    .eq("id", roomId)
    .single();

  if (roomErr || !room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.created_by !== user.id) return NextResponse.json({ error: "Only host can advance" }, { status: 403 });
  if (room.status !== "live") return NextResponse.json({ error: "Room not live" }, { status: 409 });

  // Idempotency: only advance if we're still at the expected index
  if (room.current_question_idx !== expectedIdx) {
    return NextResponse.json({ ok: true, skipped: true, currentIdx: room.current_question_idx });
  }

  // Close current question_event
  await (sb as any)
    .from("question_events")
    .update({ status: "closed" })
    .eq("room_id", roomId)
    .eq("sequence_number", expectedIdx + 1);

  const nextIdx = expectedIdx + 1;
  const isDone = nextIdx >= room.question_count;

  if (isDone) {
    // Game over
    await (sb as any)
      .from("rooms")
      .update({ status: "completed", current_question_idx: nextIdx })
      .eq("id", roomId);
    return NextResponse.json({ ok: true, done: true });
  }

  // Fire next question
  const questions = Array.isArray(room.questions_json) ? room.questions_json : [];
  const nextQ = questions[nextIdx] as Record<string, unknown>;
  if (!nextQ) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  const now = new Date();
  const closesAt = new Date(now.getTime() + QUESTION_DURATION_MS);

  const { data: event, error: eventErr } = await (sb as any)
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

  await (sb as any)
    .from("rooms")
    .update({
      current_question_idx: nextIdx,
      question_started_at: now.toISOString(),
    })
    .eq("id", roomId);

  return NextResponse.json({ ok: true, done: false, eventId: event.id, closesAt: closesAt.toISOString() });
}
