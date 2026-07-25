import { withFantasyUser } from "../_lib";
import { getLedger } from "@/lib/fantasy/server";

export const fetchCache = "force-no-store";

/** GET — the manager's own credit/chip/transfer history, derived from entries. */
export async function GET() {
  return withFantasyUser("ledger", (db, userId) => getLedger(db, userId));
}
