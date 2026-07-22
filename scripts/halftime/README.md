# Halftime packs — the poller, and how to prove it works

A quiz pack for every Premier League fixture, released at the **real half-time
whistle**. Not at kickoff+45. Those are different moments, sometimes by ten
minutes, and the difference is the entire reason this directory exists.

Two things run outside Vercel:

| | what | where |
|---|---|---|
| **poller.mjs** | the primary path. Polls SportMonks every 6s and releases the pack the instant the fixture flips to HT (`state_id == 3`). | Hetzner VPS, launched by cron each morning |
| **watchdog** | `/api/cron/halftime-watchdog`, Vercel cron `*/5`. The backstop, for when the poller dies. | Vercel |

If both are alive the poller wins and the pack is live within seconds. If the
poller dies the pack is late by up to ~6 minutes — still inside a real half-time.
If both die the pack goes up whenever something recovers, marked `released_late`,
and **no push is sent** (a notification after the restart is useless and a
spoiler for anyone who has not watched yet).

---

## The daily shape

```
07:00   cron starts poller.mjs
        no PL fixtures today?  →  logs, exits 0, ZERO SportMonks calls.   ← most days
        fixtures today?        →  asserts entitlements, then waits.
T-75    lineup watch opens (1 call/fixture/60s)
T-60    confirmed XIs → gen-fresh.mjs → veto.mjs (Telegram) → the founder can veto
T-10    veto deadline. Anything unvetoed auto-approves. The pack is FROZEN here.
KO      6s poll of /livescores/latest begins
HT      state_id == 3  →  POST /api/halftime/release  →  pack live + push
FT      all fixtures terminal → Telegram day summary → exit 0
```

**Nothing generates or edits content after the kickoff whistle.** The release
step is a byte-for-byte copy of the snapshot frozen at T-10. That is what makes
"no question may reference a first-half event" a structural property rather than
a thing we ask an LLM nicely not to do.

---

## Deploy (Hetzner VPS)

The poller has no dependencies beyond what the repo already has — it is Node
built-ins plus `fetch`. No `npm install` beyond the repo's own.

```bash
# on the VPS, in the repo checkout
node --env-file=.env.local scripts/halftime/poller.mjs --dry-run   # sanity check
```

### crontab

One line. It launches every morning and exits immediately on the ~5 days a week
with no Premier League football, so the cost of a blank day is one process start
and one call to our own API.

```cron
# Halftime quiz packs — the poller. Exits in seconds on non-matchdays.
0 7 * * * cd /root/yourscore && /usr/bin/node --env-file=.env.local scripts/halftime/poller.mjs >> /root/yourscore/scripts/data/halftime-poller.log 2>&1
```

Do **not** add a second launch "just in case" — a duplicate poller would be a
second caller for every side effect. It would in fact stand down on its own (the
heartbeat freshness check at startup makes it exit if another instance is
beating), but do not rely on that as a design.

### env the VPS needs

| var | why |
|---|---|
| `CRON_SECRET` | bearer for `/api/halftime/*` — the same value Vercel has |
| `HALFTIME_API_BASE` | `https://yourscore.app` (falls back to `NEXT_PUBLIC_APP_URL`) |
| `SPORTMONKS_API_KEY` | the paid key |
| `TELEGRAM_LAUNCH_BOT_TOKEN` / `TELEGRAM_LAUNCH_CHAT_ID` | alerts + the day summary |

And on **Vercel**: `HALFTIME_PUSH_ENABLED`. It is `false` by default and **no
push fires until it is `true`** — which is exactly what the shadow-night gate
(Fri 21 Aug, single fixture, allowlist only) needs.

`SPORTMONKS_BASE_URL` is left unset in production. It exists so the replay
harness can point the poller at fake football; if you ever find it set on the
VPS, something is very wrong.

### is it alive?

```bash
curl -s -H "authorization: Bearer $CRON_SECRET" https://yourscore.app/api/halftime/heartbeat
# → {"beating":true,"ageSeconds":34,...}
```

A heartbeat older than 10 minutes during a match window is what the watchdog
alerts on. The poller also writes `scripts/data/halftime-poller-<date>.json`,
which is its memory across a restart: what it has already released, what it has
already alerted about, so a restart does not re-alert or re-attempt.

---

## The replay harness — the only proof available before 21 August

