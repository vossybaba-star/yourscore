# Draft XI — build status

Competitive H2H football team-builder, a **separate game** inside YourScore (not part
of the quiz modes). Spec: `~/Downloads/DRAFT-XI-BUILD.md`. Additive only — no existing
YourScore schema, scoring, RLS, or routes were modified.

## Playable now (anonymous, no DB) — verified in browser

The full core loop works client-side with `localStorage` (anonymous play is core per
the spec; sign-in is only needed for cloud save / real matchmaking / leaderboards):

- Pick a formation + **difficulty** → **spin** a random legendary squad (signature
  **club-crest + era reveal**, 38-0 style) → **draft** into best-fit slots → live
  Strength → **projected 38-game record + tier** → **Quick Match** (single-game H2H)
  → **win → swap one player** / **loss → team stale → rebuild**.
- **Classic vs Expert mode**: Expert hides ratings during the draft (names +
  positions only — the "for real fans" mode) and reveals Strength/record on the team
  screen.
- Its own **bottom-nav tab** ("Draft XI", jersey icon) — shown to guests too (anonymous
  play is the top-of-funnel hook). Routes: `/draft`, `/draft/play`, `/draft/team`,
  `/draft/swap`, `/draft/match/result`.

## Code map

| Area | Files |
|---|---|
| Types / formations | `src/lib/draft/types.ts`, `formations.ts` |
| **Scoring engine** (pure, tuned, unit-tested) | `src/lib/draft/score.ts` + `score.test.ts` |
| Pool / spin | `src/lib/draft/pool.ts`, dataset `src/data/draft/player-seasons.json` |
| Client team state / persistence | `src/lib/draft/local.ts` |
| Auto-drafter (Quick Match opponents + bot fallback) | `src/lib/draft/opponent.ts` |
| UI | `src/app/draft/**`, `src/components/draft/Pitch.tsx` |
| Share image (broadcast graphic) | `src/app/api/draft/og/route.tsx` (uses `next/og`, no new dep) |
| DB (ready to apply) | `supabase/migrations/14_draft_xi.sql` |

## Scoring engine

`scoreTeam → Strength (~40-99)`: weighted mean of `overall × positionalFit`, spine
slots weighted heavier, minus GK/shape penalties, plus capped (+6) chemistry.
`projectSeason` maps Strength → tuned 38-game record/tier; `winProbability`/`resolveH2H`
resolve a single game with a seeded RNG (server-reproducible). Tuned so only a
near-perfect (~96+) XI can reach 38-0 Invincible and H2H upsets run ~8–30% at a 6-pt
edge. Run tests: `bash scripts/draft/run-tests.sh` (10/10 passing).

## Data

**Real FIFA ratings only — no hand-made estimates.** The pool spans **8 FIFA editions
over ~20 years**: 2006/07, 2009/10, 2012/13, 2015/16, 2018/19, 2021/22, 2024/25,
2025/26 — every Premier League club for each (≈4,900 player-seasons, 160 club-seasons),
so spins deal teams from different eras.

Source: **SoFIFA** (FIFA's own ratings DB), pulled per edition via the browser
(SoFIFA/fifaindex Cloudflare-block server-side `fetch`). Each edition's English-PL
players → `scripts/draft/data/players.csv` (`name,club,season,position,overall`;
positions mapped to our canonical set, names ASCII-folded). `node
scripts/draft/build-dataset.mjs` builds `src/data/draft/player-seasons.json` and
derives each club's strength (mean of its best XI) for the season simulator.
To extend: scrape another SoFIFA roster edition (set the `r=<roster>` param) and
rebuild. `scripts/draft/import-fifa.mjs` ingests a Kaggle-style FIFA CSV the same way.

## Cloud layer — BUILT, dormant until the migration is applied

All written and typechecking; it fails soft (e.g. the leaderboard shows "coming
soon") until the tables exist, so nothing crashes today.

| Piece | File |
|---|---|
| Typed table access (shim until `database.ts` is regenerated) | `src/types/draft-db.ts` |
| Server helpers: authoritative validate+score, standings credit | `src/lib/draft/server.ts` |
| Cloud save (recomputes Strength server-side) | `POST /api/draft/team` |
| Ranked H2H: random matchmaking + bot fallback, snapshot, standings, stale-on-loss | `POST /api/draft/match` |
| Leaderboard read (fails soft) | `GET /api/draft/leaderboard` |
| Daily reset (CRON_SECRET bearer) | `GET /api/draft/cron/reset` |
| Leaderboard UI (Daily / All-time) | `/draft/leaderboard` |

Team screen now shows **Ranked Match** (signed-in, feeds the leaderboard) vs
**Quick Match** (guest/practice, local), plus a Leaderboard link.

### To activate (your steps — schema changes need your say-so)
1. Apply `supabase/migrations/14_draft_xi.sql` to the Supabase project.
2. (Optional but recommended) regenerate `src/types/database.ts` from the live DB,
   then delete `src/types/draft-db.ts` and point imports at `database.ts`.
3. Schedule `GET /api/draft/cron/reset` at 00:00 UTC (Vercel cron / pg_cron) with
   the `CRON_SECRET` bearer — same pattern as `/api/cron/reclassify`.

## Custom leagues — BUILT (dormant until migration), fails soft

| Piece | File |
|---|---|
| Create / list my leagues | `POST` + `GET /api/draft/league` |
| Join by code | `POST /api/draft/league/join` |
| League board (members, in-league wins, Available badge) | `GET /api/draft/league/[code]` |
| Leagues hub (create / join / list) | `/draft/leagues` |
| League board + targeted challenge + share code | `/draft/league/[code]` |

Ranked matches accept `{ leagueId, opponentId }`: challenge a *specific* available
member from the board (stale teams aren't challengeable), or play a random league
match. Wins credit both the global and the league board. Linked from the
leaderboard ("My Leagues").

## Friend challenges + shareable results — BUILT (dormant until migration)

| Piece | File |
|---|---|
| Create challenge (snapshots your XI → share code) | `POST /api/draft/challenge` |
| Challenge info / accept-and-resolve | `GET` + `POST /api/draft/challenge/[code]` |
| Friend accept page | `/draft/challenge/[code]` |
| Public, server-rendered result with `og:image` → `/api/draft/og` | `/draft/match/[id]` |
| `draft_challenges` table (added to the migration) | `14_draft_xi.sql` |

Team screen has **🔗 Challenge a friend** (creates a code + shares the link). The
friend opens `/draft/challenge/<code>`, sees the challenger's snapshotted XI, and
resolves it with their own — both teams get win/loss applied and the winner is
credited. Shared `/draft/match/[id]` links unfurl as the broadcast graphic.

## Spec status — complete
Every locked feature in `DRAFT-XI-BUILD.md` is now built: data, scoring engine,
draft loop, Classic/Expert, team/record/tier, win-swap / loss-rebuild, share image
+ crest reveal, own nav tab, cloud save, ranked matchmaking + standings, global
Daily/All-time leaderboards, custom leagues, friend challenges, and server-rendered
shareable results. Everything past the anonymous core is dormant until the migration
is applied (see activation steps above) and fails soft until then.

### Possible polish (optional, next)
- A "my challenges / match history" view for the challenger to see results of
  challenges friends accepted while they were away.
- Regenerate `database.ts` post-migration and retire `src/types/draft-db.ts`.
- Club crests on the final-XI pitch tokens.

The Quick Match loop and Ranked Match share the exact same engine, so the remaining
work is plumbing, not redesign.
