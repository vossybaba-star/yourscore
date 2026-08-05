import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFeedEvent } from "@/lib/fantasy/feed";
import { page } from "@/components/fantasy/shared";
import { PostDetailView } from "@/components/fantasy/PostDetailView";
import { BottomNav } from "@/components/ui/BottomNav";

/**
 * A single post as its own route (Phase 3a) — the destination for a repost's
 * attribution, a quote's embed, a share link, and the `?e=` deep link the
 * social page redirects here (see fantasy/social/page.tsx and
 * lib/engagement.ts's notification URLs).
 *
 * Public read, same as the feed itself — a guest can view; contributing still
 * prompts sign-in via each control's existing 401 pattern. Only "post" events
 * (plain posts, reposts — resolved to their original, see loadFeedEvent — and
 * quotes) have a page here; anything else 404s.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function PostDetailPage({ params }: { params: { id: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const db = createServiceClient();
  const event = await loadFeedEvent(db, user?.id ?? null, params.id);
  if (!event || event.type !== "post") notFound();

  return (
    <>
      <main data-fantasy style={page}>
        <PostDetailView event={event} />
      </main>
      <BottomNav />
    </>
  );
}
