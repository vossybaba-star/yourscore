/**
 * Scout · Players — stage-1 placeholder. The tab exists and is reachable; the
 * Four Picks / player-browsing contents land in a later stage. Same Scout chrome
 * (masthead + tabs) so it reads as a real, if empty, room — not a dead link.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { FantasyMasthead, MUTED, INK, card, column, shell } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

export const metadata = { title: "Scout · Players · YourScore" };

export default function ScoutPlayers() {
  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead title="Scout" />
          <ScoutTabs active="/fantasy/scout/players" />
          <div style={{ ...card, textAlign: "center", padding: "28px 16px" }}>
            <div className="font-display tracking-widest" style={{ color: INK, fontSize: 15 }}>
              PLAYERS · COMING SOON
            </div>
            <p className="font-body" style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>
              The player scout lands here soon.
            </p>
          </div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
