import posthog from "posthog-js";

// Lazy, browser-only PostHog init. Returns the singleton either way so callers
// can `import { posthog }` and call methods unconditionally — when the key isn't
// set (local dev, preview, or before configuration) init never runs and every
// capture/identify call is a harmless no-op. This is what keeps session
// recording from silently switching on before we've intentionally configured it.
let initialized = false;

export function initPostHog(): typeof posthog {
  if (initialized || typeof window === "undefined") return posthog;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return posthog; // not configured — stay dormant

  posthog.init(key, {
    // EU cloud by default — matches the rest of the data infra (Supabase Frankfurt,
    // de.sentry.io). Override with NEXT_PUBLIC_POSTHOG_HOST only if the project
    // was created in another region.
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    // Only create person profiles once we've identified a logged-in user — keeps
    // anonymous traffic out of the billable person count and the persons UI.
    person_profiles: "identified_only",
    // App Router does its own client-side navigation, so PostHog's automatic
    // pageview never sees route changes. We fire $pageview manually in the
    // provider instead (see PostHogProvider).
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true, // clicks/inputs for heatmaps — element *text* is still masked below
    session_recording: {
      // Full privacy: mask every input value AND every text node. We keep the
      // visual layout, clicks, scroll, and rage-clicks, but never the actual
      // content a user sees or types — required given the prize board + GDPR
      // self-serve deletion.
      maskAllInputs: true,
      maskTextSelector: "*",
    },
  });

  initialized = true;
  return posthog;
}

export { posthog };
