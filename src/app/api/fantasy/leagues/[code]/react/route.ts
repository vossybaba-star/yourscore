import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { reactChat } from "@/lib/fantasy/chat";

// POST { commentId, emoji, on } — toggle an emoji reaction on a league message.
// Member-gated in the lib; the comment_reactions RLS backs it on raw REST.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-react", (db, userId) =>
    reactChat(db, userId, params.code, body.commentId, body.emoji, body.on !== false));
}
