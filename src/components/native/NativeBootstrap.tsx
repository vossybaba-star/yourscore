"use client";

import { useEffect } from "react";
import { isNative, closeOAuthBrowser, exchangeCodeFromDeepLink } from "@/lib/native";
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
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    let cleanup: (() => void) | null = null;

    (async () => {
      const { App } = await import("@capacitor/app");
      const supabase = createClient();

      // Catch the OAuth callback URL that may have launched the app while it
      // wasn't running. App.getLaunchUrl returns the original cold-launch URL
      // exactly once.
      const launch = await App.getLaunchUrl();
      if (launch?.url?.startsWith("yourscore://auth/callback")) {
        const result = await exchangeCodeFromDeepLink(supabase, launch.url);
        await closeOAuthBrowser();
        if (result.ok) {
          window.location.href = safeNext(new URL(launch.url).searchParams.get("next"));
        } else {
          console.warn("[native-auth] cold launch", result.error);
        }
      }

      // Warm-state callbacks: app already running, OAuth redirects back to it.
      const handler = await App.addListener("appUrlOpen", async (event) => {
        if (!event?.url) return;
        if (!event.url.startsWith("yourscore://auth/callback")) return;
        const result = await exchangeCodeFromDeepLink(supabase, event.url);
        await closeOAuthBrowser();
        if (!result.ok) {
          console.warn("[native-auth]", result.error);
          return;
        }
        window.location.href = safeNext(new URL(event.url).searchParams.get("next"));
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
