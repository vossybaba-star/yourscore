import { NextRequest } from "next/server";
import { withFantasyUser } from "../../_lib";
import { searchPublicLeagues } from "@/lib/fantasy/leagues";

// GET — search PUBLIC leagues by name (Social → Discover → Leagues). Member-gated
// + rate-limited via withFantasyUser.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return withFantasyUser("leagues-search", async (_db, userId) => ({
    leagues: await searchPublicLeagues(userId, q),
  }));
}
