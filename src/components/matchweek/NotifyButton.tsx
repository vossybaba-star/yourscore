"use client";

/**
 * "Notify me" for one fixture's halftime quiz — used on the Your-next-quiz tile
 * and on every card in the upcoming carousel.
 *
 * Deliberately honest about the two ways this can't work:
 *  - signed out  → "Sign in to get notified" (we'd have nobody to push)
 *  - no consent  → "Turn notifications on" links to settings, because release
 *                  respects notifications_opt_in and would silently skip them.
 * Anything else would be a button that promises a push we never send.
 */

import Link from "next/link";
import { useState } from "react";
import type { RemindersState } from "./useReminders";

const TEAL = "#00d8c0";

export function NotifyButton({
  fixtureId,
  reminders,
  size = "sm",
}: {
  fixtureId: number;
  reminders: RemindersState;
  size?: "sm" | "md";
}) {
  const [error, setError] = useState<string | null>(null);
  const { ids, signedIn, optedIn, loaded, toggle } = reminders;

  if (!loaded) return null;

  const pad = size === "md" ? "px-3.5 py-2" : "px-2.5 py-1.5";
  const text = size === "md" ? "text-xs" : "text-[11px]";
  const base = `flex-shrink-0 rounded-full font-body ${text} ${pad} transition-colors`;

  if (!signedIn) {
    return (
      <Link href="/login" className={base}
        style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.1)" }}>
        Sign in to get notified
      </Link>
    );
  }

  if (!optedIn) {
    return (
      <Link href="/settings" className={base}
        style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.1)" }}>
        Turn notifications on
      </Link>
    );
  }

  const on = ids.has(fixtureId);

  return (
    <button
      onClick={async () => {
        setError(null);
        const err = await toggle(fixtureId);
        if (err) setError(err);
      }}
      aria-pressed={on}
      aria-label={on ? "Stop notifying me about this quiz" : "Notify me when this quiz drops"}
      className={base}
      style={{
        background: on ? "rgba(0,216,192,0.14)" : "transparent",
        color: on ? TEAL : "#8a948f",
        border: `1px solid ${on ? "rgba(0,216,192,0.45)" : "rgba(255,255,255,0.12)"}`,
        fontWeight: on ? 600 : 500,
      }}
      title={error ?? undefined}
    >
      {error ? error : on ? "✓ Notifying you" : "Notify me"}
    </button>
  );
}
