"use client";

import { track } from "@vercel/analytics";
import { useEffect } from "react";
import { afRegistration } from "@/lib/analytics/appsflyerEvents";
import { getDeviceId } from "@/lib/analytics/deviceId";

// Conversion IDs. Pixel base scripts live in app/layout.tsx; this only fires events.
const X_SIGNUP_EVENT_ID = process.env.NEXT_PUBLIC_X_SIGNUP_EVENT_ID || "tw-p6vxh-p6vxj";
// Google Ads conversion, e.g. "AW-1234567890/AbCdEfghIJ". Only fires when set.
const GOOGLE_ADS_SIGNUP_SEND_TO = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_SEND_TO;

declare global {
  interface Window {
    twq?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    ttq?: { track?: (...args: unknown[]) => void };
    gtag?: (...args: unknown[]) => void;
    snaptr?: (...args: unknown[]) => void;
  }
}

/**
 * Fires the signup conversion across every ad/analytics platform. Each call is
 * guarded (`?.`) so a missing/blocked pixel never throws and never blocks the rest.
 * Uses each platform's standard registration event so they're auto-recognised in
 * the respective Events Managers (no custom-event setup needed).
 */
function fireSignupConversions() {
  window.twq?.("event", X_SIGNUP_EVENT_ID, {}); // X (Twitter) — Lead / Sign-up
  window.fbq?.("track", "CompleteRegistration"); // Meta
  window.ttq?.track?.("CompleteRegistration"); // TikTok
  window.snaptr?.("track", "SIGN_UP"); // Snapchat
  window.gtag?.("event", "sign_up"); // Google Analytics 4
  if (GOOGLE_ADS_SIGNUP_SEND_TO) {
    window.gtag?.("event", "conversion", { send_to: GOOGLE_ADS_SIGNUP_SEND_TO }); // Google Ads
  }
  track("signup"); // Vercel Analytics

  // AppsFlyer (native only) — enriched: which sign-in method, and whether they
  // played as a guest before registering (converted_from_guest). Method comes off
  // the auth callback URL if present; guest-convert is inferred from a prior game.
  const params = new URLSearchParams(window.location.search);
  const rawMethod = (params.get("method") || params.get("provider") || "").toLowerCase();
  const method = (["apple", "google", "email", "magic"] as const).find((m) => m === rawMethod);
  let convertedFromGuest = false;
  try {
    convertedFromGuest = localStorage.getItem("af:once:first_game_complete") === "1";
  } catch {
    /* storage blocked — leave false */
  }
  afRegistration({ method, convertedFromGuest });
}

/**
 * Fires the signup conversion exactly once when the auth callback redirects a
 * brand-new user back with `?signup=1`. Reads window.location directly (no
 * useSearchParams) so it needs no Suspense boundary, then strips the flag from
 * the URL so a refresh or shared link can't double-count the signup.
 */
export function SignupPixel() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") !== "1") return;

    fireSignupConversions();

    // Persist the visitor's first-touch acquisition source AND their durable
    // device id onto their new profile. The source is captured on landing by
    // AcquisitionCapture; the device id survives the guest→signup transition so
    // pre-signup guest activity can later be linked to the account. Both are
    // first-touch on the server (written only while still null). Fire-and-forget.
    try {
      const acq = localStorage.getItem("ys:acq");
      const base = acq ? (JSON.parse(acq) as Record<string, unknown>) : {};
      const deviceId = getDeviceId();
      if (acq || deviceId) {
        void fetch("/api/profile/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...base, device_id: deviceId }),
          keepalive: true,
        });
      }
    } catch {
      /* storage blocked or bad JSON — skip */
    }

    params.delete("signup");
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);
  }, []);

  return null;
}
