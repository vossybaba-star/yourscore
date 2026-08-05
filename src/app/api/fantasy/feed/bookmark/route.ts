/** POST/DELETE /api/fantasy/feed/bookmark — save (or unsave) a feed post
 *  (Social Phase 3b, AC2). Auth + rate limit via withFantasyUser, same
 *  pattern as /repost and /react. `eventId` may be a repost pointer row's id
 *  or the original's — bookmarkFeedEvent/unbookmarkFeedEvent both resolve to
 *  the original before writing. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { bookmarkFeedEvent, unbookmarkFeedEvent } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-bookmark", (db, userId) => bookmarkFeedEvent(db, userId, eventId));
}

export async function DELETE(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-bookmark", (db, userId) => unbookmarkFeedEvent(db, userId, eventId));
}
