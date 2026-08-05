import { withFantasyUser } from "../../_lib";
import { loadCurrentGwFixtures } from "@/lib/fantasy/fixtureList";

// GET — the current gameweek's fixtures, for the Social composer's Fixture
// picker. Same auth as the other fantasy routes (signed-in): the underlying
// fetch hits SportMonks (cached 5 min server-side), so this stays behind the
// rate limiter rather than open to anonymous callers.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  return withFantasyUser("fixtures-current", async (db) => ({ fixtures: await loadCurrentGwFixtures(db) }));
}
