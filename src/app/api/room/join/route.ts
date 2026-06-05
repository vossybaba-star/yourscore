import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const MODE_LIMITS: Record<string, number> = { h2h: 2, group: 8, open: 20 };

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { code?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const code = body.code?.trim().toUpperCase();
  if (!code || code.length < 4)
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const sb = createServiceClient();

  // Find the room
  const { data: room, error: roomErr } = await sb
    .from("rooms")
    .select("id, status, room_mode, max_players, current_question_idx")
    .eq("code", code)
    .eq("type", "player")
    .maybeSingle();

  if (roomErr) return NextResponse.json({ error: roomErr.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: "Lobby not found" }, { status: 404 });
  if (room.status !== "lobby")
    return NextResponse.json({ error: "Game already started" }, { status: 409 });

  // Check capacity
  const { count } = await sb
    .from("room_members")
    .select("*", { count: "exact", head: true })
    .eq("room_id", room.id);

  const maxPlayers = room.max_players ?? MODE_LIMITS[room.room_mode ?? "group"] ?? 8;
  if ((count ?? 0) >= maxPlayers)
    return NextResponse.json({ error: "Lobby is full" }, { status: 409 });

  // Upsert membership (idempotent)
  const { error: memberErr } = await sb
    .from("room_members")
    .upsert({ room_id: room.id, user_id: user.id }, { onConflict: "room_id,user_id" });

  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  // Return full room for redirect
  const { data: fullRoom } = await sb
    .from("rooms")
    .select("*")
    .eq("id", room.id)
    .single();

  return NextResponse.json({ room: fullRoom });
}
