import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { leagueChat, postChat, setStakes } from "@/lib/fantasy/chat";

// League banter. Members only — the gate lives in chat.ts, and migration 85's
// RLS guard holds the same line against raw REST. GET = messages + the week's
// auto-moments; POST = say something; PATCH = owner sets the stakes line.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("league-chat", (db, userId) => leagueChat(db, userId, params.code));
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-chat-post", (db, userId) => postChat(db, userId, params.code, body.body));
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-stakes", (db, userId) => setStakes(db, userId, params.code, body.stakes));
}
