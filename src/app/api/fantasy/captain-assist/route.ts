import { getCaptainAssist } from "@/lib/fantasy/captainAssist";
import { withFantasyUser } from "../_lib";

/** Service-role reads in a route handler get pinned by Vercel's data cache
 *  forever (constant cache key), which would serve yesterday's injury news. */
export const fetchCache = "force-no-store";

/** Read-only. Returns { enabled: false } when the flag is off, so the client can
 *  render nothing without needing to know the flag itself. Never mutates the
 *  squad — applying a recommendation goes through the existing selection route,
 *  behind an explicit confirmation. */
export async function GET() {
  return withFantasyUser("captain-assist", (db, userId) => getCaptainAssist(db, userId));
}

/** The shared client helper POSTs any path not listed in its GET set. Exposing
 *  POST as an alias keeps this endpoint usable from it without editing that
 *  shared list — same read-only handler either way. */
export async function POST() {
  return withFantasyUser("captain-assist", (db, userId) => getCaptainAssist(db, userId));
}
