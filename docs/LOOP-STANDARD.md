# YourScore Loop Standard

**What this is:** the engineering standard every automated loop (cron job, headless-Claude
routine, agent pipeline) at YourScore must satisfy, plus a live scorecard of where each
existing loop stands. Born out of a full loop-engineering audit on **2026-07-14**.

It exists because the business now runs almost entirely on autonomous loops. A loop that
fails *silently* is worse than one that never ran — it looks healthy while doing nothing (or
the wrong thing). This standard is how we keep that from happening.

---

## 0. The one idea

> **Liveness ≠ correctness.** Proving a job *ran* is not proving it *succeeded*.

The single most common failure mode in this codebase's monitoring is a job that keeps
touching its log file while producing nothing — and reads green. Everything below is
downstream of fixing that.

Grounded in the verified research (Anthropic *Building Effective Agents*; ReAct/Reflexion;
the July-2026 "infinite agentic loops" study): the reliable verification signal is
**ground truth from the environment** — a real DB row, a live post, an API 2xx — *not* the
script's exit code and *not* the model grading its own work.

---

## 1. The four rules

Every loop that runs unattended must satisfy all four. Grade A = all four; drop a letter per
gap.

### Rule 1 — Assert success, not existence
After the work, **read back the real artifact** and fail loud if it's not there.
- ✅ `packs.find(p => p.metadata.date === today)` — the row for today exists
- ✅ `postTweet()` throws on non-2xx and returns the tweet id
- ✅ Publer `pollJob` waits for `complete`/`failed`
- ❌ `exit 0` after a write whose `error` you checked but whose result you never re-read
- ❌ a deadman entry in `mode: "mtime"` (proves the file was touched, not that it's correct)

### Rule 2 — Gate every outward / irreversible action
Read + generate = autonomous. **Post / email / push / prod-write = human-gated (Telegram) or
provably safe.** The gate is the Telegram approval tap. Auto-post paths must be opt-in
(env-flagged off by default) and origin-restricted.

### Rule 3 — Bound the retry path
Any loop that can repeat needs a cap **on the path that actually repeats** — max attempts,
a no-progress check, and a wall-clock timeout. (The #1 cause of runaway loops is a bound
placed on the wrong scope.) Examples in-repo: image regen `regen < 4`; draft cap 6; web-search
`maxHops = 4`; health watchdog 8-min `setTimeout`.

### Rule 4 — One persistent dedup key per side effect
A re-run must not double-fire. The key must be **persistent** (DB row or committed file, not a
`/tmp` lockfile) and **claimed before the work**, not after.
- ✅ gold standard: `send-england-quiz-push.mjs` → `notification_log` table, `dedupeKey`,
  filters already-sent, **logs before delivery**
- ✅ `launch-daily.ran` date-content lockfile, `markLaunched()` before publish
- ✅ upsert `onConflict` (edition roll, quiz seed, fantasy feed)
- ❌ `/tmp/*.lock` written `wx` and **unlinked on exit** — guards concurrent runs only, not
  a completed-then-rerun double-send

---

## 2. Where a new loop should run (deploy-target guide)

| Kind of work | Run it as | Why |
|---|---|---|
| Fast, deterministic, tied to app data | **Vercel cron** (`vercel.json`) | Cloud, zero-infra, machine-off safe. Best default. |
| Node script needing repo/env/secrets, ≥ deterministic | **VPS cron** (Hetzner deploy crontab) | Where the money-makers live now. |
| Needs reasoning / judgement / content generation | **Headless-Claude routine** (VPS cron → `claude -p`) | Already the pattern for worldcup-quiz, security-audit, pl-season-scout, etc. |
| Quick polling during active dev | `/loop` in an open session | Session-scoped, laptop-must-be-on — **never** for production. |

**Do not** put business-critical work on laptop launchd or Claude Desktop schedules — those
die when the laptop is off. (As of the Jul-2026 migration, only two *advisory* Desktop tasks
remain laptop-bound; keep it that way.)

---

## 3. Current scorecard (2026-07-14 audit)

### Health / monitoring — checks are excellent, self-coverage is the hole
| Loop | Grade | Note |
|---|---|---|
| freshness, journeys, cleanup, experience | A / A− | genuinely assert real rows / plays / board-invisibility |
| anon-api, browser | A− | real predicates, minor brittleness |
| gamer-review | B+ | **degrades to `ok:true` when the Anthropic key is down → layer silently dark** |
| navigation | B | skip-on-missing-UI can mask a regression |
| sentry | B | Sentry outage → warn, not red (error visibility lost silently) |
| health orchestrator | B− | **nothing proves the run itself fired** |
| deadman | C | mostly `mtime` = proves-ran-not-succeeded |

### Daily quiz + WC
| Loop | Grade | Note |
|---|---|---|
| launch-daily (orchestrator) | A− | persistent day-lock, full gating, bounded regen; publish/roll trust exit-0 |
| seed-daily-quiz, gen-images, roll-wc-edition | A / A− | idempotent by upsert design |
| **7 email senders** | **C** | `/tmp` lockfile = concurrency guard, **not** dedup → manual re-run double-broadcasts |
| send-england-quiz-push | A− | the correct model — copy it to the others |

### Reddit — "nothing auto-posts" holds
| Loop | Grade | Note |
|---|---|---|
| track, sync, telegram, factcheck-queue, auth | A / A− | double-gated post, id-keyed dedup, fact-check fail-safe |
| track-local.sh | B+ | fail-loud, but no staleness deadman |
| **redraft** | **C** | regenerates model text but **keeps stale `factChecked: true`** → unverified text reaches founder marked checked |
| **track-run.sh** (older wrapper) | **D** | discards the tracker's exit-2 "all fetches failed" alarm |

### X / social / content — well-built
| Loop | Grade | Note |
|---|---|---|
| x-track, x-propose, x-engage, x-telegram-poll | A | success-asserted, gated, bounded, id-keyed dedup |
| x-ideas, x-drip | A− | drip currently `disabled` in laptop config (runs on VPS) |
| content-send, content-poll, ig-* | A / A− | claim-before-work, Publer job-status polling |

### Fantasy-news (uncommitted, not on `main`)
| Loop | Grade | Note |
|---|---|---|
| fantasy-news cron | B+ | well-gated; undeployed so unverifiable live |
| **news-items ingest** | **C** | `.insert` with **no dedup key** → duplicate news cards on VPS re-send |

---

## 4. Backlog (ranked by blast radius)

### P0 — the new single point of failure: the VPS
The Jul-2026 migration removed the laptop SPOF; it did not remove SPOF. Everything now depends
on one Hetzner CPX32 with no redundancy.
- [ ] **VPS git credentials** — the daily quiz routine commits `wc-quiz.json` but `git push`
  fails (no deploy key/PAT), so refreshed draft pools never reach prod. *Founder action.*
- [ ] **`sharp` on `main`** — quiz artwork works only via a hand-patched `package.json`; a clean
  re-clone or `git checkout .` re-breaks it. Land it on `main`.
- [ ] **VPS resilience** — automated snapshot/backup + a documented one-command rebuild, so
  "VPS down" is a 30-min restore, not a business outage.

### P1 — correctness gaps (wrong / duplicate outward output)
- [ ] **Email senders → persistent dedup key.** Port the `send-england-quiz-push.mjs`
  `notification_log` + `dedupeKey` pattern to all 7 email scripts. Kills the double-broadcast class.
- [ ] **reddit-redraft re-fact-checks.** Clear `factChecked` when the draft body changes; never
  let regenerated text reach Telegram marked checked.
- [ ] **fantasy-news ingest dedup.** `.insert` → `upsert onConflict: payload.url` before it ships.
- [ ] **Retire / fix `reddit-track-run.sh`** so the exit-2 alarm is never discarded; confirm
  which reddit wrapper is actually scheduled.

### P2 — monitoring: make silence impossible
- [ ] **External heartbeat for the watchman.** The deadman runs *inside* the health check and
  reports through the same channel — it cannot detect its own host dying. Add an independent
  uptime/dead-man's-switch ping (e.g. healthchecks.io) that pages if the health run misses.
- [ ] **mtime → success assertion.** Move `x-track / x-engage / x-ideas / content-send` deadman
  entries from `mtime` to a positive marker (write today's date / a success token on real success).
- [ ] **No silent degrade.** `sentry`, `gamer-review`, `navigation` must report *degraded* (amber,
  visible) — not green — when their subsystem is unreachable or a UI element is missing.
- [ ] **Fix the misleading laptop deadman config.** The laptop `deadman.config.json` still points
  at frozen laptop paths; the real one is on the VPS. Repoint or remove the laptop copy.

---

## 5. Open verification items (need VPS access / founder)
- Which reddit wrapper actually fires, and does the VPS reddit sweep silently 403 (VPS IP was
  blocked Jul 10)? If it runs on VPS under `mtime` deadman, a 403'd sweep reads green.
- Are the two P0 landmines (git creds, `sharp`) still live, or already fixed since the memory note?
- Is the VPS deadman config marking `x-drip` disabled while it actually posts? (monitoring blind spot)

---

*Maintainer note: when you add a loop, grade it against §1 here and add a row to §3. A loop
that ships without satisfying the four rules is exactly how the next silent failure gets in.*
