import { withFantasyUser } from "../../_lib";
import { postToFeed } from "@/lib/fantasy/feed";

// POST — create a user post (text and/or poll) in the public feed (Social → Live).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("feed-post", (db, userId) => postToFeed(db, userId, body));
}
