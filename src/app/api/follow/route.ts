/** /api/follow — the one-way follow layer, app-wide.
 *
 *  GET  ?with=<userId>  → { following, followsYou, followers, followingCount }
 *  POST { userId }      → follow that user (idempotent)
 *  DELETE { userId }    → unfollow
 *
 *  Reads/writes run under the caller's session + RLS (see mig 225): you may only
 *  create/remove your own follows; the graph itself is public. Guests get a
 *  logged-out shape rather than an error, so a Follow button can render for
 *  everyone and bounce to sign-in on tap. */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyFantasy } from "@/lib/fantasy/notify";

export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const target = new URL(req.url).searchParams.get("with");
  if (!target) return NextResponse.json({ error: "Missing 'with' param" }, { status: 400 });

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  // user_follows post-dates the generated Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const follows = () => (db as any).from("user_follows");

  // Counts are public and always available.
  const [{ count: followers }, { count: followingCount }] = await Promise.all([
    follows().select("*", { count: "exact", head: true }).eq("followee_id", target),
    follows().select("*", { count: "exact", head: true }).eq("follower_id", target),
  ]);

  if (!user || user.id === target) {
    return NextResponse.json({
      following: false, followsYou: false,
      followers: followers ?? 0, followingCount: followingCount ?? 0,
      self: user?.id === target,
    });
  }

  const [{ data: iFollow }, { data: theyFollow }] = await Promise.all([
    follows().select("follower_id").eq("follower_id", user.id).eq("followee_id", target).maybeSingle(),
    follows().select("follower_id").eq("follower_id", target).eq("followee_id", user.id).maybeSingle(),
  ]);

  return NextResponse.json({
    following: !!iFollow, followsYou: !!theyFollow,
    followers: followers ?? 0, followingCount: followingCount ?? 0, self: false,
  });
}

export async function POST(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.id === userId) return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });

  // Idempotent: a repeat follow is a no-op, not an error.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("user_follows")
    .upsert({ follower_id: user.id, followee_id: userId }, { onConflict: "follower_id,followee_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "You gained a follower" — gated + deduped per pair inside notifyFantasy, so a
  // repeat follow never re-pings. Fire-and-forget; never blocks the follow.
  void (async () => {
    const { data: prof } = await db.from("profiles").select("display_name, username").eq("id", user.id).maybeSingle();
    const who = prof?.display_name ?? (prof?.username ? `@${prof.username}` : "A manager");
    await notifyFantasy({
      userIds: [userId],
      title: `${who} started following you`,
      body: "They'll see your fantasy moves in their feed.",
      url: `/profile/${user.id}`,
      dedupeKey: `fantasy-follow:${user.id}:${userId}`,
      type: "fantasy_follow",
      actorId: user.id,
    });
  })();

  return NextResponse.json({ following: true });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("user_follows")
    .delete().eq("follower_id", user.id).eq("followee_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ following: false });
}
