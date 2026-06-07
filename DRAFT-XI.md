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

## Not yet wired (needs the migration applied + sign-in) — next session

`14_draft_xi.sql` is written but **not applied** (CLAUDE.md: never change Supabase schema
without explicit instruction). Once applied:

1. API routes (server-authoritative, mirror `src/app/api/h2h/play`): save team +
   recompute strength; create/accept challenge (friend code + random matchmaking);
   resolve match → snapshot both XIs → update `draft_standings`; stale-team guard;
   per-user rate limit.
2. Real H2H + server-rendered `/draft/match/[id]` with `og:image` → `/api/draft/og`.
3. Leaderboards: `/draft/leaderboard` (Daily / All-time via `draft_leaderboard`),
   custom leagues (`/draft/league/[code]`, create + join code + Available badges).
4. Daily reset: call `draft_reset_daily()` at 00:00 UTC (pg_cron or the existing
   `/api/cron` pattern + `CRON_SECRET`).

The Quick Match loop already exercises the exact engine real matchmaking will use, so
wiring the DB is plumbing, not redesign.
