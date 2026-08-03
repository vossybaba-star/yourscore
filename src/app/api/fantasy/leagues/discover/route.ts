import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverLeagues } from "@/lib/fantasy/leagues";

// Social → Discover → Leagues. PUBLIC to view (Social is open, founder 3 Aug):
// the mixed cross-fan leagues + Founder League, every club's fan league, and
// managers' public leagues. Signed-out gets the same lists with nothing marked
// as theirs. Contributing still needs an account (and, for a club league, being
// that club's fan) — enforced when they actually post/join.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const groups = await discoverLeagues(user?.id ?? null);
  return NextResponse.json(groups);
}
