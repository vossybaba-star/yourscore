import { lockAndScore } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST() {
  return withFantasyUser("lock", (db, userId) => lockAndScore(db, userId));
}
