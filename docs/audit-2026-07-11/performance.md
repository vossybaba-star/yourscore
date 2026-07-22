# Performance & Efficiency Audit (static analysis; live payload checks blocked by sandbox proxy)

Cost baseline: one browser→Supabase (Frankfurt) roundtrip ≈ 0.4–1s; client→GoTrue (auth.yourscore.app) same class.

## P1 — /versus mounts a 5-deep client waterfall (~2–5s to full content)
versus/page.tsx:250-251 mounts useYourTurns + useVersusStats. useYourTurns.ts:47-113 = five sequential waves: auth.getUser() → Promise.all of 3 h2h queries (:52) → profiles lookup (:68) → group-participants (:97) → per-board counts (:107). useVersusStats.ts:64-151 adds 3 more waves. Plus VersusDiscovery.tsx:30-45, CommunityHighlights.tsx:111-115, LiveActivityStrip.tsx:34, PublicLeagueCard.tsx:108 — ~15+ browser requests/visit, critical path 4-5 sequential Frankfurt roundtrips. **Fix:** one server-side /api/versus/hub route (per-user, fetchCache="force-no-store") or single RPC → page makes 1 fetch.

## P1 — Picker→quiz path serializes auth before the (already edge-cached) pack fetch
challenges/[slug]/page.tsx:481-540: auth.getUser() (~0.3-0.8s) must resolve before fetch("/api/challenges/pack") starts (:497); then prior-attempt (:524) and leaderboard (:535) run sequentially. Signed-in critical path = 4 sequential roundtrips — this IS the founder's measured ~1s picker→quiz. **Fix:** start pack fetch immediately (needs no uid); use getSession() (localStorage, 0ms); attempt + leaderboard in one Promise.all — critical path drops to 1 edge fetch.

## P1 — Per-navigation auth/badge tax: BottomNav remounts on every route with 4 network calls
BottomNav rendered inside every page (not the layout) → each tab switch remounts. BottomNav.tsx:27-29 → useUser (getUser() network, useUser.ts:23), usePendingFriends (getUser() + count), usePendingTurns (getUser() + count). ~4 network calls per navigation competing with destination data. **22 client-side auth.getUser() call sites total.** **Fix:** (a) getSession() instead of getUser() except security-sensitive writes; (b) module-level cache pending counts (once per session, refresh on focus) or one badge endpoint; (c) move BottomNav into a route-group layout so it persists.

