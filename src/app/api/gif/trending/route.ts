import { NextResponse } from "next/server";
import { klipyFetch, GifUnavailableError } from "@/lib/gif";

// GET /api/gif/trending — the GifPicker's default view. Same shape and error
// handling as /api/gif/search.
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const { gifs } = await klipyFetch(`trending?per_page=24`);
    return NextResponse.json({ gifs }, { headers: { "Cache-Control": "s-maxage=300" } });
  } catch (e) {
    if (e instanceof GifUnavailableError) return NextResponse.json({ error: "gif-unavailable" }, { status: 503 });
    console.error("[gif:trending] failed:", e);
    return NextResponse.json({ error: "gif-provider-error" }, { status: 502 });
  }
}
