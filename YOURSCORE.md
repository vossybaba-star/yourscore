# YourScore — Master Definition (Single Source of Truth)

> **This is the canonical definition of what YourScore is.** When anything in this
> repo or in conversation conflicts with this document, **this document wins.**
> `PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md` and the old
> `~/Downloads/yourscore-build-doc.md` are historical/subordinate — read them only for
> detail this file points to, and never treat them as current scope.
>
> **Confirmed with the founder:** 2026-06-10 (every section reviewed and signed off, and
> reconciled against `src/` + `supabase/migrations/`).
> **Maintenance:** update this file in the same session you change the product, bump the
> date above, and run `graphify update .` after code changes.

---

## 1. The One-Liner

**Rank your football knowledge against your mates — every match, any competition, any time.**

In-product tagline: **"Your football knowledge. Ranked."**  *(We say "football knowledge", never "football IQ".)*

---

## 2. Glossary — Locked Terms

Use these words, with these meanings, everywhere. Do not introduce synonyms.

**Product & people**
- **YourScore** — a football-knowledge competition app: score and rank how well you know football, against your mates, over time.
- **Player** — anyone playing a Game (signed in or guest).
- **Guest** — plays without an account; can play but cannot earn ranked points or appear on leaderboards.

**A play-through**
- **Game** — one play-through a Player completes: a Live match, a Multiplayer game, or a Solo challenge attempt. ("Games played" on a league table counts these.)

**Content**
- **Question** — one multiple-choice football question with a correct answer and a Window.
- **Window** — the time allowed to answer a Question (default 30s; varies by mode). Speed is scored as a % of the Window.
- **Quiz pack** — a reusable, bundled set of Questions (by club, competition, theme…); the question source for a Multiplayer game.
- **Question bank** — the curated, admin-approved pool of Questions used for **Live matches**.

**The three ways to play (modes)**
- **Live match** — playing along with a *real* fixture as it happens; Questions fire during the actual game, scored live.
- **Multiplayer** — an on-demand Game played with other users who group up in a **Lobby** (not tied to a real fixture).
- **Solo challenge** — a self-paced single-player Game; no Lobby, no live fixture.

**Multiplayer pieces**
- **Lobby** — the place Players join (via a 6-character code) and **group up before a Multiplayer game starts**. It is the grouping place, not the Game itself. *(Underlying DB table is still named `rooms` — rename pending, §10.)*
- **Lobby type** — who can join: **Private** (invite-only, up to 8) · **Public** (anyone with the link, up to 20) · **1v1** (you vs one opponent, scores compared). *(1v1 is what the code/DB calls `h2h` / "Head-to-Head".)*
- **Question source** — for a Multiplayer game: a **Quiz pack**, or a **category + difficulty filter** (e.g. Premier League / Champions League / World Cup; easy–master).
- **Custom Quiz Builder** — a *tool* (not a mode) to generate your own Quiz pack.

**Leagues**
- **League** — a named group of people whose results compile into shared tables so they can compare and compete. Hosts no gameplay itself.
- **Live board** — a league's leaderboard fed *only* by Live-match points.
- **Offline board** — a league's leaderboard fed by Multiplayer points (incl. 1v1); Solo counts *lighter* (exact rule **TBD — to be defined by the founder's partner**). Never mixes with the Live board.
- **Pub League** *(roadmap)* — a venue-owned league patrons join while at the pub.

**Scoring terms**
- **Speed band** — the multiplier tier earned by answer speed (Lightning ×2.0 → Very Slow ×0.5).
- **Streak** — consecutive correct answers (2+ earns a bonus).
- **Comeback** — answering correctly after 3+ wrong in a row (earns a bonus).
- **Perfect round** — every Question in a Game answered correctly (earns a bonus).

---

## 3. What It Is

YourScore is a **football-knowledge competition app**. Fantasy football is about
predictions made *before* a match; YourScore is about what you actually *know* —
measured under pressure and kept as a running score over time.

You play in three ways: **along with a Live match**, in on-demand **Multiplayer** games
with your mates, and in **Solo challenges** any time. Your group's results compile into
**Leagues** so you can compare and compete.

It is **not a World Cup app.** The FIFA World Cup 2026 (11 Jun – 19 Jul 2026) is the
launch moment and marketing hook, but the product is built for football year-round —
World Cup, Euros, Champions League, Premier League, internationals.

---

## 4. Target Audience & Positioning

YourScore serves **two audiences that reinforce each other**:

1. **Consumer / friend-groups — the goal.** Football fans and their mate-groups are the
   end users and the reason the product exists. Growth runs on a viral loop: one person
   sets up a League, invites their group, some of them start their own Leagues. **The
   objective is always more users.**

