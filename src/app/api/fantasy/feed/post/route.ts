import { withFantasyUser } from "../../_lib";
import { postToFeed, deleteFeedPost } from "@/lib/fantasy/feed";

// POST — create a user post (text and/or poll) in the public feed (Social → Live).
// DELETE — soft-delete your own post (Phase 5a, AC5).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("feed-post", (db, userId) => postToFeed(db, userId, body));
}

export async function DELETE(req: Request) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-post-delete", (db, userId) => deleteFeedPost(db, userId, eventId));
}