It is the off-season. `/livescores` returns legitimately empty data until the
season starts, so **the half-time transition cannot be observed at all**. Every
claim about this feature is therefore either proven in replay or it is not
proven.

```bash
node --env-file=.env.local scripts/halftime/replay-test.mjs                 # everything
node --env-file=.env.local scripts/halftime/replay-test.mjs --only saturday-slate
node --env-file=.env.local scripts/halftime/replay-test.mjs --scale 240     # faster
VERBOSE=1 node --env-file=.env.local scripts/halftime/replay-test.mjs --only normal-match
```

What it actually does: boots the **real Next.js app** against an in-memory
database, boots a **fake SportMonks** replaying a recorded matchday, and runs the
**real poller** and the **real watchdog route** against them. Nothing under
`src/` is modified, and the poller has no test mode. The only seams are two
environment variables the production code already reads:

```
SPORTMONKS_BASE_URL       → the replay server
NEXT_PUBLIC_SUPABASE_URL  → the stub database
```

Before it writes anything, it writes one heartbeat and then looks for it in the
stub. If the row is not there, the app is talking to something else — possibly
Supabase — and **the suite aborts rather than run**.

### the scenarios

| | what it proves |
|---|---|
| `normal-match` | the happy path; push once per user; re-releasing 3× concurrently changes nothing |
| `long-first-half` | HT at KO+55'. A kickoff+45 timer would have published the pack while the first half was still being played |
| `delayed-kickoff` | kickoff slides +20'; the deadline recomputes; release still keys off the flip |
| `late-lineups` | sheets at T-30, and a fixture with no sheets at all → base-only, which is a normal outcome |
| `fresh-gate` | veto-with-timeout: with **no founder response at all** the fresh questions auto-release; `Veto 2` removes exactly question 2 |
| `kill-switch` | one `KILL` takes a whole matchday base-only — including a pack already frozen with fresh questions in it |
| `postponement` | cancelled; no pack row is ever inserted; no push |
| `abandoned` | abandoned before HT → cancelled. Abandoned *after* release → **the pack stays up**, because every question in it was set before kickoff and is still true |
| `poller-crash` | SIGKILL mid-first-half. The watchdog releases within its 6-minute bound; a fixture whose HT was missed entirely goes `released_late` with **no push** |
| `poller-crash-early` | poller dies before assembly. The watchdog stages **base-only** — it never ships fresh questions, even with three approved ones sitting in the row |
| `saturday-slate` | 10 fixtures, five simultaneous 15:00 kickoffs; ten releases, and a user still gets exactly **one** push |

`--scale N` compresses time: at `120`, one nominal minute takes half a real
second, and a full Saturday replays in about five minutes. The poller reads the
same `HALFTIME_SCALE` and divides *its* durations by it, so what is being tested
is the shipping code with its real constants, just wound forward.

### the state catalogue is real, not invented

```bash
node --env-file=.env.local scripts/halftime/record-states.mjs
```

Pulls `GET /v3/football/states` from the live API into `scenarios/states.json`
and re-verifies, first-hand, that **half time is `state_id` 3**. Scenarios name
states the way the production code resolves them — by `developer_name` — so if
SportMonks ever renumbers, the poller refuses to start rather than release a pack
in the 78th minute.

```bash
node --test scripts/halftime/poller.test.mjs
```

Drives *both* classifiers — `src/lib/halftime/shared.ts` (which the watchdog
uses) and `poller.mjs` (which the daemon uses) — through all 25 live states and
fails if they ever disagree about what half time is.

---

## Known gaps

- **The poller cannot cancel a fixture itself.** There is no `/api/halftime/cancel`;
  cancellation lives in the release engine and only the watchdog calls it. When
  the poller sees a postponement it nudges `/api/cron/halftime-watchdog` and lets
  that do it, rather than growing a second code path for the same side effect. It
  works, and it is proven in `postponement` and `abandoned` — but a dedicated
  route would be cleaner.
- **`*/5` crons need Vercel Pro.** Every existing cron in `vercel.json` is
  hourly. If the plan does not support it, the watchdog silently does not run and
  the poller becomes a single point of failure.
- **The stub database is not Postgres.** The replay suite proves the *code*; W1
  proved the compare-and-set against real Postgres with 12 parallel sessions.
  Neither substitutes for the other.
