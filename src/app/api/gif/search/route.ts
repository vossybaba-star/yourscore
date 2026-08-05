import { NextRequest, NextResponse } from "next/server";
import { klipyFetch, GifUnavailableError } from "@/lib/gif";

// GET /api/gif/search?q=... — proxies Klipy's GIF search so KLIPY_API_KEY never
// reaches the client. Missing key -> 503 gif-unavailable (GifPicker's key-missing
// state); any other provider failure -> 502 so the client can tell that apart
// from a genuine "no results".
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ gifs: [] }, { headers: { "Cache-Control": "s-maxage=300" } });

  try {
    const { gifs } = await klipyFetch(`search?q=${encodeURIComponent(q)}&per_page=24`);
    return NextResponse.json({ gifs }, { headers: { "Cache-Control": "s-maxage=300" } });
  } catch (e) {
    if (e instanceof GifUnavailableError) return NextResponse.json({ error: "gif-unavailable" }, { status: 503 });
    console.error("[gif:search] failed:", e);
    return NextResponse.json({ error: "gif-provider-error" }, { status: 502 });
  }
}
