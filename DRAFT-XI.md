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

`node scripts/draft/build-dataset.mjs` → 217 curated player-seasons across 20 iconic PL
team-seasons (each spin deals a real, recognisable squad). **Hybrid-ready:** drop a
SoFIFA-derived CSV at `scripts/draft/data/players.csv`
(`name,club,season,position,overall`) and re-run to add breadth — curated overalls win
on conflict.

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

## Still to build — next session
- **Custom leagues**: create + join-code + member board (`/draft/league/[code]`) and
  an "Available" badge; ranked matches already accept a `leagueId` and credit the
  league board — only the league CRUD + pages remain.
- **Friend challenge by code** (async accept) — random matchmaking is done; this is
  the share-code variant.
- Server-rendered `/draft/match/[id]` with `og:image` → `/api/draft/og` for
  unfurling shared results (the OG route + local share already work).

The Quick Match loop and Ranked Match share the exact same engine, so the remaining
work is plumbing, not redesign.
