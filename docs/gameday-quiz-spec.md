# Gameday Quiz — Plan + Locked Acceptance Criteria

**Supersedes `docs/halftime-quiz-spec.md` (2026-07-14).** Revised 2026-07-23 after the
founder's pivot decisions in design discussion. The product is unchanged in shape — a quiz
pack for every PL fixture, ~10/week, sustained across the season — but it is now published
**the day before the fixture** instead of at the real halftime whistle, and it feeds the
Fantasy League through the club you support.

Launch is unchanged: **full public, Fri 2026-08-21**.

---

## ⚠️ CORRECTION 2026-07-23 (post-write, verified against main and prod)

This document was first written believing the halftime build was an unmerged 66-file branch
with an unapplied migration. **That is wrong.** Verified facts, all re-checkable:

- **The halftime feature is MERGED TO MAIN.** `git ls-tree main` lists all of
  `src/lib/halftime/*`, `src/app/api/halftime/*`, `scripts/halftime/*`, and
  `supabase/migrations/93_halftime.sql`. `feat/halftime-quiz` is a stale ancestor — do not
  branch from it.
- **The migration is APPLIED TO PROD.** `halftime_releases`, `halftime_control` and
  `halftime_heartbeat` all exist in `information_schema.tables`. This is an ALTER against a
  live schema, not a clean create. §2.1's "never applied to prod" claim is void.
- **Main is at migration 102**, not 99 (`100_wc_thanks`, `101_daily_games`,
  `102_daily_game_stats`). §1.3 and §10.1 understated it.
- **`halftime_releases` is read by two LIVE surfaces:** `src/app/api/clubs/table/route.ts`
  (the club-fan leaderboard) and `src/app/api/pl/fixtures/route.ts` (the PL tab, live since
  Jul 16). Renaming the table breaks both unless every reader moves in the same migration.
- **"Halftime" on main is now THREE features, not one** (§0.3). The rename scope in §0.1
  covers only the first.
- The fantasy DB layer is **already in prod** (`fantasy_squads`, `fantasy_entries`,
  `fantasy_gameweeks`, `fantasy_leagues`, `fantasy_player_prices`, …) even though the code
  branches are unmerged. §9's W3 blocker is about *code* reachability only.

SportMonks re-verified on the paid key 2026-07-23: fixtures, lineups, **events**,
statistics, historical data and states all active; 3000 calls/hour; season 2026/27 =
`season_id 28083`; round label is a plain integer (`"1"`); `starting_at` is a UTC string.
Predicted lineups 404 — no longer needed. §10.4 is closed.

### 0.3 "Halftime" on main is three separate features

Only the first one pivots. The other two happen at a real halftime and keep their names
unless the founder says otherwise.

| Feature | Files | Verdict |
|---|---|---|
| **Halftime Quiz packs** | `scripts/halftime/{gen-base,gen-fresh,poller,veto,validate,sync-fixtures}.mjs`, `/api/halftime/{schedule,fresh,assemble,release,today,upcoming,heartbeat}`, `/api/cron/halftime-watchdog`, `src/lib/halftime/{shared,release,sportmonks}.ts`, `HalftimeRail`, `HalftimeCard`, mig 93 | **PIVOTS → Gameday** |
| **Halftime Prediction poll** | `/api/halftime/predict`, `src/lib/halftime/{predict,settle}.ts`, `HalftimePredictionPoll.tsx`, mig 95, tables `halftime_predictions` + `halftime_prediction_results` | **KEEPS the name** — it fires at the real whistle, and the Jul-5 finding was that fans want prediction and reaction at halftime, not trivia |
| **Halftime reminders** | `/api/halftime/reminders`, mig 98, `emails/lifecycle/28-halftime-live.html` | **Depends on what it reminds people about** — founder call |

The pivot is more coherent because of this, not less: trivia moves to the day before, and
the halftime moment keeps the thing fans actually wanted there.

### 0.4 ⛔ BLOCKER — the deletion list in §0.1 breaks a live feature

**The Halftime Prediction poll is settled by the watchdog that §0.1 deletes**, and it is
coupled to the quiz's own state machine. Verified on `main`:

- `src/app/api/cron/halftime-watchdog/route.ts:6` imports `settleFinishedFixtures` from
  `src/lib/halftime/settle.ts`, and `settle.ts`'s own header names the watchdog as
  *"its primary caller, every 5 minutes"*. Nothing else calls it.
- The watchdog settles predictions for fixtures in `SETTLEABLE = ["released",
  "released_late"]` (`route.ts:57`) — the exact two states §0.1 removes. Prediction
  grading is keyed on the **quiz pack's** release state.
- The prediction poll is a *second-half* prediction, so it inherently needs halftime
  detection. The poller and the state flip are not quiz-only infrastructure.

**Consequence:** deleting the poller, the watchdog and the `released`/`released_late`
states would silently stop every fan's halftime prediction from ever being graded. The
"cut the live machinery" saving in §0.2 is only fully available if the prediction poll goes
too — and the Jul-5 marketing finding says the prediction poll is the thing fans actually
want at halftime.

**Nothing in §0.1 may be deleted until the founder decides what happens to the Halftime
Prediction poll.** Three coherent options, in §10.6.

---

## 0. FOUNDER DECISIONS (locked — the build implements these, it does not reopen them)

1. **Scope = B.** Season-long: a pack for every PL fixture, ~10/week, sustained.
2. **Published the day before that fixture.** Not at halftime, not on matchday morning.
3. **Content = base only.** Historic and static facts about the fixture. The confirmed-lineup
   "fresh" slice is retired with the whistle — lineups do not exist the day before.
4. **A gameweek Recap Quiz** ships alongside it: one pack per gameweek, built from what
   actually happened across all that gameweek's fixtures, released at the end of the
   gameweek (§6).
5. **Fantasy bridge (§5):** only the gameday pack for the fixture involving **the club you
   support** feeds fantasy. It is an **ALTERNATIVE route to the same transfer credit, never
   an extra one**. Credits scale exactly as the knowledge round's do. Credits earned this
   way **always bank to the NEXT gameweek**. If there is no eligible club pack, the fallback
   is the knowledge round already assigned that week — no new mechanism.
