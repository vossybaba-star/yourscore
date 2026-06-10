import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/friends?with=<userId>
 * Returns the friendship status between the current user and <userId>.
 * Status values: "none" | "pending_sent" | "pending_received" | "friends" | "unauthenticated"
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ status: "unauthenticated" });

  const otherId = req.nextUrl.searchParams.get("with");
  if (!otherId) return NextResponse.json({ error: "Missing 'with' param" }, { status: 400 });
  if (otherId === user.id) return NextResponse.json({ status: "friends" }); // same user

  const { data } = await supabase
    .from("friendships")
    .select("status, user_id")
    .or(`and(user_id.eq.${user.id},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${user.id})`)
    .maybeSingle();

  if (!data) return NextResponse.json({ status: "none" });
  if (data.status === "accepted") return NextResponse.json({ status: "friends" });
  if (data.user_id === user.id) return NextResponse.json({ status: "pending_sent" });
  return NextResponse.json({ status: "pending_received" });
}

/**
 * POST /api/friends  body: { friendId: string }
 * Sends a friend request. Deduplication:
 *  - already friends → "already_friends"
 *  - already sent    → "already_sent" (idempotent)
 *  - they sent us one first → auto-accepts it, returns "now_friends"
 *  - fresh           → inserts "pending", returns "sent"
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, string>;
  const { friendId } = body;
  if (!friendId || friendId === user.id) {
    return NextResponse.json({ error: "Invalid friendId" }, { status: 400 });
  }

  // Check existing relationship in either direction
  const { data: existing } = await supabase
    .from("friendships")
    .select("id, status, user_id")
    .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") return NextResponse.json({ status: "already_friends" });
    if (existing.user_id === user.id) return NextResponse.json({ status: "already_sent" });
    // They sent us a request first → accept it
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", existing.id!);
    return NextResponse.json({ status: "now_friends" });
  }

  const { error } = await supabase.from("friendships").insert({
    user_id: user.id,
    friend_id: friendId,
    status: "pending",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "sent" });
}
