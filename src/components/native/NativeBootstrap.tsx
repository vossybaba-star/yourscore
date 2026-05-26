"use client";

import { useEffect } from "react";
import { isNative, closeOAuthBrowser, exchangeCodeFromDeepLink } from "@/lib/native";
import { registerForPush } from "@/lib/push";
import { createClient } from "@/lib/supabase/client";

export function NativeBootstrap() {
  useEffect(() => {
    if (!isNative()) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    let unmounted = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const { App } = await import("@capacitor/app");
      const supabase = createClient();

      const handler = await App.addListener("appUrlOpen", async (event) => {
        if (!event?.url) return;
        if (!event.url.startsWith("yourscore://auth/callback")) return;
        const result = await exchangeCodeFromDeepLink(supabase, event.url);
        await closeOAuthBrowser();
        if (!result.ok) {
          console.warn("[native-auth]", result.error);
          return;
        }
        const next = new URL(event.url).searchParams.get("next") ?? "/";
        window.location.href = next;
      });

      const { data: authListener } = supabase.auth.onAuthStateChange((evt, session) => {
        if (evt === "SIGNED_IN" && session?.user) {
          void registerForPush(supabase, session.user.id);
        }
      });

      const { data: userResult } = await supabase.auth.getUser();
      if (!unmounted && userResult.user) {
        void registerForPush(supabase, userResult.user.id);
      }

      cleanup = () => {
        handler.remove();
        authListener.subscription.unsubscribe();
      };
    })();

    return () => {
      unmounted = true;
      cleanup?.();
    };
  }, []);

  return null;
}
