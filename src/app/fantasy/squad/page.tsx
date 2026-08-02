"use client";
/**
 * /fantasy/squad — the squad home (XI, bench, captain, chips, result). This used
 * to live at /fantasy; the tab now lands on the feed-first FantasyHome, so the
 * squad moved here and is reached from the "Squad" pill or the home's "View your
 * squad" link. Same gate as the tab: allowlisted → the real thing, else teaser.
 */
import { useEffect, useState } from "react";
import { FantasyHub } from "@/components/fantasy/FantasyHub";
import { FantasyTeaser } from "@/components/fantasy/FantasyTeaser";
import { BottomNav } from "@/components/ui/BottomNav";
import { fantasyVisible } from "@/lib/fantasy/flag";
import { useUser } from "@/hooks/useUser";

export default function FantasySquadPage() {
  const [full, setFull] = useState<boolean | null>(null);
  const { user, loading } = useUser();
  useEffect(() => { if (!loading) setFull(fantasyVisible(user?.id)); }, [user, loading]);
  if (full === null) return null;
  return (
    <>
      {full ? <FantasyHub /> : <FantasyTeaser />}
      <BottomNav />
    </>
  );
}
