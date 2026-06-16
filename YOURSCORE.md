# YourScore — Master Definition (Single Source of Truth)

> **This is the canonical definition of what YourScore is.** When anything in this repo
> or in conversation conflicts with this document, **this document wins.**
> `PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md`, `DRAFT-XI.md` and
> the old `~/Downloads/*build-doc.md` files are historical/subordinate — read them only
> for detail this file points to, never as current scope.
>
> **Confirmed with the founder:** 2026-06-16 (World Cup Daily + World Cup H2H — see §5B,
> migration 39; **interactive penalties** shipped, see Match types — migration 35).
> Prior full reconciliation 2026-06-10 against `src/` + `supabase/migrations/`.
> **Updated 2026-06-14:** added **Club Leagues** (built, not live — migration 36 + push pending).
> **Updated 2026-06-16:** **World Cup** reorganised into **two modes** — **World Cup
> Mastermind** (daily quiz-gated ranked run + Practice, season board) and **World Cup Run**
> (open, no-quiz draft). **Nation / National-Team mode retired** from the UI. World Cup is
> now the **first/default tab** in 38-0. A drawn knockout (and the 3-pt qualification
> play-off) is the **player's choice**: take an interactive **penalty shootout** OR answer
> one more **World Cup quiz question** (25s) to go through. **Shipped to prod** (migrations
> 35 + 39 applied).
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
- **Club League** 🆕 — a *partner-owned, branded* league + community space (a PUB, CREATOR, or SPONSOR). Distinct from the user-created leagues above: own tables (`club_leagues`), own hub at `/l/<slug>`. ⚠️ Built but NOT live (§6/§8). Never conflate "Club League" (partner-owned) with "custom/38-0 league" (user friend-group).
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
| **Interactive penalty shootout** — every drawn *played* match goes to pens and **the user takes the kicks** in a **real-time 3D scene** (React Three Fiber: floodlit stadium, 3D goal/keeper/striker, ball flies a real arc). Pick one of **9 aim zones** (3×3) + time a **POWER meter** (under/good/perfect/over); dive as keeper vs CPU in solo modes; in live H2H both players shoot simultaneously vs a seeded AI keeper, kicks streaming live. Pens win = full win (1,500 pts / streak survives); the old live opt-in ("both must agree") is retired. Group games in WC Run and the simulated season keep draws (league formats). Outcomes resolve server-side from a peppered seed in ranked modes; abandoning a shootout auto-completes it seeded — quitting never dodges a loss. The 3D scene is lazy-loaded (code-split to the pens route); striker/keeper are GLTF-ready slots for future rigged models. | 🔧 Built 2026-06-13, awaiting migration 35 + deploy |
| **Custom leagues + friend challenges** (create/join 38-0 leagues by code; challenge a specific friend via share code; shareable result graphics) | ✅ Live |
| **World Cup** — two player-facing modes, both an open **World XI** draft (nation/National-Team mode **retired** from the UI): **🧠 World Cup Mastermind** (quiz-gated — each pick unlocked by a **25s/question** timer; right answers + streaks deal stronger players) with **Today's Run** (ranked, one locked go/day, today's seeded questions, feeds the season board + Rank via the WC bucket) and **Practice** (unlimited, random past questions, no board/Rank); plus **🌍 World Cup Run** (open, no-quiz draft, replayable). The run: group → knockouts. Group qualifies on points (**≥4 auto · =3 play-off · ≤2 out**); a 3-pt play-off and any **drawn knockout are settled by a quiz decider** — one timed WC question, server-graded (temporary, until the penalty-shootout work lands) — knockout loss = out; perfect run = **8-0-0**. Season board `/38-0/wc/board` ranks closest-to-8-0-0 across the WC2026 window; **tap any player → `/38-0/wc/board/[userId]` to browse their daily drafts** (switch between days to see each day's XI + result + match-by-match road + **Mastermind quiz score** (how many of the day's questions they got right — `quiz_correct`/`quiz_total` on the run, recorded at submit; pre-migration-42 runs read null); `get_wc_player_history` definer RPC, public read). World Cup is now the **first/default 38-0 tab**. | ✅ Live 2026-06-16 (migrations 39–42 applied) |
| **World Cup H2H** (take your WC squad head-to-head — own queue/lobbies/leaderboard, WC competition lane) | ✅ Live 2026-06-15 |
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
essentially unchanged. A 38-0 triggers a full-screen gold celebration + gold scorecard
banner. **Per-play roll (2026-06-14):** the season is seeded by the XI PLUS a per-play
salt, so two players with the identical XI get DIFFERENT seasons — a copied Invincible
XI (share cards expose the XI) no longer reproduces the 38-0; the copier gets the same
per-roll odds anyone at that Strength gets. A roll is cached per-XI per-device (stable on
revisit) and server-verified by re-running the same salt; building 38-0 stays achievable
but is genuinely earned per attempt, not copy-pasteable.
**Impact subs:** halftime subs in Live H2H are 3×-weighted in second-half scorer/assist
picks — the player you bring on visibly pays off, sometimes.
**Integrity note:** the leaderboard is "verified ✓ — real results only". We do NOT
fabricate or back-date Invincibles onto real users' names; the board fills with genuine
38-0s as players earn them under this engine. (A request to manufacture/disguise wins was
declined — see [[project-38-0-leaderboard-gamefeel]].)

