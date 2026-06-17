"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import { hasPromptedPush, markPushPrompted } from "@/lib/onboarding";
import { GridBackground } from "@/components/ui/GridBackground";

// Apple Guideline 4.5.4 in-context soft pre-prompt, decoupled from the onboarding
// overlay. The native sign-in flow ends in a full-page reload (NativeBootstrap),
// which tears the carousel down — so the push ask lives here instead and fires
// the moment a real session exists: right after account creation, and for guests
// the first time they sign in later. Gating on `user` means registerForPush()
// always has a userId to store the device token against.

function PushPrePromptInner() {
  const { user, loading } = useUser();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user && !hasPromptedPush()) setShow(true);
  }, [loading, user]);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    try {
      if (user) await registerForPush(createClient(), user.id);
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
          Never miss
          <br />a challenge
        </h2>
        <p className="font-body text-sm text-text-muted mt-3 max-w-[300px]">
          Get notified when your mates challenge you and when it&apos;s your move.
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
