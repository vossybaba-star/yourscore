"use client";

import { NotifyOptInCard } from "@/components/notify/NotifyOptInCard";

// Quiz-results opt-in. Now fires after ANY quiz (not just the daily) so the
// audience builds from every finisher; copy sharpens for the daily, where the
// "be first on tomorrow's board" hook is strongest.

export function QuizNotifyPrompt({
  userId,
  accent,
  daily,
}: {
  userId: string;
  accent: string;
  daily: boolean;
}) {
  return (
    <NotifyOptInCard
      userId={userId}
      accent={accent}
      headline={daily ? "Be first on tomorrow's board" : "Never miss a new quiz"}
      body={
        daily
          ? "Turn on notifications and we'll ping you the moment the next quiz drops — before everyone else gets their shot at the top."
          : "Get a ping when a fresh quiz lands or a mate beats your score, so you can win it back."
      }
      doneBody={daily ? "We'll ping you the second tomorrow's board opens." : "We'll ping you when the next quiz lands."}
    />
  );
}
