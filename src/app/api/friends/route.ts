import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { sendFriendAcceptedEmail, sendFriendRequestEmail } from "@/lib/email/senders";
// Vercel data cache pins service-role GETs (constant cache key) — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

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

/** Display name of a user, for email copy. */
async function displayNameOf(userId: string): Promise<string> {
  const svc = createServiceClient();
  const { data } = await svc.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return data?.display_name ?? "A YourScore player";
}

/** Email address of a user (service role — auth admin). */
async function emailOf(userId: string): Promise<string | null> {
  const svc = createServiceClient();
  const { data } = await svc.auth.admin.getUserById(userId).catch(() => ({ data: null }));
  return data?.user?.email ?? null;
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

  // Friend requests fire notification emails — rate-limit to stop blast abuse.
  const { ok } = await rateLimitDistributed(`friends:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

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

    // Lifecycle 21: tell the original requester their request was accepted.
    void (async () => {
      const [requesterEmail, accepterName] = await Promise.all([
        emailOf(existing.user_id),
        displayNameOf(user.id),
      ]);
      if (!requesterEmail) return;
      await sendFriendAcceptedEmail({
        requesterUserId: existing.user_id,
        requesterEmail,
        friendUserId: user.id,
        friendName: accepterName,
      });
    })().catch(() => {});

    return NextResponse.json({ status: "now_friends" });
  }

  const { error } = await supabase.from("friendships").insert({
    user_id: user.id,
    friend_id: friendId,
    status: "pending",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Lifecycle 20: tell the recipient they have a request waiting.
  void (async () => {
    const [recipientEmail, requesterName] = await Promise.all([
      emailOf(friendId),
      displayNameOf(user.id),
    ]);
    if (!recipientEmail) return;
    await sendFriendRequestEmail({
      recipientUserId: friendId,
      recipientEmail,
      requesterUserId: user.id,
      requesterName,
    });
  })().catch(() => {});

  return NextResponse.json({ status: "sent" });
}
