/**
 * The Social tab at /fantasy/social — a first-class Fantasy destination. The
 * three segments (Following / Discover / Top) and the feed live in <SocialHome/>;
 * this route wraps it in the standalone fantasy chrome. Legacy /fantasy/feed
 * redirects here.
 *
 * `?e=<id>` is a legacy deep link — still what lib/engagement.ts's
 * notification URLs point at — redirected server-side (Phase 3a) to the real
 * post-detail route now that one exists, so a notification or an old shared
 * link lands on the actual post instead of just the open feed.
 */
import { redirect } from "next/navigation";
import { page } from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { SocialHome } from "@/components/fantasy/SocialHome";
import { BottomNav } from "@/components/ui/BottomNav";

export default function FantasySocialPage({ searchParams }: { searchParams?: { e?: string } }) {
  const e = searchParams?.e;
  if (typeof e === "string" && e) redirect(`/fantasy/social/post/${e}`);

  return (
    <>
      <main data-fantasy style={page}>
        <FantasyHeader />
        <SocialHome />
      </main>
      <BottomNav />
    </>
  );
}
