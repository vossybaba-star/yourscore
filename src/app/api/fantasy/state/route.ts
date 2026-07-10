import { getState } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

export async function GET() {
  return withFantasyUser("state", (db, userId) => getState(db, userId));
}