2. **Pubs & venues — the acquisition engine (now) and a product (later).**
   - **Now:** pubs are a *channel* to reach more consumer users. A pub running YourScore
     during a match puts the app in front of a room of the right people. Pub outreach
     (`~/yourscore-pub-outreach`) is a primary acquisition tactic, judged by users it
     brings in. Pubs must be treated well.
   - **Later (roadmap):** a dedicated **Pub League** — a pub creates its own League;
     patrons join it at the venue and see who in the pub is topping it over time (§10).

Archetypes: **League Setter-Upper** (organiser, the acquisition target), **League
Member** (invited, plays), **Solo Fan** (enters via Challenges), **Joiner** (plays one
Game, may convert).

---

## 5. Platforms — Native Apps Primary

Distributed primarily as **native iOS and Android apps** (App Store / Google Play). The
native apps are Capacitor shells around the production web app at **https://yourscore.app**,
adding native **push notifications** (§9), OAuth deep links (`yourscore://`), and a
branded splash/icon.

The **web app at yourscore.app is the engine and source of truth** — it also runs as a
PWA in the browser, and native builds need no rebuild when the web app deploys. Public
messaging **leads with "download the app."**

- Bundle ID: `app.yourscore.app` · Domain: **yourscore.app** (the old `yourscore.gg` is
  dead — never reference it) · Web deploys from `main`; native shell on `mobile-wrap`.

---

## 6. How You Play

Three ways to play, plus a builder tool. All live in code.

### 6.1 Live match — *play along with a real fixture*
A Game synced to a real fixture as it happens. Questions fire at moments during the
actual game; everyone answers within the Window; scored live. Uses the **Question bank**
(`matches`, `question_events`, `match_scores`).

### 6.2 Multiplayer — *on-demand Games with your mates, any time*
A self-contained Game you spin up whenever you like (not tied to a real fixture):
1. Open a **Lobby** and pick its **type** — **Private** (invite, ≤8) · **Public**
   (anyone with the link, ≤20) · **1v1** (you vs one opponent).
2. Pick a **Question source** — a **Quiz pack** (incl. ones you built — §6.4) or a
   **category + difficulty filter**.
3. Share the **6-character code** → Players join the Lobby and group up → the **Game**
   starts → live leaderboard.

Backed by `rooms` / `room_members` / `room_scores` (table names predate the "Lobby"
term — see §10).

### 6.3 Solo challenge — *self-paced, single-player*
Single-player Games with no Lobby and no live fixture. Currently club season-review
packs (Premier League 2025/26, Championship). Lowest-friction entry point and a natural
SEO surface. Playable without an account; account needed to rank. Backed by `challenges`,
`challenge_questions`, `challenge_attempts`.

### 6.4 Custom Quiz Builder — *a tool, not a mode*
Generates your own **Quiz pack** (AI-assisted) for use as a Multiplayer Question source.
Backed by `quiz_packs` / `quiz_attempts`.

---

## 7. Leagues — the compilation layer

**A League is just a named group of people whose results compile into shared tables** so
friends can observe each other and compete. One set of mates is one League; another set
is another. A League is a *presentation* layer — it hosts no gameplay.

**Every League has TWO separate boards; their points NEVER combine:**

