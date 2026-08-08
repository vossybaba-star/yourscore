import { BottomNav } from "@/components/ui/BottomNav";
import { page } from "@/components/fantasy/shared";

/**
 * Landing on the Leagues tab almost always redirects straight into your primary
 * league, so its transition fallback is deliberately chrome-less — no header
 * block that could read as a stale "LEAGUES" title flashing before the real
 * league opens (founder, 8 Aug). Just a quiet holding state + the nav.
 */
export default function LeaguesLoading() {
  return (
    <>
      <main data-fantasy style={page}>
        <p style={{ fontSize: 13, color: "#8a948f", marginTop: 24, textAlign: "center", opacity: 0.7 }}>Opening your league…</p>
      </main>
      <BottomNav />
    </>
  );
}
