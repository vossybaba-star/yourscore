"use client";
/**
 * A football player's profile as a real ROUTE — not the bottom Sheet the scout
 * and shortlist open. Reached from the feed and from a manager's profile squad,
 * so the device back button retraces the exact path the user came in on:
 * feed → a squad on someone's profile → a player → back → profile → back → feed.
 * A Sheet has no history entry, so back could never retrace it (founder, 30 Jul).
 *
 * Renders the same <PlayerProfile> the sheets do; `onClose` is a history back, and
 * a BackPill up top does the same with a feed fallback for a cold deep link.
 */
import { useParams, useRouter } from "next/navigation";
import { page } from "@/components/fantasy/shared";
import { PlayerProfile } from "@/components/fantasy/PlayerProfile";
import { SharePlayerToLeague } from "@/components/fantasy/league/SharePlayerToLeague";
import { BackPill } from "@/components/ui/BackPill";
import { BottomNav } from "@/components/ui/BottomNav";

export default function FantasyPlayerProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  return (
    <>
      <main data-fantasy style={page}>
        <BackPill fallback="/fantasy/feed" />
        {Number.isFinite(id) && (
          <div style={{ marginTop: 12 }}>
            <PlayerProfile playerId={id} onClose={() => router.back()} />
            {/* Share-from-source: drop this player into a league's chat. */}
            <div style={{ marginTop: 12 }}>
              <SharePlayerToLeague playerId={id} />
            </div>
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
