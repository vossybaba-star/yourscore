// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://83a65c03b79c00aec772d456da7e9785@o4511509752774656.ingest.de.sentry.io/4511509782986832",

  // 10% in production to stay inside the span quota — matches instrumentation-client.ts.
  // Tracing at 100% here (with edge/middleware) is what exhausted it.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Do NOT attach IPs/cookies/headers to events — matches the privacy posture
  // everywhere else (EU data infra, PostHog masking). Flip only with a specific need.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
});
