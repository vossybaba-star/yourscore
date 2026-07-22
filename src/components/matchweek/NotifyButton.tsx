"use client";

/**
 * "Notify me" for one fixture's halftime quiz — used on the Your-next-quiz tile
 * and on every card in the upcoming carousel.
 *
 * WORKS IN ORDER, never skips (founder, 2026-07-16). Whatever's missing, the tap
 * starts the flow that fixes it and then finishes the job:
 *
 *   signed out   → remember the fixture → /auth/sign-in?next=/matchweek → on
 *                  return, useReminders applies the pending intent, so they land
 *                  back already notified rather than staring at "Notify me".
 *   no consent   → remember the fixture → run the permission + opt-in flow
 *                  in place → apply. No trip to Settings, no dead end.
 *   ready        → plain toggle.
 *
 * The label always says "Notify me" — what's missing is our problem to solve,
 * not a hoop to advertise on the button.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isNative } from "@/lib/native";
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ids, signedIn, optedIn, loaded, toggle, rememberIntent, grantConsent } = reminders;

  if (!loaded) return null;

  const on = ids.has(fixtureId);
  const pad = size === "md" ? "px-3.5 py-2" : "px-2.5 py-1.5";
  const text = size === "md" ? "text-xs" : "text-[11px]";

  async function onClick() {
    setError(null);

    // 1. No account → keep the intent and go get one. They come back notified.
    if (!signedIn) {
      rememberIntent(fixtureId);
      router.push(`/auth/sign-in?next=${encodeURIComponent("/matchweek")}`);
      return;
    }

    // 2. Native, signed in, never consented → run the consent flow here and now,
    //    then apply the reminder (grantConsent finishes the pending intent).
    //    Web is skipped deliberately: push doesn't exist there, so the reminder
    //    is delivered by email and asking for push consent would gate a channel
    //    it has nothing to do with.
    if (isNative() && !optedIn) {
      setBusy(true);
      rememberIntent(fixtureId);
      const err = await grantConsent();
      setBusy(false);
      if (err) setError(err);
      return;
    }

    // 3. Everything in place → just toggle.
    setBusy(true);
    const err = await toggle(fixtureId);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? "Stop notifying me about this quiz" : "Notify me when this quiz drops"}
      className={`flex-shrink-0 rounded-full font-body ${text} ${pad} transition-colors`}
      style={{
        background: on ? "rgba(0,216,192,0.14)" : "transparent",
        color: on ? TEAL : "#8a948f",
        border: `1px solid ${on ? "rgba(0,216,192,0.45)" : "rgba(255,255,255,0.12)"}`,
        fontWeight: on ? 600 : 500,
        opacity: busy ? 0.6 : 1,
      }}
      title={error ?? undefined}
    >
      {error ? error : busy ? "…" : on ? "✓ Notifying you" : "Notify me"}
    </button>
  );
}
