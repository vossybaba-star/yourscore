"use client";

/**
 * Matchweek — the tab for the live, fixture-synced side of YourScore.
 *
 * It gathers the three things that only happen around real Premier League
 * matches, each of which self-hides when it is not their moment:
 *   1. HalftimeRail   — the quiz packs that drop at the real half-time whistle.
 *   2. ClubPicker     — pick the club you represent (once, locked for the season).
 *   3. ClubTable      — how your fanbase ranks against the rest this gameweek.
 * plus a prediction poll at the end of every pack (a call on the second half).
 *
 * On a quiet day all three render nothing, so the evergreen "how it works" card
 * at the bottom is always present — the tab is never an empty screen, and a new
 * player who taps in between matches learns what the tab is for.
 */

import { HalftimeRail } from "@/components/halftime/HalftimeRail";
import { ClubPicker } from "@/components/clubs/ClubPicker";
import { ClubTable } from "@/components/clubs/ClubTable";
import { BottomNav } from "@/components/ui/BottomNav";

const TEAL = "#00d8c0";

function HowItWorks() {
  const steps = [
    { n: "1", t: "Every fixture gets a quiz", d: "A pack for each Premier League match, dropping the moment the real half-time whistle blows." },
    { n: "2", t: "Call the second half", d: "Finish a pack and predict who wins — one pick, graded at full time." },
    { n: "3", t: "Represent your club", d: "Your scores stack up with every other fan of your club. Best average per fan tops the table." },
  ];
  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl p-5 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>
          HOW MATCHWEEK WORKS
        </p>
        <div className="flex flex-col gap-4">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-3.5">
              <div
                className="flex-shrink-0 flex items-center justify-center font-display text-sm rounded-full"
                style={{ width: 26, height: 26, background: `${TEAL}18`, color: TEAL, border: `1px solid ${TEAL}35` }}
              >
                {s.n}
              </div>
              <div className="min-w-0">
                <p className="font-body text-sm text-white font-semibold">{s.t}</p>
                <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MatchweekPage() {
  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: 96 }}>
      {/* Header */}
      <div className="max-w-lg mx-auto px-4 pt-8 pb-2">
        <h1 className="font-display text-3xl text-white leading-none">MATCHWEEK</h1>
        <p className="font-body text-sm mt-1.5" style={{ color: "#8a948f" }}>
          Live quizzes at half time · your club vs the rest
        </p>
      </div>

      {/* The live stack — each piece self-hides when it is not its moment. */}
      <div className="pt-2">
        <HalftimeRail />
        <ClubPicker />
        <ClubTable />
      </div>

      {/* Evergreen: keeps the tab from ever being an empty screen, and onboards
          a first-time visitor who lands here between matches. */}
      <HowItWorks />

      <BottomNav />
    </div>
  );
}
