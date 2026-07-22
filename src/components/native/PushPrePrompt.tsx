"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import { hasPromptedPush, markPushPrompted, snoozePushPrompt } from "@/lib/onboarding";

// Apple Guideline 4.5.4 soft pre-prompt — our own UI; the OS permission dialog
// only fires when the user taps Enable. Shown proactively the first time a real
// session exists (right after signup / first sign-in), so the opt-in is the
// first thing a new user sees. This is the primary acquisition surface for push
// permission; the in-context cards (NotifyOptInCard) are a backup for anyone who
// taps "Maybe later". Gating on `user` means registerForPush() always has a
// userId to store the device token against.

function PushPrePromptInner() {
  const { user, loading } = useUser();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user || hasPromptedPush()) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("profiles")
        .select("notifications_opt_in")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (data?.notifications_opt_in === true) {
        // Already opted in (e.g. via a contextual card) — make sure the OS grant
        // + device token actually exist, silently, then never prompt again.
        registerForPush(createClient(), user.id).catch(() => {});
        markPushPrompted();
        return;
      }
      // Not opted in yet → make the ask, up front.
      setShow(true);
    })();
    return () => { cancelled = true; };
  }, [loading, user]);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    try {
      if (user) {
        const supabase = createClient();
        // Flip the consent flag first so the send pipeline counts them even if
        // the OS dialog is slow / dismissed.
        await supabase.from("profiles").update({ notifications_opt_in: true }).eq("id", user.id);
        await registerForPush(supabase, user.id);
      }
    } catch (e) {
      console.warn("[push] pre-prompt enable failed", e);
    } finally {
      markPushPrompted();
      setShow(false);
      setBusy(false);
    }
  }

  function later() {
    // Snooze, don't kill: writing the permanent flag here silenced every future
    // push ask on the device forever (the "backup" NotifyOptInCard included).
    snoozePushPrompt();
    setShow(false);
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center px-6"
      style={{
        background: "rgba(5,5,10,0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={() => { if (!busy) later(); }}
    >
      <div
        className="relative w-full max-w-[360px] overflow-hidden rounded-[28px] p-7 text-center"
        style={{
          background: "#12121b",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{ background: "radial-gradient(80% 100% at 50% 0%, #aeea0026, transparent 72%)" }}
        />

        <div className="relative">
          <div
            className="mx-auto flex items-center justify-center rounded-2xl mb-5"
            style={{ width: 60, height: 60, background: "rgba(174,234,0,0.15)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#aeea00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>

          <h2 className="font-display text-[2rem] leading-[0.95] uppercase text-white">
            Be first
            <br />on the board
          </h2>
          <p className="font-body text-sm text-text-muted mt-3">
            There&apos;s a new board to top every day. We&apos;ll ping you the moment it goes live, so you can grab top spot before everyone else.
          </p>

          <div className="mt-6 space-y-2">
            <button
              onClick={enable}
              disabled={busy}
              className="btn-ticket w-full justify-center py-3.5 text-base disabled:opacity-70"
            >
              {busy ? "Enabling…" : "Enable notifications"}
            </button>
            <button
              onClick={later}
              disabled={busy}
              className="w-full py-2.5 font-body text-sm text-text-muted hover:text-white transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Outer guard — never mount the inner (and its Supabase session read) on web or
// once the prompt has already been shown.
export function PushPrePrompt() {
  const [engage, setEngage] = useState<boolean | null>(null);

  useEffect(() => {
    setEngage(isNative() && !hasPromptedPush());
  }, []);

  if (!engage) return null;
  return <PushPrePromptInner />;
}
