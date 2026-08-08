"use client";
/**
 * /fantasy — the Fantasy tab.
 *
 * Public now (founder, 25 Jul): everyone can open it, but until launch the
 * allowlist decides what they get —
 *   allowlisted / ?fantasy=preview → the real game (FantasyHub: build, round,
 *                                    transfers, leagues).
 *   everyone else                  → a teaser: what we're building + a one-tap
 *                                    waitlist opt-in (FantasyTeaser).
 * Deep links (share cards, result emails, the deadline push) all land here and
 * resolve to whichever the visitor is entitled to — no dead ends.
 */
import { useEffect, useState } from "react";
import { FantasyHome } from "@/components/fantasy/FantasyHome";
import { FantasyTeaser } from "@/components/fantasy/FantasyTeaser";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { SocialHome } from "@/components/fantasy/SocialHome";
import { page } from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";
import { fantasyVisible } from "@/lib/fantasy/flag";
import { useUser } from "@/hooks/useUser";

export default function FantasyPage() {
  // null until mounted: the flag reads sessionStorage + the URL, which the
  // server can't see, so committing to either branch during SSR would mismatch
  // the server HTML and break hydration.
  const [full, setFull] = useState<boolean | null>(null);
  const { user, loading } = useUser();

  useEffect(() => {
    // Wait for the signed-in user before deciding, or an allowlisted founder
    // could get the teaser on the split-second before their session resolves.
    if (loading) return;
    setFull(fantasyVisible(user?.id));
  }, [user, loading]);

  if (full === null) return null; // deciding

  // Signed OUT (no account) → the public browse home (best of the feed + a join
  // hook), whether or not the game is gated — a visitor always sees it being
  // played. Signed in + allowed/released → the FEED (founder, 8 Aug): the first
  // Fantasy tab is purely the players' own feed — activity + conversation from
  // other managers, a place for fantasy players to talk to each other. No squad,
  // scout or dashboard here; those live on the Squad + Scout tabs. Signed in but
  // not allowed (still gated) → the teaser.
  return (
    <>
      {!user ? (
        <FantasyHome mode="public" />
      ) : full ? (
        <main data-fantasy style={page}>
          <FantasyHeader />
          <SocialHome />
        </main>
      ) : (
        <FantasyTeaser />
      )}
      <BottomNav />
    </>
  );
}
