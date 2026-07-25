"use client";

/**
 * Matchweek — the football super-hub. Two top-level sections (Fantasy moved out
 * to its own bottom-nav tab, founder 2026-07-25):
 *
 *   Matchweek     → sub-tabs News · Table · Fixtures  (the Premier League week)
 *   Gameday Quiz  → quiz packs per fixture · club-fan ranks
 *
 * The TAB is "PL" (founder, 2026-07-16) — everything in here is the Premier
 * League: the gameday quizzes are PL fixtures. The first
 * section keeps the name "Matchweek" rather than "PL", which would have made the
 * fixture list live at PL → PL. Route stays /matchweek; `section` key stays "pl"
 * so no URL or state contract moves for a label change.
 *
 * Everything the sections render already self-hides when it's not its moment
 * (the halftime rail off-matchday, the club table with no gameweek), and the PL
 * sub-tabs carry their own empty states, so no combination of tabs is ever a
 * blank screen.
 */

import { useState } from "react";
import { GamedayRail } from "@/components/quiz/GamedayRail";
import { ClubPicker } from "@/components/clubs/ClubPicker";
import { ClubTableTile } from "@/components/clubs/ClubTableTile";
import { PlFixtures } from "@/components/matchweek/PlFixtures";
import { PlTable } from "@/components/matchweek/PlTable";
import { PlNews } from "@/components/matchweek/PlNews";
import { NextClubQuiz } from "@/components/matchweek/NextClubQuiz";
import { AppNudge } from "@/components/matchweek/AppNudge";
import { useReminders } from "@/components/matchweek/useReminders";
import { UpcomingQuizzes } from "@/components/matchweek/UpcomingQuizzes";
import { StandaloneHalftimePoll } from "@/components/matchweek/StandaloneHalftimePoll";
import { QuizStatTiles } from "@/components/matchweek/QuizStatTiles";
import { LiveQuizIntro } from "@/components/matchweek/LiveQuizIntro";
import { HowItWorksTile } from "@/components/matchweek/HowItWorksTile";
import { BottomNav } from "@/components/ui/BottomNav";

const TEAL = "#00d8c0";

type Section = "pl" | "live";
type PlTab = "news" | "table" | "fixtures";

// Fantasy moved to its OWN bottom-nav tab (founder, 25 Jul), so the PL tab is
// just the week + the gameday quiz now.
const SECTIONS: { key: Section; label: string }[] = [
  { key: "pl", label: "Matchweek" },
  { key: "live", label: "Gameday Quiz" },
];
const PL_TABS: { key: PlTab; label: string }[] = [
  { key: "news", label: "News" },
  { key: "table", label: "Table" },
  { key: "fixtures", label: "Fixtures" },
];

export default function MatchweekPage() {
  const [section, setSection] = useState<Section>("pl");
  // One shared reminders store for the section — AppNudge reads the same state
  // the buttons write, so the app pitch appears once, not once per card.
  const reminders = useReminders();
  const [plTab, setPlTab] = useState<PlTab>("news");

  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: 96 }}>
      {/* Header — titled for the TAB, not the section. Leaving this as
          "MATCHWEEK" would have re-created the collision one level down: a page
          called Matchweek whose first section is also Matchweek.

          /matchweek is the one main tab with no GamesNav above it, so nothing
          else supplies the notch inset — without it the title sat under the iOS
          status-bar clock (founder, 25 Jul). Clear the inset here so this tab
          starts where every other tab starts. */}
      <div
        className="max-w-lg mx-auto px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 22px)" }}
      >
        <h1 className="font-display text-3xl text-white leading-none">PREMIER LEAGUE</h1>
        <p className="font-body text-sm mt-1.5" style={{ color: "#8a948f" }}>
          The week · gameday quiz
        </p>
      </div>

      {/* Top-level section bar */}
      <div className="max-w-lg mx-auto px-4" data-tour="pl-sections">
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

      {/* ── Matchweek (section key stays "pl") ──────────────────────────── */}
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

      {/* ── Gameday Quiz ────────────────────────────────────────────────── */}
      {section === "live" && (
        <div className="pt-1">
          {/* A one-tap door to the full explainer, before the headline. */}
          <HowItWorksTile
            href="/gameday-quiz"
            title="How Gameday Quiz works"
            sub="Packs, scoring and playing for your club, in short."
          />
          {/* Headlines first: what Gameday Quiz IS, before anything it shows you. */}
          <LiveQuizIntro />
          {/* Web fan just set a reminder → lead with the app (email is the fallback). */}
          <AppNudge reminders={reminders} />
          {/* Then THEIR game — the only fixture that scores for their club. */}
          <NextClubQuiz />
          <StandaloneHalftimePoll />
          <GamedayRail />
          <ClubPicker />
          <UpcomingQuizzes />
          <ClubTableTile />
          <QuizStatTiles />
        </div>
      )}

      {/* Fantasy now lives in its own bottom-nav tab (/fantasy), not here. */}

      <BottomNav />
    </div>
  );
}
