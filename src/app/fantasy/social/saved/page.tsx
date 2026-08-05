/**
 * Saved posts — the viewer's own bookmarks (Social Phase 3b, AC2). Signed-in
 * only (a bookmark is nobody's business but the saver's — see migration
 * 251's RLS); a guest gets a sign-in prompt, same pattern as /notifications
 * and /profile.
 */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadBookmarkedFeed } from "@/lib/fantasy/feed";
import { page, LINE, MUTED, PANEL, TEAL } from "@/components/fantasy/shared";
import { FeedCard } from "@/components/fantasy/FeedStream";
import { BackPill } from "@/components/ui/BackPill";
import { BottomNav } from "@/components/ui/BottomNav";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function SavedPostsPage() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  if (!user) {
    return (
      <>
        <main data-fantasy style={page}>
          <BackPill fallback="/fantasy/social" />
          <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 24, textAlign: "center", marginTop: 16 }}>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: "0 0 16px" }}>
              Sign in to see the posts you&apos;ve saved.
            </p>
            <Link href="/auth/sign-in?next=/fantasy/social/saved" style={{
              display: "inline-block", padding: "11px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
              textDecoration: "none", background: TEAL, color: "#03211d",
            }}>Sign in</Link>
          </div>
        </main>
        <BottomNav />
      </>
    );
  }

  const db = createServiceClient();
  const events = await loadBookmarkedFeed(db, user.id);

  return (
    <>
      <main data-fantasy style={page}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <BackPill fallback="/fantasy/social" />
          <span className="font-display" style={{ fontSize: 19 }}>Saved</span>
        </div>

        {events.length === 0 ? (
          <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 20, textAlign: "center" }}>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>
              Nothing saved yet. Bookmark posts to find them again here.
            </p>
          </div>
        ) : (
          events.map((ev) => <FeedCard key={ev.rowKey} ev={ev} signInNext="/fantasy/social/saved" />)
        )}
      </main>
      <BottomNav />
    </>
  );
}
