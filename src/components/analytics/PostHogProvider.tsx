"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { initPostHog, posthog } from "@/lib/posthog/client";
import { useUser } from "@/hooks/useUser";

const ENABLED = !!process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Manual $pageview on every App Router navigation. useSearchParams must sit
// behind a Suspense boundary (below) or it opts the whole tree into dynamic
// rendering.
function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

// Tie recordings to the Supabase user id (a UUID — not PII) so a session can be
// found by user. Email/name are never sent. Resets only on an actual logout so
// anonymous sessions aren't fragmented on every load.
function PostHogIdentify() {
  const { user, loading } = useUser();
  const identified = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (user?.id) {
      if (identified.current !== user.id) {
        posthog.identify(user.id);
        identified.current = user.id;
      }
    } else if (identified.current) {
      posthog.reset();
      identified.current = null;
    }
  }, [user?.id, loading]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  if (!ENABLED) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}
