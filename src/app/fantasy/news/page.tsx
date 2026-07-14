/**
 * Fantasy news feed — GENERAL, same for everyone (spec §1), so it's a server
 * component reading the cron-built fantasy_news_feed row directly: no client
 * fetch, ISR keeps it cheap, and it's SEO-indexable (unlike the game pages).
 *
 * This is a FEED, not a dashboard. Every block is a content card you scroll and
 * tap into — a doubt, a tweet, an article, a tip. Reference data (the fixture
 * ticker) lives on its own tab: it's a grid you CONSULT, not content you browse,
 * and when it sat at the top of this page it buried what people came for.
 */
import { NewsTabs } from "@/components/fantasy/NewsTabs";
import {
  GOLD, INK, LINE, MUTED, PANEL, card, column, h2, ItemCard, loadFeedDoc, shell, ukTime,
} from "@/components/fantasy/newsUi";

export const revalidate = 300;

export const metadata = {
  title: "Fantasy news & insights — YourScore",
  description:
    "Team news, predicted lineups, transfer talk and tips for your YourScore fantasy squad.",
};

const short = (club: string) =>
  club.replace(/^(AFC|FC)\s+/i, "").split(" ")[0].slice(0, 3).toUpperCase();

export default async function FantasyNews() {
  const doc = await loadFeedDoc();

  const doubts = doc?.teamNews?.doubts ?? [];
  const teamItems = doc?.teamNews?.items ?? [];
  const transferItems = doc?.transfers?.items ?? [];
  const insights = doc?.insights?.items ?? [];
  const tips = doc?.tips;
  const hasTips = !!(tips?.captain || tips?.differential || tips?.note);
  const empty =
    !doubts.length && !teamItems.length && !transferItems.length &&
    !insights.length && !hasTips;

  return (
    <main style={shell}>
      <div style={column}>
        <header>
          <div style={{ color: MUTED, fontSize: 12 }}>Fantasy</div>
          <h1 style={{ color: INK, fontSize: 22, fontWeight: 700, margin: "2px 0 0" }}>
            News &amp; insights
          </h1>
          {doc?.deadline && (
            <div style={{ color: GOLD, fontSize: 12, marginTop: 6 }}>
              GW{doc.gw} deadline · {ukTime(doc.deadline)}
            </div>
          )}
        </header>

        <NewsTabs active="/fantasy/news" />

        {empty && (
          <section style={card}>
            <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>Warming up</div>
            <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Team news, transfer talk and tips land here once the gameweek opens.
              Check back soon.
            </div>
          </section>
        )}

        {/* Tips first: it's the one thing here that tells you what to DO. */}
        {hasTips && (
          <section style={{ ...card, borderColor: GOLD }}>
            <h2 style={h2}>Tips this week</h2>
            {tips?.captain && (
              <p style={{ color: INK, fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
                <strong style={{ color: GOLD }}>Captain:</strong> {tips.captain.player} — {tips.captain.why}
              </p>
            )}
            {tips?.differential && (
              <p style={{ color: INK, fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
                <strong style={{ color: GOLD }}>Differential:</strong> {tips.differential.player} — {tips.differential.why}
              </p>
            )}
            {tips?.note && (
              <p style={{ color: MUTED, fontSize: 13, margin: 0, lineHeight: 1.5 }}>{tips.note}</p>
            )}
          </section>
        )}

        {/* Doubts are the highest-value news we produce: a player dropping out of
            a predicted XI is our stand-in for an injury feed (we have none). */}
        {doubts.length > 0 && (
          <section style={card}>
            <h2 style={h2}>Doubts</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {doubts.map((d) => (
                <div
                  key={d.smId}
                  style={{
                    background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8,
                    padding: 10, color: INK, fontSize: 13, lineHeight: 1.45,
                  }}
                >
                  <strong>{d.name}</strong> ({short(d.club)}) — likely doubt, {d.reason}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Our own data, as content. The form leaderboard and the ticker are
            tools; THESE are what a fan actually reads about them. */}
        {insights.length > 0 && (
          <section style={{ display: "grid", gap: 10 }}>
            <h2 style={{ ...h2, margin: 0 }}>Worth knowing</h2>
            {insights.map((n, i) => (
              <div key={`i${i}`} style={{ ...card, padding: 12 }}>
                <div style={{ color: INK, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
                  {n.title}
                </div>
                <div style={{ color: MUTED, fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>
                  {n.body}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* The stream: every item is tappable — an article or a tweet. */}
        {teamItems.length > 0 && (
          <section style={{ display: "grid", gap: 10 }}>
            <h2 style={{ ...h2, margin: 0 }}>Team news</h2>
            {teamItems.map((it, i) => <ItemCard key={`t${i}`} item={it} />)}
          </section>
        )}

        {transferItems.length > 0 && (
          <section style={{ display: "grid", gap: 10 }}>
            <h2 style={{ ...h2, margin: 0 }}>Transfers &amp; talk</h2>
            {transferItems.map((it, i) => <ItemCard key={`x${i}`} item={it} />)}
          </section>
        )}
      </div>
    </main>
  );
}
