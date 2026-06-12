# YourScore — Master Definition (Single Source of Truth)

> **This is the canonical definition of what YourScore is.** When anything in this repo
> or in conversation conflicts with this document, **this document wins.**
> `PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md`, `DRAFT-XI.md` and
> the old `~/Downloads/*build-doc.md` files are historical/subordinate — read them only
> for detail this file points to, never as current scope.
>
> **Confirmed with the founder:** 2026-06-12 (full reconciliation against `src/` +
> `supabase/migrations/` through migration 25, incl. the 38-0 game; interactive
> penalties added 2026-06-12 — see Match types).
> **Maintenance:** update this file in the same session you change the product, bump the
> date, and run `graphify update .` after code changes.

---

## 1. What YourScore Is

**YourScore is a football competition platform — one app, one account, two games, a
shared social layer.** It's where you prove and rank how well you know and understand
football, against your mates, over time.

The two games:
1. **38-0** — a competitive head-to-head **team-builder** game. *(The current flagship /
   acquisition hook.)*
2. **Quiz** — the football-**knowledge** quiz game. *(The depth / retention play.)*

Around them sits a shared layer: accounts, **Friends**, **public profiles**, a **players
database**, and (per game) **Leagues** and rankings — with a unified **YourScore Rank**
being built to bridge the two games.

