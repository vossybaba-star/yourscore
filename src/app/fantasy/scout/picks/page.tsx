/**
 * Scout · Picks — the Scout's Four Picks get their own tab (between Briefing and
 * Players), per the founder. Same Scout chrome as the other sub-tabs; the picks
 * themselves render in <FourPicks> (server, reads the published set). When
 * nothing's published FourPicks shows its own quiet teaser.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { FantasyMasthead, column, shell, MUTED } from "@/components/fantasy/newsUi";
import { FourPicks } from "@/components/fantasy/FourPicks";
import { BottomNav } from "@/components/ui/BottomNav";

export const revalidate = 300;

export const metadata = {
  title: "Scout · Picks · YourScore",
  description:
    "The Scout's four picks for the gameweek: one safe, one in form, one for value, one gamble. Facts, not verdicts.",
};

export default function ScoutPicksPage() {
  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead />
          <ScoutTabs active="/fantasy/scout/picks" />
          <div style={{ color: MUTED, fontSize: 12.5, marginTop: -6 }}>
            One safe, one in form, one for value, one gamble. Facts, not verdicts.
          </div>
          <FourPicks />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
