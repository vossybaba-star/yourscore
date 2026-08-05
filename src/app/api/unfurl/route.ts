import { withFantasyUser } from "../fantasy/_lib";
import { unfurlUrl, UnfurlBlockedError } from "@/lib/unfurl";
import { HttpError } from "@/lib/fantasy/server";

// POST {url} — fetch (or serve cached) og:title/description/image for a link,
// so the Social composer can show a preview card before posting. Signed-in
// only (withFantasyUser) — without that gate this is an open URL-fetch proxy.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const url = typeof (body as { url?: unknown }).url === "string" ? (body as { url: string }).url : "";
  return withFantasyUser("unfurl", async (db) => {
    if (!url) throw new HttpError(400, "Missing url");
    try {
      return await unfurlUrl(db, url);
    } catch (e) {
      if (e instanceof UnfurlBlockedError) throw new HttpError(400, e.message);
      throw e;
    }
  });
}
