import { wildcardValue } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

// What a wildcard would be worth if you played it today. A read, no writes —
// it never plays the chip, it only prices it.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

export async function GET() {
  return withFantasyUser("wildcard-value", (db, userId) => wildcardValue(db, userId));
}
