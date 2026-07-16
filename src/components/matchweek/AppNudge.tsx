"use client";

/**
 * Shown once a WEB fan sets a halftime reminder. Push is native-only, so their
 * reminder is delivered by email — this LEADS with the app (founder,
 * 2026-07-16), because a halftime pack is live for about the length of the
 * interval and an email simply won't beat a push to it.
 *
 * Confirms the email fallback plainly underneath, so nobody's left wondering
 * whether tapping the button actually did anything. It did.
 *
 * ONE of these for the whole section: it reads the shared reminders store rather
 * than mounting per card, so setting six reminders can't stack six pitches.
 * Frequency-gated weekly in useReminders (nudgeDue).
 */

import { APP_STORE_URL } from "@/lib/appStore";
import type { RemindersState } from "./useReminders";

const TEAL = "#00d8c0";

export function AppNudge({ reminders }: { reminders: RemindersState }) {
  const { nudge, dismissNudge } = reminders;
  if (!nudge) return null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl p-4"
        style={{
          background: "linear-gradient(150deg, rgba(0,216,192,0.12), rgba(0,216,192,0.03))",
          border: "1px solid rgba(0,216,192,0.3)",
        }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg text-white leading-tight">Get the whistle the second it goes</p>
            <p className="font-body text-xs mt-1.5" style={{ color: "#8a948f" }}>
              The pack is only live for the interval. On the app you know the moment it drops.
            </p>
          </div>
          <button onClick={dismissNudge} aria-label="Dismiss"
            className="flex-shrink-0 flex items-center justify-center rounded-full"
            style={{ width: 26, height: 26, color: "#586058", background: "rgba(255,255,255,0.05)" }}>
            ✕
          </button>
        </div>

        <div className="flex items-center gap-3 mt-3.5">
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"
            className="rounded-full font-body text-xs px-4 py-2"
            style={{ background: TEAL, color: "#062018", fontWeight: 700 }}>
            Get YourScore
          </a>
          <span className="font-body text-xs" style={{ color: "#586058" }}>
            Otherwise we&apos;ll email you.
          </span>
        </div>
      </div>
    </div>
  );
}
