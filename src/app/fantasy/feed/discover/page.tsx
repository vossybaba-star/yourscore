"use client";
/**
 * Managers to follow — the on-ramp the feed's empty state points at. Most-followed
 * first, minus you and anyone you already follow. Reached from the feed so a new
 * manager with an empty Following tab has somewhere to go.
 */
import { INK, LINE, MUTED, PANEL, page } from "@/components/fantasy/shared";
import { BackPill } from "@/components/ui/BackPill";
import { FollowList } from "@/components/social/FollowList";
import { BottomNav } from "@/components/ui/BottomNav";

export default function DiscoverManagersPage() {
  return (
    <>
      <main data-fantasy style={page}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <BackPill fallback="/fantasy/feed" label="Back" tone="neutral" />
        </div>
        <h1 className="font-display" style={{ fontSize: 24, color: INK, margin: "0 0 4px" }}>Managers to follow</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
          Follow managers to see their transfers, chips and big weeks in your feed.
        </p>
        <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 12 }}>
          <FollowList query="type=discover" emptyText="No one to suggest yet. Check back once more managers join." />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
