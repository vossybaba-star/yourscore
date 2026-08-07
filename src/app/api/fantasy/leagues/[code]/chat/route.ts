import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { withFantasyUser } from "../../../_lib";
import { HttpError } from "@/lib/fantasy/server";
import { leagueChat, postChat, postGif, postImage, postVideoMessage, setStakes, pinChatMessage, unpinChatMessage } from "@/lib/fantasy/chat";

// League banter. Posting/pinning/etc. stay members-only via withFantasyUser
// (signed-in + on the launch allowlist), and migration 85's RLS guard holds
// the same line against raw REST for those writes.
//
// GET is different (founder, 7 Aug: leagues read as communities — "signed-out
// users can read league chats"): auth is OPTIONAL here, same hand-rolled
// pattern as the league-detail GET (../route.ts) — no fantasyAllowed launch
// gate either, matching that route's existing "link-viewable" precedent.
// leagueChat itself still enforces the real privacy boundary: a genuinely
// PRIVATE league (not club/founder/public) still 403s a non-member, guest or
// signed in — this route only removes the "must be signed in at all" gate,
// it does not touch that per-league membership check.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const gwRaw = req.nextUrl.searchParams.get("gw");
  const gw = gwRaw != null && /^\d+$/.test(gwRaw) ? Number(gwRaw) : null;

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rlKey = user ? `fantasy-league-chat:${user.id}` : `fantasy-league-chat-ip:${ip}`;
  const { ok } = await rateLimitDistributed(rlKey, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const db = createServiceClient();
    const data = await leagueChat(db, user?.id ?? null, params.code, gw);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:league-chat:get]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
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
