import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { leagueFeed } from "@/lib/fantasy/chat";

// The league's own activity feed — member moves (squads, transfers, captains,
// hauls) filtered to this league. Members only; the same RLS guard as the chat.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const limRaw = req.nextUrl.searchParams.get("limit");
  const limit = limRaw && /^\d+$/.test(limRaw) ? Math.min(40, Number(limRaw)) : 20;
  return withFantasyUser("league-feed", (db, userId) => leagueFeed(db, userId, params.code, limit));
}
