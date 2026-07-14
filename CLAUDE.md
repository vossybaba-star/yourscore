# YourScore — Project Instructions

## 0. READ THIS FIRST — product truth lives in one place
**[`YOURSCORE.md`](./YOURSCORE.md) is the single source of truth for what YourScore is** —
product, game modes, league model, scoring, locked vocabulary, and what's discontinued.
**Read it — including its top "Recently shipped" changelog — before referencing any feature
or claiming that something is or isn't built.** When it conflicts with this file, older docs,
memory, or your own assumptions, **YOURSCORE.md wins.**

Do **not** rely on memory — or on a hard-coded feature list in this file — for what exists:
features ship almost daily. This file deliberately does **not** enumerate features (a second
list only drifts and misleads the next session — that drift is exactly why agents fall behind).
YOURSCORE.md carries the feature set and it is kept current.

`PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md`, and the old
`~/Downloads/*build-doc.md` files are historical/stale — never treat them as current scope.

## ⚑ Before you build — which framework applies

Two docs govern *how* we build. **Check the trigger below and read the matching doc before
starting.** They are scoped on purpose — do not apply them to work they don't cover.

| If the task is… | Read first | Mandatory? |
|---|---|---|
| **A new app feature** (new game mode, new surface, new user-facing capability) | [`docs/FEATURE-BUILD-FRAMEWORK.md`](./docs/FEATURE-BUILD-FRAMEWORK.md) | **Yes** |
| **A new automated loop** (cron job, scheduled/headless agent, pipeline) | [`docs/LOOP-STANDARD.md`](./docs/LOOP-STANDARD.md) | **Yes** |
| Bug fix, perf work, copy/content change, refactor, audit, a question | — | No — §2 operating principles apply as normal |

**Two ways this gets triggered — both are valid:**
1. **You classify it.** Read the founder's request against the table above and pick the bucket.
   Most cases are obvious. **When genuinely unsure, ask** — do not default to the heavyweight path.
   The founder can also override in words ("new feature — run the framework" / "quick fix, skip it").
2. **The founder runs `/feature <description>`** — the explicit switch. It invokes the framework
   deterministically, with no classification step to get wrong. Prefer this reading when it's used.

**Feature builds default to the FAST PATH** (four beats, 2–4 subagents, plan-mode speed):
**Haiku researches** (cheap/fast gatherer — real API calls to external dependencies, sourced
facts, output labelled UNVERIFIED; skipped for purely internal features) → **Fable plans,
receiving the research** (investigates the codebase itself, verifies load-bearing claims; output
= plan + locked acceptance criteria) → **🚦 founder approves the plan** → **one Sonnet agent
builds** at `high` (branch/worktree, never `git add -A`, never push `main`; Opus only by stated
exception: concurrency/races, scoring/money, core game loops) → **Fable reviews the diff**
against the locked criteria (`next build` + `next lint` run as commands, never agents) →
**🚦 founder approves ship** → update YOURSCORE.md, measure vs the impact hypothesis. **Model
routing is automatic and the skill's responsibility** — Fable beats run inline when the session
is on Fable, else via an auto-spawned Fable agent with a scoped brief; **never ask the founder
to switch models**. Speed and cost are requirements.

**The multi-agent deep-run pipeline is OPT-IN ONLY** — propose it with an agents/cost/time
estimate and get an explicit founder yes *before* starting. Reserve for features where a wrong
assumption is expensive and discovered late (unverified third-party APIs at the core, live data,
money, hard seasonal deadlines). Its cost rules (§0a of the framework doc) bind absolutely.

**Automated loops** must satisfy the 4 rules: assert success (not existence), gate every
outward/irreversible action, bound the retry path, one persistent dedup key per side effect.

**Don't over-apply this.** A typo fix does not get a research phase. If the task is small,
reversible, and not a new feature or loop, just do the work under §2. When genuinely unsure which
bucket a task falls in, ask the founder rather than defaulting to the heavyweight path.

## 1. Stable facts (these rarely change)
- **What it is:** a football **competition** platform — two games plus a shared social layer.
  **38-0** (head-to-head team-builder) is the flagship/acquisition hook; **Quiz** (football
  knowledge) is the depth/retention play. It is **not** a World Cup app — FIFA WC 2026 is the
  launch/marketing moment; both games are year-round.
- **Platform / domain:** web app at **yourscore.app** (not `.gg`), wrapped as native
  iOS/Android (the primary surface).
- **Locked vocabulary — never deviate:** say **"football knowledge"**, never "IQ". A **Game** =
  one play-through. A **Lobby** (never "Room") = pre-game grouping; types **Private / Public /
  1v1** (1v1 = code's `h2h`). Brand the team-builder **"38-0"** ("Draft XI" is an internal
  descriptor only). Frozen code paths: the Quiz game lives at `/play`; `rooms*` tables ARE
  Lobbies. Do not rename paths.
- For anything beyond the above — the current feature set, what's live vs building vs shelved —
  **read YOURSCORE.md. Do not guess, and do not tell the user a feature isn't built without
  checking.**

## 2. How to work in this repo (operating principles)
Non-negotiable defaults. They exist because this is a live product with real users, multiple
Claude sessions editing in parallel, and a small margin for error.

