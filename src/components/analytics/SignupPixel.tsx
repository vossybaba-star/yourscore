"use client";

import { useEffect } from "react";

// X (Twitter) "Lead Generation Tracker" conversion event on pixel p6vxh.
// Base twq pixel is loaded in app/layout.tsx; this only fires the event.
const X_SIGNUP_EVENT_ID = process.env.NEXT_PUBLIC_X_SIGNUP_EVENT_ID || "tw-p6vxh-p6vxj";

declare global {
  interface Window {
    twq?: (...args: unknown[]) => void;
  }
}

/**
 * Fires the X signup conversion exactly once when the auth callback redirects a
 * brand-new user back with `?signup=1`. Reads window.location directly (no
 * useSearchParams) so it needs no Suspense boundary, then strips the flag from
 * the URL so a refresh or shared link can't double-count the signup.
 */
export function SignupPixel() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") !== "1") return;

    window.twq?.("event", X_SIGNUP_EVENT_ID, {});

    params.delete("signup");
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);
  }, []);

  return null;
}
