import { createServiceClient } from "@/lib/supabase/service";
import { GridBackground } from "@/components/ui/GridBackground";
import { BackPill } from "@/components/ui/BackPill";
import { FollowList } from "@/components/social/FollowList";

// Who this manager follows — reached by tapping the "following" count on a profile.
export default async function FollowingPage({ params }: { params: { userId: string } }) {
  const db = createServiceClient();
  const { data: p } = await db.from("profiles").select("display_name").eq("id", params.userId).single();
  const name = p?.display_name ?? "Player";
  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />
      <nav className="relative z-10 flex items-center gap-3 px-5 pb-4 max-w-lg mx-auto"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}>
        <BackPill fallback={`/profile/${params.userId}`} label="Back" tone="neutral" />
      </nav>
      <div className="relative z-0 max-w-lg mx-auto px-5">
        <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1">{name}</p>
        <h1 className="font-display text-3xl text-white mb-4">Following</h1>
        <FollowList query={`type=following&userId=${params.userId}`} emptyText="Not following anyone yet." />
      </div>
    </main>
  );
}
