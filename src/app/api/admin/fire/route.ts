import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";

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

  // Player notifications are delivered via the send-push edge function
  // (WhatsApp API notifications were discontinued — see YOURSCORE.md).
  return NextResponse.json({ eventId: data.id, closesAt: closesAt.toISOString() });
}