6. **Anti-lookup timer applies**, same as the knowledge round, on any credit-eligible attempt.
7. **Gameday pack points count toward YourScore Rank** as ordinary Quiz Knowledge points
   (first-party gate-approved packs — same precedent as the daily WC packs). Unchanged.

### 0.1 What the pivot DELETES from the 2026-07-14 build

All of this is retired. Do not carry it forward, and do not rename it — delete it.

**REVISED 2026-07-23 after the founder's decision in §0.5** — the poller and watchdog were
originally on this list. They are not deleted. Only the fresh slice and its gate go.

| Deleted | Why |
|---|---|
| `scripts/halftime/gen-fresh.mjs`, `lib/dossier.mjs`, `lib/claims.mjs`, `prompts/fresh.md`, `replay-generators/gen-fresh.mjs` | The fresh slice is gone — no confirmed lineups exist the day before. |
| `scripts/halftime/veto.mjs`, `replay-generators/veto.mjs`, and the whole veto-with-timeout gate | It gated the fresh slice only. Base keeps the normal approve-to-ship gate. |
| `halftime_control` table (slate kill switch) | It killed the fresh slice. Nothing left to kill. **Table exists in prod — this is a DROP, coordinated with removing its readers.** |
| `fresh_questions`, `fresh_state`, `veto_deadline_at`, `telegram_message_id` columns on `halftime_releases` | Unused after the fresh slice goes. **Live table — drop in the same migration that removes every reader.** |
| Scenarios `fresh-gate.json`, `gate-unsendable.json`, `kill-switch.json`, `late-lineups.json` | They exercise the fresh slice and its gate. |
| Old AC 4, 8–14, 30 (fresh generation, veto gate, kill switch) | Replaced by §8. |

**NOT deleted** (reversal of the first draft — see §0.4 and §0.5):

| Kept | Why |
|---|---|
| `scripts/halftime/poller.mjs` + `poller.test.mjs` | Now serves the **Halftime Prediction poll**: it is what detects the real whistle. It no longer releases quiz packs. |
| `/api/cron/halftime-watchdog` | Sole caller of `settleFinishedFixtures` — prediction grading depends on it entirely. |
| `src/lib/halftime/{predict,settle}.ts`, `/api/halftime/predict`, `HalftimePredictionPoll.tsx`, migrations 95 + 98 | The prediction poll and reminders. Untouched by this pivot. |
| `replay-server.mjs`, `record-scenario.mjs`, `replay-test.sh`, scenarios `saturday-slate`, `postponement`, `delayed-kickoff`, `long-first-half`, `poller-crash*`, `abandoned`, `normal-match`, `recorded-matchday`, `states` | They test whistle detection, which still runs for predictions. Only their quiz-release assertions get repointed at prediction settlement. |
| `released` / `released_late` states | **Still needed** — but they now describe the *prediction* lifecycle, not the quiz. See §0.5 for the decoupling this forces. |

**Net effect, corrected:** the *quiz* comes off the whistle path and off the VPS — a pack
publishes from a Vercel cron against already-approved content, and a dead VPS can no longer
stop it going live. The **prediction poll keeps the VPS on its own critical path**, so the
platform-level SPOF remains. The SportMonks saving is likewise smaller than this document
first claimed: the 6-second live poll stays for predictions, so weekly calls stay in the
~5.5k range, not the ~200 quoted in §7. §7's cost table is corrected there.

### 0.6 FOUNDER DECISION 2026-07-23 (later same day) — TWO prediction moments

This supersedes the coupling problem in §0.4 entirely, and is simpler than the decoupling
§0.5 proposed. There are now **two** prediction polls, and **neither is attached to a quiz
pack**. Both key on the FIXTURE.

1. **Pre-match prediction** — appended to the end of a Gameday Quiz attempt, shown **only if
   the player finishes before kickoff**. Predicts the full-time result. A player who plays
   the pack after kickoff simply does not see it.
2. **Halftime prediction** — stands alone at the real whistle, predicting the second half.
   **Every player sees it whether or not they played the quiz.** It is not rendered from a
   pack page and does not require a pack to exist.

**Why this kills E1/E2/E3 rather than patching them.** All three bugs came from the poll
being rendered off `quiz_packs.metadata.halftime` and gated on pack state. Once both polls
key on the fixture:
- E1 (poll starves because gameday packs carry a different metadata key) — gone, no metadata
  lookup.
- E2 (poll opens the day before because publication used to mean the whistle) — gone, each
  poll has its own explicit window: pre-match closes at kickoff, halftime opens at the
  whistle.
- E3 (two state machines in one column) — gone, the polls no longer read quiz state at all.

**Schema.** `halftime_predictions` gains a `phase text not null check (phase in
('prematch','halftime'))`, and its uniqueness becomes one pick per user per fixture **per
phase**. Settlement grades pre-match against the full-time result and halftime against the
second-half result (`resultFromGoals` already does the latter). `second_half_started_at`
from §0.5 is still the whistle marker that opens poll 2.

**W3 (fantasy bridge) is DEFERRED, not cut.** Founder: *"wait for the fantasy stuff to be
finished, we don't need to do that now."* Build everything else; the bridge ships as its own
piece of work once `fantasy/season` and `fantasy/advice` are merged. Acceptance criteria
15–23 and 30 travel with it and are excluded from the launch set.

### 0.5 FOUNDER DECISION 2026-07-23 — prediction poll kept, machinery kept

Chosen from the three options in §10.6: **keep the Halftime Prediction poll and keep the
whistle machinery**, with the poller and watchdog serving predictions only.

**The one piece of decoupling this still forces.** Prediction settlement currently keys on
the *quiz pack's* state — `SETTLEABLE = ["released","released_late"]` in
`src/app/api/cron/halftime-watchdog/route.ts:57`. Once the quiz stops using those states,
that predicate matches nothing and predictions would never settle. So:

- **Prediction settlement must key on the fixture reaching full time**, read from SportMonks
  phases by the poller/watchdog, not on any quiz pack state.
- This is a contained change to the watchdog's row selection, not the full state-machine
  separation of option 2. It is mandatory, not optional — the pivot breaks predictions
  without it, silently and with no error.
- **AC37 (§8) covers it and must be verified before ship.**

### 0.2 What survives unchanged

