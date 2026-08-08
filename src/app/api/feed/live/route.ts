import { NextResponse } from "next/server";
import { fetchLiveFeed } from "@/lib/pl/liveFeed";

/**
 * GET /api/feed/live — the live "what's happening now" feed (news + embeddable
 * YouTube videos), newest-first. No auth, no Supabase — just external RSS — so
 * it's safe to edge-cache: revalidate every 10 min, serve stale-while-revalidate
 * so a user never waits on the desks. If every source fails we return an empty
 * list (the next revalidate re-tries).
 */
export const revalidate = 600;

export async function GET() {
  try {
    const { items, updatedAt } = await fetchLiveFeed();
    return NextResponse.json(
      { items, updatedAt },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" } },
    );
  } catch (e) {
    console.error("[feed:live]", e);
    return NextResponse.json({ items: [], updatedAt: new Date().toISOString() });
  }
}
