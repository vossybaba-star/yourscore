"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/push";
import {
  clearPushAsk, recordPushAsk, recordPushDecline, shouldAskPush,
  type PushPermission,
} from "@/lib/onboarding";

// Apple Guideline 4.5.4 soft pre-prompt — our own UI; the OS permission dialog
// only fires when the user taps Enable. Shown proactively the first time a real
// session exists (right after signup / first sign-in), so the opt-in is the
// first thing a new user sees. This is the primary acquisition surface for push
// permission; the in-context cards (NotifyOptInCard) are a backup for anyone who
// taps "Maybe later". Gating on `user` means registerForPush() always has a
// userId to store the device token against.

/** Last value mirrored to the profile, so a no-op open costs no write. */
const PERMISSION_REPORTED_KEY = "yourscore:push-permission-reported";

function PushPrePromptInner({ permission }: { permission: PushPermission }) {
  const { user, loading } = useUser();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  /** OS already refused. The button can only send them to Settings from here. */
  const blocked = permission === "denied";

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("profiles")
        .select("notifications_opt_in")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (data?.notifications_opt_in === true && !blocked) {
        // Opted in and the OS agrees — make sure the device token exists,
        // silently, and stop asking.
        registerForPush(createClient(), user.id).catch(() => {});
        clearPushAsk();
        return;
      }
      recordPushAsk();
      setShow(true);
    })();
    return () => { cancelled = true; };
  }, [loading, user, blocked]);

  if (!show) return null;

  async function enable() {
    setBusy(true);
    try {
      if (blocked) {
        // iOS will not show its permission dialog a second time, so the only
        // route back is the system Settings page for the app.
        //
        // Navigating the webview to the scheme rather than calling a plugin:
        // @capacitor/app has no openUrl in v8, and Capacitor's navigation
        // delegate hands any non-http(s) scheme to UIApplication.open, which is
        // exactly what is needed here.
        window.location.href = "app-settings:";
        recordPushAsk();
        setShow(false);
        return;
      }
      if (user) {
        const supabase = createClient();
        // Flip the consent flag first so the send pipeline counts them even if
        // the OS dialog is slow / dismissed.
        await supabase.from("profiles").update({ notifications_opt_in: true }).eq("id", user.id);
        await registerForPush(supabase, user.id);
        clearPushAsk();
      }
    } catch (e) {
      console.warn("[push] pre-prompt enable failed", e);
    } finally {
      setShow(false);
      setBusy(false);
    }
  }

  function later() {
    // Counts the decline rather than silencing the ask. The cadence itself
    // decides when to come back — and softens once someone has said no enough
    // times that continuing to ask is just noise.
    recordPushDecline();
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

          {/* Two asks, because the user is in two different situations. Someone
              who has never been asked can be shown the OS dialog; someone who
              already refused it can only be sent to Settings, and pretending
              otherwise gives them a button that does nothing. */}
          <h2 className="font-display text-[2rem] leading-[0.95] uppercase text-white">
            {blocked ? (<>Turn news<br />back on</>) : (<>Your club,<br />the moment it breaks</>)}
          </h2>
          <p className="font-body text-sm text-text-muted mt-3">
            {blocked
              ? "Notifications are switched off for YourScore in your iPhone settings. Turn them on there and we can bring you your club's news again."
              : "Follow your club and we'll bring you the story the moment the big desks run it, plus the Daily Briefing at 6pm."}
          </p>

          <div className="mt-6 space-y-2">
            <button
              onClick={enable}
              disabled={busy}
              className="btn-ticket w-full justify-center py-3.5 text-base disabled:opacity-70"
            >
              {busy ? "Enabling…" : blocked ? "Open settings" : "Turn on notifications"}
            </button>
            <button
              onClick={later}
              disabled={busy}
              className="w-full py-2.5 font-body text-sm text-text-muted hover:text-white transition-colors"
            >
              {blocked ? "Not now" : "Maybe later"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Outer guard. Never mounts the inner (and its Supabase read) on web, and asks
 * the OS what it will actually do before deciding to show anything.
 *
 * Re-evaluated on every app open, not once per mount: the founder's ask is that
 * a user who has not enabled notifications is asked essentially every time they
 * open the app, and a cold mount only covers the first launch. `appStateChange`
 * covers returning from background, which is how most opens actually happen.
 */
export function PushPrePrompt() {
  const { user } = useUser();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;

    async function readPermission() {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const p = await PushNotifications.checkPermissions();
        if (cancelled) return;
        const value = p.receive as PushPermission;
        setPermission(value);
        reportPermission(value);
      } catch {
        if (!cancelled) setPermission(null);
      }
    }

    /**
     * Mirror the OS state onto the profile.
     *
     * Server-side, `notifications_opt_in = false` covers two different people:
     * one Apple will still show a dialog to, and one who already refused and can
     * only be recovered through iOS Settings. They are indistinguishable from the
     * database, so there was no way to know whether to push the in-app card
     * harder or lean on the Settings route. This is the only place that can see
     * the difference — the permission lives on the device.
     *
     * Skipped when unchanged: this runs on every app open, and re-writing the
     * same value would be a pointless write per user per open.
     */
    async function reportPermission(value: PushPermission) {
      if (!user) return;
      try {
        if (localStorage.getItem(PERMISSION_REPORTED_KEY) === value) return;
      } catch { /* storage blocked — fall through and write */ }
      try {
        await createClient()
          .from("profiles")
          .update({ push_permission: value, push_permission_at: new Date().toISOString() })
          .eq("id", user.id);
        localStorage.setItem(PERMISSION_REPORTED_KEY, value);
      } catch {
        // Never let telemetry break the prompt.
      }
    }

    readPermission();

    let remove: (() => void) | undefined;
    (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        // Coming back to the foreground IS an app open. Re-read the permission
        // too: the user may have granted it in Settings while we were away.
        if (isActive) { readPermission(); setTick((t) => t + 1); }
      });
      remove = () => handle.remove();
    })();

    return () => { cancelled = true; remove?.(); };
  }, [user]);

  if (!permission) return null;
  if (!shouldAskPush(permission)) return null;
  return <PushPrePromptInner key={tick} permission={permission} />;
}