Base content pipeline and its grounding rules (§3), the structured-data validator for base
claims, season-horizon dedup, the Telegram approve gate, fixture sync, the health check, the
`quiz_packs`-row-at-publish model, Rank integration, Lobby play, and the per-pack leaderboard.

---

## 1. ARCHITECTURE

### 1.1 Component map

```
                         ┌──────────────────────────────────────────────────────┐
                         │ Hetzner VPS (deploy crontab) — GENERATION ONLY         │
  SportMonks API         │  sync-fixtures.mjs   (Mon 09:00 weekly)               │
  (paid, PL league 8) ◄──┤  gen-base.mjs        (D-2 10:00, per matchday)        │
       ▲                 │  validate.mjs        (every question, before any gate) │
       │                 │  gate.mjs            (D-2 18:00 Telegram slate approve)│
       │                 │  gen-recap.mjs       (post-GW, §6)                     │
       │                 └──────────────┬───────────────────────────────────────┘
       │                                │  Bearer CRON_SECRET (HTTP only — scripts
       │                                │  never touch the DB directly)
┌──────┴─────────┐       ┌──────────────▼───────────────────────────────────────┐
│ (no replay     │       │ Vercel (Next.js app)                                  │
│  harness — the │       │  /api/gameday/{schedule,content,today}                │
│  release path  │       │  /api/cron/gameday-publish  (daily 09:00 — THE release)│
│  is a cron)    │       │  /api/gameday/claim  (fantasy credit, §5)             │
└────────────────┘       │  quiz_packs insert at publish → existing play stack   │
                         └──────────────┬───────────────────────────────────────┘
                                        ▼
                          Supabase: gameday_releases · gameday_fantasy_awards ·
                          quiz_packs/quiz_attempts (existing) · club_supporters (mig 94)
```

### 1.2 What is REUSED (re-verify each file:line at build time)

Unchanged from the 2026-07-14 spec §1.2 — every row still applies: `notifyUsers()`
(`src/lib/notify.ts:13-77`), `POST /api/room/create` (`route.ts:7,17-106`),
`POST /api/quiz/solo-complete` (`route.ts:69-85,97,115-141`), the Rank view
(`supabase/migrations/30_yourscore_points.sql:36,44` — **DO NOT TOUCH**),
`/challenges/[slug]` + `PackLeaderboard`, `/api/challenges/pack`, the cron-auth pattern from
`src/app/api/cron/wc-mastermind/route.ts:36-45`, `scripts/tg.mjs` + the `tg-gates`
exit-code conventions, `normalizeQuestionText` (`src/lib/questions.ts:12`), the deterministic
answer shuffle at publish, and `scripts/health/checks/`.

**New reuse introduced by the pivot:**

| Concern | Reuse | Where |
|---|---|---|
| Who supports which club (season-locked) | `club_supporters` — PK `(user_id, season_id)`, no update/delete policy | `supabase/migrations/94_club_fans.sql` |
| Transfer credits, bank cap, the -4 hit | the fantasy economy as built | `applyTransferTx` in `src/lib/fantasy/server.ts`; `fantasy_squads`, `fantasy_entries` |
| One bonus wildcard per half-season | `fantasy_squads.bonus_wildcard_half` | `supabase/migrations/81_fantasy_chips.sql` |
| Per-question timer + credit scaling | the knowledge round | `/api/fantasy/round/{start,step}`, `src/lib/fantasy/server.ts` |

### 1.3 What is NEW

- **Migration `1XX_gameday.sql`** (§2.1). **Number must be picked at build time** by checking
  both `supabase/migrations/` and prod — main is at 99, the fantasy branches claim 100/101,
  and per CLAUDE.md many applied migrations are absent from `schema_migrations`. Do not
  hardcode a number from this document.
- **Shared lib** `src/lib/gameday/shared.ts` (state machine, assembly, publish copy, types)
  and `src/lib/gameday/sportmonks.ts` (thin client; base URL from `SPORTMONKS_BASE_URL`).
- **API routes** `/api/gameday/{schedule,content,today,claim}` + `/api/cron/gameday-publish`
  + one `vercel.json` cron line.
- **VPS scripts** `scripts/gameday/{sync-fixtures,gen-base,validate,gate,gen-recap}.mjs`
  + `scripts/gameday/prompts/{base.md,recap.md}`.
- **Health check** `scripts/health/checks/gameday.mjs`.
- **UI** `GamedayRail` (on `/play`), `GamedayCard` (Home `Dashboard.tsx`), and the
  club-pack entry point on the fantasy surface (§5.4).

---

## 2. DATA

### 2.1 Migration — exact shape

**CORRECTED.** This is **not** a clean create. `halftime_releases` is applied to prod
(migration 93, on main) and is read by two live surfaces. So:

- **The physical table keeps the name `halftime_releases`.** Only the product name changes.
  Precedent is already locked in CLAUDE.md: the `rooms*` tables ARE Lobbies, and paths are
  never renamed. Renaming it would mean touching `src/app/api/clubs/table/route.ts` (club-fan
  leaderboard) and `src/app/api/pl/fixtures/route.ts` (PL tab, live since Jul 16) in the same
  migration, for zero user benefit.
- **Pick the number at build time and expect it to be ≥110.** Numerically (not
  lexicographically — `100` sorts before `93` as text and that trap has already produced two
  wrong answers this session): main tops out at **102**, `fantasy/season` at **109**,
  `fantasy/advice` at **101**. Numbers 100–102 are claimed by three different branches with
  different content. Re-verify against the directory AND prod before choosing.
- The migration is therefore an **ALTER of a live table plus one new table**, and must be
  staged in risk order per CLAUDE.md §2.

