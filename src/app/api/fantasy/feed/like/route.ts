/** POST/DELETE /api/fantasy/feed/like — the "like this move" heart on a feed
 *  event. Auth + founder gate + rate limit via withFantasyUser; the like row is
 *  keyed (event_id, user_id) so it's idempotent. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-like", async (db, userId) => {
    await db.from("fantasy_feed_likes")
      .upsert({ event_id: eventId, user_id: userId }, { onConflict: "event_id,user_id" });
    return { liked: true };
  });
}

export async function DELETE(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-like", async (db, userId) => {
    await db.from("fantasy_feed_likes").delete().eq("event_id", eventId).eq("user_id", userId);
    return { liked: false };
  });
}
