/**
 * Scout · Shortlist (Stage 3a) — the real list.
 *
 * Same Scout chrome as the Briefing and Players tabs (masthead + tabs + BottomNav),
 * a server shell so metadata + chrome stay static; the saved players themselves
 * render in the client <ShortlistView> (it reads the per-user shortlist + the
 * priced pool). Research only — no buy/sell here.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { FantasyMasthead, column, shell } from "@/components/fantasy/newsUi";
import { ShortlistView } from "@/components/fantasy/ShortlistView";
import { BottomNav } from "@/components/ui/BottomNav";

export const metadata = { title: "Scout · Shortlist · YourScore" };

export default function ScoutShortlist() {
  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead title="Scout" />
          <ScoutTabs active="/fantasy/scout/shortlist" />
          <ShortlistView />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
