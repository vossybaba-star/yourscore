import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { TIMEOUT_PENALTY, calculatePerfectRoundBonus } from "@/lib/scoring";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";
import { notifyShadowResult, type ShadowInfo } from "@/lib/versus/shadow";

const QUESTION_DURATION_MS = 20_000;

// How long past closes_at a non-host member must wait before they may advance
// the room. Covers the host backgrounding their phone / refreshing / leaving —
// which used to freeze the game for everyone, forever (question advance lived
// only in a setTimeout on the host's device).
const WATCHDOG_GRACE_MS = 3_000;

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
  if (room.status !== "live") return NextResponse.json({ error: "Lobby not live" }, { status: 409 });

  // Idempotency: only advance if we're still at the expected index
  if (room.current_question_idx !== expectedIdx) {
    return NextResponse.json({ ok: true, skipped: true, currentIdx: room.current_question_idx });
  }

  // ── Find the in-flight question event (overdue check + close + penalties) ──
  const { data: closedEvent } = await sb
    .from("question_events")
    .select("id, closes_at")
    .eq("room_id", roomId)
    .eq("sequence_number", expectedIdx + 1)
    .single();

  // The host advances on schedule. Any OTHER room member is a watchdog: they may
  // advance only once the question is overdue (closes_at + grace), so a vanished
  // host no longer stalls the game — the host gate is an optimisation, not a
  // requirement.
  if (room.created_by !== user.id) {
    const { data: membership } = await sb
      .from("room_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Not in this lobby" }, { status: 403 });
    const overdue = !!closedEvent?.closes_at &&
      Date.now() - new Date(closedEvent.closes_at as string).getTime() > WATCHDOG_GRACE_MS;
    if (!overdue) return NextResponse.json({ error: "Only the host can advance before the question closes" }, { status: 403 });
  }

  const nextIdx = expectedIdx + 1;
  const isDone = nextIdx >= room.question_count;

  // ── Atomic claim ──────────────────────────────────────────────────────────
  // Compare-and-swap on the room's index: of any concurrent advancers (host
  // timer + member watchdogs racing on the same buzzer) exactly one gets the
  // row back; the rest skip. There's no unique index on
  // question_events(room_id, sequence_number), so this CAS is what prevents a
  // double-fired question. It's also the rooms UPDATE clients already listen to.
  const { data: claimed } = await sb
    .from("rooms")
    .update(isDone
      ? { status: "completed", current_question_idx: nextIdx }
      : { current_question_idx: nextIdx, question_started_at: new Date().toISOString() })
    .eq("id", roomId)
    .eq("current_question_idx", expectedIdx)
    .eq("status", "live")
    .select("id");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, currentIdx: nextIdx });
  }

  // Close the finished event (after the claim, so penalties below run once).
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

    // (Room already marked completed by the atomic claim above.)

    // Shadow match finished → tell the run's owner, under the anti-pestering
    // rules (max one push per rolling 24h; absorbed plays aggregate into the
    // next push — see notifyShadowResult). Fire-and-forget; never blocks.
    const shadow = (room.shadow ?? null) as ShadowInfo | null;
    if (shadow?.userId) {
      void (async () => {
        const humanId = room.created_by as string;
        const [{ data: humanProfile }, { data: pack }] = await Promise.all([
          sb.from("profiles").select("display_name").eq("id", humanId).maybeSingle(),
          room.pack_id ? sb.from("quiz_packs").select("name").eq("id", room.pack_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        await notifyShadowResult(sb, {
          roomId,
          shadow,
          humanId,
          humanName: humanProfile?.display_name ?? "Someone",
          packName: pack?.name ?? "a quiz",
          humanScore: finalScores.get(humanId) ?? 0,
          shadowScore: finalScores.get(QUIZ_BOT_ID) ?? 0,
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

  // (Room index + question_started_at already advanced by the atomic claim above;
  // clients get the new question via the question_events INSERT subscription.)
  return NextResponse.json({ ok: true, done: false, eventId: event.id, closesAt: closesAt.toISOString() });
}
