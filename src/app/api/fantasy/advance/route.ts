import { advanceGw } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST() {
  return withFantasyUser("advance", (db, userId) => advanceGw(db, userId));
}
