/** POST/DELETE /api/fantasy/feed/pin — pin (or unpin) a post on YOUR OWN
 *  profile (Social Phase 3b, AC7). Auth + rate limit via withFantasyUser;
 *  pinPost itself checks that the event belongs to the caller (403 otherwise). */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { pinPost, unpinPost } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { eventId } = await req.json().catch(() => ({}));
  if (!eventId) return Response.json({ error: "Missing eventId" }, { status: 400 });
  return withFantasyUser("feed-pin", (db, userId) => pinPost(db, userId, eventId));
}

export async function DELETE() {
  return withFantasyUser("feed-pin", (db, userId) => unpinPost(db, userId));
}
