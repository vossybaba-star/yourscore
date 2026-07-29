/**
 * Scout · Shortlist — stage-1 placeholder. The tab exists and is reachable; the
 * shortlist contents land in a later stage. Same Scout chrome (masthead + tabs)
 * so it reads as a real, if empty, room — not a dead link.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { FantasyMasthead, MUTED, INK, card, column, shell } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

export const metadata = { title: "Scout · Shortlist · YourScore" };

export default function ScoutShortlist() {
  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead title="Scout" />
          <ScoutTabs active="/fantasy/scout/shortlist" />
          <div style={{ ...card, textAlign: "center", padding: "28px 16px" }}>
            <div className="font-display tracking-widest" style={{ color: INK, fontSize: 15 }}>
              SHORTLIST · COMING SOON
            </div>
            <p className="font-body" style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>
              Your saved players will gather here soon.
            </p>
          </div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
