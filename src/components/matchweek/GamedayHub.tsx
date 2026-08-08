"use client";

/**
 * The live Gameday Quiz experience (founder 8 Aug: lifted out of the PL page so
 * /matchweek can be a clean News/Table/Fixtures/Feed hub). Everything that used
 * to sit under the PL page's "Gameday Quiz" section lives here now, on its own
 * /gameday-quiz route, reachable from Play and the home tiles.
 *
 * The club-fan leaderboard is NOT here — it moved into Leagues (the social home
 * for every game). Every tile below already self-hides off its moment (the
 * halftime rail off-matchday, etc.), so this is never a blank screen.
 */

import { GamedayRail } from "@/components/quiz/GamedayRail";
import { ClubPicker } from "@/components/clubs/ClubPicker";
import { NextClubQuiz } from "@/components/matchweek/NextClubQuiz";
import { AppNudge } from "@/components/matchweek/AppNudge";
import { useReminders } from "@/components/matchweek/useReminders";
import { UpcomingQuizzes } from "@/components/matchweek/UpcomingQuizzes";
import { StandaloneHalftimePoll } from "@/components/matchweek/StandaloneHalftimePoll";
import { QuizStatTiles } from "@/components/matchweek/QuizStatTiles";
import { GamedayNotifyPrompt } from "@/components/matchweek/GamedayNotifyPrompt";

export function GamedayHub() {
  // One shared reminders store — AppNudge reads the same state the buttons
  // write, so the app pitch appears once, not once per card.
  const reminders = useReminders();
  return (
    <div className="pt-1">
      {/* Web fan just set a reminder → lead with the app (email is the fallback). */}
      <AppNudge reminders={reminders} />
      {/* THEIR game — the only fixture that scores for their club. */}
      <NextClubQuiz />
      <StandaloneHalftimePoll />
      <GamedayRail />
      <ClubPicker />
      <UpcomingQuizzes />
      <QuizStatTiles />
      {/* Landed here (usually from the home Gameday tile)? Nudge a reminder for
          their club's first pack. Once, until they act. */}
      <GamedayNotifyPrompt reminders={reminders} />
    </div>
  );
}
