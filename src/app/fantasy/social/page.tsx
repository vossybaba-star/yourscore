"use client";
/**
 * The Social tab at /fantasy/social — a first-class Fantasy destination. The
 * three segments (Following / Discover / Top) and the feed live in <SocialHome/>;
 * this route wraps it in the standalone fantasy chrome. Legacy /fantasy/feed
 * redirects here.
 */
import { page } from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { SocialHome } from "@/components/fantasy/SocialHome";
import { BottomNav } from "@/components/ui/BottomNav";

export default function FantasySocialPage() {
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
