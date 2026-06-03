/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const MODE_LIMITS: Record<string, number> = { h2h: 2, group: 8, open: 20 };
const VALID_MODES = ["h2h", "group", "open"];
const VALID_COUNTS = [5, 10, 20];
const VALID_DIFFICULTIES = ["easy", "medium", "hard", "mixed"];

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/1/I
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    room_mode?: string;
    question_count?: number;
    pack_id?: string | null;
    category_filter?: string | null;
    difficulty_filter?: string;
    name?: string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    room_mode = "group",
    question_count = 10,
    pack_id = null,
    category_filter = null,
    difficulty_filter = "mixed",
    name,
  } = body;

  if (!VALID_MODES.includes(room_mode))
    return NextResponse.json({ error: "Invalid room_mode" }, { status: 400 });
  if (!VALID_COUNTS.includes(question_count))
    return NextResponse.json({ error: "question_count must be 5, 10, or 20" }, { status: 400 });
  if (!VALID_DIFFICULTIES.includes(difficulty_filter))
    return NextResponse.json({ error: "Invalid difficulty_filter" }, { status: 400 });
  if (!pack_id && !category_filter)
    return NextResponse.json({ error: "pack_id or category_filter required" }, { status: 400 });

  const sb = createServiceClient();

  // Fetch display_name for the room name default
  const { data: profile } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const roomName = name?.trim() ||
    (profile?.display_name ? `${profile.display_name}'s Game` : "Game Room");

  // Generate a unique code (retry up to 5x)
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode();
    const { data: existing } = await sb
      .from("rooms")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) { code = candidate; break; }
  }
  if (!code) return NextResponse.json({ error: "Could not generate unique code" }, { status: 500 });

  // Create the room
  const { data: room, error: roomErr } = await (sb as any)
    .from("rooms")
    .insert({
      code,
      name: roomName,
      type: "player",
      status: "lobby",
      created_by: user.id,
      max_players: MODE_LIMITS[room_mode],
      room_mode,
      question_count,
      pack_id,
      category_filter,
      difficulty_filter,
      current_question_idx: 0,
    })
    .select()
    .single();

  if (roomErr) return NextResponse.json({ error: roomErr.message }, { status: 500 });

  // Add host as first member
  const { error: memberErr } = await sb
    .from("room_members")
    .insert({ room_id: room.id, user_id: user.id });
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  return NextResponse.json({ room });
}
