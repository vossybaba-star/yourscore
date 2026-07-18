# Halftime Quiz Packs — acceptance scorecard (Gate 2)

Graded 2026-07-14 against `docs/halftime-quiz-spec.md` §7, by direct verification in this
session (commands run, code read, replay output observed) — not from build-agent reports.

**Verdict shorthand:** ✅ PASS (verified) · 🔄 REPLAY (passed in the replay harness) ·
📅 LIVE (unverifiable until real football, 2026-08-21; mechanism replay-proven) ·
🔧 FIXED (failed initial grading, fixed inline this session, re-verified)

## A. Staging & the two-pass content rule
| AC | Verdict | Evidence |
|---|---|---|
| 1 base slate by T-21h, 10 Q, provenance | ✅ | `gen-base.mjs` writes slate + provenance sidecar (`:149-168`); pack shape enforced by `validatePackQuestions` + DB CHECK `halftime_staged_needs_pack` |
| 2 historic-only base | ✅ | prompt (`prompts/base.md`) + validator text gates; 29/29 claims tests incl. current-affairs bans |
| 3 NO first-half references — structural | 🔄 | replay: "byte-identical to the T-10 freeze" asserted on every released pack in every scenario; content mutation refused post-release (`fresh/route.ts:34-36`); validator kills 1H references even in options (claims test) |
| 4 fresh only after confirmed lineups; claims re-resolve | 🔄 | fresh-gate scenario; validator drops player-not-in-lineup |
| 5 zero-claim questions auto-dropped | ✅ | claims.test.mjs — ungrounded question dropped |
| 6 dedup vs bank + season | 🔧 | **was slate-only.** Added `op:"dedup"` (server-side, canonical `normalizeQuestionText`, paged bank + season halftime packs, self-fixture excluded) + wired into both generators with audited drops. tsc + parse verified |
| 7 fresh failure ⇒ full base-only pack | 🔄 | no-lineups (late-lineups), veto-all (fresh-gate), kill-switch, gate-unsendable scenarios all shipped 10-question base packs |

## B. Veto gate, timeout, kill switch
| AC | Verdict | Evidence |
|---|---|---|
| 8 one msg/fixture, answers+facts+deadline | ✅ | `veto.mjs:100-140` message builder; seen in replay preview mode |
| 9 per-question veto removes exactly that Q | 🔄 | fresh-gate scenario |
| 10 no response ⇒ auto-release at deadline | 🔄 | fresh-gate: zero-interaction path releases fresh Qs |
| 11 KILL ⇒ matchday base-only + confirm; UNKILL | 🔄 | kill-switch scenario; `veto.mjs:316-356` |
| 12 late veto honored till release; after ⇒ "too late" | 🔄 | unit test "a veto landing after the deadline still pulls the question" + fresh-gate |
| 13 unsendable gate ⇒ fresh dropped | 🔄 | gate-unsendable scenario (Telegram stub 500); `veto.mjs:28-29,173` |
| 14 no pack without a gate; release refuses unapproved | ✅+🔄 | release = CAS from `staged` only; unapproved never reaches `staged`; unit "cancelled fixture never releasable" |

## C. Release & timing
| AC | Verdict | Evidence |
|---|---|---|
| 15 playable ≤2 min of whistle | 🔄+📅 | normal-match "0.50 min after HT"; long-first-half: HT at KO+55' released on the flip — a +45 timer would have fired 10' early |
| 16 push ≤3 min, exactly once, spoiler-free | 🔄+📅 | push copy has no score (`shared.ts:308-320`, unit-tested); `notification_log` PK dedupe |
| 17 ≤1 halftime push/user/day | 🔄 | saturday-slate: "exactly ONE halftime push each, despite 10 fixtures"; first whistle of the day is the one that pushed |
| 18 re-invoke release = no-op | 🔄 | unit "concurrent releasers produce exactly one winner"; replay triple-invoke |
| 19 poller dead ⇒ watchdog ≤6 min; late ⇒ no push; pre-assembly ⇒ base-only | 🔄 | poller-crash: "2.0 min after HT", `released_late` no push; poller-crash-early: base-only shipped with 3 approved fresh Qs deliberately unused |
| 20 postponement ⇒ cancelled, no pack, no push | 🔄 | postponement scenario |
| 21 kickoff move updates row + deadline; release still on flip | 🔄 | delayed-kickoff scenario |
| 22 invisible pre-release | 🔄 | asserted in EVERY scenario ("no pack_id, no slug, no quiz_packs row"); pack row inserted only at release |

