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
 *
 * While the release gate is shut this route has to stay shut too, or it is the
 * open back door around the hidden tab. Those visitors go to the PL tab rather
 * than a dead end.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FantasyHub } from "@/components/fantasy/FantasyHub";
import { BottomNav } from "@/components/ui/BottomNav";
import { fantasyVisible } from "@/lib/fantasy/flag";

export default function FantasyPage() {
  const router = useRouter();
  // null until mounted: the flag reads sessionStorage and the URL, which the
  // server can't see, so committing to either branch during SSR would mismatch
  // the server HTML and break hydration.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = fantasyVisible();
    setAllowed(ok);
    if (!ok) router.replace("/matchweek");
  }, [router]);

  if (!allowed) return null; // deciding, or redirecting

  return (
    <>
      <FantasyHub />
      <BottomNav />
    </>
  );
}