```sql
-- 1. ALTER the existing, live halftime_releases (name frozen — see above).
alter table halftime_releases
  add column if not exists gameweek     int,
  add column if not exists publish_at   timestamptz,
  add column if not exists questions    jsonb,
  add column if not exists published_at timestamptz;

-- The state CHECK gains 'approved' and 'published'. 'released'/'released_late' STAY —
-- they now describe the prediction lifecycle (§0.5), not the quiz.
-- Dropping the fresh-slice columns (fresh_questions, fresh_state, veto_deadline_at,
-- telegram_message_id) and the halftime_control table happens ONLY after every reader
-- is removed, in the same migration, verified by grep.

-- Columns 93 already gave us and we keep using: id, fixture_id (unique), season_id,
-- round_name, pack_id, home, away, kickoff_at, state, base_questions, pack_questions,
-- released_at, created_at, updated_at.
--
-- `gameweek` is parsed from round_name, which SportMonks returns as a plain integer
-- string ("1") — verified on the paid key 2026-07-23.

create index if not exists halftime_releases_publish_idx
  on halftime_releases (publish_at) where state = 'approved';
create index if not exists halftime_releases_gw_idx
  on halftime_releases (season_id, gameweek);

-- 2. NEW table — the fantasy bridge.
-- One fantasy credit award per user per gameweek. The PK IS the cap — a second
-- award for the same gameweek cannot be written, whatever the caller does.
create table gameday_fantasy_awards (
  user_id    uuid not null references profiles(id) on delete cascade,
  season_id  bigint not null,
  gameweek   int not null,
  pack_id    uuid not null,                      -- which club pack earned it
  attempt_id uuid not null,                      -- the credit-eligible quiz_attempts row
  credits    int  not null,                      -- scaled exactly as the knowledge round
  applies_to int  not null,                      -- ALWAYS gameweek + 1 (§5.3)
  perfect    boolean not null default false,     -- drove a bonus-wildcard mint attempt
  created_at timestamptz not null default now(),
  primary key (user_id, season_id, gameweek)
);

-- RLS: enable on gameday_fantasy_awards, create NO anon/authenticated policies
-- (deny-all; service_role bypasses). halftime_releases is already RLS deny-all from
-- migration 93 — do not weaken it. Public reads go only through /api/gameday/today,
-- a filtered projection.
-- Function grants: revoke from PUBLIC (not just anon/authenticated — CLAUDE.md §4).
```

**Quiz state machine**, single direction, compare-and-set on every transition:
`scheduled → base_ready → approved → published`; any pre-publish state `→ cancelled`
(postponement, or unapproved by its deadline) or `→ failed` (bounded-retry exhaustion).
No transition out of `published`/`cancelled` except manual founder action.

**`released` / `released_late` are NOT part of that machine any more.** They stay in the
CHECK constraint because the prediction poll's lifecycle still uses them (§0.5). The two
concerns share one table and must not share one state field's meaning — the build states
explicitly, in `shared.ts`, which states belong to which feature, and prediction settlement
keys on full time from SportMonks rather than on any of them (AC37).

### 2.2 `publish_at` derivation

`publish_at = 09:00 Europe/London on the calendar day before `kickoff_at`'s Europe/London
date`. Computed at sync and recomputed whenever `kickoff_at` moves. A fixture whose kickoff
moves to a different day gets a new `publish_at`; if that day has already passed, the pack
publishes at the next cron tick rather than never (§4.1 step 3).

---

## 3. CONTENT PIPELINE (one pass — base is the whole product)

### 3.1 The rule that used to be structural, restated

The 2026-07-14 spec's hard rule ("no question may depend on anything after the kickoff
whistle") is now trivially satisfied: the pack is written two days early, approved one day
early, frozen at approval, and published before the match exists. **Nothing generates,
regenerates, or edits content after approval.** The publish step only flips state and
inserts the already-frozen `quiz_packs` row.

The content rule that still needs enforcing is the *other* one, and it matters more now:
**historic and static only.** No form, no injuries, no current squad, no current manager, no
league position. Those reproduce the Jul-13 stale-fact failure class, and a pack written
D-2 and read by a player on D-1 has a 48-hour staleness window on anything current.

### 3.2 Generation — `scripts/gameday/gen-base.mjs`

Unchanged from the old §2.2 in every respect that survives:

- **10 questions, complete pack.** Difficulty mix 3 easy / 4 medium / 3 hard.
- **Content:** H2H record, classic meetings, club records, iconic players of this fixture,
  stadium and derby history.
- **Grounding sources, named:** (1) SportMonks Historical Data (H2H fixtures, season
  aggregates) via `src/lib/gameday/sportmonks.ts`; (2) the owned validated pool
  (`src/data/games/pool.json`, the same source `src/lib/games/serve.ts` plays from);
  (3) web verification for anything neither covers. Every question carries a provenance
  entry (source + retrieval date) in a slate sidecar JSON.
- **Generator:** headless Claude routine on the VPS (the proven daily-WC muscle). Authors
  write the answer as A; deterministic shuffle happens at approval, seeded on `fixture_id`.
- **Validation:** `scripts/gameday/validate.mjs` runs on every question before any gate.
  Base questions carry `source_ref` claims checked against the provenance sidecar, plus
  `h2h_fact` claims re-resolved against SportMonks historical fixtures. A question with no
  machine-checkable claim is **dropped as ungrounded by definition**.
- **Dedup:** `normalizeQuestionText` against (a) the `questions` bank, (b) every prior
  gameday pack **this season** — reverse fixtures recur, so the horizon is the season, not
  the gameweek — and (c) every Recap pack this season (§6).

### 3.3 The approve gate — `scripts/gameday/gate.mjs`

The normal approve-to-ship norm. The veto-with-timeout departure died with the fresh slice.

- ONE Telegram batch message per matchday slate at **D-2 ≈18:00**, per-pack
  Approve / Regenerate buttons, regenerate bounded at 2 rounds, following
  `scripts/tg-gates.mjs` conventions and exit codes (0/1/3).
- Reminder at **D-1 07:00**, two hours before publish.
- **A pack unapproved by its `publish_at` → row `cancelled`**, that fixture simply has no
  pack, Telegram FYI. Approved sets are written to `gameday_releases.questions` via
  `POST /api/gameday/content`, state → `approved`, `pack_id` pre-assigned.
- No pack ever reaches players without passing this gate. There is no auto-release path.

**Founder load:** one approval sitting per matchday, ~5 minutes, with a full day of slack
before publish. This is the change that makes cancellation rare rather than a matchday-morning
coin flip — but it is still a standing weekly dependency on the founder's availability, in
February as much as August, and the fallback in §5.3 exists partly because of it.

### 3.4 Timeline — Saturday 15:00 slate

