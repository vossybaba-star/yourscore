"use client";

/**
 * Matchweek — the football super-hub. Three top-level sections (design locked
 * with the founder, 2026-07-15):
 *
 *   PL         → sub-tabs News · Table · Fixtures  (the Premier League week)
 *   Live Quiz  → halftime quiz packs + "call the second half" · club-fan ranks
 *   Fantasy    → the fantasy hub (placeholder this pass; wired when fantasy merges)
 *
 * Everything the sections render already self-hides when it's not its moment
 * (the halftime rail off-matchday, the club table with no gameweek), and the PL
 * sub-tabs carry their own empty states, so no combination of tabs is ever a
 * blank screen.
 */

import { useState } from "react";
import { HalftimeRail } from "@/components/halftime/HalftimeRail";
import { ClubPicker } from "@/components/clubs/ClubPicker";
import { ClubTable } from "@/components/clubs/ClubTable";
import { PlFixtures } from "@/components/matchweek/PlFixtures";
import { PlTable } from "@/components/matchweek/PlTable";
import { PlNews } from "@/components/matchweek/PlNews";
import { BottomNav } from "@/components/ui/BottomNav";

const TEAL = "#00d8c0";

type Section = "pl" | "live" | "fantasy";
type PlTab = "news" | "table" | "fixtures";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "pl", label: "PL" },
  { key: "live", label: "Live Quiz" },
  { key: "fantasy", label: "Fantasy" },
];
const PL_TABS: { key: PlTab; label: string }[] = [
  { key: "news", label: "News" },
  { key: "table", label: "Table" },
  { key: "fixtures", label: "Fixtures" },
];

export default function MatchweekPage() {
  const [section, setSection] = useState<Section>("pl");
  const [plTab, setPlTab] = useState<PlTab>("fixtures");

  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: 96 }}>
      {/* Header */}
      <div className="max-w-lg mx-auto px-4 pt-8 pb-3">
        <h1 className="font-display text-3xl text-white leading-none">MATCHWEEK</h1>
        <p className="font-body text-sm mt-1.5" style={{ color: "#8a948f" }}>
          The Premier League week · live quizzes · fantasy
        </p>
      </div>

      {/* Top-level section bar */}
      <div className="max-w-lg mx-auto px-4">
        <div className="flex gap-1.5 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
          {SECTIONS.map((s) => {
            const on = section === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className="flex-1 rounded-xl py-2 font-display text-sm tracking-wide transition-colors"
                style={{ background: on ? TEAL : "transparent", color: on ? "#062018" : "#8a948f" }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── PL ──────────────────────────────────────────────────────────── */}
      {section === "pl" && (
        <>
          <div className="max-w-lg mx-auto px-4 pt-4">
            <div className="flex gap-5 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              {PL_TABS.map((t) => {
                const on = plTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setPlTab(t.key)}
                    className="pb-2.5 font-body text-sm transition-colors relative"
                    style={{ color: on ? "#fff" : "#8a948f" }}
                  >
                    {t.label}
                    {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full" style={{ background: TEAL }} />}
                  </button>
                );
              })}
            </div>
          </div>
          {plTab === "news" && <PlNews />}
          {plTab === "table" && <PlTable />}
          {plTab === "fixtures" && <PlFixtures />}
        </>
      )}

      {/* ── Live Quiz ───────────────────────────────────────────────────── */}
      {section === "live" && (
        <div className="pt-1">
          <HalftimeRail />
          <ClubPicker />
          <ClubTable />
          <LiveQuizIntro />
        </div>
      )}

      {/* ── Fantasy (placeholder this pass) ─────────────────────────────── */}
      {section === "fantasy" && (
        <div className="max-w-lg mx-auto px-4 pt-6">
          <div className="rounded-2xl p-8 bg-surface text-center" style={{ border: `1px solid ${TEAL}25` }}>
            <div className="text-3xl mb-3">⚽️</div>
            <p className="font-display text-lg text-white mb-1">Fantasy is coming</p>
            <p className="font-body text-sm" style={{ color: "#8a948f" }}>
              Pick your squad, join leagues, and track your points through the season — all here in Matchweek.
            </p>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}

/** A short "what Live Quiz is" note under the rail — onboards a first-timer and
 *  keeps the section from ending abruptly on a quiet day. */
function LiveQuizIntro() {
  const steps = [
    { n: "1", t: "A quiz at every half time", d: "One pack per fixture, dropping the moment the real whistle blows." },
    { n: "2", t: "Call the second half", d: "Finish a pack and predict who wins — one pick, graded at full time." },
    { n: "3", t: "Represent your club", d: "Your scores stack with every other fan of your club. Best average per fan tops the table." },
  ];
  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl p-5 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>HOW LIVE QUIZ WORKS</p>
        <div className="flex flex-col gap-4">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-3.5">
              <div className="flex-shrink-0 flex items-center justify-center font-display text-sm rounded-full"
                style={{ width: 26, height: 26, background: `${TEAL}18`, color: TEAL, border: `1px solid ${TEAL}35` }}>
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
