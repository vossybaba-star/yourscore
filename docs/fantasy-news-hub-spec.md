# Fantasy News & Insights Hub — v1 build spec

**Status:** draft for build · **Date:** 2026-07-13 · **Owner:** marketing/product lead
**Related:** `docs/your-pl-xi-design.md` (the game), `src/lib/fantasy/ingest.ts` (existing Sportmonks pattern), memory `project-yourscore-fantasy-news-hub`

## 1. What this is

A news/insight surface **inside the Fantasy section** so users check what's happening with players — fixtures, team news, form, transfers — and get tips to score better. It's the freshness + tips layer around the knowledge-gated fantasy game.

**v1 scope (locked with founder Jul 13):**
- **General** feed — everyone sees the same content (no personalisation).
- **Solo-first** — no social features (friend-ownership etc. is the planned fast-follow).
- **Straight news feed** — NOT tied into the earn-transfers loop. (Earning credits from engaging with content is explicitly PARKED as a possible later layer.)
- Casual-fan voice, easy on stats — treated as a hypothesis to validate, not a proven wedge.

**Deliberately out of v1** (per deep-research: table-stakes + paywalled among rivals, non-differentiating, or needs data we lack): AI transfer optimiser, price-change predictor, points projections, xG/expected-goals stats, a dedicated injuries feed, personalised/squad-filtered views, any social layer.

## 2. Routes

Follows existing conventions (`/fantasy`, `/fantasy/transfers`, `/api/fantasy/*`).

**The hub is TWO surfaces, tabbed — and the split is the whole point.**

`/fantasy/news` is a **FEED**: a stream of content cards you scroll and tap into (tips, doubts, articles, tweets). `/fantasy/fixtures` is a **TOOL**: the club × GW ticker, reference data you *consult* when planning a transfer. The first build put the ticker at the top of the feed and it buried the content people actually came for — a 20×5 grid is not something anyone browses. **Tools get a tab; the feed stays a feed.** Both tabs render from the SAME cron-built doc (two views of one document, not two pipelines).

- **Page:** `/fantasy/news` (`src/app/fantasy/news/page.tsx`) — a **server component that reads the cached feed row from Supabase directly**. No `GET /api/fantasy/news` route: the iOS app is a Capacitor wrapper around the same pages, so there is no non-web client that needs a JSON API. Add one later only if something non-web needs it.
- **Page:** `/fantasy/fixtures` (`src/app/fantasy/fixtures/page.tsx`) — the ticker.
- **Shared:** `components/fantasy/NewsTabs.tsx` (tab strip) + `newsUi.tsx` (tokens, `ItemCard`, `loadFeedDoc`). Server-safe — `shared.tsx` is `"use client"` so its exports can't cross into these.
- **Cron:** `POST/GET /api/cron/fantasy-news` — the single builder (see §3).
- **Ingest:** `POST /api/fantasy/news-items` — authed endpoint the VPS content pipeline POSTs curated editorial/tweet items to (see §4.4).
- **Nav:** entry point from the fantasy hub (`/fantasy/page.tsx`) — a "News & insights" tile/tab.

## 3. Data-serving strategy

The general feed is the same for all users, and Sportmonks has rate limits — so **do not call Sportmonks on the user request path.** Build the feed on a schedule and serve cached JSON.

- **One hourly cron** (`/api/cron/fantasy-news` in vercel.json, matching the wc-mastermind pattern: hourly cron, internal gating). Inside, each section declares its own staleness rule:
  - fixtures: rebuild if >24h old
  - team news: rebuild if >1h old when <48h to deadline, else >24h
  - form: rebuild once after a GW completes
  - transfers/tips: on change / weekly
  The **deadline push nudge fires from this same cron** (it already knows the deadline) — no separate cron entry.
- **Storage keyed by GW, not one mutable row:** `fantasy_news_feed(gw int primary key, doc jsonb, updated_at)`. History for free; next GW's doc can build while the current one is live.
- **Predicted-XI snapshots:** `fantasy_predicted_xi(gw, club_id, xi jsonb, fetched_at)` — the "dropped from XI = doubt" inference REQUIRES diffing vs the previous fetch, which a single doc can't do. Doubts are computed by comparing the latest two snapshots per club.
- The page reads the feed row server-side with short revalidation. Cheap, fast, no per-user Sportmonks hits.

