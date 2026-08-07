"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import { hasPromptedPush, markPushPrompted } from "@/lib/onboarding";

// Reusable in-context push opt-in card. Drop it on any post-engagement surface
// (quiz results, 38-0 match result, …) with copy tuned to that moment. It
// breaks the dead-end opt-in flow: accepting flips notifications_opt_in AND
// fires the OS push grant (registerForPush), which is the ONLY way a device
// token gets created.
//
// Guards: native only (web push isn't wired — no false promise), shown at most
// once per device across all surfaces, and never to someone already opted in.

export function NotifyOptInCard({
  userId,
  accent,
  headline,
  body,
  doneHeadline = "You're on the list",
  doneBody = "We'll let you know.",
}: {
  userId: string;
  accent: string;
  headline: string;
  body: string;
  doneHeadline?: string;
  doneBody?: string;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isNative() || hasPromptedPush()) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("profiles")
        .select("notifications_opt_in")
        .eq("id", userId)
        .single();
      if (cancelled) return;
      if (data?.notifications_opt_in === true) {
        markPushPrompted();
        return;
      }
      setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.from("profiles").update({ notifications_opt_in: true }).eq("id", userId);
      await registerForPush(supabase, userId);
      setDone(true);
    } catch (e) {
      console.warn("[notify-optin] enable failed", e);
      setDone(true);
    } finally {
      markPushPrompted();
      setBusy(false);
    }
  }

  function later() {
    markPushPrompted();
    setShow(false);
  }

  if (done) {
    return (
      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: `${accent}14`, border: `1px solid ${accent}40` }}>
        <span className="text-lg" aria-hidden>🔔</span>
        <div>
          <p className="font-display text-sm tracking-wide" style={{ color: accent }}>{doneHeadline}</p>
          <p className="font-body text-xs text-text-muted">{doneBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: `linear-gradient(135deg, ${accent}1f 0%, rgba(10,10,15,0.6) 80%)`, border: `1px solid ${accent}40` }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 42, height: 42, background: `${accent}26` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
        <div>
          <p className="font-display text-base tracking-wide text-white leading-tight">{headline}</p>
          <p className="font-body text-xs text-text-muted mt-1 leading-relaxed">{body}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={enable} disabled={busy}
          className="flex-1 rounded-xl py-3 font-display text-sm tracking-widest active:scale-[0.97] transition-transform disabled:opacity-70"
          style={{ background: accent, color: "#0a0a0f" }}>
          {busy ? "Enabling…" : "Notify me →"}
        </button>
        <button onClick={later} disabled={busy}
          className="rounded-xl py-3 px-4 font-body text-sm text-text-muted hover:text-white transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
