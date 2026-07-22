# Technical Health, Analytics Instrumentation & Trust Audit

**Headline:** scoring is genuinely server-authoritative, cron/webhook/admin APIs properly guarded, error boundaries above-average — but product analytics is DEAD CODE, the funnel is unanswerable, ad pixels run with no consent layer for an EU/UK audience, and the quiz prize leaderboard is forgeable from DevTools.

## P1-1 — PostHog is fully unwired: no working funnel/retention analytics
PostHogProvider.tsx (pageview capture, identify, session recording, EU-privacy masking — all built) is imported by NOTHING; initPostHog (lib/posthog/client.ts:10) never called outside it. posthog-js still in package.json:32. GA4 only sees the initial hard load (layout.tsx:117-133 — one gtag('config'), no route-change page_view on the App Router). Founder cannot answer "where do users drop off landing → first game → signup → D1". Client config also defaults to us.i.posthog.com (client.ts:17) — set EU host when wiring. **Fix:** mount <PostHogProvider> in layout, key + EU host, mirror trackGamePlay/Complete, signup, share events into posthog.capture.

## P1-2 — Quiz answers ship pre-game + client-supplied timing → prize-board scores trivially forgeable
/api/challenges/pack (route.ts:19) returns questions INCLUDING answer from a public, edge-cached, unauthenticated route; client grades itself (challenges/[slug]/page.tsx:638). /api/quiz/solo-complete grades server-side but from answers the client already has, and elapsedMs is client-supplied, clamped only to [0, 30000] (solo-complete/route.ts:117); same /api/h2h/play (route.ts:110). A ~10-line script posts a max-speed perfect score. Prize board rides on the daily quiz. **Fix:** strip answer key server-side (reveal can come back in the grade response); server-issued question-start timestamps on prize-eligible packs.

## P1-3 — Multi-pixel ad tracking (Meta, TikTok, X, Snap, GA4) fires on load with no consent gate, UK/EU audience
layout.tsx:116-202 unconditionally injects all pixels afterInteractive. No CMP anywhere. GDPR/UK-GDPR + ePrivacy exposure; also App Store ATT-expectation risk inside the Capacitor webview. **Fix:** region-aware consent gate deferring pixel Scripts until opt-in, or Consent Mode v2 + per-pixel consent APIs (TikTok stub already exposes grantConsent/revokeConsent, layout.tsx:141).

## P2-4 — /messages is a live, unfinished DM feature (worse than a stub) exposed from FriendsPanel
messages/[userId]/page.tsx is a full real-time chat: reads/writes a messages table via the anon client through `as any` (:57,:61,:125), insert trusts client-set sender_id, no error handling on send (:125-130). Reachable via FriendsPanel link. Either a security hole (if RLS lax) or silent send failures (if strict). **Fix:** confirm RLS (sender_id = auth.uid(), recipient-scoped reads); if not ready, remove the FriendsPanel entry point.

## P2-5 — Global REALTIME_ENABLED hard-coded true — documented incident kill-switch disarmed
lib/realtime.ts:11 — const true; doc comment describes it as the load-shedding lever from the WC-surge Disk-IO incident. Flipping it now needs a code edit + redeploy under load. **Fix:** env-var back it (NEXT_PUBLIC_REALTIME_ENABLED !== "false").

## P2-6 — Public "community activity" numbers partly fabricated with a seeded baseline
lib/versus/activity.ts:113 — lookingForMatch: Math.max(realLooking, dailyBaseline("looking", 24, 68)). Deterministic fake 24-68 when queues near-empty. TODO(real-presence) ×4. Trust/reputational risk in a prize context. **Fix:** time-boxed seeding flag, label as estimates, or ship real presence.

## P2-7 — /api/auth/validate-email unauthenticated, un-rate-limited, enumerable
validate-email/route.ts:15 — no rate limit, live DNS/deliverability lookups. Every other write route uses rateLimitDistributed (even unauthed draft/share by IP, draft/share/route.ts:41). **Fix:** rateLimitDistributed(`validate-email:${ip}`) mirroring draft/share.

## P2-8 — global-error.tsx shows a bare unbranded Next.js error page
global-error.tsx:23 renders <NextError statusCode={0} /> — unstyled, no CTA. Root-layout crash inside the Capacitor webview = white "Application error" screen with no escape. (Per-segment error.tsx → RouteError is genuinely good.) **Fix:** minimal inline-styled branded fallback with reload button.

## P2-9 — Several public service-role read routes lack the documented data-cache guard
leaderboard/yourscore, leaderboard/wc2026, leagues/discover, versus/activity: service client + only Cache-Control s-maxage header, no fetchCache/dynamic export — the exact CLAUDE.md §4 stale-pin trap (s-maxage controls the CDN, not Vercel's durable Data Cache). **Fix:** export dynamic = "force-dynamic" or fetchCache = "force-no-store" on each.

## P3-10 — sendDefaultPii: true in Sentry
sentry.server.config.ts:19 — attaches IPs, headers/cookies to every event; inconsistent with the PostHog masking stance and no consent layer. **Fix:** false, or scrub in beforeSend.

## P3-11 — viewport maximumScale: 1, userScalable: false fails accessibility zoom
layout.tsx:76-83. WCAG 1.4.4 failure; App Store a11y nit. **Fix:** drop both.

## P3-12 — /admin pages rely only on client rendering (APIs are properly guarded)
Every /api/admin/* calls requireAdmin() (verified) checking app_metadata.is_admin (lib/auth/admin.ts:24) — solid. But src/app/admin/layout.tsx is "use client" with no server-side gate. Low real risk; leaks admin IA. **Fix:** server-component guard or middleware matcher for /admin.

## P3-13 — No offline handling for the wrapped native app
capacitor.config.ts:7 loads remote URL (server.url: yourscore.app) — thin webview over prod, no webDir fallback, no errorPath. No navigator.onLine/offline/service-worker anywhere. Native user offline (or during outage) = dead webview. **Fix:** offline detection + branded offline screen; consider SW-cached shell.

### Verified sound (note the good)
- Scoring truly server-side (weakness is inputs, not arithmetic).
- Cron & webhook auth done right: Bearer CRON_SECRET fails closed; Resend webhook svix-verified, fails closed.
- Empty-catch density low (2 total); hot-path catches commented with recovery.
- Reduced-motion respected (globals.css:205; useReducedMotion in draft components).
- AASA/OneLink/AppsFlyer correctly configured, fail-inert until env-flipped; in-app-review via AppMomentPrompt.tsx.

**Top 3:** wire PostHog (P1-1), strip answers from pack API (P1-2), consent gate (P1-3).
