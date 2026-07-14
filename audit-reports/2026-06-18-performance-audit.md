# YourScore Performance Audit — 2026-06-18

## Executive summary
The app is slow to render because of **client bundle weight**, not the database (DB cache hit 99.99%;
all app queries 18–64ms). The quiz/draft pages ship a **2.6MB player dataset inlined into a single JS
chunk** that the browser must download *and parse on the main thread* before anything interactive
renders. On top of that, **user scores load via client-side fetch waterfalls** that only start after
that 3.7MB of JS hydrates, and **images are unoptimized** (71 raw `<img>` tags, several multi-MB
assets). Measured live: quiz page total JS = **3.7MB**; the single `player-seasons` chunk = **2.6MB**;
scores RPC round-trip ≈ **1s**, fetched client-side after hydration.

## Measured (live, yourscore.app)
| Page | TTFB | JS shipped | Notable |
|---|---|---|---|
| `/38-0/wc` (quiz) | 60ms | **3.7MB** (one 2.66MB chunk) | 30 script requests |
| `/leaderboard` (scores) | 55ms | ~1MB | `get_yourscore_leaderboard` fetch **1012ms**, client-side |
| Third-party | — | — | Snap `scevent.min.js` ~944ms, TikTok/Meta/GA pixels |

DB is healthy: `yourscore_user_ratings` 20ms, `get_yourscore_leaderboard` 18.7ms, cache hit 99.99%.
The slowness is the front end.

---

## P0 — the one that matters most

### 1. 2.6MB player dataset bundled into client JS  ⟶ blocks quiz render
- `src/lib/draft/pool.ts:10` — `import raw from "@/data/draft/player-seasons.json"` (2.6MB dict:
  players/buckets/clubs/nations). Re-exported (`spin`, `spinForNation`, `spinWorld`, `allBuckets`,
  `getPlayer`, `pickableNations`…) and imported by **9 client pages**: `38-0/wc/page.tsx:26`,
  `38-0/wc/run/[id]/page.tsx:21`, `38-0/swap`, `38-0/play`, `38-0/match/prematch`,
  `38-0/live/match/[id]`, `38-0/team`, `38-0/season`.
- **Why it's the worst:** inlined JSON is parsed by V8 as *code* (much slower than `JSON.parse`), on
  the main thread, before first interaction — on every draft/quiz page. This is the "quizzes render
  really slowly."
- **Fix options (by risk):**
  - **(a) Serve as data, not code (recommended):** move the JSON to `public/data/` (or an API route)
    and load it once at runtime (`fetch().json()` — fast parser, CDN+brotli, out of the JS bundle),
    behind an async `ensurePool()` the draft pages await with a loading state. ~600KB over the wire,
    off the critical parse path.
  - **(b) Slim the dataset:** drop fields the client never renders; regenerate a lean pool. Lower
    code risk, needs the generator. Can combine with (a).
  - **(c) Code-split:** convert the 9 top-level `import`s to lazy `await import()` at the point of
    use so the chunk loads after the shell paints.
  - Risk note: this is the **core 38-0 game loop**. Any option needs a full spin/draft playthrough
    verified before shipping — hence the go/no-go question below given the ~2-day traffic spike.

---

## P1 — user scores feel slow

### 2. Scores fetched client-side in useEffect waterfalls
- `src/app/leaderboard/page.tsx:56-76` — fetches friendships **then** the leaderboard RPC serially;
  both only start after the big JS hydrates. Parallelize (`Promise.all`) and/or move to a server
  component / cached route.
- `src/app/profile/page.tsx:159-171` — sequential `room_scores` "recently played with" query after
  another await. Parallelize.
- **Both** wait on the 3.7MB bundle first — fixing P0 also speeds these up.

### 3. Rank recomputed O(N) over all ~6,800 users per call
- `get_yourscore_rank` / `get_yourscore_leaderboard` run a `row_number()` window over the whole
  `yourscore_user_ratings` view every call (18ms now, but grows with users and runs on every profile /
  rank-card / live-match view). Consider a materialized view or cached rank refreshed on a schedule.

---

## P2 — images

### 4. 71 raw `<img>` vs 4 `next/image` — no optimization
- `next.config.mjs` has `images` remote patterns (good) and does **not** set `unoptimized` — but raw
  `<img>` tags bypass optimization entirely (no AVIF/WebP, no srcset, no lazy-load). Hot spots:
  `38-0/wc/page.tsx:523,559,612,642,666`, `38-0/wc/run/[id]/page.tsx:462,575,619,732,846,869`,
  `profile/page.tsx:16`.
- Scorecard `<img>` at `38-0/wc/run/[id]/page.tsx:846` and `38-0/wc/share/page.tsx:86` have no
  width/height ⟶ layout shift (CLS).

### 5. Oversized static assets
- `public/clubs/lukepingu/cover.webp` 2.1MB · `public/sprites/pens/bg.png` 1.0MB ·
  `public/email/h2h-gameplay.png` 890KB · `public/email/wc-scout.png` 706KB · 71 club badges ~200KB
  each. Compress; consider a badge sprite/CDN; email images shouldn't ship to the app.

---

## P3 — third-party & misc
- Snap/TikTok/Meta/GA pixels load on every page (Snap script ~944ms). Confirm all are
  `strategy="afterInteractive"`/`lazyOnload` and consider gating non-critical pixels.
- No `revalidate`/`dynamic` directives on several dynamic pages; only 4 API routes are cached.

---

## Recommended order
1. **P0 #1** — de-bundle the 2.6MB dataset (biggest win; needs careful game-loop verification).
2. **P1 #2** — parallelize the scores waterfalls (quick, safe).
3. **P2 #4/#5** — image width/height (CLS) + compress the multi-MB assets (safe).
4. **P1 #3** — cached/materialized rank (medium).
5. **P3** — defer/gate pixels, add caching (safe).

*DB is not the bottleneck. Read-only audit.*

---

## REMEDIATION LOG — applied 2026-06-18

**P0 #1 (2.6MB bundle) — FIXED.** `pool.ts` now loads `player-seasons.json` via a dynamic
`import()` behind `ensurePool()`/`isPoolReady()` instead of a static import. Webpack code-splits it
into its own async chunk (`_app-pages-browser_src_data_draft_player-seasons_json.js`). All 10
consumers gated (wc, wc/run/[id], swap, play, match/prematch, live/match/[id], team, season,
38-0/page, api/draft/records) — client pages preload on mount + load-then-retry on spin; the server
route awaits it. Verified:
- **Initial JS for `/38-0/wc` dropped ~3.7MB → <1MB**; the 2.6MB chunk is no longer in any page's
  initial load (checked `app-build-manifest.json`).
- `tsc` clean; `next build` green.
- Live playthrough (own dev server): page renders real UI; the dataset chunk loads **200 on demand
  only after entering a draft**; quiz-gated spin dealt a real player slate. Game loop intact.

**Safe wins — assessed:** scorecard `<img>` already have `aspectRatio` (no CLS fix needed);
leaderboard global scope is a single fetch (no waterfall to parallelize) and its friends scope is a
dependent chain — both already benefit from the faster hydration. No change made (avoided churn).

**Not committed / not deployed** — held back (main carries other-session WIP). Deploy needed to reach
prod. `api/draft/team/random/route.ts` still statically imports the JSON but is **server-only** (no
client-bundle impact) — left as-is.

### Still open (as scoped; not done today)
- P1 #3 cached/materialized rank; P2 #4 convert 71 raw `<img>`→`next/image`; P2 #5 compress oversized
  assets; P3 gate third-party pixels. These were the "aggressive" tier — deferred per your choice.
