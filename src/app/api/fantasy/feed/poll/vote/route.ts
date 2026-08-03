import { withFantasyUser } from "../../../_lib";
import { voteFeedPoll } from "@/lib/fantasy/feed";

// POST { eventId, optionIndex } — vote on a post's poll (one choice per user).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const b = body as { eventId?: unknown; optionIndex?: unknown };
  return withFantasyUser("feed-poll-vote", (db, userId) => voteFeedPoll(db, userId, b.eventId, b.optionIndex));
}