| Board | Fed by |
|---|---|
| **Live board** | **Live-match** points only. |
| **Offline board** | **Multiplayer** points (incl. **1v1**). **Solo challenges count lighter** — exact rule **TBD (to be defined by the founder's partner)**. |

**Live matches inside a League:** a friend group can create a League that *tracks a Live
match*. All members get the **same** Questions and compete **privately within their own
League**, separate from any public play. Those points land on the **Live board**.

Per member a League tracks: total score, accuracy %, current/best streak, Games played
(`leagues`, `league_members`).

> **Implementation note — current code vs. this model (the gap to close):** Games *do*
> feed Leagues today — `/api/answer` calls the `update_league_member_stats` RPC on every
> answer. But the wiring is simplified: **every point a Player earns flows into ALL their
> Leagues as one combined total.** Today there is **no Live/Offline split** (a single
> pooled total per member), Leagues **cannot yet track a specific Live match**, and the
> **Solo "lighter" weighting does not exist** (all Games count equally). The two-board
> model above is the **build target**, not the current behaviour.

---

## 8. Scoring Engine (current — `src/lib/scoring.ts`)

Per correct answer:

```
points = 100 (BASE) × difficulty_multiplier × speed_multiplier
```

- **Difficulty:** easy ×1.0 · medium ×1.5 · hard ×2.0 · expert ×2.5 · master ×3.0
- **Speed band** (% of the Window): 0–20% **Lightning ×2.0** · 20–40% **Fast ×1.5** ·
  40–60% **Normal ×1.0** · 60–80% **Slow ×0.75** · 80–100% **Very Slow ×0.5**. Window
  default 30s; set per mode.
- Wrong answer = 0.

**Bonuses:** +50 Streak (2+ correct) · +50 Comeback (correct after 3+ wrong) · **+500
Perfect round**.

**Penalties:** −25 timeout (no answer) · −50 per hint/skip · −100 ragequit (abandon
mid-Game).

**Not live yet:** the **hints system** (and its +75 no-hints bonus / −50 hint penalty) is
**deferred until hints ship**.

---

## 9. Auth, Notifications & Social

### Auth — live in production
**Apple** · **Google** · **Email + password** · **Email magic link**.
Apple Sign-In landed June 2026 alongside the iOS App Store submission (App Review
Guideline 4.8). Facebook is not live. Guests can play but need an account to earn
points / rank.

### Notifications
- **Primary: native push** (APNs iOS / FCM Android) — live-Question alerts when
  backgrounded; part of the App Store anti-thin-wrapper justification.
- **WhatsApp/link sharing** (wa.me) remains the *share* mechanic — fully supported.

### Social features — status
| Feature | Status |
|---|---|
| **Match follow** (mark interest in a fixture; `match_interests`) | ✅ Live — alerts (`match_notifications`) **being built out**. |
| **Public profiles** (`/profile/[userId]`) | 🔜 Next — about to build. |
| **Friends** (social graph) | 🔜 Next — *not built yet*; today we have **Leagues only**. (`friendships` is scaffolding; 1v1 invites are via code for now.) |

---

## 10. Roadmap (near-term, in rough order)

- Finish **Match-follow alerts** (push when a followed fixture goes live).
- **Public profiles** with stats.
- **Friends** (social graph) — also powers 1v1 invites beyond codes.
- **Hints system** (scoring hooks exist) — then no-hints/hint scoring goes live.
- **Pub Leagues** — venue-owned Leagues patrons join at the pub (first dedicated venue
  product, vs. pubs-as-acquisition today).
- **Naming cleanup** so code matches the locked vocabulary: rename `rooms` →
  `lobby`/`lobbies` (tables, routes, code), and the `/join` route → `/matches` (the tab
  already shows "Matches"). Until then: `rooms*` tables = Lobbies; `/join` = the Matches
  tab.

---

## 11. Admin Panel (`/admin`)

| Section | Purpose |
|---|---|
| `/admin/matches` | Schedule fixtures, generate Questions (Claude API), manage status |
| `/admin/questions/[matchId]` | Review / approve / edit the Question bank |
| `/admin/rooms` | View Lobbies; fire live Questions |
| `/admin/fire/[roomId]` | Live match control — fire Questions during a game |
| `/admin/challenges` | Upload season Quiz packs (paste → parse → upload) |

---

## 12. Tech Stack

Next.js 14 (App Router) · Supabase (Postgres + Auth + Realtime + Edge Functions) ·
Capacitor (iOS + Android) · APNs + FCM push · Tailwind CSS · Vercel (web) · pnpm ·
Anthropic Claude API (Question generation).

Patterns: `"use client"` interactive UI · Supabase Realtime for live Questions +
leaderboards · RLS on all tables · server-side scoring/grading via service role ·
per-user rate limiting (`rate_limits`).

---

## 13. Navigation Canon

**Bottom nav (5 tabs):** **Home · Leagues · Matches · Play · Profile.**

- **Home** (`/`) — dashboard.
- **Leagues** (`/leagues`) — your Leagues + standings.
- **Matches** (`/join`) — browse fixtures / **Live matches** and set up a League around
  one. *(The route is named `/join` for legacy reasons; the tab/page is titled "Matches".)*
- **Play** (`/play`) — two sub-tabs: **Solo** (Challenges) and **Multiplayer** (open/join
  a Lobby).
- **Profile** (`/profile`).

Guests get a reduced nav (Home + Play).

---

## 14. Discontinued / Shelved — DO NOT reference as current

| Thing | Status | Notes |
|---|---|---|
| **WhatsApp API notifications** | ❌ Discontinued | Replaced by native push. Only a `test-whatsapp` route + `lib/whatsapp.ts` remain as vestige. *(WhatsApp share links unaffected.)* |
| **Sponsored / branded rooms** | 🅿️ Shelved (back of queue) | Sponsor logos, prizes, public "Live now", winner export. Vestigial DB columns only. Not on the active roadmap. |
| **`yourscore.gg`** | ❌ Dead | Domain is **yourscore.app**. |
| **"No app download needed" as the headline** | ⚠️ Demoted | Web/PWA still works, but messaging leads with the native app (§5). |
| **Old flat-45s / linear-bonus / multiplier-streak scoring** | ❌ Superseded | Use §8. |
| **"Football IQ" phrasing** | ✏️ Replaced | Say **"football knowledge"**. |
| **"Room" as a term** | ✏️ Replaced | Say **"Lobby"** (the grouping place). `rooms*` tables pending rename (§10). |

---

## 15. Maintenance Rule

When the product changes, **update this file in the same session** and bump the
"Confirmed" date. New modes, killed features, renamed tabs, scoring tweaks, and
positioning shifts belong here first. If a future session starts referencing something
not in this document, that's the signal to reconcile — not to trust an old doc.
