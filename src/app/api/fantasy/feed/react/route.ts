/** POST/DELETE /api/fantasy/feed/react — emoji reactions on a feed event. One
 *  reaction per user per event (PK is (event_id, user_id)): POST upserts the
 *  chosen emoji (changing it if they'd already reacted), DELETE clears it. Auth +
 *  founder gate + rate limit via withFantasyUser. Replaces the single-heart like. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { FEED_REACTIONS } from "@/lib/fantasy/feed";
import { recordFeedReaction, removeFeedReaction } from "@/lib/engagement";

export const fetchCache = "force-no-store";

const ALLOWED = new Set<string>(FEED_REACTIONS);

export async function POST(req: NextRequest) {
  const { eventId, emoji } = await req.json().catch(() => ({}));
  if (!eventId || typeof emoji !== "string" || !ALLOWED.has(emoji)) {
    return Response.json({ error: "Bad reaction" }, { status: 400 });
  }
  return withFantasyUser("feed-react", async (db, userId) => {
    await db.from("fantasy_feed_likes")
      .upsert({ event_id: eventId, user_id: userId, emoji }, { onConflict: "event_id,user_id" });
    // Notify the post's author (inbox + email fallback for non-app users). Never
    // fails the reaction — recordFeedReaction resolves the author and skips self.
    await recordFeedReaction({ eventId, actorId: userId, emoji });
    return { reacted: emoji };
  });
}

export async function DELETE(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-react", async (db, userId) => {
    await db.from("fantasy_feed_likes").delete().eq("event_id", eventId).eq("user_id", userId);
    await removeFeedReaction({ eventId });
    return { reacted: null };
  });
}
