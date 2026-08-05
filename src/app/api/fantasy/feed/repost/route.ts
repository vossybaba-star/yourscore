/** POST/DELETE /api/fantasy/feed/repost — repost (or undo a repost of) a feed
 *  post. Auth + founder gate + rate limit via withFantasyUser, same pattern as
 *  /react. `eventId` is always the CONTENT id — the client never sees a repost
 *  pointer row's own id (see lib/fantasy/feed.ts for why). */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { repostFeedEvent, undoRepost } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-repost", (db, userId) => repostFeedEvent(db, userId, eventId));
}

export async function DELETE(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-repost", (db, userId) => undoRepost(db, userId, eventId));
}