| Clock (UK) | Offset | Action |
|---|---|---|
| Thu 10:00 | D-2 | `gen-base.mjs` for all Saturday fixtures (bounded concurrency 2; ~10 packs) → validator → dedup |
| Thu 18:00 | D-2 | ONE slate gate to Telegram (per-pack Approve / Regenerate, regen ≤2) |
| Fri 07:00 | D-1 | unapproved-pack reminder |
| Fri 09:00 | D-1 | `/api/cron/gameday-publish` → every `approved` row with `publish_at <= now()` flips to `published`, `quiz_packs` row inserted, push fan-out (§4.3) |
| Fri 09:00 → Sat 15:00 | — | pack is live and playable, ~30 hours |
| Sat 15:00 | KO | nothing happens. The pack is unaffected by the match. |

Compare to the old spec's §2.7: no T-75 lineup watch, no 600 calls/hr, no veto window, no
6-second live poll, no HT band, no day-summary daemon exit.

---

## 4. PUBLICATION

### 4.1 `/api/cron/gameday-publish` — Vercel cron, daily 09:00 Europe/London

Auth `Bearer CRON_SECRET` + `export const fetchCache = "force-no-store"` (both patterns from
`wc-mastermind/route.ts:36-45`). Logic, in order:

1. No rows with `state='approved'` and `publish_at <= now()` → return `{idle:true}`, zero
   SportMonks calls, zero writes.
2. For each due row, in a single CAS per row (`update … where state='approved'` returning):
   flip to `published`, set `published_at`, insert the `quiz_packs` row (§4.2).
3. **Catch-up:** a row whose `publish_at` is in the past and is still `approved` (cron missed,
   kickoff moved forward) publishes on this tick. A row whose *kickoff* has already passed
   publishes nothing and goes `cancelled` — a pack for a match that has been played is
   pointless, and its questions may now read as stale.
4. Postponement check: one `GET /v3/football/fixtures/date/{tomorrow}` per run; any tracked
   fixture no longer scheduled → `cancelled`, no pack inserted, no push.
5. Return counts. The health check asserts against them (liveness ≠ correctness).

Running it twice changes nothing: the CAS makes step 2 idempotent and the pack insert is
`on conflict (id) do nothing` against the pre-assigned uuid.

### 4.2 The `quiz_packs` insert

Unchanged from the old §3.5 step 2, including the gotcha: prod `quiz_packs_type_check` allows
only `club|national|records`, so gameday packs use **`type='records'`** with linkage in
`metadata.gameday = {fixture_id, gameweek, kickoff_at, home, away}`. `status='published'`,
`rotation_active=true`, `question_count=10`. We introduce no new status value and **no ALTERs
to `quiz_packs`**.

Before publish the pack is invisible and ungradeable: `solo-complete` requires
`status='published'` (`route.ts:97`) and `/api/challenges/pack` 404s. That closes the
pre-play leak window, exactly as the staged→released design did.

### 4.3 Push policy — now personalised by club

This is the one place the pivot makes push *better* rather than simpler. Previously the rule
was "first whistle of the day wins", which is arbitrary. Now:

- **Each user gets the pack for the club they support**, if that club has a pack publishing
  today. `club_supporters` gives this directly.
- Users with no `club_supporters` row get no gameday push (they still see the rail and the
  Home card). Do not fall back to a random fixture — an arbitrary pack is what made the old
  rule bad.
- `notifyUsers({dedupeKey: "gameday:"+fixtureId, requireOptIn: true,
  url: "/challenges/<slug>?pid=<packId>"})` — opt-in and exactly-once per fixture built in
  (`notify.ts:33-61`).
- **Per-user daily cap = 1 gameday push**, enforced as before by excluding users already
  holding any `gameday:%` `notification_log` row created today. With the club rule this cap
  should almost never bind (one club, one fixture per matchday) — it is a backstop for
  double gameweeks.
- Copy: locked vocabulary, never mentions the delivery mechanism, and — since the match has
  not happened — there is nothing to spoil. Name the fixture and the club.
- Cap 2000 targeted per run (mastermind precedent).

---

## 5. THE FANTASY BRIDGE

### 5.1 Eligibility

A gameday pack is **credit-eligible** for a user if and only if:

1. the user has a `club_supporters` row for the current season, and
2. that club is the home or away side of the pack's fixture, and
3. the user has no `gameday_fantasy_awards` row for this `(season_id, gameweek)` yet.

Condition 3 is enforced by the table's primary key, not by application logic. Because a club
plays once per gameweek, conditions 1–2 already yield at most one eligible pack per user per
gameweek in the normal case; the PK covers double gameweeks and any race.

Club choice is **locked for the season** at the DB layer (`club_supporters` has no update or
delete policy for anon/authenticated), so nobody can hop clubs to farm an easier pack. No
extra guard is needed.

### 5.2 Scoring, timer, and the anti-lookup rule

- Credits scale **exactly as the knowledge round's do**: correct answers, harder ones
  weighted more, no speed scoring and no difficulty-choice scoring. Reuse the round's scaling
  function directly — do not reimplement it, or the two routes will drift apart.
- **The anti-lookup timer applies.** A credit-eligible attempt runs under the knowledge
  round's per-question timer.
- **The credit-eligible attempt is the user's FIRST attempt on their own club's pack,
  whichever surface they enter from.** This is the important rule and it must be enforced at
  the attempt level, not offered as a mode. If a user could play the pack casually and untimed
  first, then start a separate "play for credit" run, they would simply be reading the answers
  before the timed attempt. So: for a user whose club is in the fixture, their first attempt on
  that pack is timed and credit-eligible, always; every later replay is untimed and pays
  nothing. The fantasy and quiz surfaces must both say so before the first question.
- A **perfect** credit-eligible attempt mints a bonus wildcard on exactly the same terms as a
  perfect knowledge round. No new guard is required: `fantasy_squads.bonus_wildcard_half`
  already records the half a perfect round minted in, so one bonus per half-season holds
  regardless of which route earned it.

### 5.3 Timing — credits always bank to the next gameweek

The fantasy deadline is **90 minutes before the gameweek's first kickoff** (founder-locked
10 Jul) and does not move per fixture. A pack published the day before a Sunday fixture lands
after that deadline has gone. Only clubs in the round's opening fixture would ever have a pack
out in time, and which clubs those are changes weekly with the TV picks.