**Positioning:** 38-0 leads (it's the hook that pulls people in); the Quiz is the depth
that keeps them. In-product quiz tagline: **"Your football knowledge. Ranked."** (say
"football knowledge", never "football IQ").

It is **not a World Cup app.** The FIFA World Cup 2026 (11 Jun – 19 Jul 2026) is the
launch moment / marketing hook; both games are built for football year-round.

---

## 2. Glossary — Locked Terms

Use these words, with these meanings, everywhere. No synonyms.

**Platform & people**
- **YourScore** — the football competition platform (the app) containing 38-0 + Quiz + social.
- **38-0** — the team-builder game (name = an unbeaten 38-game season). *("Draft XI" is the internal/descriptor name only — brand it "38-0".)*
- **Quiz** — the football-knowledge game. *(User-facing label; its route is still `/play` in code — do not change paths.)*
- **Player / User** — anyone using YourScore (signed in or guest).
- **Guest** — no account; can play (esp. 38-0 Quick Match + Quiz solo) but can't earn ranked points / leaderboards / cloud save.
- **Game** — one play-through (a Quiz game or a 38-0 match).

**Quiz terms**
- **Question / Window** — one MCQ; the time allowed to answer (default 30s; speed scored as % of Window).
- **Quiz pack** — a reusable bundled question set; the question source for a Multiplayer Quiz game.
- **Lobby** — the place players group up before a Multiplayer Quiz game (joined via 6-char code). *(DB table still `rooms` — rename pending, §8. Never say "Room".)*
- **Lobby type** — **Private** (invite, ≤8) · **Public** (anyone w/ link, ≤20) · **1v1** (you vs one). *(1v1 = code's `h2h`.)*

**38-0 terms**
- **Spin** — deal a random squad of real-rated legends (drawn across FIFA editions/eras).
- **Draft** — place spun players into your formation's best-fit slots to build your XI.
- **Strength** — your XI's computed rating (~40–99).
- **Projected season** — Strength mapped to a 38-game record + tier (the "could it go 38-0?" projection).
- **Classic / Expert** — Expert mode hides player ratings during the draft (names + positions only).
- **Match types** — **Quick Match** (guest/practice, local) · **Ranked** (signed-in, feeds leaderboards — *building*) · **Live H2H** (simultaneous two-half match you watch play out) · **Challenge** (snapshot your XI → friend resolves via share code) · **World Cup Run** (solo WC2026 campaign).
- **Stale team** — after a loss your team goes stale and must be rebuilt (win → swap one player).

**Leagues & ranking**
- **Quiz League** — a group's table for the Quiz game (`leagues`). Two boards planned: Live / Offline (§6).
- **38-0 League** — a custom group league for 38-0 (`draft_leagues`), joined by code, with its own board.
- **YourScore Rank** ✅ — the unified cross-game leaderboard: **YourScore points = Knowledge pts (Quiz) + Match pts (38-0: win 1,500 / draw 500)**; one strict position per player (no shared ranks). Position is the status; badges (👑/Elite/Diamond/…) are cosmetic, derived from position.

---

## 3. Target Audience & Positioning

Two audiences that reinforce each other:

1. **Consumer / friend-groups — the goal.** Football fans and their mate-groups are the
   end users. Growth runs on viral loops (invite your group; some start their own
   leagues/challenges). The objective is always **more users**, and **38-0 is the lead
   hook** because anonymous play + shareable results spread fast.

2. **Pubs & venues — acquisition channel now, product later.** Pubs are a *channel* to
   reach consumer users (`~/yourscore-pub-outreach`), judged by users they bring in.
   Later (roadmap): a dedicated **Pub League**.

---

## 4. Platforms

**Strategic direction: native apps primary.** Native iOS/Android (Capacitor shells around
the web app) are the intended primary distribution, with App Store / Play Store listings
drafted and store-readiness work in progress.

**Current reality: the web app is the live product.** The **mobile app is NOT launched
yet.** Today everything runs at **https://yourscore.app** (Next.js on Vercel; also a PWA).
Two things are deliberately **gated on the mobile launch**:
- **Live-match Quiz** (playing along to a real fixture) — see §5A.1.
- **Push notifications** — see §7.

- Domain: **yourscore.app** (the old `yourscore.gg` is dead). Bundle ID `app.yourscore.app`.
  Web deploys from `main`; native shell on `mobile-wrap`.

---

## 5. The Two Games

### 5A — QUIZ (football knowledge)

The knowledge game. Nav tab **"Quiz"** (route `/play`). Ways to play:

- **5A.1 Live match** — playing along with a *real* fixture; questions fire during the
  game, scored live. **⛔ NOT live yet — gated on the mobile app launch.** (We aren't
  running live-match quizzes until the mobile app is confirmed.)
- **5A.2 Multiplayer** — on-demand Quiz game with others in a **Lobby** (Private / Public
  / 1v1); question source = a Quiz pack or a category+difficulty filter. ✅ Live.
- **5A.3 Solo challenge** — self-paced single-player quizzes (club season-review packs:
  PL 2025/26, Championship). Lowest-friction entry; SEO surface. ✅ Live.
- **5A.4 Custom Quiz Builder** (`/quiz/create`) — *tool* (not a mode): generate your own
  Quiz pack to use in Multiplayer.

**Quiz scoring (`src/lib/scoring.ts`, current):** `points = 100 × difficulty × speed`.
Difficulty easy ×1.0 / medium ×1.5 / hard ×2.0 / expert ×2.5 / master ×3.0. Speed bands
(% of Window): Lightning ×2.0 (0–20%) → Fast ×1.5 → Normal ×1.0 → Slow ×0.75 → Very Slow
×0.5 (80–100%). Bonuses: +50 streak (2+ correct), +50 comeback (after 3+ wrong), +500
perfect round. Penalties: −25 timeout, −50 hint/skip, −100 ragequit. *(Hints system
deferred — its +75 no-hints bonus / −50 hint penalty aren't live until hints ship.)*

### 5B — 38-0 (team-builder) — *the flagship*

> **One-liner:** *Build an XI good enough to go a 38-game season unbeaten — spin a squad
> of real-rated legends across football eras, draft your best XI, and go head-to-head.*

A **separate game** (not a Quiz mode). Nav tab **"38-0"** (route `/38-0`). Core loop:
pick a formation + difficulty → **Spin** a random legendary squad → **Draft** into best
slots → see live **Strength** → **projected 38-game record + tier** → play a match → win
→ swap a player / lose → team stale → rebuild. **Classic vs Expert** mode (Expert hides
ratings). **Anonymous play is the deliberate hook** — guests get the full draft + Quick
Match loop on `localStorage`; sign-in unlocks cloud save / ranked / social.

**Match types — live status:**
| Type | Status |
|---|---|
| **Quick Match** (guest/anon, local) | ✅ Live |
| **Live H2H multiplayer** (simultaneous two-half match, watch-it-play-out, halftime swaps; friend code or random queue w/ disguised bot fallback) | ✅ Live |
| **Interactive penalty shootout** — every drawn *played* match goes to pens and **the user takes the kicks** (tap one of six zones to shoot; dive as keeper vs CPU in solo modes; in live H2H both players shoot simultaneously vs a seeded AI keeper, kicks streaming live). Pens win = full win (1,500 pts / streak survives); the old live opt-in ("both must agree") is retired. Group games in WC Run and the simulated season keep draws (league formats). Outcomes resolve server-side from a peppered seed in ranked modes; abandoning a shootout auto-completes it seeded — quitting never dodges a loss. | 🔧 Built 2026-06-12, awaiting migration 35 + deploy |
| **Custom leagues + friend challenges** (create/join 38-0 leagues by code; challenge a specific friend via share code; shareable result graphics) | ✅ Live |
| **World Cup Run** (solo WC2026 campaign — pick nations) | ✅ Live |
| **Ranked + global leaderboards** (Daily/All-time, points ladder W3/D1) | 🔧 Being built now |
| **Verified "Leaderboard ✓" tab** (closest-to-38-0 season records per competition + closest-to-8-0 WC runs; server re-simulates every submitted XI — client never trusted; personal bests card on /profile) | ✅ Live 2026-06-12 (boards activate with migration 29) |

**Competitions:** **Premier League** is live. **La Liga** (2nd competition) is now
**live** too — released 2026-06-11 (migration 26; club crests added). Pick a competition,
then draft your all-time XI from that league's ~20 years of players.

**Data & engine (high level):** real **FIFA/SoFIFA ratings** across ~8 editions over ~20
years (~4,900 player-seasons). `score.ts` → Strength; `match.ts` is the single engine for
all scorelines (attack-line vs defence-line, Poisson on a seeded RNG); `live-score.ts`
drives the live two-half match. **Season feel (2026-06-12):** strong XIs (>74 STR) play
"on form" — `formFactor` (season.ts) lifts the player's λ and damps the opponents', so
wins climb with Strength and good seasons reveal as a long unbeaten streak that breaks
late ("looked like 38-0"). Calibrated against all real saved XIs: a genuinely elite,
well-built XI (top ~3-5% by Strength, ~89.5+) now has a real, repeatable shot at the
perfect **38-0 Invincible** (~0.3% of all teams, ~10-15% of elite ones); mid/weak teams
essentially unchanged. This is a PERMANENT engine property — the season seed is the XI
itself, so any Invincible is reproducible and re-verifiable forever (never a temporary
window). A 38-0 triggers a full-screen gold celebration + gold scorecard banner.
**Impact subs:** halftime subs in Live H2H are 3×-weighted in second-half scorer/assist
picks — the player you bring on visibly pays off, sometimes.
**Integrity note:** the leaderboard is "verified ✓ — real results only". We do NOT
fabricate or back-date Invincibles onto real users' names; the board fills with genuine
38-0s as players earn them under this engine. (A request to manufacture/disguise wins was
declined — see [[project-38-0-leaderboard-gamefeel]].)

---

## 6. Leagues & Ranking

**Two separate, per-game league systems — they do not merge:**

- **Quiz Leagues** (`leagues`, `league_members`) — a group's table for the Quiz game.
  Target model: **two boards that never combine — Live** (live-match points) and
  **Offline** (Multiplayer incl. 1v1; Solo counts *lighter*, exact rule **TBD — founder's
  partner**). This two-board model is **still the plan / build target**.
  > *Current code:* `/api/answer` calls `update_league_member_stats` — every point flows
  > into ALL a user's Quiz leagues as one pooled total. No Live/Offline split or
  > per-match tracking yet. The two-board model is the target, not today's behaviour.

- **38-0 Leagues** (`draft_leagues`) — custom group leagues for 38-0, joined by code, with
  their own board (in-league wins, challengeable members). ✅ Live.

**YourScore Rank — ✅ LIVE (shipped 2026-06-12).** The unified cross-game leaderboard and
the deliberate **38-0 ↔ Quiz bridge**. One currency, one table, one #1:

- **YourScore points = Knowledge pts + Match pts.** Knowledge = Quiz points as-is
  (multiplayer + live + solo). Match = ranked 38-0 record converted at **win = 1,500 /
  draw = 500** (keeps football's 3:1; one win ≈ one strong quiz session). The exchange
  rate is the single tuning dial — set in `supabase/migrations/30_yourscore_points.sql`.
- **Position is the product.** Strict unique positions (`row_number`; ties → earlier
  account). **No percentiles, no point-based tiers** — v1's percentile blend (migration 27)
  is superseded. Badges (👑 #1 · Elite top 10 · Diamond top 50 · Platinum top 200 · Gold
  top 1000) are cosmetic, client-side, derived from position (`src/lib/rank.ts`).
- **The reward loop:** a **RankRewardCard** mounts on every Game end (38-0 live result,
  Solo challenge, Multiplayer quiz): points earned, places climbed (never shows a drop),
  current position, and the chase — "N pts behind <player above> — overtake them".
- **Surfaces:** `/leaderboard` (Global + Friends scopes), profile hero (position-led),
  38-0 live-match header shows the opponent's #position.
- **Data:** `yourscore_user_ratings` view + `get_yourscore_rank` / `get_yourscore_leaderboard`
  RPCs (migration 30). Read-time only — per-game scoring/writes unchanged.
- *Known watch-items:* top of table is currently pure 38-0 volume (quiz pts small by
  comparison); wins vs disguised bots count toward Match pts (bot-farming lever if needed:
  human-only wins or daily caps). No seasonal reset yet — all-time.

---

## 7. Auth, Notifications & Social

**Auth — live in production:** **Google**, **Apple**, **Email (password + magic link)**.
*(Facebook button exists in the UI but is NOT enabled in prod.)* Native OAuth uses the
`yourscore://` deep link. Guests can play; account needed for ranked/cloud/social.

**Push — tied to mobile launch:** the **send-push** Edge Function (APNs/FCM) is built but
comes online with the mobile app.

**Lifecycle email — LIVE on web (Resend, hello@yourscore.app):** 23 branded templates in
`emails/lifecycle/` + 6 Supabase Auth templates. Event-triggered: welcome (neutral 4-path),
first quiz/league/invite (quiz side), first XI/match/H2H/league (38-0 side, 16–19), friend
request/accepted (20–21), H2H challenge result to the challenger (22), and a once-ever
come-back nudge via daily cron (23 — gated behind `COMEBACK_EMAILS_ENABLED=true` + the
`email_log` table, migration 31). Governance: event emails only for things that happened
while the user was away; campaigns (11–15) are one-off scripts. "Friends online" is
deliberately push-only, not email.

**Shared social features:**
| Feature | Status |
|---|---|
| **Friends** (add/search/requests, `/friends`) | ✅ Live |
| **Public profiles** (`/profile/[userId]`, stats) | ✅ Live |
| **Players database** (`/players/[id]`) | ✅ Live |
| **Messages / DMs** (`/messages/[userId]`) | 🔜 Planned only (page exists but is a stub; not released) |

---

## 8. Roadmap (rough order)

- **38-0 Ranked + global leaderboards** (in progress).
- **YourScore Rank** — two-track (38-0 Match + Quiz Knowledge) cross-game bridge (in progress).
- **Mobile app launch** — unblocks **live-match Quiz** and **push notifications**.
- **Quiz Live/Offline league boards** + the Solo-weighting rule (founder's partner).
- **Messages / DMs**, **Hints system** (Quiz scoring hooks exist), **Pub Leagues**.
- **Naming cleanup:** `rooms` → `lobby`/`lobbies` and `/join` → `/matches` (code paths;
  do NOT touch yet — user-facing labels already say Lobby / Matches / Quiz).

---

## 9. Navigation Canon

**Bottom nav (signed-in, 5 tabs):** **Home · Leagues · Quiz · 38-0 · Profile.**
- **Home** (`/`) · **Leagues** (`/leagues`) · **Quiz** (`/play`; sub-tabs Solo + Multiplayer)
  · **38-0** (`/38-0`; its own sub-nav: Live · Board · Leagues · Teams) · **Profile**.
- **Guests** see a reduced nav (Home · Quiz · 38-0).
- **Matches** (`/join`) still exists as a route (browse fixtures, set up a league around a
  match) but is **not a primary bottom-nav tab** while live-match Quiz is gated.

---

## 10. Admin (`/admin`)

`/admin/matches` (fixtures + AI question generation) · `/admin/questions/[matchId]`
(approve question bank) · `/admin/rooms` ("Lobbies" — view/fire live questions) ·
`/admin/fire/[roomId]` (live match control) · `/admin/challenges` (upload Quiz packs).

---

## 11. Tech Stack

Next.js 14 (App Router) · Supabase (Postgres + Auth + Realtime + Edge Functions) ·
Capacitor (iOS/Android, pre-launch) · Tailwind · Vercel · pnpm · Anthropic Claude API
(Quiz question generation). 38-0: pure TS engines (`src/lib/draft/*`) over a FIFA-ratings
dataset; Supabase Realtime for live matches; `next/og` for shareable result graphics.
Patterns: server-authoritative scoring/grading (service role), RLS on all tables, rate
limiting. `next.config.mjs` sets `typescript.ignoreBuildErrors: true` (build tolerates
pre-existing type errors).

---

## 12. Discontinued / Shelved — DO NOT reference as current

| Thing | Status |
|---|---|
| **WhatsApp API notifications** | ❌ Discontinued (replaced by native push; share links unaffected). |
| **Sponsored / branded rooms** | 🅿️ Shelved (vestigial DB columns only). |
| **`yourscore.gg`** | ❌ Dead — domain is **yourscore.app**. |
| **"Football IQ" phrasing** | ✏️ Replaced by **"football knowledge"**. |
| **"Room" as a term** | ✏️ Replaced by **"Lobby"** (DB tables pending rename). |
| **"Play" as the quiz tab label** | ✏️ Now **"Quiz"** (route stays `/play`). |
| **Old flat-45s / linear-bonus scoring** | ❌ Superseded by §5A scoring. |

---

## 13. Maintenance Rule

Update this file in the same session you change the product; bump the "Confirmed" date.
New games/modes, killed features, renamed tabs, scoring tweaks, prod-status changes, and
positioning shifts belong here first. If a future session references something not in this
document, reconcile against the code — don't trust an older doc.
