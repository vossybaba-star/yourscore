"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import { hasPromptedPush, markPushPrompted } from "@/lib/onboarding";
import { GridBackground } from "@/components/ui/GridBackground";

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
    markPushPrompted();
    setShow(false);
  }

  return (
    <div
      className="fixed inset-0 z-[110] overflow-hidden flex flex-col"
      style={{
        background: "var(--bg)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <GridBackground opacity={0.025} />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 42% at 50% 0%, #aeea0029, transparent 72%)" }}
      />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div
          className="flex items-center justify-center rounded-2xl mb-7"
          style={{ width: 76, height: 76, background: "rgba(174,234,0,0.15)" }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#aeea00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        <h2 className="font-display text-[2.6rem] leading-[0.92] uppercase text-white">
          Be first
          <br />on the board
        </h2>
        <p className="font-body text-sm text-text-muted mt-3 max-w-[300px]">
          There&apos;s a new board to top every day. We&apos;ll ping you the moment it goes live, so you can grab top spot before everyone else.
        </p>
      </div>

      <div
        className="relative z-10 px-7 space-y-3 w-full max-w-[420px] mx-auto"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 18px)" }}
      >
        <button
          onClick={enable}
          disabled={busy}
          className="btn-ticket w-full justify-center py-4 text-lg disabled:opacity-70"
        >
          {busy ? "Enabling…" : "Enable notifications"}
        </button>
        <button
          onClick={later}
          disabled={busy}
          className="w-full py-3 font-body text-sm text-text-muted hover:text-white transition-colors"
        >
          Maybe later
        </button>
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