So `gameday_fantasy_awards.applies_to = gameweek + 1`, always, uniformly, for every club.
The credit enters the user's bank for the following gameweek and is then subject to the
existing bank cap. The loop the player experiences is: play your club's pack this week, spend
the credit next week.

### 5.4 The fallback

If a user has no credit-eligible pack in a gameweek — pack cancelled, fixture postponed, club
blank that gameweek, or no club declared — **the fallback is the knowledge round already
assigned that week in fantasy.** There is no new mechanism, no compensation logic, and no
special case in this spec: the user simply earns the way fantasy already works.

This is also why the bridge is safe. It is an **alternative route to the same credit, never an
extra one**: total credit supply is unchanged from a fantasy-only world, so the ~5 bank cap and
the -4 hit symmetry keep their meaning, and nobody who plays only one of the two games is worse
off than they are today.

### 5.5 `POST /api/gameday/claim`

Called server-side at the end of a credit-eligible attempt (never trusted from the client):

1. Re-derive eligibility (§5.1) from `club_supporters` + the pack's fixture. Ineligible →
   `{credited:false, reason}`.
2. Re-derive the credit from the graded `quiz_attempts` row using the knowledge round's
   scaling function. Never accept a score from the caller.
3. Insert `gameday_fantasy_awards`. On PK conflict → `{already:true}`, stop.
4. Apply the credit to the squad's bank for `gameweek + 1`, and if `perfect`, attempt the
   bonus-wildcard mint through the existing half-guarded path.
5. Return the award. The caller asserts success by re-reading it (LOOP rule 1 — never trust
   the 200 alone).

### 5.6 Coverage — a number the build should watch

Queried from prod 2026-07-23: **634 `club_supporters` rows against 9,967 profiles (6.4%)** —
but every one of those 634 was created between 18 and 23 July, i.e. all of them in the five
days since club picking shipped with the PL tab. It is a new surface converting fast, not a
dead one.

Left alone until Aug 21 that trend gives low thousands declared, still well short of everyone.
**Therefore: picking a club must be part of fantasy onboarding.** If it is not, most managers
never declare, never get a credit-eligible pack, and silently sit on the §5.4 fallback forever
without discovering the club route exists.

---

## 6. THE GAMEWEEK RECAP QUIZ

A second, smaller pipeline. One pack per gameweek, built from what actually happened across
**all** that gameweek's fixtures.

- **Release:** after the gameweek's last final whistle, published by the same daily cron
  (a `gameday_releases` row with `gameweek` set, `fixture_id` null-equivalent — use a
  synthetic negative id keyed on `(season_id, gameweek)` to keep the unique constraint honest,
  or a `kind` column; the build picks one and states it).
- **Content:** goals, red cards, records broken, unusual scorelines, milestones. This is the
  only quiz on the platform that can be about *this week's* football, which is the whole
  reason it exists.
- **Data source:** SportMonks match events for the gameweek's fixtures — the same
  entitlement the old fresh-slice fact miner used, repointed from pre-kickoff lineups to
  post-match events. Much of `lib/dossier.mjs`'s mining shape is reusable here even though the
  file itself is deleted; lift the patterns, not the file.
- **Gate:** same Telegram approve gate, same validator, same season-horizon dedup.
- **Timing pressure:** it must generate, gate and publish before the next gameweek's football
  starts, or it is stale. That is a genuinely tight loop and the one part of this spec with real
  schedule risk. Generate on the final whistle of the last fixture, gate that evening, publish
  the next morning.
- **Fantasy:** the Recap Quiz does **not** pay transfer credits. It is a Rank-scoring pack
  like any other. Only the club gameday pack feeds fantasy (§0.5).

---

## 7. SEASON OPS

- **Fixture sync** — `scripts/gameday/sync-fixtures.mjs`, weekly VPS cron Mon 09:00:
  `GET /v3/football/fixtures/between/{today}/{+14d}` filtered `fixtureLeagues:8` → upsert
  `gameday_releases` on `fixture_id`, computing `publish_at` (§2.2). Date-driven, so midweek
  rounds, double gameweeks and rearranged fixtures are handled automatically. Blank GW = no
  rows = every downstream job no-ops at zero cost. Sync asserts success by re-reading the
  post-upsert count; zero fixtures on a date the PL calendar expects them → Telegram warning.
- **Health check** — `scripts/health/checks/gameday.mjs` in the existing 4x/day suite:
  asserts (a) every fixture kicking off tomorrow has a row in `approved` or `published` by
  10:00, (b) no row sits in `base_ready` past its gate deadline, (c) off-days the publish cron
  reported `{idle:true}`. Assert the *content* of the state machine, never file mtimes
  (LOOP-STANDARD P2 bans new mtime deadman entries).
- **Weekly cost, steady state ~10 fixtures — CORRECTED after §0.5.** The quiz itself costs
  ~3 sync calls + ~200 validator/historical calls ≈ **200/wk**. But the 6-second live poll
  **stays**, for the prediction poll, at ~4–5k calls/wk. **Total remains ≈5k/wk**, against a
  verified **3000/hour** limit on the paid key (2026-07-23) — comfortable, but the earlier
  "down to 200/wk" claim in this document was wrong and is withdrawn. Anthropic: 10 base
  packs + 1 recap pack ≈ **£1–3/wk**. Vercel: one publish cron run/day plus the existing
  `*/5` watchdog. Founder: ~5 min per matchday slate.
- **Covers:** unchanged — **plumbing ships, pixels wait.** Packs launch with the existing
  no-cover gradient card. Fixture cover art comes later via one contact-sheet approval;
  `metadata` already carries what a cover job needs. No generated imagery in this build.

---

## 8. LOCKED ACCEPTANCE CRITERIA

Numbered, individually testable by someone who didn't build it. **[LIVE]** items are
re-verified on the first real matchday (2026-08-21/22).

**A. Content**
1. By its gate deadline, every PL fixture in the next matchday has a `gameday_releases` row
   in `state='base_ready'` with 10 questions, each with 4 options, an answer key, difficulty
   ∈ {easy,medium,hard} (mix 3/4/3), and a provenance entry in the slate sidecar naming its
   grounding source.
2. Zero current-affairs claims: no form, injuries, current squad, current manager, or league
   position in any published question. Checkable by reading all 10 per pack.
