"use client";
/**
 * The fantasy activity feed at /fantasy/feed. The feed itself (scopes, reactions,
 * comments, pull-to-refresh) lives in <FeedStream/>, shared with the home "Feed"
 * tab; this route just wraps it in the standalone fantasy chrome.
 */
import { page } from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { FeedStream } from "@/components/fantasy/FeedStream";
import { BottomNav } from "@/components/ui/BottomNav";

export default function FantasyFeedPage() {
  return (
    <>
      <main data-fantasy style={page}>
        <FantasyHeader />
        <FeedStream signInNext="/fantasy/feed" />
      </main>
      <BottomNav />
    </>
  );
}
