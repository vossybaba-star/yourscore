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

// Tabs (Social Phase 3b, AC6). "Mentions" and "Leagues" are pattern matches
// over the type strings this app already writes, NOT a hardcoded enum — a new
// mention-shaped or league/chat-shaped type lands in the right tab with no
// code change here, same "no enum" call migration 222 made for `type` itself.
// Leagues also catches anything scoped to a league via subject_type, which is
// how fantasy_month_winner (no "league"/"chat" in its own name) gets in.
type NotifTab = "all" | "mentions" | "leagues";
function isMentionType(n: NotificationRow): boolean {
  return /mention/i.test(n.type);
}
// League-scoped subject_types beyond fantasy_league itself: challenge
// notifications carry subject_type "member_challenge" (types like
// challenge_result/challenge_invite) and competition notifications carry
// "league_competition" (type "competition_result") — neither name matches
// /league|chat/, so both classes were falling out of the Leagues tab into
// only "All". Listed explicitly, same "match the subject_type, not a wider
// regex" spirit as the comment above.
const LEAGUE_SUBJECT_TYPES = new Set(["fantasy_league", "member_challenge", "league_competition"]);
function isLeagueType(n: NotificationRow): boolean {
  return (n.subject_type != null && LEAGUE_SUBJECT_TYPES.has(n.subject_type)) || /league|chat/i.test(n.type);
}

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
  } else if (n.type === "feed_reaction") {
    const others = n.like_count - 1;
    headline =
      others > 0
        ? `${actorName} and ${others} other${others === 1 ? "" : "s"} reacted to your post`
        : `${actorName} reacted to your post`;
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

export default async function NotificationsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab: NotifTab = searchParams?.tab === "mentions" ? "mentions" : searchParams?.tab === "leagues" ? "leagues" : "all";

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

  const [{ data: profile }, { data: rows, error: rowsError }] = await Promise.all([
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
  // Gated on the fetch having actually succeeded: a transient select error
  // would otherwise render an empty inbox AND clear the badge, silently
  // burying notifications the user never saw. Wrapped so a failed marker
  // write degrades to "still unread" instead of 500ing the page.
  if (!rowsError) {
    try {
      await svc.from("profiles").update({ notifications_read_at: new Date().toISOString() }).eq("id", userId);
    } catch (err) {
      console.error("[notifications] mark-read failed:", err);
    }
  }

  const visible = notifications.filter((n) => (tab === "all" ? true : tab === "mentions" ? isMentionType(n) : isLeagueType(n)));
  const emptyCopy = tab === "mentions"
    ? "No mentions yet."
    : tab === "leagues"
      ? "Nothing from your leagues yet."
      : "Nothing here yet. Likes, replies and daily drops will land here.";

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3 px-5 py-4 max-w-lg mx-auto">
          <BackPill fallback="/" />
          <p className="font-display text-lg text-white">Notifications</p>
        </div>
        <div className="flex items-center gap-2 px-5 pb-3 max-w-lg mx-auto">
          {([["all", "All"], ["mentions", "Mentions"], ["leagues", "Leagues"]] as [NotifTab, string][]).map(([t, label]) => {
            const on = t === tab;
            return (
              <Link key={t} href={t === "all" ? "/notifications" : `/notifications?tab=${t}`}
                className="font-body text-xs font-bold px-3 py-1.5 rounded-full"
                style={{
                  background: on ? "rgba(174,234,0,0.14)" : "rgba(255,255,255,0.04)",
                  color: on ? LIME : "#8a948f",
                  border: `1px solid ${on ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.08)"}`,
                  textDecoration: "none",
                }}>{label}</Link>
            );
          })}
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-4 space-y-2.5">
        {visible.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-body text-sm" style={{ color: "#8a948f" }}>{emptyCopy}</p>
          </div>
        ) : (
          visible.map((n) => {
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
