import { getState } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function GET() {
  return withFantasyUser("state", (db, userId) => getState(db, userId));
}
