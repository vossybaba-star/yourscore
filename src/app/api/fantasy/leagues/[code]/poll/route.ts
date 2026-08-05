import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { postPoll, votePoll } from "@/lib/fantasy/chat";

// POST { question, options[] } — create a poll in the league chat.
// PATCH { commentId, optionIndex } — cast or change a vote.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-poll", (db, userId) =>
    postPoll(db, userId, params.code, body.question, body.options, body.parentId));
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-poll-vote", (db, userId) =>
    votePoll(db, userId, params.code, body.commentId, body.optionIndex));
}
