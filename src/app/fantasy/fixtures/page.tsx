/**
 * Fantasy fixture ticker — squad-first. The interactive grid (My clubs / All
 * clubs, difficulty legend, owned-club highlight) is a client component fed by
 * this server-rendered doc, so the page stays ISR + SEO-indexable while a
 * signed-in manager gets their own clubs first.
 */
import { NewsTabs } from "@/components/fantasy/NewsTabs";
import { FantasyMasthead, INK, MUTED, card, column, loadFeedDoc, shell, ukTime } from "@/components/fantasy/newsUi";
import { FixturesGrid } from "@/components/fantasy/FixturesGrid";
import { BottomNav } from "@/components/ui/BottomNav";

export const revalidate = 300;

export const metadata = {
  title: "Fixture difficulty · YourScore",
  description: "Your Premier League clubs' next five fixtures, colour-coded by difficulty.",
};

export default async function FantasyFixtures() {
  const doc = await loadFeedDoc();
  const gws = doc?.fixtures?.gws ?? [];
  const runs = doc?.fixtures?.runs ?? [];
  const deadlineLine = doc?.deadline && new Date(doc.deadline).getTime() > Date.now()
    ? `GW${doc.gw} deadline · ${ukTime(doc.deadline)}` : null;

  return (
    <>
    <main style={shell}>
      <div style={column}>
        <FantasyMasthead title="News & insights" />
        <NewsTabs active="/fantasy/fixtures" />
        {runs.length === 0 ? (
          <section style={card}>
            <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>Fixtures land when the season opens</div>
            <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Once the gameweek calendar is set, this shows your clubs&apos; next five, colour-coded by how hard each game is.
            </div>
          </section>
        ) : (
          <FixturesGrid gws={gws} runs={runs} deadlineLine={deadlineLine} />
        )}
      </div>
    </main>
      <BottomNav />
    </>
  );
}