3. A question with zero machine-checkable claims is auto-dropped (unit-testable on
   `validate.mjs` with a fabricated ungrounded question).
4. Dedup: no published question's `normalizeQuestionText` matches the `questions` bank, any
   other gameday pack this season, or any Recap pack this season.
5. Content is frozen at approval: the published `quiz_packs` questions are byte-identical to
   the `gameday_releases.questions` jsonb written at approval. No generation or content
   mutation call executes after approval for any fixture (log-provable).

**B. Gate**
6. One Telegram slate message per matchday, per-pack Approve/Regenerate (regen ≤2), reminder
   at D-1 07:00.
7. A pack unapproved by its `publish_at` → `cancelled`, no pack, no push, Telegram FYI.
   Attempting to publish an unapproved fixture is refused by the cron (`state != 'approved'`).

**C. Publication**
8. Every approved pack for tomorrow's fixtures is live and openable at
   `/challenges/<slug>?pid=` by 09:05 on D-1, and appears in `/api/gameday/today`.
9. Re-running the publish cron is a no-op: no second push, no state change, no duplicate pack
   row (CAS + `on conflict do nothing`; invoke it 3× concurrently).
10. Before publish the pack is invisible and ungradeable: `/api/challenges/pack` 404s,
    `/api/quiz/packs` does not list it, and `POST /api/quiz/solo-complete` returns 404 for its
    pre-assigned pack id.
11. Postponement: row → `cancelled`, no `quiz_packs` row ever inserted, no push; a rescheduled
    fixture re-enters via weekly sync with a recomputed `publish_at` and passes back through
    the approve gate (date-locked rule).
12. A pack whose kickoff has already passed while still `approved` goes `cancelled`, never
    published.
13. **[LIVE]** Push: opt-in users receive the pack **for the club they support**, exactly once
    per fixture (`notification_log` has exactly one row per user per `gameday:<fixtureId>`),
    at most one gameday push per user per day, deep-linking to the pack, with no
    delivery-mechanism language.
14. A user with no `club_supporters` row receives no gameday push, and specifically not a
    random fixture's push.

**D. Fantasy bridge**
15. A user whose club is in a published fixture gets a **timed** first attempt on that pack,
    and that attempt is credit-eligible. A second attempt on the same pack is untimed and
    credits nothing.
16. A user whose club is NOT in a fixture's pack gets an ordinary untimed pack and no credit,
    however they reach it.
17. Credits awarded equal what the knowledge round's own scaling function returns for the same
    answer pattern — asserted by calling that function directly in a test, not by
    reimplementing the expected value.
18. `gameday_fantasy_awards` accepts exactly one row per `(user_id, season_id, gameweek)`:
    a second claim in the same gameweek (double gameweek, replay, concurrent request) returns
    `{already:true}` and writes nothing.
19. Every award has `applies_to = gameweek + 1`, for every club, regardless of when their
    fixture falls in the round. The credit is spendable in the next gameweek and not before.
20. A perfect credit-eligible attempt mints at most one bonus wildcard per half-season across
    **both** routes: a user who scores a perfect knowledge round and a perfect club pack in the
    same half gets one bonus wildcard, not two (asserted against
    `fantasy_squads.bonus_wildcard_half`).
21. `/api/gameday/claim` never trusts a client-supplied score or eligibility: it re-derives
    both server-side from `quiz_attempts` and `club_supporters`. Proven by posting a forged
    body and getting the correct (or refused) award.
22. Total transfer-credit supply is unchanged from a fantasy-only world: in a season
    simulation, a user who plays both games cannot exceed the credit bank a knowledge-round-only
    user could reach in the same gameweeks.
23. A user with no eligible club pack in a gameweek can still earn that week's credits from the
    knowledge round exactly as before — no code path treats them as already awarded.

**E. Play, scoring, rank** (unchanged from the old spec)
24. A signed-in user completing a published gameday pack solo gets a `quiz_attempts` row graded
    server-side, first-attempt-only, and their Rank knowledge points increase by the attempt
    score. No changes to `src/lib/scoring.ts` or migration 30.
25. "Play with friends" creates a **Lobby** (locked vocab) on the pack via the existing
    `POST /api/room/create`; a 2-player game completes end-to-end with scores.
26. The per-fixture leaderboard is the existing per-pack `PackLeaderboard` on the pack's
    challenge page, reachable from the rail. Zero new leaderboard backend.
27. Guests see exactly the existing guest pack behavior; nothing gameday-specific breaks the
    guest path.
28. The club-fan leaderboard continues to compute from `quiz_attempts` + the releases table,
    ranked by AVERAGE per participating fan — verify the rename did not break it.

**F. Surfaces**
29. The `/play` Gameday rail renders only when `/api/gameday/today` has rows: it shows
    tomorrow's fixtures as playable now, and is absent entirely on a day with no published
    packs. The Home card mirrors this.
30. The fantasy surface shows the user their club's pack when one is live and credit-eligible,
    states plainly that the first attempt is timed and pays a credit for **next** gameweek, and
    shows the knowledge round as the route when no eligible pack exists.

**G. Recap Quiz**
31. One Recap pack per completed gameweek, generated from that gameweek's match events, gated
    and published before the next gameweek's first fixture. It scores to Rank and pays no
    transfer credits.

**H. Negative criteria — what must NOT change or break**
32. Untouched and behaviorally identical: `/api/quiz/packs` cache headers and response shape;
    `/api/challenges/pack` caching; `/play` picker tabs; the daily WC quiz launch; WC Mastermind
    cron; rank views (migration 30); `VALID_COUNTS`; `quiz_packs` schema (no ALTERs —
    metadata-only usage); the fantasy knowledge round, transfer, chip and wildcard paths (the
    bridge adds a caller, it does not modify the economy).
33. A **real `next build`** passes (`NEXT_DIST_DIR=.next-verify`; ESLint unused-imports is the
    known tsc-passes/build-fails trap). No new service-role route ships without
    `fetchCache = "force-no-store"` (grep-checkable).
34. The migration applies cleanly to prod-shaped schema; both new tables are RLS-on with no
    anon/authenticated policies (anon SELECT returns zero rows or permission denied); function
    privileges revoked from PUBLIC, not just anon/authenticated.
