import { NextRequest, NextResponse } from "next/server";

const STORAGE_BASE =
  "https://auth.yourscore.app/storage/v1/object/public/quiz-share";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const { slug } = params;
  const imageUrl = `${STORAGE_BASE}/${encodeURIComponent(slug)}.png`;

  try {
    const upstream = await fetch(imageUrl);
    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status });
    }
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
        // Cache for 24h — the image doesn't change after the quiz launches.
        // Deliberately NOT forwarding x-robots-tag: none from Supabase storage,
        // so Twitter's card crawler can fetch and display the preview image.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
