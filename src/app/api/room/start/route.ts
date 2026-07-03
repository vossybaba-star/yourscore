import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { shuffle } from "@/lib/utils";
import type { Json } from "@/types/database";

type Difficulty = "easy" | "medium" | "hard";

const QUESTION_DURATION_MS = 20_000;

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { roomId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { roomId } = body;
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });

  const sb = createServiceClient();

  // Fetch room and verify ownership
  const { data: room, error: roomErr } = await sb
    .from("rooms")
    .select("id, status, created_by, question_count, pack_id, category_filter, difficulty_filter, room_mode, shadow, questions_json")
    .eq("id", roomId)
    .single();

  if (roomErr || !room) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
  if (room.created_by !== user.id) return NextResponse.json({ error: "Only host can start" }, { status: 403 });
  if (room.status !== "lobby") return NextResponse.json({ error: "Lobby already started" }, { status: 409 });

  // ── Fetch questions ────────────────────────────────────────────────────────

  let questions: unknown[] = [];

  if (room.shadow && Array.isArray(room.questions_json) && room.questions_json.length > 0) {
    // Shadow Lobby: questions were copied VERBATIM from the source run's room at
    // creation (same questions, same order) so the sequence-based replay is
    // exact. Do NOT reshuffle.
    questions = room.questions_json;

  } else if (room.pack_id) {
    // Pull from quiz_packs.questions JSON array
    const { data: pack, error: packErr } = await sb
      .from("quiz_packs")
      .select("questions")
      .eq("id", room.pack_id)
      .single();

    if (packErr || !pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });

    const qs = Array.isArray(pack.questions) ? pack.questions : [];
    questions = shuffle(qs).slice(0, room.question_count);

  } else if (room.category_filter) {
    // Pull from questions bank
    const difficultyFilter = room.difficulty_filter as string;
    const entity = room.category_filter as string;

    const fetchByDifficulty = async (diff: Difficulty, limit: number) => {
      const { data } = await sb
        .from("questions")
        .select("id, question, options, answer, difficulty, category")
        .eq("status", "active")
        .eq("entity", entity)
        .eq("difficulty", diff)
        .limit(limit * 3);
      return shuffle(data ?? []).slice(0, limit);
    };

    if (difficultyFilter === "mixed") {
      const perDiff = Math.ceil(room.question_count / 3);
      const [easy, medium, hard] = await Promise.all([
        fetchByDifficulty("easy",   perDiff),
        fetchByDifficulty("medium", perDiff),
        fetchByDifficulty("hard",   Math.max(1, room.question_count - 2 * perDiff)),
      ]);
      questions = shuffle([...easy, ...medium, ...hard]).slice(0, room.question_count);
    } else {
      questions = await fetchByDifficulty(difficultyFilter as Difficulty, room.question_count);
    }

    if (questions.length < 3)
      return NextResponse.json({ error: "Not enough questions for this filter. Try a broader category or difficulty." }, { status: 422 });
  } else {
    return NextResponse.json({ error: "Lobby has no question source configured" }, { status: 400 });
  }

  // ── Persist question list + set room live ──────────────────────────────────

  const now = new Date();
  const closesAt = new Date(now.getTime() + QUESTION_DURATION_MS);

  // Update room: store questions, mark live, set first question pointer
  const { error: updateErr } = await sb
    .from("rooms")
    .update({
      questions_json: questions as unknown as Json,
      status: "live",
      current_question_idx: 0,
      question_started_at: now.toISOString(),
    })
    .eq("id", roomId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Fire first question_event
  const firstQ = questions[0] as Record<string, unknown>;
  const { data: event, error: eventErr } = await sb
    .from("question_events")
    .insert({
      room_id: roomId,
      question_id: firstQ.id as string,
      fired_at: now.toISOString(),
      closes_at: closesAt.toISOString(),
      status: "live",
      sequence_number: 1,
    })
    .select()
    .single();

  if (eventErr) return NextResponse.json({ error: eventErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, eventId: event.id, closesAt: closesAt.toISOString() });
}
