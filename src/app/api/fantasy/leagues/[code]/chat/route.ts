import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { leagueChat, postChat, postGif, postImage, postVideoMessage, setStakes, pinChatMessage, unpinChatMessage } from "@/lib/fantasy/chat";

// League banter. Members only — the gate lives in chat.ts, and migration 85's
// RLS guard holds the same line against raw REST. GET = messages + the week's
// auto-moments; POST = say something (text/gif/image), each may carry a
// `parentId` to thread it as a reply (Phase 4a, AC2); PATCH = owner sets the
// stakes line, or pins/unpins a message (Phase 4a, AC6).
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
    return withFantasyUser("league-chat-gif", (db, userId) => postGif(db, userId, params.code, body.gif, body.parentId));
  }
  if (body?.kind === "image") {
    return withFantasyUser("league-chat-image", (db, userId) => postImage(db, userId, params.code, body.image, body.parentId));
  }
  if (body?.kind === "video") {
    return withFantasyUser("league-chat-video", (db, userId) => postVideoMessage(db, userId, params.code, body.video, body.parentId));
  }
  return withFantasyUser("league-chat-post", (db, userId) => postChat(db, userId, params.code, body.body, body.parentId, body.mentions));
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  if (body?.kind === "pin") {
    return withFantasyUser("league-chat-pin", (db, userId) => pinChatMessage(db, userId, params.code, body.commentId));
  }
  if (body?.kind === "unpin") {
    return withFantasyUser("league-chat-unpin", (db, userId) => unpinChatMessage(db, userId, params.code));
  }
  return withFantasyUser("league-stakes", (db, userId) => setStakes(db, userId, params.code, body.stakes));
}
