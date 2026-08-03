"use client";
/**
 * Managers to follow — the standalone route. The discovery itself (search +
 * reason-ranked suggestions) lives in <DiscoverManagers/>, shared with the
 * Social tab's Discover panel; this route wraps it in the fantasy chrome.
 */
import { INK, MUTED, page } from "@/components/fantasy/shared";
import { BackPill } from "@/components/ui/BackPill";
import { DiscoverManagers } from "@/components/fantasy/DiscoverManagers";
import { BottomNav } from "@/components/ui/BottomNav";

export default function DiscoverManagersPage() {
  return (
    <>
      <main data-fantasy style={page}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <BackPill fallback="/fantasy/social" label="Back" tone="neutral" />
        </div>
        <h1 className="font-display" style={{ fontSize: 24, color: INK, margin: "0 0 4px" }}>Managers to follow</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px", lineHeight: 1.5 }}>
          Follow them and their transfers, captains and big weeks land in your feed.
        </p>
        <DiscoverManagers intro={false} />
      </main>
      <BottomNav />
    </>
  );
}
