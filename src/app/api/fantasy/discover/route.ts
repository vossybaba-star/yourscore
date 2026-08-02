import { withFantasyUser } from "../_lib";
import { fantasyDiscover } from "@/lib/fantasy/discover";

// Managers to follow, with reasons + their squads. Member-gated.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  return withFantasyUser("discover", async (db, userId) => ({ managers: await fantasyDiscover(db, userId) }));
}
