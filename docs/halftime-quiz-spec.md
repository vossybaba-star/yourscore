# Halftime Quiz Packs — Scope B: Plan + Locked Acceptance Criteria (REVISED)

Stage 2 of the Feature-Build Framework. Revision of the 2026-07-14 Scope-A spec after the
founder's Gate-1 decisions (same day): **Scope B**, **hybrid content (base + fresh slice)**,
**Telegram veto-with-timeout gate on the fresh slice**, **live state-flip release**,
**points count toward Rank**. Stage 6 grades the build against §7, item by item.

Every file:line below was re-verified against the build worktree
(`feat/halftime-quiz`, off `origin/main` at `5f922bd`) on 2026-07-14. Where the earlier
spec cited files that turn out to live only on the uncommitted fantasy branch, the
reference has been corrected (§1.4).

---

## 0. FOUNDER DECISIONS (locked — the build implements these, it does not reopen them)

1. **Scope = B.** Season-long: a pack for every PL fixture, ~10/week, sustained.
2. **Content = hybrid, two-pass.** Base questions written the day before from
   historic/static facts; a fresh slice generated when confirmed lineups land
   (~T-60 to T-45), grounded in what the team sheets reveal.
   **Hard rule, absolute: no question may depend on anything that happened after the
   kickoff whistle.** Everything up to kickoff is fair game; nothing after it.