**Account deletion (2026-06-14):** Settings → Danger Zone → typed-DELETE confirm →
`POST /api/account/delete`. The route (service role, always the caller's own session id)
runs the `delete_user_account()` SQL function then `auth.admin.deleteUser()` then clears
the avatar. The function erases the user across every public table in FK-safe order — a
bare auth delete can't, because `profiles.id`/`quiz_packs.user_id` are NO ACTION,
`answers`/`room_members`/`room_scores`/`rooms` reference profiles with no cascade, and the
club tables are RESTRICT. Shared content they authored (custom quiz packs, lobbies,
leagues) is kept with ownership nulled. Verified end-to-end against the live schema.

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

- **Club Leagues** (`club_leagues`) — ⚠️ **BUILT, NOT LIVE** (migration `38_club_leagues.sql`
  unapplied). Partner-owned, branded league + community space for PUBS, CREATORS,
  and SPONSORS — the productised, generalised form of the roadmap's "Pub Leagues" (§8). Own
  first-class tables (chosen over extending `draft_leagues`/`leagues` or reviving shelved
  sponsored Lobbies). Per partner:
  - **Branded hub** at `/l/<slug>` (logo, cover, brand colour, welcome/prize text, pinned
    announcement, shareable join link/QR). Tabs: **Board · Events · Feed** (+ **Manage** for owners).
  - **Overall board** = `get_yourscore_leaderboard(p_user_ids := members)` — the *same*
    YourScore Rank, scoped to that partner's members. Read-time only; **zero new scoring writes**.
  - **Quiz events** = partner-run quiz nights: pick/build a `quiz_packs` pack → questions are
    **snapshotted** onto the event (pack edits can't break a live night) → members play in the
    window → per-event board. Correct answers are **never sent to the client**; server-graded;
    one attempt each. **Event points count ONLY on the event board** — they do NOT feed
    `profiles.total_score`/`quiz_attempts`/YourScore points (integrity: partner packs must not
    mint global ranking points).
  - **Feed** = read-time derived activity (`get_club_league_feed`): joins, 38-0 H2H results,
    solo quizzes, event results. No chat in v1.
  - **Provisioning:** admin at `/admin/club-leagues` (create + owner-by-email + kill switch);
    partner self-manages branding/events on the hub. **Free for pubs/creators; sponsors invoiced
    manually** (`tier` field is reporting-only — no in-app billing).
  - **Outreach asset:** `/api/club-preview` — a parameterized `next/og` PNG of a branded board
    (`?pub=&color=&logo=&prize=&kind=`) to embed inline in cold email; DB-free mockup.
  - **Immersion direction (Jun 14, NOT built):** the hub should be a *branded TAKEOVER*
    ("Spotify artist page" feel) — full-bleed dimmed wallpaper backdrop + page-wide accent shift
    from the partner's colour, while a subtle "Powered by YourScore" mark + the app's nav/dark
    surfaces remain. More immersive than a Facebook page, less than white-label.
  - **v1 deferrals:** chat, 38-0 event types, billing, staff/manager roles, partner analytics,
    brand-bleed into game screens, true white-label.

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

**Unsubscribe (2026-06-14):** every email footer link → `/settings/email?unsub=all|pause=<scope>&u=<userId>`
(previously 404'd — now fixed). The page (prefetch-safe, button-triggered) and
`POST /api/email/unsubscribe` write a `reason='manual'` row to `email_suppressions` —
the table `loadSuppressions()` reads, so all send scripts skip them. Resubscribe lifts
only the user's own opt-out (bounce/complaint suppressions stay). Runtime emails also
carry `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click) headers.

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
- **Club Leagues** (the productised "Pub Leagues") — ✅ **built, awaiting migration 36 + push to
  go live**; then the immersive brand-takeover redesign of `/l/<slug>` (see §6).
- **Messages / DMs**, **Hints system** (Quiz scoring hooks exist).
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
