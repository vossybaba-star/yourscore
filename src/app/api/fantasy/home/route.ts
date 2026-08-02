import { withFantasyUser } from "../_lib";
import { fantasyHome } from "@/lib/fantasy/home";

// The Fantasy tab's feed-first landing: the "You" strip + the social feed, in one
// call. Member/allowlist-gated like the rest of the fantasy API.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  return withFantasyUser("home", (db, userId) => fantasyHome(db, userId));
}
