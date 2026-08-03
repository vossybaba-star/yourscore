import { NextRequest } from "next/server";
import { withSignedInUser } from "../_lib";
import { HttpError } from "@/lib/fantasy/server";

/**
 * GIF search proxy for the league-chat picker (founder, 3 Aug). Fronts Tenor v2
 * so the API key stays server-side and every request is content-filtered. Empty
 * query returns Tenor's "featured" (trending) set; a query searches.
 *
 * Needs TENOR_API_KEY in the environment. Without it the route throws 503, and
 * the picker shows a friendly "GIFs aren't switched on yet" state rather than
 * breaking — so the plumbing can ship before the key is set.
 *
 * The handler returns PLAIN DATA and signals failures with HttpError: the
 * withSignedInUser wrapper serialises the return value and maps HttpError to a
 * status code (returning a NextResponse here would be double-wrapped to `{}`).
 *
 * Signed-in only: the proxy isn't an open relay to Tenor.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const LIMIT = 24;

interface TenorResult {
  id: string;
  media_formats?: Record<string, { url?: string; dims?: number[] }>;
}

export async function GET(req: NextRequest) {
  return withSignedInUser("fantasy-gif-search", async () => {
    const key = process.env.TENOR_API_KEY;
    if (!key) throw new HttpError(503, "gifs_unavailable");

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    const pos = (req.nextUrl.searchParams.get("pos") ?? "").slice(0, 64);

    const base = q ? "https://tenor.googleapis.com/v2/search" : "https://tenor.googleapis.com/v2/featured";
    const url = new URL(base);
    url.searchParams.set("key", key);
    url.searchParams.set("client_key", "yourscore-fantasy");
    url.searchParams.set("limit", String(LIMIT));
    // gif = the full media we post; tinygif = the light preview in the grid.
    url.searchParams.set("media_filter", "gif,tinygif");
    url.searchParams.set("contentfilter", "high"); // strictest safe filter — keep the league clean
    if (q) url.searchParams.set("q", q);
    if (pos) url.searchParams.set("pos", pos);

    let data: { results?: TenorResult[]; next?: string };
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new HttpError(502, "gif_provider_error");
      data = await res.json();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, "gif_provider_error");
    }

    const results = (data.results ?? [])
      .map((r) => {
        const full = r.media_formats?.gif;
        const tiny = r.media_formats?.tinygif ?? full;
        if (!full?.url || !tiny?.url) return null;
        const [w = 0, h = 0] = full.dims ?? [];
        return { id: r.id, url: full.url, preview: tiny.url, width: w, height: h };
      })
      .filter((x): x is { id: string; url: string; preview: string; width: number; height: number } => !!x);

    return { results, next: data.next ?? null };
  });
}
