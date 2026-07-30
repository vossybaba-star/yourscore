/**
 * YourScore Scout — the Briefing.
 *
 * Reskin of the old fantasy news hub. The general Scout Report (the cron-built
 * feed) is unchanged and still renders from the fantasy_news_feed doc as a server
 * component (ISR, SEO-indexable). What's new is the head of the page: SquadUpdate,
 * a client block about the fifteen players YOU own — the one personalised, facts-
 * only read that the general feed can't give.
 *
 * The route is deliberately still /fantasy/news (nothing that links here breaks);
 * the surface is now branded Scout.
 */
import { ScoutTabs } from "@/components/fantasy/ScoutTabs";
import { ScoutCover } from "@/components/fantasy/ScoutCover";
import { NewsFeed } from "@/components/fantasy/NewsFeed";
import { FantasyMasthead, GOLD, column, loadFeedDoc, shell, ukTime } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

export const revalidate = 300;

export const metadata = {
  title: "Scout · YourScore",
  description:
    "Facts, not noise, for your YourScore fantasy squad: team news, availability and the moves worth knowing.",
};

/** Hide feed items older than ten days — a stale source must never read as today's
 *  news. Empty beats misleading. */
const MAX_ITEM_AGE_MS = 10 * 24 * 60 * 60 * 1000;
function fresh<T extends { createdAt: string }>(items?: T[]): T[] {
  return (items ?? []).filter((i) => Date.now() - new Date(i.createdAt).getTime() < MAX_ITEM_AGE_MS);
}

export default async function ScoutBriefing() {
  const doc = await loadFeedDoc();

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

        <ScoutTabs active="/fantasy/news" />

        {/* Briefing is general news only now (founder, 30 Jul): Squad Update
            moved to the "Your Squad" tab, the shortlist peek is gone (it lives on
            the Shortlist tab), and Compare moved to the Players tab. */}

        {/* The general Scout Report. Stale-item guard (founder, 30 Jul): the
            team-news source stopped feeding on 14 Jul, so anything older than ten
            days is hidden rather than shown as if it were current. Better an empty
            section than 16-day-old "news". (The dead ingest still needs fixing.) */}
        <NewsFeed
          tips={doc?.tips}
          doubts={doc?.teamNews?.doubts ?? []}
          insights={doc?.insights?.items ?? []}
          teamItems={fresh(doc?.teamNews?.items)}
          transferItems={fresh(doc?.transfers?.items)}
        />
      </div>
    </main>
      <BottomNav />
    </>
  );
}
