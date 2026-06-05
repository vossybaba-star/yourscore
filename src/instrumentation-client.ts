// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://83a65c03b79c00aec772d456da7e9785@o4511509752774656.ingest.de.sentry.io/4511509782986832",

  // Session Replay intentionally omitted: it's a large client payload (heavy in a
  // Capacitor webview) and ships to every device. Re-add Sentry.replayIntegration()
  // only if you genuinely need session recordings.

  // Sample 10% of traces in production to control client cost/quota; full in dev.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  enableLogs: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