## P1 — Middleware does a GoTrue roundtrip on every request for signed-in users
middleware.ts:10 matcher excludes only static assets; lib/supabase/middleware.ts:66-73 awaits auth.getUser() (3s bound) on every nav, RSC request, and /api/* fetch when a cookie exists — serial ~100-300ms before every handler. Anonymous traffic skipped (good). **Fix:** decode JWT locally, only call getUser()/refresh near exp (<~60s); or narrow matcher so cache-only API routes bypass.

## P1 — Badge images: 90 raw <img> sites, 100–243KB PNGs rendered at 36–84px
Only 3 files import next/image vs 90 raw <img>. public/badges = 6.6MB / 98 PNGs; worst leganes.png 243KB, leeds 238KB, malaga 227KB — rendered at 82-84px (play/page.tsx:97-101, Dashboard.tsx:383, draft screens). img.ts coverUrl() only transforms Supabase-storage URLs — /badges/* raw. Club grid ships several MB. **Fix:** one-off resize to 128px WebP (~5-10KB) into public/badges/128/, point getTeamBadgeUrlSync there; or next/image.

## P1 — /play multiplayer tab: N+1 member counts from the browser (up to 21 queries)
play/page.tsx:515-527 — rooms list, then one room_members count query per room (limit 20), all browser→Frankfurt. Tail ~1-2s. **Fix:** edge-cached route (s-maxage=15) returning rooms+counts in one service-role query.

## P2 — /38-0 hub downloads the 2.6MB player pool for a cosmetic count line
38-0/page.tsx:46-48 — ensurePool() on hub mount ("only used for the cosmetic count line"); pool.ts:78 fetches /data/draft/player-seasons.json (2,707,651 bytes). **Fix:** hardcode/inline per-league counts or 200-byte counts JSON; keep ensurePool() at /38-0/play, prefetch on Start.

## P2 — Service-role GET routes missing fetchCache="force-no-store" (known stale-pin trap)
Routes with GET + service client, no fetchCache/dynamic/revalidate:
api/quiz/availability, api/draft/records (:23), api/versus/shadow (:18-19), api/club/[slug], api/club/[slug]/events, api/club/events/[id], api/friends (GET, authed), api/draft/challenge/[code], api/admin/club-leagues. **Fix:** one line each; add s-maxage on the shared ones.

## P2 — Shared-data GETs with no s-maxage doing full serverless+DB roundtrips
/api/draft/records (38-0 leaderboard tab, fetched from 38-0/page.tsx:402; handler runs ensurePool() server-side — 2.6MB JSON parse on cold start); /api/quiz/availability. **Fix:** public, s-maxage=30-60, stale-while-revalidate.

## P2 — Penalty scene ships a 1MB PNG backdrop
public/sprites/pens/bg.png = 1,029,452 bytes, raw via PenaltyScene2D.tsx:20 — mid-game pop-in. **Fix:** WebP (~120-180KB), preload during pre-shootout screen.

## P2 — Six third-party trackers injected on every page
layout.tsx:117-202 — GA4, TikTok, X, Meta, (Snap), afterInteractive, + Vercel Analytics + SpeedInsights (:107-108) + Sentry. Contend with app chunks on throttled phones. gtag stub defined twice (:111-115, :126-127). **Fix:** lazyOnload / first-interaction for pixels; audit which are still bought channels.

## P2 — 63 of 83 pages are "use client"; only 2 loading.tsx
/play, /versus, /leaderboard, /38-0 fully client-rendered. Home (page.tsx:79-152) shows the right pattern (parallel Promise.all server component). /leaderboard global scope (leaderboard/page.tsx:58-63) renders identical data for everyone — ideal server+edge candidate. Only app/loading.tsx and profile/loading.tsx exist. **Fix:** convert /leaderboard first; add loading.tsx for /league/[id], /g/[id].

## P3 — Eager, high-priority cover images on every grid card
play/page.tsx:49 — CoverImg sets loading="eager" fetchPriority="high" for ALL cards. **Fix:** first ~4 eager; lazy below.

## P3 — Friends leaderboard is a 3-hop client waterfall
leaderboard/page.tsx:66-80: dynamic import → friendships → RPC after useUser ≈ 2-3 roundtrips. **Fix:** single RPC resolving friend ids server-side.

## P3 — Dead weight in repo/deploy
public/models/players.glb (3.0MB) + penalty-player.glb (404KB): zero references in src (pens is 2D now). posthog-js dependency + PostHogProvider.tsx exists but mounted NOWHERE — dead dep. public/email (14MB) ships every deploy. **Fix:** delete GLBs, delete or mount PostHogProvider; move email assets to storage.

### Already good (don't re-fix)
Edge-cache pattern works (/api/quiz/packs, challenges/pack, leaderboard/yourscore, versus/activity, wc2026 revalidate=60); coverUrl() CDN resizing; browser client singleton; Sentry Replay omitted; react-qr-code dynamic at 4/5 sites; home dashboard fully parallel server component.

### Top 3 by user-facing impact
1. Kill client auth/waterfall tax (1-3): getSession() over getUser(), one /versus hub endpoint, unblock the pack fetch — attacks the founder's ~1s nav complaint directly.
2. Middleware JWT-freshness check (4) — serial latency off every signed-in request.
3. Badge resize to WebP (5) — one script, megabytes off the hottest grids.
