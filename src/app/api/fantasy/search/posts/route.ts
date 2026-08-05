import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { searchFeedPosts } from "@/lib/fantasy/feed";

// The Social search overlay's Posts group (Phase 5b, AC3) — authed-optional
// (a guest searches too), payload text match over the last 30 days.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const db = createServiceClient();
  const posts = await searchFeedPosts(db, user?.id ?? null, q);
  return NextResponse.json({ posts });
}
