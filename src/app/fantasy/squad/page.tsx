"use client";
/**
 * /fantasy/squad — the squad home (XI, bench, captain, chips, result). This used
 * to live at /fantasy; the tab now lands on the feed-first FantasyHome, so the
 * squad moved here and is reached from the "Squad" pill or the home's "View your
 * squad" link. Same gate as the tab: allowlisted → the real thing, else teaser.
 */
import { useEffect, useState } from "react";
import { SquadTabs } from "@/components/fantasy/SquadTabs";
import { FantasyTeaser } from "@/components/fantasy/FantasyTeaser";
import { BottomNav } from "@/components/ui/BottomNav";
import { fantasyVisible } from "@/lib/fantasy/flag";
import { useUser } from "@/hooks/useUser";

export default function FantasySquadPage() {
  const [full, setFull] = useState<boolean | null>(null);
  const { user, loading } = useUser();
  useEffect(() => {
    if (loading) return;
    // The Squad tab is open to everyone (founder, 4 Aug). A signed-out visitor
    // sees the same squad home and can build a team; saving is what needs an
    // account, and that's gated in the builder, not at this door.
    setFull(fantasyVisible(user?.id));
  }, [user, loading]);
  if (full === null) return null;
  return (
    <>
      {full ? <SquadTabs /> : <FantasyTeaser />}
      <BottomNav />
    </>
  );
}