Sportmonks base + auth pattern (already in `ingest.ts`): `https://api.sportmonks.com/v3/football/...&api_token=${SPORTMONKS_API_KEY}`, PL filter `filters=fixtureLeagues:8`.

## 4. Sections (priority order)

### 4.1 Fixture ticker · Sportmonks
- **Shape: a club × gameweek GRID, not a match list.** Rows = the 20 clubs, columns = the next 5 GWs, each cell = that club's opponent. **This is not cosmetic.** A match list ("BUR v BOU — tough") cannot say who the fixture is tough *for* — the first build shipped exactly that and it was meaningless. A fantasy manager reads *down a club's row* ("I own Haaland — what's City's run?"), so difficulty always has an unambiguous subject.
- **Source:** `fixtures/between/{from}/{to}?filters=fixtureLeagues:8&include=participants`, anchored on the **GW windows from `fantasy_gameweeks`** (NOT "today" — replay/demo windows are historical and pre-season "today+35d" lands in a dead zone). Fixtures are bucketed into GW columns by which window their kickoff falls in.
- **Club codes: use SportMonks' `short_code` on the participant** (MCI, MUN, WHU, NFO, BHA). Do NOT derive from the club name — a name heuristic collapses Manchester City and Manchester United to the same "MAN" (it did, and shipped that way until caught).
- **Difficulty:** band by the OPPONENT's league position (top-6 = tough/red, bottom-6 = kind/green, else amber). Stored per-cell from that club's perspective.
- **Cell convention:** CAPS = home, lowercase = away (standard FPL ticker). A blank GW renders as an em-dash.
- **Refresh:** daily (fixtures rarely move).
- **Fallback:** if fetch fails, serve last cached ticker.

