// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// ── Third-party noise filtering ──────────────────────────────────────────────
// These patterns were confirmed (Jun 2026) to come from injected scripts, browser
// extensions, and in-app webviews — NOT from YourScore code. They were drowning
// real signal (e.g. a single bogus `CONFIG` ReferenceError logged 571× in 24h) and
// skewing anomaly alerts. Each entry below is intentionally narrow so genuine app
// errors are never suppressed.
const IGNORE_ERRORS: (string | RegExp)[] = [
  // Snapchat in-app browser bridge (injected, not our code).
  /SCDynimacBridge/,
  // Bogus global from an injected ad/sticky-footer script — its frames are
  // updateGapFiller / updateFooterPositions, neither of which exists in our source.
  /Can't find variable: CONFIG/,
  /CONFIG is not defined/,
  // Browser-extension messaging API leaking into the page.
  /runtime\.sendMessage/,
  /Extension context invalidated/,
  // iOS in-app browsers (Instagram/Facebook/TikTok etc.) inject native-bridge
  // probes that evaluate `window.webkit.messageHandlers` in contexts where the
  // page isn't hosted in their webview, so it's undefined. Spikes wherever run
  // links get shared (Jul 2026: ×123/6h on /38-0/wc/run/:id). Confirmed not
  // ours: no unguarded access exists in src or any bundled dep (checked —
  // @capacitor/core 8's only access is existence-guarded, in cordova.js which
  // we never import).
  /window\.webkit\.messageHandlers/,
  // Supabase auth tab-lock contention across multiple open tabs — benign, non-actionable.
  /Acquiring an exclusive Navigator LockManager lock/,
  // Generic interrupted-fetch noise: Safari's "Load failed" / Chrome's "Failed to
  // fetch" fired when a user navigates away or drops connection mid-request. No
  // stack, not actionable. Remove if you ever need raw network-failure visibility.
  /Load failed/,
  /Failed to fetch/,
  // Generic non-Error rejections (almost always third-party scripts).
  /Non-Error promise rejection captured/,
];

// Drop anything whose code actually originated in a browser extension.
const DENY_URLS: (string | RegExp)[] = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-(web-)?extension:\/\//,
];

Sentry.init({
  dsn: "https://83a65c03b79c00aec772d456da7e9785@o4511509752774656.ingest.de.sentry.io/4511509782986832",

  // Session Replay intentionally omitted: it's a large client payload (heavy in a
  // Capacitor webview) and ships to every device. Re-add Sentry.replayIntegration()
  // only if you genuinely need session recordings.

  // Sample 10% of traces in production to control client cost/quota; full in dev.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  enableLogs: true,

  ignoreErrors: IGNORE_ERRORS,
  denyUrls: DENY_URLS,

  // Catch the injected-script `CONFIG` family even if its message ever changes:
  // if every stack frame points at known-injected functions and none at our code,
  // it isn't ours — drop it.
  beforeSend(event) {
    const frames =
      event.exception?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? [];
    if (frames.length > 0) {
      const INJECTED_FNS = ["updateGapFiller", "updateFooterPositions"];
      const allInjected = frames.every((f) =>
        INJECTED_FNS.includes(f.function ?? "")
      );
      if (allInjected) return null;
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