3. **Fresh-slice gate = Telegram veto with timeout.** Fresh questions go to Telegram as a
   batch; the founder can veto; unvetoed questions **auto-release** at the deadline. Plus a
   **slate kill switch** (one message kills a whole matchday's fresh slices). A structured-data
   validator runs regardless and auto-drops any question whose named players/facts don't
   resolve against SportMonks — the veto is the human layer on top, never the only layer.
   (This is a deliberate founder departure from the approve-to-ship norm, **scoped to the
   fresh slice only** — the day-before base slate keeps the normal approve gate, §3.3.)
4. **Release trigger = live SportMonks state flip** (`state_id == 3` = HT), never a
   kickoff+45 timer. Poller = long-lived Node process on the Hetzner VPS (6s poll of
   `/livescores/latest`). Watchdog = Vercel cron `*/5`, bounding worst-case release to
   ~6 min; if the 2nd half already started it releases **without push** (`released_late`).
5. **Halftime pack points count toward YourScore Rank** as ordinary Quiz Knowledge points
   (first-party gate-approved packs — same precedent as the daily WC packs).

**Founder pre-build blockers (unchanged from stage 1, re-stated):**
- **SportMonks trial ends 2026-07-22.** Founder is converting to paid. Before build starts,
  re-run `GET /v3/my/resources` on the paid key and confirm livescores/inplay/states/
  periods/lineups + Historical Data survive. No paid confirmation by Jul 21 = build waits.
- YOURSCORE.md §5A.1 doc question (live-match quiz gate) — flagged in §8; needs a
  one-line founder answer at ship gate, not before build.

---

## 1. ARCHITECTURE (Scope B)

### 1.1 Component map

```
                         ┌──────────────────────────────────────────────────────┐
                         │ Hetzner VPS (deploy crontab)                          │
  SportMonks API         │  sync-fixtures.mjs  (Mon 09:00 weekly + matchday 07:00)│
  (paid, PL league 8) ◄──┤  gen-base.mjs       (day-before, per matchday)        │
       ▲                 │  poller.mjs         (matchday daemon, 6s live poll)   │
       │                 │    ├─ lineup watch → gen-fresh.mjs → validate.mjs     │
       │                 │    ├─ veto.mjs (Telegram batch + timeout + kill)      │
       │                 │    └─ HT flip → POST /api/halftime/release            │
       │                 └──────────────┬───────────────────────────────────────┘
       │                                │  Bearer CRON_SECRET (HTTP only — poller
       │                                │  never touches the DB directly)
┌──────┴─────────┐       ┌──────────────▼───────────────────────────────────────┐
│ replay-server  │       │ Vercel (Next.js app)                                  │
│ .mjs (mock SM, │       │  /api/halftime/schedule│fresh│assemble│release│       │
│ off-season     │       │  /api/halftime/today (public) · /heartbeat            │
│ harness)       │       │  /api/cron/halftime-watchdog (*/5, backstop)          │
└────────────────┘       │  quiz_packs insert at release → existing play stack   │
                         └──────────────┬───────────────────────────────────────┘
                                        ▼
                          Supabase: halftime_releases · halftime_control ·
                          halftime_heartbeat (mig 80) · quiz_packs/quiz_attempts (existing)
```

### 1.2 What is REUSED (every reference re-verified in this worktree)

| Concern | Reuse | Verified at |
|---|---|---|
| Push fan-out, opt-in filter, per-key dedup, log-before-send | `notifyUsers()` | `src/lib/notify.ts:13-77` (opt-in :33-42, dedup :44-52, log-before-deliver :54-61) |
| Lobby create with a pack | `POST /api/room/create` — `pack_id` first-class, 10 ∈ `VALID_COUNTS` | `src/app/api/room/create/route.ts:7,17-106` |
| Solo grading, first-attempt-only, server-authoritative | `POST /api/quiz/solo-complete` — untouched; requires `status='published'` | `src/app/api/quiz/solo-complete/route.ts:69-85,97,115-141` |
| Rank | `knowledge_score = total_score + solo_score` view — **DO NOT TOUCH** | `supabase/migrations/30_yourscore_points.sql:36,44` |
| Pack page + per-pack leaderboard (= the per-fixture halftime leaderboard, zero new backend) | `/challenges/[slug]` + `PackLeaderboard` | `src/app/challenges/[slug]/page.tsx:297-431,528-560`; index `supabase/migrations/32_io_hardening.sql:36-37` |
| Pack content fetch (edge-cached, slug = `slugify(name)`) | `/api/challenges/pack` | `src/app/api/challenges/pack/route.ts:20-31,53-58` (404s cached only 30s: :71-77) |
| Cron auth + no-op flag + `fetchCache` pattern | wc-mastermind cron | `src/app/api/cron/wc-mastermind/route.ts:36-45` |
| Telegram send/buttons plumbing | `scripts/tg.mjs` (`sendMessage`, `awaitButtonsOrText`) + exit-code gate pattern (0/1/3) | `scripts/tg-gates.mjs:1-35`, `scripts/launch-daily.mjs:44-62` |
| Question dedup | `normalizeQuestionText` | `src/lib/questions.ts:12`; bank guard `supabase/migrations/67_questions_unique_active_text.sql` |
| Deterministic answer shuffle at publish (authors write answer as A) | daily-quiz pattern | `scripts/seed-daily-quiz.mjs` |
| Health checks (4x/day) | new check file slots into `scripts/health/checks/` beside `freshness.mjs` etc. | `scripts/health/check.mjs`, `scripts/health/deadman.config.json` |
| SportMonks-fed quiz content precedent | game-types pool | `src/lib/games/serve.ts:1-20` |

### 1.3 What is NEW

- **Migration `supabase/migrations/93_halftime.sql`** — `halftime_releases`,
  `halftime_control`, `halftime_heartbeat` (§1.5). Number **verified against prod
  2026-07-14** via Management API: `schema_migrations` tops at "53" (known-incomplete),
  fantasy tables exist in prod. **RE-CHECKED 2026-07-14 (late): parallel sessions applied 77 (fantasy_news), 78 (fantasy_news_feed) and 79 (fantasy_leagues) to prod — 78 was CLAIMED after this spec was written. Renumbered to 80; verified no `halftime*` tables exist in prod.**
  Re-verify both (dir + prod tables) again at build time; parallel sessions collide.
- **Shared lib** `src/lib/halftime/shared.ts` (state machine, assembly, push copy,
  types) and `src/lib/halftime/sportmonks.ts` (thin client; base URL from
  `SPORTMONKS_BASE_URL` env, real default — the single seam the replay harness uses).
- **API routes** `/api/halftime/{schedule,fresh,assemble,release,today,heartbeat}` +
  `/api/cron/halftime-watchdog` + one `vercel.json` cron line.
- **VPS scripts** `scripts/halftime/{sync-fixtures,gen-base,gen-fresh,validate,veto,poller,replay-server,record-scenario}.mjs` + `scripts/halftime/scenarios/*.json` + `scripts/halftime/replay-test.sh`.
- **Health check** `scripts/health/checks/halftime.mjs`.
- **UI** `HalftimeRail` (on `/play`), `HalftimeCard` (Home `Dashboard.tsx`).

### 1.4 Corrections to the Scope-A spec's reuse list (verified absent from this branch)

These exist only on the uncommitted fantasy/gates branches and **must not be referenced
by the build**: `src/lib/fantasy/ingest.ts`, `src/lib/gates/sportmonks.ts`,
`src/app/api/cron/fantasy-news/route.ts`, `scripts/gen-club-cover.mjs`,
`docs/LOOP-STANDARD.md` (lives at `~/yourscore/docs/`, content mirrored into §6 rules
here). Replacements: cron-auth pattern from `wc-mastermind` (on-branch), a new thin
SportMonks client in `src/lib/halftime/sportmonks.ts` (fetch shape copied from the
fantasy ingest call: `GET /v3/football/fixtures/date/{date}?filters=fixtureLeagues:8`),
and Telegram helper `scripts/tg.mjs` (NOT `scripts/lib/tg.mjs` — that path doesn't exist).

**Explicitly NOT reused (schema-dead / ungrounded):** the legacy live-match stack
(`matches`/`question_events`/`/admin/fire`) and
`src/app/api/admin/generate-questions/route.ts`.

### 1.5 DB — migration 93 (exact shape)

```sql
create table halftime_releases (
  id            uuid primary key default gen_random_uuid(),
  fixture_id    bigint not null unique,          -- SportMonks fixture id
  season_id     bigint,                          -- 28083 for 2026/27
  round_name    text,                            -- SportMonks round (GW) label
  pack_id       uuid,                            -- PRE-ASSIGNED at assembly; the quiz_packs
                                                 -- row is inserted only AT RELEASE (§3.6)
  home          text not null,
  away          text not null,
  kickoff_at    timestamptz not null,
  state         text not null default 'scheduled'
    check (state in ('scheduled','base_ready','staged','released','released_late','cancelled','failed')),
  base_questions  jsonb,                         -- approved 10-question fallback set
  fresh_questions jsonb,                         -- [{q..., claims[], status:'pending'|'approved'|'vetoed'|'dropped'}]
  fresh_state   text not null default 'none'
    check (fresh_state in ('none','pending_veto','approved','vetoed','killed','skipped')),
  veto_deadline_at    timestamptz,
  telegram_message_id bigint,
  released_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index halftime_releases_kickoff_idx on halftime_releases (kickoff_at);

create table halftime_control (               -- the slate kill switch
  matchday    date primary key,               -- Europe/London date
  fresh_kill  boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table halftime_heartbeat (
  id      text primary key,                   -- 'poller'
  beat_at timestamptz not null,
  detail  jsonb
);

-- RLS: enable on all three, create NO anon/authenticated policies (deny-all;
-- service_role bypasses). Public reads go only through /api/halftime/today,
-- which serves a filtered projection. Function grants: revoke from PUBLIC.
```

State machine (single direction, compare-and-set on every transition):
`scheduled → base_ready → staged → released | released_late`; any pre-release state
`→ cancelled` (postponement) or `→ failed` (bounded-retry exhaustion). No transition
out of `released`/`released_late`/`cancelled` except manual founder action.

---

## 2. THE TWO-PASS CONTENT PIPELINE

### 2.1 Design principle that makes the hard rule structural

**All generation completes before kickoff. Nothing generates, regenerates, or edits
content after the kickoff whistle — the HT release step only flips state and copies
already-frozen content.** First-half contamination is therefore impossible *by
construction*, not by prompt discipline: base is written the day before; the fresh
dossier (§2.3) is built exclusively from pre-kickoff SportMonks data; assembly freezes
the pack at T-10. The prompt-level ban (§2.3) is defense in depth, not the mechanism.
The same rule extends to **push copy: no live score, no first-half events in the push**
("Halftime at the Emirates — play the Arsenal v Coventry quiz pack", never
"HT: Arsenal 1–0"). People play later in the day; the push must not spoil.

### 2.2 Pass 1 — BASE (day before, 10 full questions per fixture)

- **Base is a complete 10-question pack, not a partial.** Fresh replaces up to 3 base
  questions at assembly. If the fresh slice fails at any layer (no lineups, validator
  drops all, veto-all, kill switch, Telegram down), the pack ships base-only with zero
  founder involvement — graceful degradation is the backbone of Scope B ops.
- **Content rule: historic/static only.** H2H record, classic meetings, club records,
  iconic players of this fixture, stadium/derby history. Zero form/injury/current-squad/
  manager/league-position claims — those reproduce the Jul-13 stale-fact failure class.
- **Grounding sources, named:** (1) SportMonks Historical Data (H2H fixtures, season
  aggregates) via `src/lib/halftime/sportmonks.ts`; (2) the owned validated pool
  (`src/data/games/pool.json`, the same SportMonks-fed source `src/lib/games/serve.ts`
  plays from); (3) web verification for anything neither source covers. Every question
  carries a provenance entry (source + retrieval date) in a slate sidecar JSON.
- **Generator:** `scripts/halftime/gen-base.mjs`, headless Claude routine on the VPS
  (the proven daily-WC muscle). Authors write answer as A; deterministic shuffle happens
  at assembly. Difficulty mix per pack: 3 easy / 4 medium / 3 hard.
- **Validation:** `scripts/halftime/validate.mjs` (same validator as fresh, §2.4) runs on
  every base question. Then dedup: `normalizeQuestionText` (`src/lib/questions.ts:12`)
  against (a) the `questions` bank, (b) every prior halftime pack this **season** —
  reverse fixtures recur, the horizon must be the season, not the gameweek.
- **Gate (approve-to-ship, unchanged norm):** ONE Telegram batch message per matchday
  slate at T-1d ≈18:00 via a new `slate` mode in the tg-gates pattern (exit codes 0/1/3,
  `scripts/tg-gates.mjs` conventions; per-pack Approve/Regenerate buttons, regenerate
  bounded at 2 rounds). Reminder at matchday T-4h. **A pack unapproved by T-60 →
  row `cancelled`, that fixture simply has no pack, Telegram FYI.** Approved base set is
  written to `halftime_releases.base_questions` via `POST /api/halftime/fresh` (the
  content-write route, §5) and state → `base_ready`.

### 2.3 Pass 2 — FRESH (confirmed lineups, ≤3 questions per fixture)

**Detection:** from T-75, the poller polls `GET /v3/football/fixtures/{id}?include=lineups;participants`
per tracked fixture every 60s. Lineups considered CONFIRMED when the lineup array is
non-empty with ≥11 starters per side. Late sheets: keep polling to T-25; if still absent →
`fresh_state='skipped'`, base-only.

**The "genuinely impressed" strategy — mine facts deterministically, let the LLM only
phrase them.** Surprise comes from a fact miner; correctness comes from structured data;
the LLM never invents a claim:

1. **Fact miner** (in `gen-fresh.mjs`, pure SportMonks queries) computes candidate
   "reveals" from the confirmed XI, each with machine-checkable evidence:
   - *Debutant*: starter with zero prior appearances for this club (player statistics).
   - *Milestone*: starter at appearance 99/100/199/200… for club or in the PL.
   - *Returning player*: starter whose transfer history includes today's opponent.
   - *Scorer vs this opponent*: starter with notable goal count (incl. hat-trick match)
     against today's opponent, from H2H fixture events.
   - *First start together / first start since <date>* for a bounded pair set (new
     signings + returners only — the pairwise space is otherwise unbounded).
   - *Formation anomaly*: today's formation differs from the side's season mode.
   - *Keeper/captain change, unusually young XI, N academy graduates* — all computable.
2. **LLM pass** (Anthropic API, funded; Sonnet-class per the framework's model policy):
   input = the dossier lines ONLY (each line: fact + evidence ids + why it's surprising);
   task = pick the ≤3 most impressive, write one question each (4 options, answer as A,
   plausible distractors). **Hard prompt bans:** no facts outside the dossier; nothing
   after kickoff (no score, no events, no "currently"); no injury/form speculation;
   locked vocabulary. Output = question + the dossier claim ids it uses.
3. Questions citing zero dossier claims, or claims the validator can't re-resolve, are
   **auto-dropped** before any human sees them.

If the miner finds fewer than 1 strong reveal, it sends fewer questions or none —
**an empty fresh slice is a normal outcome, not a failure** (base-only pack ships).

### 2.4 The structured-data validator (`scripts/halftime/validate.mjs`)

Runs on **every** question, base and fresh, before any gate. Each question carries typed
claims; the validator re-resolves each against SportMonks live data at validation time:

| Claim type | Check |
|---|---|
| `player_in_lineup {player_id}` | player id present in today's confirmed lineup |
| `player_stat {player_id, stat, value, scope}` | statistics endpoint value matches (±0 tolerance; milestone counts exact) |
| `transfer_history {player_id, team_id}` | opponent appears in transfer/career data |
| `h2h_fact {fixture_ids, assertion}` | asserted result/scoreline matches the referenced historical fixtures |
| `formation {team_id, formation}` | matches today's lineup formation string |

Any claim unresolvable → **question dropped, logged with reason**, never surfaced.
A question with no machine-checkable claims → dropped (ungrounded by definition).
Base questions grounded on the owned pool or web sources carry `source_ref` claims
checked against the provenance sidecar instead. Drops are bounded-logged to the slate
report; ≥50% of a fixture's fresh slice dropped → note appended to the veto message.

### 2.5 The Telegram veto gate — timeout, auto-release, kill switch

- **One veto message per fixture** (not per question), sent the moment the validated
  fresh slice exists (~T-55). Naturally staggered across a slate by lineup arrival.
  Message shows: fixture, kickoff, each fresh question with its correct answer and its
  dossier fact, and buttons: `Veto 1` `Veto 2` `Veto 3` · `Veto all` · plus the standing
  `KILL TODAY'S FRESH` control (below). Footer states the deadline explicitly:
  *"Unvetoed questions go live in the halftime pack automatically at HH:MM."*
- **Timeout / auto-release:** deadline = `max(send_time + 15min, kickoff − 10min)`,
  hard-capped at `kickoff − 5min`. At the deadline every question still `pending` flips
  `approved` — **no response required, ever**. This is the founder's explicit decision;
  the build must not add a blocking wait.
- **Veto handling:** `scripts/halftime/veto.mjs` long-polls Telegram `getUpdates`
  (callback queries), non-blocking, multiple fixtures concurrently. Every tap is
  persisted immediately to `fresh_questions[].status` via `POST /api/halftime/fresh` —
  a poller restart re-reads veto state from the DB, never from process memory.
  Vetoes after the deadline but before HT are still honored (the question is pulled at
  release-copy time); after release they're a no-op with a "too late" reply.
- **Slate kill switch:** the founder sends `KILL` (button on any veto message, or the
  bare text `KILL` / `KILL FRESH` to the launch bot). Effect: `halftime_control` row for
  today → `fresh_kill=true`; every fixture today flips `fresh_state='killed'`; already-
  assembled-but-unreleased packs are **re-assembled base-only**; Telegram confirms with
  the list of affected fixtures. One message, whole matchday, irreversible for the day
  (re-enabling requires the founder to send `UNKILL`, which only affects fixtures not yet
  assembled).
- **Fail-safe direction:** if the veto message cannot be confirmed sent (Telegram error,
  no message id back), the fresh slice is **dropped**, not auto-released — a gate that
  was never offered is treated as vetoed (LOOP rule 2: gate every outward action).

### 2.6 Assembly (T-10, per fixture)

`POST /api/halftime/assemble` (called by the poller at the veto deadline):
1. Take surviving fresh questions (0–3, `approved` only, minus post-deadline vetoes).
2. Fill to exactly 10 with base questions in authored priority order.
3. Deterministic answer shuffle (seed = fixture_id; the daily-quiz publish pattern).
4. Pre-assign `pack_id` (uuid) if not already set; freeze the final 10 into
   `halftime_releases` (single jsonb write); state `base_ready → staged` (CAS).
**No quiz_packs row exists yet** — the pack is invisible and ungradeable pre-whistle
(`solo-complete` requires `status='published'`, `route.ts:97`; `/api/challenges/pack`
404s). This closes the pre-play/leak window the Scope-A design had.

### 2.7 Exact timeline — Saturday 15:00 slate (the stress case: up to 10 fixtures, and
the classic 5–6 simultaneous 15:00 kickoffs)

| Clock (UK) | Offset | Action |
|---|---|---|
| Fri 10:00 | T-29h | `gen-base.mjs` for all Saturday fixtures (bounded concurrency 2; ~10 packs) → validator → dedup |
| Fri 18:00 | T-21h | ONE base slate gate to Telegram (per-pack Approve/Regenerate; regen ≤2 rounds) |
| Sat 07:00 | T-8h | poller launcher: fixture re-sync (kickoff changes/postponements), asserts entitlements via `/my/resources`, sleeps to T-75 of first kickoff. Unapproved-pack reminder fires (T-4h before earliest KO on the 11:00 TV slot days this is Fri evening — the reminder anchors to each fixture's own T-4h) |
| 13:45 | T-75 | lineup watch: 1 call/fixture/60s (10 fixtures ≈ 600 calls/hr — at the 2000/hr limit's third) |
| ~14:00 | T-60 | lineups land → fact miner → LLM (concurrency 3 across fixtures) → validator → **veto messages** (one per fixture, staggered as sheets arrive), deadline stated |
| 14:15–14:50 | T-45→T-10 | founder vetoes (or doesn't); every tap persisted; `KILL` available throughout |
| 14:50 | T-10 | veto deadline (for 15:00 KOs) → `assemble` per fixture → all `staged` |
| 15:00 | T-0 | kickoff; poller switches to `/livescores/latest` every 6s (ONE call covers all in-play fixtures) |
| ~15:47±3 | HT | `state_id == 3` per fixture → `POST /api/halftime/release` (sequential, concurrency 4 — the 15:00 slate flips within the same ~2-min band) → pack live + push |
| ~16:03 | 2H | any fixture still `staged` when 2nd half detected → `released_late`, **no push** |
| 17:30 / 20:00 | — | late KOs repeat the per-fixture cycle with their own offsets |
| ~22:00 | last FT | poller writes day summary to Telegram (slate report: released/late/cancelled, fresh stats, drops), exits |

Simultaneity notes: per-fixture pipelines are fully independent state machines keyed on
`fixture_id`; the only shared resources are the SportMonks budget (measured above, fits),
the Anthropic call pool (bounded concurrency 3), and Telegram (≤10 compact messages over
~30 min — acceptable; the kill switch is the overload valve). Push volume is capped
per-user (§3.6).

---

## 3. HALFTIME DETECTION — POLLER + WATCHDOG

### 3.1 Poller (`scripts/halftime/poller.mjs`, VPS deploy crontab, daily 07:00 Europe/London)

- No PL fixtures today (from `/api/halftime/schedule`) → log + exit 0. Zero cost.
- Matchday phases: (1) sleep→T-75; (2) lineup watch + fresh pipeline (§2.3–2.6);
  (3) live poll `/livescores/latest` every **6s** from first KO to last FT;
  (4) day summary → exit.
- **State ids:** HT = `state_id == 3` (verified this session). All OTHER states
  (1st-half, 2nd-half, FT, postponed, abandoned, suspended, delayed) are resolved **by
  `developer_name` from `GET /v3/football/states` fetched at startup** — no unverified
  ids are hardcoded. `3` is additionally cross-checked against that same fetch.
- On HT for a `staged` fixture → `POST /api/halftime/release` (Bearer `CRON_SECRET`),
  then **asserts success**: re-reads `/api/halftime/today` and confirms
  `state='released'` (LOOP rule 1 — never trust the 200 alone).
- Heartbeat: `POST /api/halftime/heartbeat` every 60s during phases 2–3
  (`halftime_heartbeat.id='poller'`).
- Startup safety: if an existing heartbeat is <90s old, another poller instance is live →
  exit immediately (no double daemon).
- The poller **never** writes the DB directly and **never** calls Telegram for release
  actions — content writes go through `/api/halftime/fresh|assemble`, releases through
  `/api/halftime/release`, human gates through `veto.mjs`. One code path per side effect.

### 3.2 Watchdog (`/api/cron/halftime-watchdog`, Vercel cron `*/5 * * * *`)

Auth `Bearer CRON_SECRET` + `export const fetchCache = "force-no-store"` (both patterns
from `src/app/api/cron/wc-mastermind/route.ts:36-45`). Logic, in order:
1. No rows today in `base_ready`/`staged` → return `{idle:true}` — **zero SportMonks
   calls off-matchday** (the enabled-flag no-op pattern).
2. One `/livescores/latest` call. For each `staged` fixture: at HT → release (with push);
   in/past 2nd half → release `released_late` (**no push**); postponed/abandoned →
   `cancelled`, no push ever.
3. `base_ready` fixture whose kickoff passed and assembly never ran (poller died before
   T-10) → **assemble base-only** and stage it. The watchdog **never ships fresh
   questions** — fresh releases only via the poller path that owns the veto clock; a
   dead poller means the veto ledger can't be trusted end-to-end, so the conservative
   bound is base-only (gate rule).
4. Heartbeat staleness: during any window [first KO − 80min, last FT] with the beat
   >10 min old → Telegram alert (if `TELEGRAM_*` present in Vercel env — deploy
   checklist item) and always a Sentry-visible error log.

Worst case with the poller dead: release lands ≤ ~6 min after HT (5-min cadence +
execution), inside the ~15-minute real halftime window.

### 3.3 Every failure mode, named, with its bounded response

| Failure | Bounded response |
|---|---|
| Poller process/VPS dies | Watchdog releases within ~6 min (base-only assembly if pre-assembly); heartbeat alert |
| Vercel down (watchdog dead), poller alive | Poller is the primary path — unaffected. Both dead: feature misses the window; packs release `released_late` on recovery, no push. Accepted residual risk (also true of every existing cron) |
| SportMonks outage / 5xx | Poller: 3 retries, exponential backoff, then Telegram alert + keep cycling (next 6s tick retries); watchdog independent |
| SportMonks 429 | Poll interval degrades 6s→12s→30s, alert at 30s; budget math (§2.7) keeps normal ops at <⅓ limit |
| Paid-plan entitlement loss | Poller startup asserts `/my/resources` covers livescores/lineups/states → hard alert + exit non-zero (deadman catches) |
| HT flips inside a 6s gap | Impossible to miss: SportMonks holds state; and the watchdog re-checks every 5 min regardless |
| HT never observed (feed error), 2H seen | `released_late`, no push (founder decision 4) |
| Lineups never published | T-25 → `fresh_state='skipped'`, base-only |
| Telegram unreachable at veto-send | Fresh slice **dropped** (never released ungated); base-only |
| Founder taps veto after deadline | Honored until release-copy time; no-op with reply after |
| Anthropic API down | Fresh skipped (bounded 2 retries), base-only; base gen is day-before with an 18h repair window + `failed` alert |
| Kickoff moved after staging | Re-sync + livescores `starting_at` drift → `kickoff_at` updated, veto deadline recomputed; if moved to another day → back to `scheduled`, re-enters the pipeline that day |
| Postponement any time pre-HT | `cancelled` (CAS), pack never inserted, push never fires; re-scheduled fixture re-enters via weekly sync as a new matchday (fresh regenerated; base reused after a re-gate) |
| Abandoned AFTER release | Nothing: pack content is pre-kickoff-only, still true; stays up |
| Double release (poller + watchdog race) | Impossible: `staged→released` is a single-row CAS (`update … where state='staged'` returning); push dedupes on `notification_log` |
| Duplicate poller instance | Heartbeat-freshness startup check → second instance exits |
| DST/clock skew | All scheduling off SportMonks UTC timestamps; matchday key computed Europe/London |

### 3.4 LOOP-STANDARD compliance (this is a new automated loop — all four rules)

1. **Assert success, not existence:** poller re-reads `today` post-release; gen scripts
   re-read persisted rows; watchdog returns counts the health check asserts against.
2. **Gate every outward action:** base = approve gate; fresh = veto gate + validator +
   kill switch; push only inside the release route after the CAS commits; unsendable
   gate = vetoed.
3. **Bound the retry path:** SportMonks retries ×3/backoff; LLM regen ≤2; base regen ≤2
   rounds; poller wall-clock exit at last-FT+30min; watchdog is naturally single-shot.
4. **One persistent dedup key per side effect:** release = the `staged→released` CAS row;
   push = `notification_log` key `halftime:<fixtureId>` (+ daily cap key, §3.6);
   pack insert = pre-assigned uuid + `on conflict (id) do nothing`; fixture rows =
   `unique(fixture_id)` upserts; veto taps = idempotent status writes.

On ship: add a row to LOOP-STANDARD §3 scorecard, target grade A.

### 3.5 Release endpoint (`POST /api/halftime/release`) — exact semantics

Bearer `CRON_SECRET`; `fetchCache = "force-no-store"`. Steps, in order, idempotent:
1. CAS `halftime_releases.state 'staged'→'released'` (`released_late` variant flag from
   caller). Zero rows updated → return `{already:true}`, **stop** (no push, no insert).
2. Insert `quiz_packs` row with the pre-assigned `pack_id`: final 10 questions,
   `status='published'`, `rotation_active=true`, `question_count=10`,
   `metadata.halftime={fixture_id, matchday, kickoff, home, away}`,
   `on conflict (id) do nothing`. (Verified prod `quiz_packs` columns 2026-07-14:
   `status`/`rotation_active`/`metadata` all exist; only status value in use is
   `'published'` — we introduce no new status value.)
3. If (and only if) not `released_late`: push via `notifyUsers` — §3.6.
4. Return state; caller asserts.

Edge-cache tail: `/api/challenges/pack` caches misses 30s (`route.ts:71-77`), so a user
who somehow hit the URL pre-release sees the pack ≤30s after the flip — inside the AC
budget. `/api/quiz/packs` (2-min edge cache, `route.ts:9-11`) is NOT the release path
and is untouched; the rail and push read `/api/halftime/today`.

### 3.6 Push policy

- `notifyUsers({dedupeKey: "halftime:"+fixtureId, requireOptIn: true, url:
  "/challenges/<slug>?pid=<packId>"})` — opt-in + exactly-once per fixture built in
  (`notify.ts:33-61`).
- **Per-user daily cap = 1 halftime push** (a Saturday must not mean 6 pushes): before
  fan-out, the route excludes users already holding any `halftime:%` log row created
  today (`notification_log` prefix query). First whistle of the day wins.
- Copy: spoiler-free (§2.1), locked vocabulary, never mentions delivery mechanism.
- Cap 2000 targeted/run (mastermind precedent).

---

## 4. SEASON-LONG OPS (what makes this B, not A)

### 4.1 Fixture sync — `scripts/halftime/sync-fixtures.mjs`
- **Weekly** (VPS cron, Mon 09:00): `GET /v3/football/fixtures/between/{today}/{+14d}`
  filtered `fixtureLeagues:8` → upsert `halftime_releases` on `fixture_id`
  (state `scheduled`, kickoff, participants, round). Date-driven, so **midweek rounds,
  double gameweeks and rearranged fixtures are handled automatically** — a fixture is
  work because it exists in the window, not because of its GW label. Blank GW = no rows
  = every downstream job no-ops at zero cost.
- **Matchday re-sync** (inside the poller launcher, 07:00): same call for today —
  catches overnight kickoff changes/postponements before any content work.
- Sync asserts success: post-upsert count re-read; 0 fixtures on a date the PL calendar
  expects fixtures → warning to Telegram (catches a silent filter/entitlement break).

### 4.2 Heartbeat in the existing health system
- New `scripts/health/checks/halftime.mjs` in the 4x/day suite: on matchdays asserts
  (a) heartbeat fresh during match windows, (b) today's fixtures have rows in a sane
  state for the time of day (e.g. by T-2h: `base_ready`+; post-HT: `released*`);
  off-days asserts the watchdog's last run returned `{idle:true}` (liveness ≠
  correctness — we assert the *content* of the state machine, not that files got touched).
- `scripts/health/deadman.config.json` gains poller + sync entries in success-marker
  mode (not `mtime` — LOOP-STANDARD P2 explicitly bans new mtime deadman entries).

### 4.3 Weekly cost + founder load (steady state, 10 fixtures/wk)
- **SportMonks:** sync ~3 calls; lineup watch ~350; live poll ~4–5k (one call covers all
  concurrent fixtures); validator/miner ~200. **≈5.5k calls/wk**, peak <700/hr vs
  2000/hr — comfortable. £: the paid plan the founder is buying anyway.
- **Anthropic:** base 10 packs (headless routine) + fresh 10 × 1 small call ≈ **£1–3/wk**.
- **Vercel:** watchdog 288 idle-cheap runs/day (2016/wk) — noise on Pro (plan verified
  implicitly: hourly crons already run, `vercel.json`; confirm Pro at deploy).
- **Founder:** ~5 min/matchday base-slate approval + optional veto glances. The timeout
  means zero founder availability is required on matchday itself.
- **VPS:** existing box; poller is one Node process on matchdays only. Known VPS
  landmines (no git creds, `sharp`) don't touch this pipeline (no image gen at runtime).

### 4.4 Covers
Per the locked creative rule: **plumbing ships, pixels wait.** Packs launch with the
existing no-cover gradient card. Fixture-cover art (club-crest composite style — the
approved style system exists; note `gen-club-cover.mjs` itself is NOT on this branch)
comes later via one contact-sheet approval; `metadata` already carries what a cover job
needs. No generated imagery ships in this build.

---

## 5. API SURFACE (W1 contract — all handlers `fetchCache = "force-no-store"`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/halftime/schedule?date=` | CRON_SECRET | today's rows, full detail — poller/scripts read |
| `POST /api/halftime/fresh` | CRON_SECRET | persist base set, fresh slice, veto status updates, kill-switch flips (single content-write route; body carries `op`) |
| `POST /api/halftime/assemble` | CRON_SECRET | §2.6 assembly, CAS `base_ready→staged` |
| `POST /api/halftime/release` | CRON_SECRET | §3.5 |
| `GET /api/halftime/heartbeat` / `POST` | CRON_SECRET (POST); GET internal | beat write / staleness read |
| `GET /api/halftime/today` | **public** | filtered projection: `{fixture_id, home, away, kickoff_at, state, pack_id, slug}` — NO questions, NO fresh/veto data. CDN: `s-maxage=15, stale-while-revalidate=30` (whistle-precision with edge protection; the 15s is inside every timing budget) |
| `GET /api/cron/halftime-watchdog` | CRON_SECRET (Vercel cron) | §3.2 |

CLI contracts between workstreams (so W2/W3 build independently):
- `gen-fresh.mjs --fixture <id>` → exit 0 with fresh slice persisted (or `skipped`), exit 2 on bounded failure.
- `veto.mjs send --fixture <id>` → sends batch, persists message id + deadline; `veto.mjs watch` → long-poll daemon mode invoked by the poller; exit codes follow tg-gates conventions (0/1/3).
- `gen-base.mjs --date <YYYY-MM-DD>`; `sync-fixtures.mjs [--date|--window 14]`;
  `replay-server.mjs --scenario <file> --scale 60 --port 8787`.

---

## 6. REPLAY-MODE TEST HARNESS (mandatory — the only pre-Aug-21 proof)

It is the off-season: `/livescores` is legitimately empty until 2026-08-21, so the live
HT transition cannot be observed. The harness is therefore a **launch gate, not a
nice-to-have**: the pipeline must pass it end-to-end before the season.

- **`scripts/halftime/replay-server.mjs`** — local HTTP server implementing exactly the
  SportMonks routes the code calls: `/v3/football/livescores/latest`,
  `/v3/football/fixtures/{id}` (lineups/participants includes),
  `/v3/football/fixtures/date/{date}`, `/v3/football/fixtures/between/…`,
  `/v3/football/states`, `/v3/my/resources`. Poller and watchdog run **unmodified** —
  the single seam is `SPORTMONKS_BASE_URL` (env override, real default, defined in
  `src/lib/halftime/sportmonks.ts`; the replay harness is the reason that seam exists).
- **Scenario files** (`scripts/halftime/scenarios/*.json`): a timeline of
  `{at_offset_s, fixture_id, patch}` steps mutating served fixture state
  (state transitions by developer_name, lineup publication, `starting_at` shifts).
  **Clock scaling** (`--scale 60`: 1 real second = 1 match minute) replays a full
  Saturday in ~10 minutes; `--scale 1` for a real-time soak.
- **Required scenarios (shipped with the build):**
  1. `saturday-slate.json` — 10 fixtures, 5 simultaneous 15:00 KOs + staggered others,
     **reconstructed from a real recorded matchday (2026-03-14) via the Historical Data
     entitlement** (`record-scenario.mjs` pulls the real fixtures' periods/lineups/state
     history and emits the scenario) — real HT minutes, real lineup timing, not invented.
  2. `postponement.json` — one fixture flips to postponed at T-90.
  3. `delayed-kickoff.json` — `starting_at` slides +30 min at T-40 (veto deadline must
     recompute; release still keys off the state flip, not the clock).
  4. `long-first-half.json` — HT arrives at KO+52min (proves no kickoff+45 assumption
     anywhere; the pack releases at the real flip).
  5. `late-lineups.json` — sheets at T-30 (shrunken veto window ≥ the T-5 floor) and a
     no-lineups fixture (fresh skipped).
- **`scripts/halftime/replay-test.sh`** orchestrates the full E2E: replay server + local
  `next dev` (`NEXT_DIST_DIR=.next-verify` if building) + poller against a seeded local/
  staging DB; drives Telegram in `--preview` mode against the founder's real chat once
  (AC30) and a stub chat for CI-style runs; kills the poller mid-scenario to prove the
  watchdog path (invoking the watchdog route by curl on its 5-min cadence, compressed).
- Push in replay: `notifyUsers` targeted at a founder-allowlist test user only
  (`WC_MASTERMIND_PUSH_ENABLED`-style env flag `HALFTIME_PUSH_ENABLED` gates prod push;
  replay runs with it off + a test allowlist).

---

## 7. LOCKED ACCEPTANCE CRITERIA

Numbered, individually testable by someone who didn't build it. "Replay" = the §6
harness; criteria marked **[LIVE]** additionally get re-verified on the first real
matchday (2026-08-21/22) before the feature is declared measured (stage 8).

**A. Staging & the two-pass content rule**
1. By T-21h for every PL fixture in the next matchday: a `halftime_releases` row in
   `state='base_ready'` with 10 base questions in `base_questions`, each with 4 options,
   answer key, difficulty ∈ {easy,medium,hard} (mix 3/4/3), and a provenance entry in
   the slate sidecar naming its grounding source. Checkable by DB query + sidecar read.
2. Zero current-affairs claims in base questions: no form, injuries, current squad,
   current manager, or league position. Checkable by reading all 10 per pack against the
   historic-only rule.
3. **NEGATIVE (the hard rule):** no question in any released pack — base or fresh —
   references ANY event after the kickoff whistle (score, goals, cards, subs, injuries
   in play, "currently leading"). Test two ways: (a) inspect all released GW1 packs;
   (b) structural proof — demonstrate from logs that no generation or content-mutation
   call executed after `kickoff_at` for any fixture (the release step's jsonb copy is
   byte-identical to the T-10 assembly snapshot).
4. Fresh questions are generated only after confirmed lineups exist, and every fresh
   question's claims re-resolve against SportMonks (replay: seed one question with a
   player NOT in the lineup → validator drops it, drop is logged, founder never sees it).
5. A question with zero machine-checkable claims is auto-dropped (unit-testable on
   `validate.mjs` with a fabricated ungrounded question).
6. Dedup: no released question's `normalizeQuestionText` matches the `questions` bank or
   any other halftime pack **this season**. Checkable by running the dedup standalone.
7. The fresh slice failing entirely (no lineups / all dropped / vetoed / killed /
   Telegram down) still yields a full 10-question base-only pack, released normally —
   demonstrated in replay for at least the no-lineups and veto-all paths.

**B. Veto gate, timeout, kill switch**
8. One Telegram veto message per fixture, showing every fresh question + answer + the
   grounding fact + per-question veto buttons + the exact auto-release deadline time.
9. Tapping `Veto 2` removes exactly question 2 from the assembled pack (replay-verified
   by inspecting the released pack).
10. With NO founder response, all validated fresh questions auto-release at
    `max(send+15min, T-10)` (hard cap T-5) — replay-verified with zero Telegram
    interaction; the released pack contains the fresh questions.
11. `KILL` (button or bare text) flips every remaining fixture of the matchday to
    base-only within one poller cycle, including re-assembling any staged-but-unreleased
    packs, and Telegram confirms with the affected fixture list. Already-released packs
    are untouched.
12. A veto arriving after the deadline but before HT is still honored; after release it
    is a no-op and the founder gets a "too late" reply. (Replay.)
13. If the veto message send fails (message id unconfirmed), the fresh slice is dropped —
    never released ungated. (Replay with Telegram stub returning 500.)
14. Base slate gate: one message per matchday, per-pack Approve/Regenerate (regen ≤2);
    a pack unapproved by T-60 → row `cancelled`, no pack, no push, FYI sent. No pack
    ever reaches players without either the base approve gate (base content) or
    validator+veto-window (fresh content). Demonstrate by attempting to release an
    unapproved fixture: release route refuses (`state != 'staged'`).

**C. Release & timing**
15. **[LIVE]** A staged pack becomes playable — returned by `/api/halftime/today` as
    `released` AND openable at `/challenges/<slug>?pid=` — within **2 minutes of the real
    halftime whistle** (compare `released_at` to the SportMonks period-end timestamp
    post-match). Replay first: release fires on the `state_id==3` flip in scenarios 1,
    3 and 4 — including the KO+52' half (proving no +45 timer anywhere).
16. **[LIVE]** The opt-in push is delivered within **3 minutes** of the whistle, exactly
    once per user per fixture (`notification_log` has exactly one row per user for
    `halftime:<fixtureId>`), deep-linking to the pack, with copy containing no score/
    first-half information and no delivery-mechanism language.
17. On a multi-fixture slate a user receives at most **1 halftime push per day**
    (replay saturday-slate: allowlisted test user gets exactly one push despite 5+
    simultaneous HTs).
18. Re-invoking the release endpoint for a released fixture is a no-op: no second push,
    no state change, no duplicate pack row (CAS + `on conflict do nothing` proof; replay
    invokes it 3× concurrently).
19. With the poller killed mid-first-half, the watchdog releases within **6 minutes** of
    HT; if the 2nd half has started, state is `released_late` and NO push fires. If the
    poller died before assembly, the watchdog ships base-only (never fresh). (Replay.)
20. Postponement (replay scenario 2): row → `cancelled`, no `quiz_packs` row is ever
    inserted, no push; the rescheduled fixture re-enters via sync as a fresh matchday
    entry whose base pack passes back through the approve gate (date-locked rule).
21. Kickoff moved +30 min (replay scenario 3): `kickoff_at` updates without manual
    intervention, the veto deadline recomputes, and release still fires on the state flip.
22. Before release, the pack is invisible and ungradeable: `/api/quiz/packs` and
    `/api/halftime/today` don't expose it as playable, `/api/challenges/pack` 404s, and
    `POST /api/quiz/solo-complete` returns 404 for its pre-assigned pack id.

**D. Play, scoring, rank**
23. A signed-in user completing a released halftime pack solo gets a `quiz_attempts` row
    graded server-side, first-attempt-only, and their Rank knowledge points increase by
    the attempt score (`get_yourscore_rank` before/after). No changes to
    `src/lib/scoring.ts` or migration 30.
24. "Play with friends" from the rail creates a **Lobby** (locked vocab) on the halftime
    pack via the existing `POST /api/room/create`; a 2-player game completes end-to-end
    with scores.
25. The per-fixture halftime leaderboard is the existing per-pack `PackLeaderboard` on
    the pack's challenge page, reachable from the rail card; entries appear as attempts
    land. Zero new leaderboard backend.
26. Guests see exactly the existing guest pack behavior (play, prompted to save score) —
    nothing halftime-specific breaks the guest path.

**E. Surfaces**
27. The `/play` Halftime rail renders only when `/api/halftime/today` has a row for
    today: pre-HT it shows the fixture as upcoming ("Quiz drops at half time"), at
    release it flips to LIVE, later it reads as today's pack; on a no-fixture day the
    rail is absent entirely. The Home card mirrors this and is absent off-matchday.
28. The push deep link opens the pack directly (`/challenges/<slug>?pid=<packId>`) on
    iOS (the only push channel today).

**F. Season ops**
29. Weekly sync upserts the next 14 days of PL fixtures idempotently (running it twice
    changes nothing); a midweek round and a double-GW week land automatically (test by
    pointing the sync at a replayed `/fixtures/between` payload containing both); a
    blank-GW window yields zero rows and every downstream job no-ops at zero SportMonks
    cost (log-verified, same bar as watchdog idle).
30. Full E2E replay demo to the founder before 2026-08-21: scenarios 1–5 pass, including
    one run with the real Telegram chat in preview mode so the founder has seen the
    actual veto message format before the season.
31. Poller heartbeat is queryable; a >10-min-stale heartbeat during a match window
    raises a Telegram alert (replay: kill poller, run watchdog); the 4x/day health suite
    contains a halftime check asserting state-machine correctness (not mtime), and
    off-matchday the watchdog run reports `{idle:true}` with zero SportMonks calls.
32. Launch gating [LIVE]: **FULL PUBLIC LAUNCH on Fri 2026-08-21** (founder decision at
    Gate 2, 2026-07-14 — supersedes the earlier shadow-night plan: "Opening night will be
    for everyone. The whole concept of building this properly is so that we can launch on
    day one."). `HALFTIME_PUSH_ENABLED` on from day one. Pre-launch bar instead of a
    shadow night: the full replay suite green (AC20) + the founder has seen the real
    Telegram veto message format (AC30). Residual live risk accepted and contained by
    design: late HT detection → `released_late`, no push; poller death → watchdog ≤6 min;
    unresolvable content → base-only; the KILL switch. AC15–AC17 get measured on the real
    Friday fixture and reviewed before the Saturday slate as a checkpoint, not a gate.

**G. Negative criteria — what must NOT change/break**
33. Untouched and behaviorally identical: `/api/quiz/packs` cache headers + response
    shape (`route.ts:9-16`); `/api/challenges/pack` caching; `/play` picker tabs; the
    daily WC quiz launch (`launch-daily.mjs` full same-day run green); WC Mastermind
    cron; rank views (migration 30); `VALID_COUNTS` (`room/create/route.ts:7`);
    `quiz_packs` schema (no ALTERs — metadata-only usage); the fantasy hub + cron
    (not on this branch: verified by **zero file overlap** with the fantasy branch's
    files and by claiming migration 93, leaving 76/77 untouched in prod).
34. A **real `next build`** passes (`NEXT_DIST_DIR=.next-verify`; ESLint
    unused-imports is the known tsc-passes/build-fails trap). No new
    service-role route ships without `fetchCache = "force-no-store"` (grep-checkable).
35. Migration 80 applies cleanly to prod-shaped schema; all three new tables are RLS-on
    with no anon/authenticated policies (anon SELECT returns zero rows / permission
    denied); function privileges revoked from PUBLIC, not just anon/authenticated.
36. On-ship docs: YOURSCORE.md gains the §0 changelog line + Confirmed-date bump (and
    the §5A.1/§7 clarifications flagged in §8), `graphify update .` run, LOOP-STANDARD
    scorecard row added — same session as ship.

---

## 8. YOURSCORE.md ALIGNMENT (carry-over, still open)

- **§5A.1 (live-match quiz "⛔ gated on mobile app launch"):** halftime packs sidestep
  it — nothing fires during play; this is a fixture-synced release of an ordinary pack.
  Founder must still pick at ship gate: (a) add a §5A.5 "Halftime Quiz" entry, or
  (b) fold into a revised §5A.1. Flagged, not silently resolved.
- **§7 says "Push — tied to mobile launch" while §0 says push shipped 2026-06-27** —
  correct §7 on ship (we depend on push being live; verified in code).
- Locked vocabulary throughout: "quiz pack", "Lobby" (never Room), "football knowledge"
  (never IQ), route stays `/play`; copy never mentions delivery mechanism.
- The dormant `/join` Matches surface stays dormant; the rail lives on `/play`.

---

## 9. BUILD WORK-BREAKDOWN — 4 workstreams, ZERO file overlap

Interfaces between workstreams are the HTTP routes (§5) and CLI contracts (§5) — defined
here so each stream builds against the contract, not each other's files. Any file not
listed is out of bounds for that stream. `pnpm`/`package.json` untouched by all four
(no new deps required; poller uses node built-ins + existing repo helpers).

### W1 — Foundation (migration + API + watchdog + shared lib)
```
supabase/migrations/93_halftime.sql
src/lib/halftime/shared.ts
src/lib/halftime/sportmonks.ts
src/app/api/halftime/schedule/route.ts
src/app/api/halftime/fresh/route.ts
src/app/api/halftime/assemble/route.ts
src/app/api/halftime/release/route.ts
src/app/api/halftime/today/route.ts
src/app/api/halftime/heartbeat/route.ts
src/app/api/cron/halftime-watchdog/route.ts
vercel.json                      (append ONE cron line — only W1 touches this)
```
W1 lands first; W2–W4 build against its contracts. Env additions (deploy checklist, not
files): `HALFTIME_PUSH_ENABLED`, `SPORTMONKS_BASE_URL` default, VPS gets
`SPORTMONKS_API_KEY` + `CRON_SECRET`; optional `TELEGRAM_*` into Vercel for watchdog alerts.

### W2 — Poller + replay harness
```
scripts/halftime/poller.mjs
scripts/halftime/replay-server.mjs
scripts/halftime/record-scenario.mjs
scripts/halftime/scenarios/saturday-slate.json
scripts/halftime/scenarios/postponement.json
scripts/halftime/scenarios/delayed-kickoff.json
scripts/halftime/scenarios/long-first-half.json
scripts/halftime/scenarios/late-lineups.json
scripts/halftime/replay-test.sh
scripts/health/checks/halftime.mjs
scripts/health/deadman.config.json   (append entries — only W2 touches this)
```
Poller invokes W3 scripts as child processes per the CLI contract; never imports them.

### W3 — Generation + veto + season sync
```
scripts/halftime/sync-fixtures.mjs
scripts/halftime/gen-base.mjs
scripts/halftime/gen-fresh.mjs
scripts/halftime/validate.mjs
scripts/halftime/veto.mjs
scripts/halftime/prompts/           (base + fresh prompt templates, dossier spec)
```
Imports `scripts/tg.mjs` (existing, READ-ONLY — nobody edits it) and calls W1 routes
over HTTP. Does NOT touch `scripts/tg-gates.mjs` or `scripts/launch-daily.mjs` — the
slate gate is a new mode inside `veto.mjs` following their conventions, not an edit.

### W4 — Frontend surfaces
```
src/components/quiz/HalftimeRail.tsx
src/components/home/HalftimeCard.tsx
src/app/play/page.tsx                (mount rail — only W4 touches this)
src/components/home/Dashboard.tsx    (mount card — only W4 touches this)
src/app/play/new/**                  (only if pack-preselect needs a param; W4-owned)
```
`/challenges/[slug]` page: **NO changes** (leaderboard + play flow already exist).

**Collision audit:** the only shared-by-name files are `vercel.json` (W1 only),
`deadman.config.json` (W2 only), `src/app/play/page.tsx` + `Dashboard.tsx` (W4 only),
`scripts/tg.mjs` (read-only for all). Merge order W1 → {W2,W3,W4 in any order}.
All work stays in this worktree on `feat/halftime-quiz`; no commits, no pushes —
a human ships.
