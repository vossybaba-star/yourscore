/**
 * /gameday-quiz — the Gameday Quiz explainer.
 *
 * Reached from the "How it works" tile at the top of the Gameday Quiz tab
 * (founder, 25 Jul). Says what the thing IS in the order a new fan meets it:
 * a quiz for every fixture, a score, and a club table their score feeds. Copy
 * tracks the live tab (LiveQuizIntro + ClubTableTile) so the explainer never
 * promises something the tab doesn't do.
 *
 * Static content, so it prerenders and is SEO-indexable — no client state.
 */
import Link from "next/link";
import { BackPill } from "@/components/ui/BackPill";
import { BottomNav } from "@/components/ui/BottomNav";

const TEAL = "#00d8c0";
const BG = "#080d0a";
const PANEL = "#0e1611";
const INK = "#eef2f0";
const MUTED = "#8a948f";
const LINE = "rgba(255,255,255,0.07)";

export const metadata = {
  title: "How Gameday Quiz works · YourScore",
  description:
    "A quiz for every Premier League fixture. Score it, and play for your club. Best average tops the fan table.",
};

const BEATS: { n: string; t: string; d: string }[] = [
  {
    n: "01",
    t: "A quiz for every fixture",
    d: "Each Premier League match gets its own pack of quick questions about the two teams. New packs land around matchday, so pick your game and play.",
  },
  {
    n: "02",
    t: "Score it",
    d: "Answer against the clock. The faster and sharper you are, the higher you score. You get one go per pack, so it's your first instinct that counts.",
  },
  {
    n: "03",
    t: "Play for your club",
    d: "Your score joins every other fan of your club. It's the average that ranks a club, not the total, so a big fanbase can't buy its way up the table.",
  },
  {
    n: "04",
    t: "Climb the fan table",
    d: "Best average tops it. It takes a handful of games to rank, so one lucky round can't put you top. The table rewards the fans who keep turning up.",
  },
];

function Beat({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div style={{ display: "flex", gap: 14 }}>
      <div
        className="font-display rounded-full"
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28, fontSize: 11,
          background: "rgba(0,216,192,0.16)", color: TEAL, border: "1px solid rgba(0,216,192,0.34)",
        }}
      >
        {n}
      </div>
      <div style={{ minWidth: 0 }}>
        <p className="font-body" style={{ fontSize: 15, color: INK, fontWeight: 600, margin: 0 }}>{t}</p>
        <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "4px 0 0", lineHeight: 1.55 }}>{d}</p>
      </div>
    </div>
  );
}

export default function GamedayQuizHowItWorks() {
  return (
    <main style={{ minHeight: "100vh", background: BG, color: INK, paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
      <div style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }} className="max-w-lg mx-auto px-4">
        <BackPill fallback="/matchweek" tone="play" />

        {/* Hero */}
        <div
          className="rounded-2xl relative overflow-hidden"
          style={{
            marginTop: 14, padding: "22px 20px",
            background: "linear-gradient(150deg, rgba(0,216,192,0.10), rgba(0,216,192,0.02))",
            border: "1px solid rgba(0,216,192,0.22)",
          }}
        >
          <p className="font-display tracking-widest" style={{ fontSize: 10, color: TEAL, marginBottom: 10 }}>
            GAMEDAY QUIZ
          </p>
          <p className="font-display text-white" style={{ fontSize: 38, lineHeight: 0.92, letterSpacing: "-0.015em" }}>
            <span style={{ display: "block" }}>Know your</span>
            <span style={{ display: "block" }}>football.</span>
          </p>
          <p className="font-body" style={{ fontSize: 14, color: MUTED, marginTop: 12, maxWidth: "82%", lineHeight: 1.5 }}>
            A quiz for every match, and a club table your score feeds. Play for the badge.
          </p>
        </div>

        {/* The four beats */}
        <div className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${LINE}`, padding: 20, marginTop: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {BEATS.map((b) => <Beat key={b.n} {...b} />)}
          </div>
        </div>

        {/* CTA back to the tab */}
        <Link
          href="/matchweek"
          className="flex items-center justify-center rounded-2xl font-display active:scale-[0.99] transition-transform"
          style={{
            marginTop: 16, height: 52, fontSize: 15, letterSpacing: "0.01em",
            background: TEAL, color: "#062018",
          }}
        >
          Play today&rsquo;s quiz
        </Link>
        <p className="font-body" style={{ fontSize: 12, color: MUTED, marginTop: 10, textAlign: "center" }}>
          Set your club once and your scores start counting toward its table.
        </p>
      </div>
      <BottomNav />
    </main>
  );
}