### 4.2 Team news (predicted XI) · Sportmonks + content pipeline  ← anchor section
This is the freshness play (beats Sleeper's #1 complaint) and it's data we own.
- **Predicted lineups:** Sportmonks `Access Predicted Lineups` entitlement confirmed. **TODO:** confirm exact `include`/lineup-type name against a live fixture ~24–48h pre-kickoff (predicted lineups aren't populated pre-season; probed 2026-07-13, 0 rows — expected).
- **Injury inference (no injuries endpoint on our plan):** a player who drops OUT of a club's predicted XI vs the prior week = surface as a "likely doubt" flag. This is how we do "injuries" without an injury feed.
- **Verified-source layer:** attach editorial article cards + embedded tweets from trusted journalists (via the existing football-media repurpose pipeline — NOT fresh scraping). This is the trust/freshness backstop for injury news.
- **Refresh:** hourly in the 48h before a deadline; daily otherwise.

### 4.3a Insight cards ("Worth knowing") · generated from our own data
**The feed carries no tables.** Our reference data becomes *content*: instead of a form leaderboard, a card that says "Szoboszlai is quietly racking up points — 24 for Liverpool". Instead of reading a ticker, "Wolves have a kind run coming — 3 of their next 5 look winnable."
- **Two generators** (`buildInsights`, pure): **form** (from §4.3) and **fixture-swing** (a club with 3+ kind games in the window).
- **Lead with POINTS, not a stat line.** Points are the game's own currency and the one number we can never be wrong about (we scored them). A stat line alone overclaims — "1 goal in his last 5" is *not* "on a run", and a card asserting it is noise. First cut did exactly that; fixed.
- **Be conservative.** A feed of weak takes is worse than a short feed: skip players whose only line is "steady minutes", cap at 3 form + 2 swing cards.

### 4.3 Form / stat leaders · **our own DB — zero new Sportmonks calls**
**Data only — NOT rendered as a table on the feed.** It feeds §4.3a's cards and nothing else.
- **Source:** `fantasy_player_scores` (migration 76: `gw, player_id, minutes, facts jsonb, points`) — already populated per GW by the scoring ingest. The form section is a pure aggregation over the last ~5 GWs of this table. Do NOT re-fetch fixtures from Sportmonks (spec'd that way originally — it duplicated work the game already does).
- **Why this is also a product win:** the form numbers users see are literally the numbers the game scores with — they can never disagree.
- **Proxy metrics (we have these, xG we don't):** goals/assists/etc. from `facts`, plus points-per-GW trend. Show the human-legible line ("2 goals + 1 assist in his last 3"), not a modelled score.
- **Refresh:** after each GW's ingest completes.

### 4.4 Transfers & performances feed · content pipeline (+ Sportmonks transfers)
- **Editorial + tweet cards:** transfer reports, "player on fire" takes — from the VPS content pipeline. **Verified integration gap:** the VPS dash is file-based JSON, no Supabase — content currently has NO path into the app DB. Contract: the VPS worker **POSTs curated items to `POST /api/fantasy/news-items`** (CRON_SECRET-style bearer auth) → inserts into `fantasy_news_items`. Keeps DB creds off the VPS.
- **Tweets render as native-styled cards, NOT X's embed script** — `widgets.js` is heavy (page weight is the flagged next perf lever) and embed availability is flaky. Store tweet text/author/handle/image at ingest; card links out to the tweet.
- **Factual transfer data:** Sportmonks `Access Transfers` for confirmed moves (structured, we own it) to anchor/verify the editorial.
- **Refresh:** continuous for content (push-based via the ingest endpoint); daily for Sportmonks transfers.

### 4.5 Tips · YourScore (our own layer)
- **Content:** captain pick, a differential, a fixture-swing call — written in casual voice.
- **v1 authoring:** authored/curated per GW (like the daily quiz JSON), optionally AI-drafted from the section data above then human-approved. (Founder confirmed an AI "here's the move I'd make and why" recommendation is wanted — it's useful, not "removing the thinking.")
- **Refresh:** weekly per GW, plus a captain pick before each deadline.

## 5. Habit-loop hooks (from research — the FPL "The Scout" bar)

Match the free daily-habit bar with what our data supports:
- **Deadline nudge** — push before each GW deadline. Reuse existing push infra (`project-yourscore-push-notifications`).
- **Weekly tip push** — one push when the GW tips drop.
- (NOT matching FPL's squad-injury alerts — that needs an injuries feed we don't have.)

## 6. Feed document shape (sketch)

```jsonc
{
  "generatedAt": "2026-08-20T09:00:00Z",
  "gameweek": 1,
  "deadline": "2026-08-21T17:30:00Z",
  "fixtures": [ { "home": "ARS", "away": "COV", "difficulty": "kind", "kickoff": "..." } ],
  "teamNews": [ { "club": "ARS", "predictedXI": ["..."], "doubts": [{ "player": "Saka", "reason": "dropped from XI" }], "sources": [{ "type": "tweet", "url": "...", "handle": "@..." }] } ],
  "form": [ { "player": "Palmer", "line": "7 big chances · 12 key passes" } ],
  "transfers": [ { "type": "article|tweet", "title": "...", "url": "...", "confirmed": true } ],
  "tips": { "captain": { "player": "Isak", "why": "..." }, "differential": { "player": "...", "why": "..." } }
}
```

## 7. Open items before build

1. Confirm exact Sportmonks predicted-lineups `include`/type name against a live fixture near season start (currently pre-season, unpopulated). Builder must degrade gracefully (empty team-news section) until then.
2. ~~Content-pipeline contract~~ → RESOLVED: VPS POSTs to `POST /api/fantasy/news-items` (bearer auth). VPS-side worker script is a separate follow-up task.
3. Tips authoring workflow: pure-authored vs AI-drafted-then-approved for v1. (Schema supports both — tips live in the feed doc; authoring writes them via admin/script.)
4. Fixture-difficulty model: v1 = league-position bands (top-6 tough / bottom-6 kind / else medium) from standings; form-weighted later.

## 7b. Operational notes (learned building this)

- **`?force=1` on the cron** rebuilds every section regardless of staleness. **Use it whenever a section's shape or logic changes** — the staleness gate only asks "is this old?", never "was this built by the current code", so a fresh-but-wrong section otherwise persists until its window expires.
- **The feed doc is persisted JSON that outlives the code that wrote it.** Both the builder and the page optional-chain every section: an older-shape doc must degrade to "no section", not crash. (The club-ticker rewrite crashed both until this was added.) The builder also drops any section whose shape has drifted, so it rebuilds clean.
- **Next data cache pins the page's feed read.** The page sets an explicit per-fetch `revalidate`; to see a change immediately in dev you must stop the server, `rm -rf .next/cache`, then restart — clearing it while the server runs leaves an in-memory copy.

## 8. Parked for later (not v1)

- Personalisation (squad-filtered "your players" view).
- Social layer: friend-ownership, friends' moves, in-hub debate/poll hooks (port from Sleeper model, tied to knowledge rounds).
- Earning transfer credits from engaging with insight content (the knowledge-gating wedge).
