/**
 * Scout · Players — the research browser (Stage 2).
 *
 * A destination for looking players up: search, filter (position / club / price /
 * availability) and sort, then tap through to the full profile. It is NOT the
 * transfer market — there is no buy / sell / add-to-squad here. The shortlist star
 * and the compare action are Stage 3.
 *
 * This shell is a server component so it keeps the same masthead + tab chrome the
 * Briefing wears; the interactive list is the <ScoutPlayersBrowser> client child,
 * mirroring how /fantasy/news renders its client blocks.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { ScoutPlayersBrowser } from "@/components/fantasy/ScoutPlayersBrowser";
import { FantasyMasthead, MUTED, column, shell } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

export const metadata = { title: "Scout · Players · YourScore" };

export default function ScoutPlayers() {
  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead title="Scout" />
          <div style={{ color: MUTED, fontSize: 12.5, marginTop: -6 }}>
            Every player, priced and researched. Look before you move.
          </div>
          <ScoutTabs active="/fantasy/scout/players" />
          <ScoutPlayersBrowser />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