## D. Play, scoring, rank
| AC | Verdict | Evidence |
|---|---|---|
| 23 solo grading + rank via untouched paths | ✅+📅 | zero diff on solo-complete/scoring/migration 30; halftime packs are ordinary `quiz_packs` rows (type `records` — prod CHECK constraint discovered and respected) |
| 24 friends ⇒ existing Lobby create | ✅ | rail → `/play/new?packId=` (pre-existing preselect, `play/new/page.tsx:44`) → existing `room/create` |
| 25 per-fixture leaderboard = existing PackLeaderboard | ✅ | challenge page untouched; rail links to it |
| 26 guest path unchanged | ✅ | no guest-path code touched; pack is an ordinary published pack |

## E. Surfaces
| AC | Verdict | Evidence |
|---|---|---|
| 27 rail/card render only on matchday, flip at release | ✅ | `HalftimeRail.tsx:172-174` returns null when empty; live flip via `isLive()`; mounts are 2 self-hiding component insertions |
| 28 push deep link opens pack | ✅+📅 | `packUrl` → `/challenges/<slug>?pid=<packId>` |

## F. Season ops
| AC | Verdict | Evidence |
|---|---|---|
| 29 idempotent sync; midweek/double/blank GWs | ✅ | upsert `merge-duplicates` on `fixture_id` (`lib/api.mjs:92-93`); date-window driven |
| 30 full E2E replay demo pre-season | 🔄 | **13/13 scenarios green, 93 assertions, 0 failures** (saturday-slate 9/9 after a harness-only timeout fix); founder to see veto preview run |
| 31 heartbeat + health check, watchdog idle=0 calls | 🔄 | poller-crash heartbeat alerts; `{idle:true,checked:0}` observed; `scripts/health/checks/halftime.mjs` registered |
| 32 **FULL PUBLIC LAUNCH Fri 2026-08-21** | 📅 | founder decision at Gate 2 (supersedes shadow night); AC15–17 measured Friday as checkpoint, not gate |

## G. Negative criteria
| AC | Verdict | Evidence |
|---|---|---|
| 33 existing surfaces untouched | ✅ | `git diff origin/main` empty on quiz/packs, challenges, room/create, scoring, migration 30; only 23 insertion-lines on 5 existing files (mounts + cron + gitignore + health registry) |
| 34 real `next build` passes; force-no-store everywhere | ✅ | build green (`NEXT_DIST_DIR=.next-verify`); `grep -L force-no-store` over new routes = empty |
| 35 migration 93: RLS deny-all, PUBLIC revoke | ✅ | read directly; also strips table grants as defense-in-depth; CHECK constraints on state machine |
| 36 on-ship docs | ⏳ | pending founder ship approval (YOURSCORE.md changelog + graphify + LOOP-STANDARD row) |

## Test totals
- Unit: **78/78** (39 shared/state-machine + 29 claims/validator + 10 poller-states)
- Replay E2E: **13/13 scenarios, 93 assertions, 0 product failures.** Slate highlights:
  10/10 fixtures released each on its own whistle (5 simultaneous 15:00 KOs, HTs ~7
  replay-min apart); exactly 1 push/user/day across 10 fixtures; 1,885 livescores calls
  for the full slate day vs the 2,000/hr limit; every pack byte-identical to its T-10
  freeze. (Two harness-only fixes en route: atMin budget now scales with target minute;
  child processes killed as a group so a crashed run can't orphan the dev server.)
- `tsc` clean · real `next build` green · `next lint` clean on all halftime files

## Founder actions before 21 Aug (none block commit)
1. SportMonks → paid before Jul 22; re-verify entitlements (`GET /v3/my/resources`)
2. Apply `supabase/migrations/93_halftime.sql` to prod
3. VPS: deploy poller per `scripts/halftime/README.md` (crontab + env)
4. Vercel env: `HALFTIME_PUSH_ENABLED=true` (day-one decision) + `TELEGRAM_*` for alerts
5. Decide YOURSCORE.md §5A.1 wording (new §5A.5 entry vs revised §5A.1)
