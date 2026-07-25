# Gameday Quiz — deploy runbook

Branch `feat/gameday-quiz`, merged up to `origin/main` (merge commit 6ff7c39, 2026-07-23).
This is the exact order to ship. **Migration 110 ALTERs the LIVE `halftime_releases` table**,
so ordering is not optional — a wrong order breaks prod, not just the new feature.

## Pre-flight (all must be true before step 1)
- [ ] `feat/gameday-quiz` is merged up to the current `origin/main` tip and `next build` is green (done: 6ff7c39, build verified).
- [ ] `origin/main` has not moved again since the merge. If it has, `git merge origin/main` again and re-run the build — do NOT ship a branch behind main.
- [ ] Migration 110 number is still free on prod. Re-check numerically: `ls supabase/migrations | sort -t_ -k1,1n`. Main occupies 100-105, 112-113, 200-209; 110 sits in the gap. If a parallel session took 110, renumber to the next free ≥114 in one commit before shipping.
- [ ] Fantasy is confirmed still deferred (W3 not in this branch — verify `src/app/api/gameday/claim` and `src/lib/gameday/fantasy.ts` do NOT exist on the branch).
- [ ] `NEXT_PUBLIC_FANTASY_ENABLED` untouched by this deploy (this feature does not flip it).

## Step 1 — apply migration 110 to prod, THEN deploy immediately (one motion)
**Why one motion:** 110 adds `approved`/`published` to the state CHECK and the new columns.
Old prod code never writes those, so 110 is safe to apply *before* the code deploys. But the
code deploy must follow immediately — do not apply 110 and leave it for hours, because the
gameday-publish cron on the new deploy expects the new columns to exist.

1. Apply `supabase/migrations/110_gameday.sql` via the Management API
   (`POST /v1/projects/mznvuswzgkaupvaqznkm/database/query`). It is additive + `if not exists`
   guarded; it does not drop anything.
2. Verify: `select column_name from information_schema.columns where table_name='halftime_releases' and column_name in ('gameweek','publish_at','questions','published_at','kind','second_half_started_at');` → 6 rows. And the new `gameday_fantasy_awards`... **is NOT created by 110** (fantasy deferred) — confirm 110 creates no new table, only ALTERs.
3. Merge `feat/gameday-quiz` → `main` and push. Pushing `main` auto-deploys to prod via Vercel.
4. Smoke the two LIVE readers of `halftime_releases` immediately after deploy:
   - `GET /api/pl/fixtures` (the PL tab) returns its normal shape.
   - `GET /api/clubs/table` (club-fan leaderboard) returns its normal shape.
   Both must be unchanged. If either 500s, the ALTER or a reader regressed — roll back the deploy (Vercel instant rollback), the migration stays (additive, harmless).

## Step 2 — set the Vercel env + cron
- [ ] `SPORTMONKS_BASE_URL` default is the real API (only the replay harness overrides it) — confirm not set to a stub in prod env.
- [ ] The publish cron `0 8,9 * * *` is in `vercel.json` (in the branch). Confirm it registered after deploy: Vercel dashboard → Crons shows `/api/cron/gameday-publish`.
- [ ] `CRON_SECRET` present in prod env (existing; the whistle route and publish cron both use it).
- [ ] VPS gets the generation scripts + crontab (see step 4).

## Step 3 — verify the prediction poll did NOT regress (AC37-39)
The pivot decoupled prediction settlement from quiz state. On the first real matchday:
- [ ] A fixture reaching full time settles its predictions (both phases) — check
  `halftime_prediction_results` gains rows keyed on the fixture, not on any quiz pack state.
- [ ] The watchdog (`/api/cron/halftime-watchdog`) still runs `*/5` and its selection is
  time-based (no `released`/`released_late` quiz condition).

## Step 4 — VPS generation crontab (off the Vercel deploy)
On the Hetzner box (94.130.229.19), the generation scripts run from cron, NOT Vercel:
- `scripts/gameday/sync-fixtures.mjs` — weekly Mon 09:00 + on demand.
- `scripts/gameday/gen-base.mjs` — D-2 ~10:00 per matchday.
- `scripts/gameday/gate.mjs` — D-2 ~18:00 (Telegram approve).
- `scripts/gameday/gen-recap.mjs` — after each gameweek's last final whistle.
- [ ] **gate.mjs Telegram path has NEVER been run against the real bot** (verified only in
  `--dry-run`). Do ONE real send to the founder's chat before relying on it for a live slate.
- [ ] Confirm `SPORTMONKS_API_KEY` + `ANTHROPIC_API_KEY` present on the VPS.

## Step 5 — the drop migration `111`, DAYS LATER (not now)
`111_gameday_drop_fresh.sql` (NOT YET WRITTEN) drops the retired fresh-slice columns
(`fresh_questions`, `fresh_state`, `veto_deadline_at`, `telegram_message_id`) and the
`halftime_control` table.
- Apply ONLY after: (a) the new code has been live for several days, (b) `grep` proves zero
  readers of those columns in the deployed tree, (c) prod smoke on the readers passed.
- Rationale: the rollback window must never contain code that reads a dropped column. Keeping
  110 (additive) and 111 (destructive) days apart guarantees that.

## Rollback
- Code: Vercel instant rollback to the prior deploy. Safe at any point — migration 110 is
  additive so old code ignores the new columns.
- Migration 110: no rollback needed (nothing depends on the new columns until the new code
  runs). Do NOT drop the added columns to "roll back" — that would break a re-deploy.

## Not in this deploy (deferred / follow-up)
- **W3 fantasy transfer bridge** — deferred by founder until fantasy is finished. Ships separately.
- **`gameday_fantasy_awards` table** — part of W3, not created by 110.
- **`deadman.config.json` entries** for the new cron — skipped (only mtime/date modes exist,
  which LOOP-STANDARD bans); the `gameday.mjs` health check covers state-machine correctness instead.
- **Copy/marketing** — YOURSCORE.md "Recently shipped" + Confirmed-date bump happen at merge
  (AC36), same session as the ship.
