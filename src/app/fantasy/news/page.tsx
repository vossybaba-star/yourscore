/**
 * YourScore Scout — one page, five seamless sections (founder, 2 Aug). The
 * Briefing / Picks / Players / Shortlist / Your Squad tabs used to be five routes;
 * now the cover sits up top and a client shell (ScoutTabsShell) slides between the
 * content slots with no page load. Signed out, the cover + tabs still show but the
 * content is behind a sign-up wall.
 *
 * Still served at /fantasy/news so nothing linking here breaks; the old
 * /fantasy/scout/* routes redirect in with the right tab.
 */
import { createClient } from "@/lib/supabase/server";
import { ScoutCover } from "@/components/fantasy/ScoutCover";
import { ScoutTabsShell, type ScoutTabKey } from "@/components/fantasy/ScoutTabsShell";
import { NewsFeed } from "@/components/fantasy/NewsFeed";
import { FourPicks } from "@/components/fantasy/FourPicks";
import { ScoutPlayersBrowser } from "@/components/fantasy/ScoutPlayersBrowser";
import { CompareEntry } from "@/components/fantasy/CompareEntry";
import { ShortlistView } from "@/components/fantasy/ShortlistView";
import { ScoutYourSquad } from "@/components/fantasy/ScoutYourSquad";
import { FantasyMasthead, GOLD, column, loadFeedDoc, shell, ukTime } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

export const dynamic = "force-dynamic"; // reads the auth cookie to wall the content

export const metadata = {
  title: "Scout · YourScore",
  description: "Facts, not noise, for your YourScore fantasy squad: team news, availability and the moves worth knowing.",
};

const MAX_ITEM_AGE_MS = 10 * 24 * 60 * 60 * 1000;
function fresh<T extends { createdAt: string }>(items?: T[]): T[] {
  return (items ?? []).filter((i) => Date.now() - new Date(i.createdAt).getTime() < MAX_ITEM_AGE_MS);
}
const VALID: ScoutTabKey[] = ["briefing", "picks", "players", "shortlist", "squad"];

export default async function ScoutBriefing({ searchParams }: { searchParams?: { tab?: string } }) {
  const [{ data: { user } }, doc] = await Promise.all([
    (await createClient()).auth.getUser(),
    loadFeedDoc(),
  ]);
  const signedIn = !!user;
  const initial = (VALID.includes(searchParams?.tab as ScoutTabKey) ? searchParams!.tab : "briefing") as ScoutTabKey;

  const slots = signedIn ? {
    briefing: (
      <NewsFeed
        tips={doc?.tips}
        doubts={doc?.teamNews?.doubts ?? []}
        insights={doc?.insights?.items ?? []}
        teamItems={fresh(doc?.teamNews?.items)}
        transferItems={fresh(doc?.transfers?.items)}
      />
    ),
    picks: <FourPicks />,
    players: <><CompareEntry /><ScoutPlayersBrowser /></>,
    shortlist: <ShortlistView />,
    squad: <ScoutYourSquad />,
  } : undefined;

  return (
    <>
      <main style={shell}>
        <div style={column}>
          <FantasyMasthead />
          <ScoutCover />
          {doc?.deadline && new Date(doc.deadline).getTime() > Date.now() && (
            <div style={{ color: GOLD, fontSize: 12, marginTop: -8, marginBottom: 2 }}>
              GW{doc.gw} deadline · {ukTime(doc.deadline)}
            </div>
          )}
          <ScoutTabsShell initial={initial} signedIn={signedIn} slots={slots} />
        </div>
      </main>
      <BottomNav />
    </>
  );
}
