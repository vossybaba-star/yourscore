import { startRound } from "@/lib/fantasy/server";
import { withFantasyUser } from "../../_lib";

export const fetchCache = "force-no-store";

export async function POST() {
  return withFantasyUser("round", (db, userId) => startRound(db, userId));
}
