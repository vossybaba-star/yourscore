/** GET /api/fantasy/social/profile-tab?userId=<id>&tab=posts|replies|media —
 *  lazy-loaded data for a profile's Posts/Replies/Media tabs (Social Phase 3b,
 *  AC7). Public read, same as the main feed — a guest can view a profile's
 *  posts; contributing (react/comment/bookmark/pin) still gates on its own
 *  route. No withFantasyUser here on purpose: this must work signed out. */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadUserPosts, loadUserReplies, loadUserMedia, loadPinnedPost } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const userId = sp.get("userId") ?? "";
  const tab = sp.get("tab") === "replies" ? "replies" : sp.get("tab") === "media" ? "media" : "posts";
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const db = createServiceClient();

  if (tab === "replies") {
    const replies = await loadUserReplies(db, userId);
    return NextResponse.json({ replies });
  }
  if (tab === "media") {
    const media = await loadUserMedia(db, userId);
    return NextResponse.json({ media });
  }
  const [pinned, posts] = await Promise.all([
    loadPinnedPost(db, user?.id ?? null, userId),
    loadUserPosts(db, user?.id ?? null, userId),
  ]);
  // The pinned post renders once, above the list — drop it from the list
  // itself so it doesn't also appear in its normal chronological slot.
  const rest = pinned ? posts.filter((p) => p.id !== pinned.id) : posts;
  return NextResponse.json({ pinned, posts: rest });
}
