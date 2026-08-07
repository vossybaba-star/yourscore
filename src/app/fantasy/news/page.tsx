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
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScoutCover } from "@/components/fantasy/ScoutCover";
import { ScoutTabsShell, type ScoutTabKey } from "@/components/fantasy/ScoutTabsShell";
import { NewsFeed } from "@/components/fantasy/NewsFeed";
import { FourPicks } from "@/components/fantasy/FourPicks";
import { ScoutLatest } from "@/components/fantasy/ScoutLatest";
import { ScoutPlayersBrowser } from "@/components/fantasy/ScoutPlayersBrowser";
import { CompareEntry } from "@/components/fantasy/CompareEntry";
import { ShortlistView } from "@/components/fantasy/ShortlistView";
import { ScoutYourSquad } from "@/components/fantasy/ScoutYourSquad";
import { FixturesGrid } from "@/components/fantasy/FixturesGrid";
import { FantasyMasthead, GOLD, INK, LINE, MUTED, TEAL, card, column, loadFeedDoc, shell, ukTime } from "@/components/fantasy/newsUi";
import { BottomNav } from "@/components/ui/BottomNav";

/** Scout's front door: "what do you need help with", not a stats dashboard
 *  (founder brief, 7 Aug). Four decision cards above the news stream, each a
 *  question a manager actually has this week rather than a feature label. All
 *  four routes redirect back into this same page with the matching tab
 *  pre-selected (see src/app/fantasy/scout/*), so plain Links are enough — no
 *  client state needed for a server component.
 *
 *  COMPARE has no dedicated URL entry point today: CompareEntry (mounted in
 *  the players slot) opens on local useState with no query-param read, and
 *  ScoutPlayersBrowser's own compare sheet is likewise local state. So this
 *  card links plain to /fantasy/scout/players rather than a `?compare=1`
 *  deep link — landing on Players, with Compare one tap away, same as today. */
const DECISIONS: { title: string; sub: string; href: string }[] = [
  { title: "CAPTAIN", sub: "Who should I captain?", href: "/fantasy/scout/picks" },
  { title: "TRANSFERS", sub: "Who should I bring in?", href: "/fantasy/scout/players" },
  { title: "MY SQUAD", sub: "Where are the weaknesses?", href: "/fantasy/scout/squad" },
  { title: "COMPARE", sub: "Compare two players", href: "/fantasy/scout/players" },
];

function DecisionGrid() {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058" }}>
        WHAT DO YOU NEED HELP WITH?
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {DECISIONS.map((d) => (
          <Link key={d.title} href={d.href} className="rounded-2xl bg-surface" style={{
            border: `1px solid ${LINE}`, padding: "14px 12px", textDecoration: "none",
            display: "flex", flexDirection: "column", gap: 4, minHeight: 84,
          }}>
            <span className="font-display" style={{ color: INK, fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>
              {d.title}
            </span>
            <span className="font-body" style={{ color: MUTED, fontSize: 12, lineHeight: 1.35 }}>
              {d.sub}
            </span>
            <span aria-hidden style={{ color: TEAL, fontSize: 16, marginTop: "auto", alignSelf: "flex-end" }}>
              ›
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export const dynamic = "force-dynamic"; // reads the auth cookie to wall the content

export const metadata = {
  title: "Scout · YourScore",
  description: "Facts, not noise, for your YourScore fantasy squad: team news, availability and the moves worth knowing.",
};

const MAX_ITEM_AGE_MS = 10 * 24 * 60 * 60 * 1000;
function fresh<T extends { createdAt: string }>(items?: T[]): T[] {
  return (items ?? []).filter((i) => Date.now() - new Date(i.createdAt).getTime() < MAX_ITEM_AGE_MS);
}
const VALID: ScoutTabKey[] = ["briefing", "picks", "players", "fixtures", "shortlist", "squad"];

export default async function ScoutBriefing({ searchParams }: { searchParams?: { tab?: string } }) {
  const [{ data: { user } }, doc] = await Promise.all([
    (await createClient()).auth.getUser(),
    loadFeedDoc(),
  ]);
  const signedIn = !!user;
  const initial = (VALID.includes(searchParams?.tab as ScoutTabKey) ? searchParams!.tab : "briefing") as ScoutTabKey;

  const slots = signedIn ? {
    briefing: (
      <div style={{ display: "grid", gap: 14 }}>
        <DecisionGrid />
        <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: -6 }}>
          THIS WEEK
        </div>
        <NewsFeed
          tips={doc?.tips}
          doubts={doc?.teamNews?.doubts ?? []}
          insights={doc?.insights?.items ?? []}
          teamItems={fresh(doc?.teamNews?.items)}
          transferItems={fresh(doc?.transfers?.items)}
        />
      </div>
    ),
    picks: <div style={{ display: "grid", gap: 12 }}><ScoutLatest /><FourPicks /></div>,
    players: <><CompareEntry /><ScoutPlayersBrowser /></>,
    fixtures: (() => {
      const gws = doc?.fixtures?.gws ?? [];
      const runs = doc?.fixtures?.runs ?? [];
      const dl = doc?.deadline && new Date(doc.deadline).getTime() > Date.now() ? `GW${doc.gw} deadline · ${ukTime(doc.deadline)}` : null;
      return runs.length === 0 ? (
        <section style={card}>
          <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>Fixtures land when the season opens</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            Once the gameweek calendar is set, this shows every club&apos;s next five, colour-coded by how hard each game is.
          </div>
        </section>
      ) : <FixturesGrid gws={gws} runs={runs} deadlineLine={dl} />;
    })(),
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
