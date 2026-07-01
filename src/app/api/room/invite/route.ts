import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";

// Invite a specific friend to a live Quiz Battle lobby. Sends a push (opt-in
// gated + deduped) whose link drops them straight into the join flow. The room
// itself is created via /api/room/create first; this only notifies.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { roomId?: string; invitedUserId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { roomId, invitedUserId } = body;
  if (!roomId || !invitedUserId) return NextResponse.json({ error: "roomId and invitedUserId required" }, { status: 400 });
  if (invitedUserId === user.id) return NextResponse.json({ error: "Can't invite yourself" }, { status: 400 });

  const sb = createServiceClient();
  const { data: room } = await sb.from("rooms").select("id, code, room_mode, status, pack_id, created_by").eq("id", roomId).single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.created_by !== user.id) return NextResponse.json({ error: "Not your lobby" }, { status: 403 });

  let packName = "a quiz";
  if (room.pack_id) {
    const { data: pack } = await sb.from("quiz_packs").select("name").eq("id", room.pack_id).single();
    if (pack?.name) packName = pack.name;
  }
  const { data: me } = await sb.from("profiles").select("display_name").eq("id", user.id).single();

  await notifyUsers({
    userIds: [invitedUserId],
    title: "Quiz Battle challenge",
    body: `${me?.display_name ?? "A friend"} wants to play you live on ${packName}`,
    url: `/play?join=${room.code}`,
    dedupeKey: `room-invite:${room.id}:${invitedUserId}`,
  });

  return NextResponse.json({ ok: true });
}
