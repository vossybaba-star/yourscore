"use client";
/**
 * /fantasy — the deep-link route for the squad home.
 *
 * Fantasy's HOME is the Fantasy section of the Premier League tab; this route
 * exists because things outside the app point straight here: the gameweek share
 * link's CTA, the result email, the deadline push, and any bookmark from before
 * the section existed. It renders the same component the tab does, with the
 * bottom nav attached — the walk found this page rendering NO nav at all, so a
 * deep link stranded you with no way into the rest of YourScore.
 */
import { FantasyHub } from "@/components/fantasy/FantasyHub";
import { BottomNav } from "@/components/ui/BottomNav";

export default function FantasyPage() {
  return (
    <>
      <FantasyHub />
      <BottomNav />
    </>
  );
}
