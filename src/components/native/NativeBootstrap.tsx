"use client";

import { useEffect } from "react";
import { isNative, closeOAuthBrowser, exchangeCodeFromDeepLink } from "@/lib/native";
import { initAppsFlyer } from "@/lib/native/appsflyer";
import { createClient } from "@/lib/supabase/client";

// Only allow same-origin relative redirects. Rejects absolute URLs
// (https://evil.com), protocol-relative (//evil.com) and javascript: payloads
// that a malicious deep link could put in ?next= to hijack the in-app webview.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function NativeBootstrap() {
  useEffect(() => {
    if (!isNative()) return;

    // Start AppsFlyer for mobile install attribution (no-op on web). Runs even
    // without Supabase configured — it's independent of auth.
    void initAppsFlyer();

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    let cleanup: (() => void) | null = null;

    (async () => {
      const { App } = await import("@capacitor/app");
      const supabase = createClient();

      // Handle an auth deep link (custom scheme): OAuth + magic-link land on
      // yourscore://auth/callback (→ next); password reset on
      // yourscore://auth/reset-password (→ the in-app set-password screen).
      // Either way we exchange the PKCE code here (the verifier lives in this
      // webview), establishing the session, then route.
      const handleAuthDeepLink = async (url: string): Promise<void> => {
        const isCallback = url.startsWith("yourscore://auth/callback");
        const isReset = url.startsWith("yourscore://auth/reset-password");
        if (!isCallback && !isReset) return;
        const result = await exchangeCodeFromDeepLink(supabase, url);
        await closeOAuthBrowser();
        if (!result.ok) { console.warn("[native-auth]", result.error); return; }
        window.location.href = isReset ? "/auth/reset-password" : safeNext(new URL(url).searchParams.get("next"));
      };

      // Cold launch: the deep link may have launched the app while it wasn't
      // running. App.getLaunchUrl returns the original cold-launch URL once.
      const launch = await App.getLaunchUrl();
      if (launch?.url) await handleAuthDeepLink(launch.url);

      // Warm state: app already running when the deep link returns.
      const handler = await App.addListener("appUrlOpen", async (event) => {
        if (event?.url) await handleAuthDeepLink(event.url);
      });

      // Push registration intentionally NOT auto-triggered on sign-in. Apple
      // Guideline 4.5.4 / 5.1.1 prefers an in-context pre-prompt before the
      // system permission alert. Wire registerForPush() (src/lib/push.ts) to
      // an explicit user action (e.g. settings toggle or first match sign-up)
      // in a future release.

      cleanup = () => {
        handler.remove();
      };
    })();

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
