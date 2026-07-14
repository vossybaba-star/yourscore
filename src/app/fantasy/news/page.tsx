/**
 * Fantasy news feed — GENERAL, same for everyone (spec §1), so it's a server
 * component reading the cron-built fantasy_news_feed row directly: no client
 * fetch, ISR keeps it cheap, and it's SEO-indexable (unlike the game pages).
 *
 * This is a FEED, not a dashboard. Every block is a content card you scroll and
 * tap into. Reference data (the fixture ticker) lives on its own tab: it's a grid
 * you CONSULT, not content you browse, and when it sat at the top of this page it
 * buried what people came for.
 *
 * The stream itself is a client component (the filter chips hold state) but it's
 * fed entirely by props from here — so the page still prerenders.
 */
import { NewsTabs } from "@/components/fantasy/NewsTabs";
import { NewsFeed } from "@/components/fantasy/NewsFeed";
import { GOLD, INK, MUTED, column, loadFeedDoc, shell, ukTime } from "@/components/fantasy/newsUi";

export const revalidate = 300;

export const metadata = {
  title: "Fantasy news & insights — YourScore",
  description:
    "Team news, transfer talk and tips for your YourScore fantasy squad.",
};

export default async function FantasyNews() {
  const doc = await loadFeedDoc();

  return (
    <main style={shell}>
      <div style={column}>
        <header>
          <div style={{ color: MUTED, fontSize: 12 }}>Fantasy</div>
          <h1 style={{ color: INK, fontSize: 22, fontWeight: 700, margin: "2px 0 0" }}>
            News &amp; insights
          </h1>
          {doc?.deadline && new Date(doc.deadline).getTime() > Date.now() && (
            <div style={{ color: GOLD, fontSize: 12, marginTop: 6 }}>
              GW{doc.gw} deadline · {ukTime(doc.deadline)}
            </div>
          )}
        </header>

        <NewsTabs active="/fantasy/news" />

        <NewsFeed
          tips={doc?.tips}
          doubts={doc?.teamNews?.doubts ?? []}
          insights={doc?.insights?.items ?? []}
          teamItems={doc?.teamNews?.items ?? []}
          transferItems={doc?.transfers?.items ?? []}
        />
      </div>
    </main>
  );
}
