import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserBounded } from "@/lib/supabase/bounded";
import { createServiceClient } from "@/lib/supabase/service";
import { Button } from "@/components/ui/Button";
import { GridBackground } from "@/components/ui/GridBackground";
import { BottomNav } from "@/components/ui/BottomNav";
import { BackPill } from "@/components/ui/BackPill";

// Notification inbox (stage 2). Everything in one feed: comment likes
// (aggregated per comment), comment replies (one row each), and the two
// daily broadcasts. Opening this page marks EVERYTHING read in one write —
// no per-row read state (founder decision).
//
// `notifications` and `profiles.notifications_read_at` post-date the
// generated src/types/database.ts (migration 222) — untyped service-client
// handle throughout, same reason as the rest of this workstream.

export const fetchCache = "force-no-store";

const LIME = "#aeea00";
const LOOKBACK_DAYS = 30;

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type NotificationRow = {
  id: string;
  user_id: string | null;
  type: string;
  actor_id: string | null;
  comment_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  like_count: number;
  title: string | null;
  body: string | null;
  url: string;
  created_at: string;
  updated_at: string;
};

/** One rendered inbox row, built from a notification row + the read-time
 *  actor/comment enrichment. */
function renderRow(
  n: NotificationRow,
  actorName: string,
  comment: { body: string; deleted_at: string | null } | undefined,
  isUnread: boolean,
) {
  let headline: string;
  let snippet: string | null = null;

  if (n.type === "comment_like") {
    const others = n.like_count - 1;
    headline =
      others > 0
        ? `${actorName} and ${others} other${others === 1 ? "" : "s"} liked your comment`
        : `${actorName} liked your comment`;
  } else if (n.type === "comment_reply") {
    headline = `${actorName} replied to your comment`;
  } else {
    // Broadcasts carry their own copy, stored at write time.
    headline = n.title ?? "";
    snippet = n.body ?? null;
  }

  if (n.type === "comment_like" || n.type === "comment_reply") {
    if (!comment) {
      snippet = "on a comment that is no longer available";
    } else if (comment.deleted_at) {
      snippet = "on a comment that is no longer available";
    } else {
      snippet = comment.body;
    }
  }

  return (
    <Link
      key={n.id}
      href={n.url}
      className="block rounded-2xl px-4 py-3.5 transition-opacity hover:opacity-90"
      style={{
        background: isUnread ? "rgba(174,234,0,0.07)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isUnread ? "rgba(174,234,0,0.22)" : "rgba(255,255,255,0.07)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-white">{headline}</p>
          {snippet && (
            <p className="font-body text-xs mt-1 line-clamp-2" style={{ color: "#8a948f" }}>
              {snippet}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isUnread && <span className="w-2 h-2 rounded-full" style={{ background: LIME }} />}
          <span className="font-body text-[11px]" style={{ color: "#5c655f" }}>
            {timeAgo(n.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const user = await getUserBounded(supabase);

  if (!user) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-body text-text-muted">Sign in to see your notifications.</p>
          <Button href="/auth/sign-in" variant="ghost" size="md">
            Sign in →
          </Button>
        </div>
      </main>
    );
  }

  const userId = user.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: profile }, { data: rows }] = await Promise.all([
    svc.from("profiles").select("notifications_read_at").eq("id", userId).maybeSingle(),
    svc
      .from("notifications")
      .select(
        "id, user_id, type, actor_id, comment_id, subject_type, subject_id, like_count, title, body, url, created_at, updated_at",
      )
      .or(`user_id.eq.${userId},and(user_id.is.null,created_at.gt.${since})`)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const notifications: NotificationRow[] = rows ?? [];
  // Captured BEFORE the mark-read write below, so this first render still
  // shows which rows were unread when the page opened.
  const readAt: string | null = profile?.notifications_read_at ?? null;

  // ── Read-time enrichment: actor display names + comment bodies ─────────────
  // Deliberately no denormalized names — a display-name change must never go
  // stale in an old notification row.
  const actorIds = Array.from(new Set(notifications.map((n) => n.actor_id).filter((id): id is string => !!id)));
  const commentIds = Array.from(new Set(notifications.map((n) => n.comment_id).filter((id): id is string => !!id)));

  const [{ data: actorRows }, { data: commentRows }] = await Promise.all([
    actorIds.length
      ? svc.from("profiles").select("id, display_name").in("id", actorIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    commentIds.length
      ? svc.from("comments").select("id, body, deleted_at").in("id", commentIds)
      : Promise.resolve({ data: [] as { id: string; body: string; deleted_at: string | null }[] }),
  ]);
  const actorNameById = new Map<string, string | null>(
    (actorRows ?? []).map((p: { id: string; display_name: string | null }): [string, string | null] => [p.id, p.display_name]),
  );
  const commentById = new Map<string, { body: string; deleted_at: string | null }>(
    (commentRows ?? []).map(
      (c: { id: string; body: string; deleted_at: string | null }): [string, { body: string; deleted_at: string | null }] => [
        c.id,
        c,
      ],
    ),
  );

  // ── Mark everything read — ONE write, no per-row state ──────────────────────
  await svc.from("profiles").update({ notifications_read_at: new Date().toISOString() }).eq("id", userId);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3 px-5 py-4 max-w-lg mx-auto">
          <BackPill fallback="/" />
          <p className="font-display text-lg text-white">Notifications</p>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-4 space-y-2.5">
        {notifications.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-body text-sm" style={{ color: "#8a948f" }}>
              Nothing here yet. Likes, replies and daily drops will land here.
            </p>
          </div>
        ) : (
          notifications.map((n) => {
            const isUnread = !readAt || new Date(n.updated_at) > new Date(readAt);
            const actorName = n.actor_id ? actorNameById.get(n.actor_id) ?? "A player" : "A player";
            const comment = n.comment_id ? commentById.get(n.comment_id) : undefined;
            return renderRow(n, actorName, comment, isUnread);
          })
        )}
      </div>

      <BottomNav />
    </main>
  );
}
