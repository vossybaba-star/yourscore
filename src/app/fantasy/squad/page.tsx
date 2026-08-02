"use client";
/**
 * /fantasy/squad — the squad home (XI, bench, captain, chips, result). This used
 * to live at /fantasy; the tab now lands on the feed-first FantasyHome, so the
 * squad moved here and is reached from the "Squad" pill or the home's "View your
 * squad" link. Same gate as the tab: allowlisted → the real thing, else teaser.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SquadTabs } from "@/components/fantasy/SquadTabs";
import { FantasyTeaser } from "@/components/fantasy/FantasyTeaser";
import { BottomNav } from "@/components/ui/BottomNav";
import { fantasyVisible } from "@/lib/fantasy/flag";
import { useUser } from "@/hooks/useUser";

export default function FantasySquadPage() {
  const router = useRouter();
  const [full, setFull] = useState<boolean | null>(null);
  const { user, loading } = useUser();
  useEffect(() => {
    if (loading) return;
    // The squad needs an account. A signed-out visitor (e.g. deep-linked here in
    // the released world) goes to sign-in, not a page that assumes a player.
    if (!user) { router.replace("/auth/sign-in?next=/fantasy/squad"); return; }
    setFull(fantasyVisible(user.id));
  }, [user, loading, router]);
  if (full === null) return null;
  return (
    <>
      {full ? <SquadTabs /> : <FantasyTeaser />}
      <BottomNav />
    </>
  );
}