35. Every deleted artefact in §0.1 is actually gone from the branch — no orphaned poller,
    watchdog route, veto script, replay scenario, or `halftime_*` table. Grep-checkable.
36. On-ship docs: YOURSCORE.md changelog line + Confirmed-date bump, `graphify update .` run,
    LOOP-STANDARD scorecard row added — same session as ship.

**I. The prediction poll must not regress** (added 2026-07-23, §0.5)
37. **Halftime predictions still settle.** After the pivot, a fan's second-half prediction on
    a fixture that reaches full time is graded exactly as before, and settlement no longer
    depends on any quiz pack state. Prove it two ways: (a) the watchdog's row selection
    contains no reference to `released`/`released_late` as a *quiz* condition; (b) replay a
    completed fixture end-to-end with the quiz pack in `published` (never `released`) and
    confirm `halftime_prediction_results` gains its row and every pick is graded.
38. The prediction poll, its route, its component, its reminders and their emails are
    behaviourally identical to main — verified by diffing those files to zero.
39. `/api/clubs/table` (club-fan leaderboard) and `/api/pl/fixtures` (PL tab, live) still
    read `halftime_releases` successfully and return unchanged shapes. Both are live
    surfaces; a broken read here is a user-visible prod regression.

---

## 9. BUILD WORK-BREAKDOWN — 4 workstreams, zero file overlap

Interfaces between workstreams are the HTTP routes and CLI contracts. Any file not listed is
out of bounds for that stream.

**Branch: cut `feat/gameday-quiz` off `main`, NOT off `feat/halftime-quiz`** (which is a
stale ancestor — see the correction block at the top).

### W0 — Demolition (lands first, alone)
Delete the fresh-slice artefacts in §0.1 and their readers. **Much smaller than the first
draft**: the poller, watchdog, replay harness and prediction files all stay.

Rename **only the quiz's own** files: `gen-base`, `validate`, `sync-fixtures`, the quiz
routes, `shared.ts`, `release.ts` → `publish.ts`, `HalftimeRail` → `GamedayRail`,
`HalftimeCard` → `GamedayCard`, `useHalftimeToday` → `useGamedayToday`. **Do NOT rename**
`predict.ts`, `settle.ts`, `HalftimePredictionPoll.tsx`, `/api/halftime/predict`,
`/api/halftime/reminders`, `poller.mjs`, or `/api/cron/halftime-watchdog` — those are the
prediction feature and keep their name. **Do NOT rename the `halftime_releases` table**
(§2.1). One commit, no behaviour change beyond deletion and renaming.

### W1 — Foundation
```
supabase/migrations/1XX_gameday.sql        (number picked at build time — §1.3)
src/lib/gameday/shared.ts
src/lib/gameday/sportmonks.ts
src/app/api/gameday/{schedule,content,today}/route.ts
src/app/api/cron/gameday-publish/route.ts
vercel.json                                (append ONE cron line — only W1 touches this)
```

### W2 — Generation + gate + season sync
```
scripts/gameday/{sync-fixtures,gen-base,validate,gate,gen-recap}.mjs
scripts/gameday/prompts/{base.md,recap.md}
scripts/health/checks/gameday.mjs
scripts/health/deadman.config.json         (append entries — only W2 touches this)
```
Imports `scripts/tg.mjs` (existing, READ-ONLY). Does NOT edit `scripts/tg-gates.mjs` or
`scripts/launch-daily.mjs` — the slate gate is a new script following their conventions.

### W3 — Fantasy bridge
```
src/app/api/gameday/claim/route.ts
src/lib/gameday/fantasy.ts                 (eligibility + credit derivation)
```
Calls into the fantasy economy; **modifies none of it**. The knowledge round's scaling
function is imported, never copied. Depends on W1's migration for
`gameday_fantasy_awards`. **This workstream must not land before the fantasy branches are
merged** — it imports from `src/lib/fantasy/server.ts`, which is currently unmerged on
`fantasy/season` and `fantasy/advice`.

### W4 — Frontend surfaces
```
src/components/quiz/GamedayRail.tsx
src/components/home/GamedayCard.tsx
src/app/play/page.tsx                      (mount rail — only W4 touches this)
src/components/home/Dashboard.tsx          (mount card — only W4 touches this)
```
Plus the club-pack entry point on the fantasy surface (§5.4), owned by W4 and coordinated with
W3's contract. `/challenges/[slug]`: **NO changes.**

Merge order: **W0 → W1 → {W2, W4} → W3** (W3 last, gated on the fantasy merge).

---

## 10. OPEN ITEMS

1. **Migration number** — pick at build time, numerically, against both the directory and
   prod. Expect ≥110: main is at **102**, `fantasy/season` at **109**, `fantasy/advice` at
   **101**, with 100–102 claimed by three branches with different content. Sorting migration
   filenames as text puts `100` before `93` and has already produced two wrong answers.
2. **Fantasy branch merge** — `fantasy/season` (→109) and `fantasy/advice` (→101) are
   unmerged and collide with main across 100–102. W3 is blocked on that being resolved, and
   it needs resolving before Aug 21 regardless of this feature. Note the fantasy **tables**
   are already in prod; only the code is unreachable.
3. **Recap Quiz row shape** — synthetic fixture id vs a `kind` column (§6). Build picks one.
4. ~~SportMonks entitlements~~ — **CLOSED 2026-07-23.** Paid key verified: fixtures,
   lineups, events, statistics, historical data, states, livescores all active; 3000/hour;
   season `28083`; round label a plain integer; `starting_at` a UTC string. Predicted
   lineups 404, no longer needed.
5. **Club pick in fantasy onboarding** (§5.6) — a product decision, not a build detail, but
   the bridge's reach depends on it.
6. ~~What happens to the Halftime Prediction poll~~ — **DECIDED 2026-07-23, §0.5:** keep it,
   keep the whistle machinery, decouple settlement from quiz state (AC37).
7. ~~Halftime reminders~~ — **DECIDED 2026-07-23:** the matchweek "Notify me" toggle is
   wired into the day-before publish. `pushForFixture` now pushes to that fixture's
   `halftime_reminders` subscribers as well as club supporters (unioned, deduped, one daily
   cap); the reminders route guard now rejects a reminder once the pack is `published`
   (was the retired `released` states). Per-fixture opt-in, not club-tied. Built in W1.
