import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { sharePlayerToLeague } from "@/lib/fantasy/chat";

// POST { playerId, note? } — share a player card into the league chat. Called
// from a player's profile (share-from-source; no separate share destination).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-share", (db, userId) =>
    sharePlayerToLeague(db, userId, params.code, body.playerId, body.note));
}
