import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";
import { sendQuestionAlert } from "@/lib/whatsapp";

export async function POST(request: NextRequest) {
  // Admin-only — service client below bypasses RLS
  const denied = await requireAdmin();
  if (denied) return denied;

  const db = createServiceClient();

  const { questionId, roomId, matchId, durationSeconds = 45 } = await request.json();
  if (!questionId || (!roomId && !matchId)) {
    return NextResponse.json({ error: "Missing fields: need questionId + (roomId or matchId)" }, { status: 400 });
  }

  const now = new Date();
  const closesAt = new Date(now.getTime() + durationSeconds * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;
  const { data, error } = await anyDb
    .from("question_events")
    .insert({
      question_id: questionId,
      room_id: roomId ?? null,
      match_id: matchId ?? null,
      fired_at: now.toISOString(),
      closes_at: closesAt.toISOString(),
      status: "live",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (roomId) {
    await anyDb.from("rooms").update({ status: "live" }).eq("id", roomId).eq("status", "lobby");
  }

  if (matchId) {
    await anyDb.from("matches").update({ status: "live" }).eq("id", matchId).eq("status", "upcoming");
  }

  // Send WhatsApp notifications — fire and forget
  sendNotifications(db, roomId ?? null, matchId ?? null, questionId, durationSeconds).catch(console.error);

  return NextResponse.json({ eventId: data.id, closesAt: closesAt.toISOString() });
}

async function sendNotifications(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  roomId: string | null,
  matchId: string | null,
  questionId: string,
  durationSeconds: number
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3003";

  const [{ data: question }] = await Promise.all([
    supabase.from("questions").select("question").eq("id", questionId).single(),
  ]);

  if (!question) return;

  if (roomId) {
    const [{ data: room }, { data: members }] = await Promise.all([
      supabase.from("rooms").select("name").eq("id", roomId).single(),
      supabase
        .from("room_members")
        .select("whatsapp_number")
        .eq("room_id", roomId)
        .eq("notification_consent", true)
        .not("whatsapp_number", "is", null),
    ]);

    if (!room || !members?.length) return;

    const payload = {
      roomName: room.name,
      questionText: question.question,
      durationSeconds,
      roomUrl: `${appUrl}/room/${roomId}`,
    };

    for (const member of members) {
      await sendQuestionAlert(member.whatsapp_number, payload);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  if (matchId) {
    const { data: match } = await supabase
      .from("matches")
      .select("home_team, away_team")
      .eq("id", matchId)
      .single();

    if (!match) return;

    const payload = {
      roomName: `${match.home_team} vs ${match.away_team}`,
      questionText: question.question,
      durationSeconds,
      roomUrl: `${appUrl}/match/${matchId}`,
    };

    // Get any room members opted-in for rooms tied to this match
    const { data: members } = await supabase
      .from("room_members")
      .select("whatsapp_number, rooms!inner(match_id)")
      .eq("rooms.match_id", matchId)
      .eq("notification_consent", true)
      .not("whatsapp_number", "is", null);

    if (!members?.length) return;

    for (const member of members) {
      await sendQuestionAlert(member.whatsapp_number, payload);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
