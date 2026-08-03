import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { leagueChat, postChat, postGif, setStakes } from "@/lib/fantasy/chat";

// League banter. Members only — the gate lives in chat.ts, and migration 85's
// RLS guard holds the same line against raw REST. GET = messages + the week's
// auto-moments; POST = say something; PATCH = owner sets the stakes line.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const gwRaw = req.nextUrl.searchParams.get("gw");
  const gw = gwRaw != null && /^\d+$/.test(gwRaw) ? Number(gwRaw) : null;
  return withFantasyUser("league-chat", (db, userId) => leagueChat(db, userId, params.code, gw));
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  if (body?.kind === "gif") {
    return withFantasyUser("league-chat-gif", (db, userId) => postGif(db, userId, params.code, body.gif));
  }
  return withFantasyUser("league-chat-post", (db, userId) => postChat(db, userId, params.code, body.body));
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-stakes", (db, userId) => setStakes(db, userId, params.code, body.stakes));
}
