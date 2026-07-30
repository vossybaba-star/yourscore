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
import { SquadUpdate } from "@/components/fantasy/SquadUpdate";
import { FourPicks } from "@/components/fantasy/FourPicks";
import { ShortlistPreview } from "@/components/fantasy/ShortlistPreview";
import { CompareEntry } from "@/components/fantasy/CompareEntry";
import { NewsFeed } from "@/components/fantasy/NewsFeed";
import { FantasyMasthead, GOLD, MUTED, column, loadFeedDoc, shell, ukTime } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

export const revalidate = 300;

export const metadata = {
  title: "Scout · YourScore",
  description:
    "Facts, not noise, for your YourScore fantasy squad: team news, availability and the moves worth knowing.",
};

export default async function ScoutBriefing() {
  const doc = await loadFeedDoc();

  return (
    <>
    <main style={shell}>
      <div style={column}>
        <FantasyMasthead />
        <div style={{ color: MUTED, fontSize: 12.5, marginTop: -6 }}>
          Facts. Not noise. Make better moves.
        </div>
        {doc?.deadline && new Date(doc.deadline).getTime() > Date.now() && (
          <div style={{ color: GOLD, fontSize: 12, marginTop: -4 }}>
            GW{doc.gw} deadline · {ukTime(doc.deadline)}
          </div>
        )}

        <ScoutTabs active="/fantasy/news" />

        {/* Personalised, facts-only: YOUR squad first. */}
        <SquadUpdate />

        {/* The Scout's four picks for the gameweek — published only, renders nothing until approved. */}
        <FourPicks />

        {/* A compact peek at your saved players — renders nothing when empty. */}
        <ShortlistPreview />

        {/* Entry into side-by-side Player Comparison (opens empty from here). */}
        <CompareEntry />

        {/* The general Scout Report — same for everyone, straight from the feed doc. */}
        <NewsFeed
          tips={doc?.tips}
          doubts={doc?.teamNews?.doubts ?? []}
          insights={doc?.insights?.items ?? []}
          teamItems={doc?.teamNews?.items ?? []}
          transferItems={doc?.transfers?.items ?? []}
        />
      </div>
    </main>
      <BottomNav />
    </>
  );
}
