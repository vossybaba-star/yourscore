// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://83a65c03b79c00aec772d456da7e9785@o4511509752774656.ingest.de.sentry.io/4511509782986832",

  // Middleware runs on every single request, so it dominates trace volume: 35k of the
  // 53k transactions in a sample 24h, which exhausted the org's monthly span quota and
  // made Sentry answer the ingest tunnel with 429 span_usage_exceeded. Its traces carry
  // almost no diagnostic value (it only refreshes the auth cookie), so sample it thinly.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.02 : 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
