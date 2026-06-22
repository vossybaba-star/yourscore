"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import { hasPromptedQuizNotify, markQuizNotifyPrompted } from "@/lib/onboarding";

// In-context opt-in shown on the daily-quiz results screen. This is the
// conversion moment the signup checkbox can't reach: the player has just
// finished, seen their score, and the reward ("be first on tomorrow's board")
// is concrete. Accepting flips notifications_opt_in AND fires the OS push
// grant via registerForPush, so the daily-drop notification can reach them.
//
// Guards: native only (web push isn't wired yet — showing it there would
// promise a notification we can't deliver), daily quizzes only (the "next
// quiz" hook is meaningless for a one-off pack), once per device, and never
// to someone who already opted in.

export function QuizNotifyPrompt({
  userId,
  accent,
  daily,
}: {
  userId: string;
  accent: string;
  daily: boolean;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isNative() || !daily || hasPromptedQuizNotify()) return;
    let cancelled = false;
    (async () => {
      // Already opted in? Then they're covered — don't re-ask.
      const { data } = await createClient()
        .from("profiles")
        .select("notifications_opt_in")
        .eq("id", userId)
        .single();
      if (cancelled) return;
      if (data?.notifications_opt_in === true) {
        markQuizNotifyPrompted();
        return;
      }
      setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, daily]);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    try {
      const supabase = createClient();
      // Flip the consent flag first so the send pipeline + signup pre-prompt
      // treat them as opted-in even if the OS grant is slow / dismissed.
      await supabase.from("profiles").update({ notifications_opt_in: true }).eq("id", userId);
      await registerForPush(supabase, userId);
      setDone(true);
    } catch (e) {
      console.warn("[quiz-notify] enable failed", e);
      setDone(true); // don't trap them — the flag is set, move on
    } finally {
      markQuizNotifyPrompted();
      setBusy(false);
    }
  }

  function later() {
    markQuizNotifyPrompted();
    setShow(false);
  }

  if (done) {
    return (
      <div
        className="rounded-2xl p-4 flex items-center gap-3"
        style={{ background: `${accent}14`, border: `1px solid ${accent}40` }}
      >
        <span className="text-lg" aria-hidden>🔔</span>
        <div>
          <p className="font-display text-sm tracking-wide" style={{ color: accent }}>
            You&apos;re on the list
          </p>
          <p className="font-body text-xs text-text-muted">
            We&apos;ll ping you the second tomorrow&apos;s board opens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: `linear-gradient(135deg, ${accent}1f 0%, rgba(10,10,15,0.6) 80%)`,
        border: `1px solid ${accent}40`,
      }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 42, height: 42, background: `${accent}26` }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
        <div>
          <p className="font-display text-base tracking-wide text-white leading-tight">
            Be first on tomorrow&apos;s board
          </p>
          <p className="font-body text-xs text-text-muted mt-1 leading-relaxed">
            Turn on notifications and we&apos;ll ping you the moment the next quiz drops —
            before everyone else gets their shot at the top.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={enable}
          disabled={busy}
          className="flex-1 rounded-xl py-3 font-display text-sm tracking-widest active:scale-[0.97] transition-transform disabled:opacity-70"
          style={{ background: accent, color: "#0a0a0f" }}
        >
          {busy ? "Enabling…" : "Notify me →"}
        </button>
        <button
          onClick={later}
          disabled={busy}
          className="rounded-xl py-3 px-4 font-body text-sm text-text-muted hover:text-white transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
