/**
 * Scout · Your Squad — the news that applies to the fifteen a manager actually
 * owns: injuries, doubts, blank gameweeks flagged for YOUR players (founder,
 * 30 Jul). Moved off the Briefing so the Briefing is general news and this tab
 * is personal. SquadUpdate handles the signed-out / no-squad states itself.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { FantasyMasthead, column, shell, MUTED } from "@/components/fantasy/newsUi";
import { SquadUpdate } from "@/components/fantasy/SquadUpdate";
import { BottomNav } from "@/components/ui/BottomNav";

export const metadata = {
  title: "Scout · Your Squad · YourScore",
  description: "Injuries, doubts and blank gameweeks flagged for the players in your squad.",
};

export default function ScoutSquadPage() {
  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead />
          <ScoutTabs active="/fantasy/scout/squad" />
          <div style={{ color: MUTED, fontSize: 12.5, marginTop: -6 }}>
            Injuries, doubts and blanks, flagged for your fifteen.
          </div>
          <SquadUpdate />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