**Verify, don't assume.**
- Before claiming a feature/file/flag exists or how it behaves, check the **live code, DB, or
  Sentry** — not memory or docs. Memory and recalled notes are point-in-time snapshots; the
  repo is truth. If a memory names a file/function/flag, confirm it still exists before acting.
- Before optimizing, **measure** (preview/Chrome, `EXPLAIN ANALYZE`, real timings) — don't
  guess where the cost is. Before a "fix", reproduce the problem.
- When an earlier assumption turns out wrong, **say so plainly and correct course** — don't
  paper over it.

**Production safety — treat prod as sacred.**
- Stage changes in **risk order**, smallest first, and **verify each step** (`tsc` → real
  `next build` → a real check) before the next. Never ship a change to the core game loops
  (38-0 draft/spin, Quiz play, Live H2H) without an end-to-end run first.
- **Never `git add -A`.** The working tree almost always holds other sessions' WIP — stage the
  exact files you changed, nothing else. Before pushing, `git fetch` and confirm a clean
  fast-forward; **pushing `main` auto-deploys to prod via Vercel.**
- Commit/push only when asked. When you do, re-check that origin hasn't moved and you aren't
  clobbering another session.

**Report faithfully.** Distinguish **shipped vs deferred**; state what you verified vs assumed;
surface failures with the actual output. Don't claim done-and-verified when it's neither.

**Keep the docs true — this is how agents stay current, so do your part.**
- Any product change → update `YOURSCORE.md` **in the same session** (add a line to its
  "Recently shipped" changelog, bump the Confirmed date) and run `graphify update .`.
  A feature that ships without a doc update is precisely why the next session is "out of date."

## 3. Tools & where truth lives
- **Codebase questions:** `graphify query "<q>"` (then `graphify path` / `graphify explain`)
  return a scoped subgraph — cheaper than raw grep. `graphify-out/wiki/index.md` for
  navigation; `graphify-out/GRAPH_REPORT.md` only for broad architecture. Run `graphify
  update .` after code changes (AST-only, no API cost).
- **Bugs — CHECK SENTRY FIRST** (before reading files or querying the DB). Read token in
  `.env.local` as `SENTRY_READ_TOKEN`; org `yourscore-qx`, project `javascript-nextjs`:
  ```bash
  SENTRY_READ_TOKEN=$(grep SENTRY_READ_TOKEN .env.local | cut -d= -f2) && \
  curl -s "https://de.sentry.io/api/0/projects/yourscore/javascript-nextjs/issues/?limit=10&statsPeriod=24h" \
    -H "Authorization: Bearer $SENTRY_READ_TOKEN" | \
    jq '[.[] | {id, title, culprit, count, lastSeen, firstSeen}]'
  # then: /api/0/issues/<ISSUE_ID>/events/?limit=3&full=true  for stack traces + context
  ```
- **Database:** Supabase project ref **`mznvuswzgkaupvaqznkm`** (eu-central-1). Drive it via the
  Management API — `POST api.supabase.com/v1/projects/<ref>/database/query`, plus
  `/advisors/security`, `/config/auth`, `/health` — with `SUPABASE_ACCESS_TOKEN` from
  `.env.local`. Note `NEXT_PUBLIC_SUPABASE_URL` is a **custom domain** (`auth.yourscore.app`),
  so take the ref from here, not by parsing that URL.
- **Secrets:** read only from gitignored `.env.local`; never print values. One var:
  `grep '^VAR=' .env.local | cut -d= -f2-`.
- **Verify UI/behavior:** the preview MCP (`preview_start`, then drive the real flow) or the
  Chrome MCP against prod — don't ask the user to check manually.

## 4. Gotchas (learned the hard way — don't relearn them)
- **zsh:** never use `path` or `UID` as a shell loop/temp variable — `path` is bound to `$PATH`
  and silently breaks every command after it; `UID` is readonly. Use `p`, `route`, `userid`.
- **Prod build:** `next build` fails on ESLint unused-imports even when `tsc` passes — run a
  real `next build` before deploying, not just `tsc`.
- **Vercel data cache:** service-role Supabase GETs in route handlers get pinned forever
  (constant cache key). Set `export const fetchCache = "force-no-store"` (or `dynamic`) on any
  authed/service-role route, or you'll serve stale data indefinitely.
- **Client reads are slow, not the DB:** a browser→Supabase (Frankfurt) fetch is ~0.4–1s
  regardless of the query (which is sub-ms). For shared data, wrap it in a Vercel **edge-cached**
  route (`s-maxage`); for per-user data, fetch **server-side** (co-located with the DB). Don't
  "optimize the query" — move the call.
- **Postgres/RLS:** function `EXECUTE` is granted to `PUBLIC` by default, so
  `revoke ... from anon, authenticated` is a no-op — `revoke ... from public` and re-`grant ...
  to service_role`. An RLS-enabled table with no policy = deny-all for anon/authenticated
  (service_role bypasses RLS).
- **Migrations:** numbers collide across parallel sessions — check the `supabase/migrations/`
  dir AND `schema_migrations` before picking one; many applied migrations were applied via the
  Management API and are NOT recorded in `schema_migrations`.

## 5. After changing the product
Update `YOURSCORE.md` in the same session (bump the "Confirmed" date, add a "Recently shipped"
line), then run `graphify update .` to keep the knowledge graph current.
