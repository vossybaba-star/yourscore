import { recentForm } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

// Depends on how far THIS user's season has progressed, so it's per-user and
// must never be cached (see CLAUDE.md: service-role GETs get pinned forever).
export const fetchCache = "force-no-store";

export async function GET() {
  return withFantasyUser("form", (db, userId) => recentForm(db, userId));
}
