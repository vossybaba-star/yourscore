# YourScore Feature-Build Framework

**What this is:** how new YourScore **app features** get built. Companion to
[`docs/LOOP-STANDARD.md`](./LOOP-STANDARD.md) (which governs the *automation* loops).

## ⚡ The FAST PATH is the default (2026-07-14 founder decision)

The standard way to build a feature is the founder's three-beat design, implemented in
`~/.claude/skills/feature/SKILL.md`:

1. **Haiku researches** (1–2 parallel agents, `effort: low` — the cheapest/fastest model as the
   gatherer, not the judge: real API calls to external dependencies, sourced competitor/market
   facts, live time-sensitive data; output = compact notes labelled UNVERIFIED. Skipped for
   purely internal features)
2. **Fable plans — receiving the research** (inline when the session is on Fable; otherwise the
   skill **auto-spawns a Fable agent** — model routing is automatic, the founder is never asked
   to switch models; Fable investigates the codebase itself, verifies any load-bearing research
   claim, outputs plan + locked acceptance criteria) → 🚦 founder approves the plan
3. **One Sonnet agent executes** (`effort: high`; branch, never `main`; Opus only by stated
   exception: concurrency/races, scoring/money, core game loops)
4. **Fable reviews the diff** (same automatic routing; against the locked criteria, then bug
   hunt; `next build` + `next lint` run as commands) → 🚦 founder approves ship → update
   YOURSCORE.md, measure vs the impact hypothesis later

2–4 subagents, wall-clock comparable to plan mode plus a research and a review pass. **Why it's
cheap:** agent *count* with cold context is the expensive thing, not the models — the blowout
run used 18 agents re-reading the world; the fast path uses at most 4, each with a scoped brief,
research lands on the cheapest model, and the token-hungry build always lands on Sonnet.

**Everything below this line is the DEEP RUN — opt-in only.** It requires an explicit founder
yes, given an estimate of agents/cost/time, *before* it starts. Reserve it for features where a
wrong assumption is expensive and discovered late (unverified third-party APIs at the core, live
data, money, hard seasonal deadlines). The first heavyweight run cost ~5× a plain build and took
hours ([[feedback_feature_framework_cost_discipline]]) — hence this default.

What must survive in *either* path: **verified facts (not confident summaries) · locked, testable
criteria before building · the two founder gates · post-ship measurement.** Those four are the
point; the deep run is just more machinery around them.

---

# THE DEEP RUN (opt-in pipeline)

---

## ⚠️ 0a. This is a COST-CONTROL design — the four cost rules

The model table below is the whole point: **Fable only on the high-stakes, low-token stages
(1b, 2, 7); the token-hungry BUILD stays on Sonnet.** That's what keeps total spend contained.
Break it and this framework is strictly worse than plan-mode-and-go — slower, dearer, same code.

**Learned the hard way (2026-07-14, halftime quiz packs):** that run cost ~5× a plain build.
Causes: Opus-at-`xhigh` was used on 3 of 4 **build** workstreams (the build is ~80% of tokens);
18 agents with no cap; every agent cold-booted and re-read the same product docs and codebase
(duplicated *input* tokens were most of the overspend, not the extra thinking); and a 13–16
agent-day spec was run as one monolith with no checkpoint.

1. **The model table is a CEILING.** Build = Sonnet. Opus on a build stage needs a specific
   reason — concurrency/races, scoring/money, or the core game loops — stated out loud at the
   time. `xhigh` effort ONLY on stage 2. Builds run at `high`.
2. **Agent budget:** research ≤3 · build ≤4 workstreams (zero file overlap, proven) ·
   reviews **2 by default** (stage 6 criteria-grader + stage 7 Fable bug hunt; stage 5 is opt-in
   for money/core-loop/real-time; never spawn an agent for the lint sweep — just run `next lint`).
   **Hard ceiling 12 agents per feature.**
3. **Write the context brief ONCE** and pass its path. Forbid agents from re-reading YOURSCORE.md,
   CLAUDE.md, GRAPH_REPORT.md, or exploring the codebase broadly. This is where the money goes.
4. **Size gate:** build estimate >~5 agent-days → do NOT build; take the smallest
   independently-shippable slice back to the founder.

**Report agent count + spend at both gates.** And if the feature is built entirely from code we
already own and understand, **don't run this at all** — plan mode gives ~90% of the outcome for
~20% of the spend. This framework earns its keep only when a wrong assumption is **expensive and
discovered late**: unverified third-party APIs, live data, seasonal deadlines, money.

---

## 0. The four things that make it fundamental

Most of the pipeline is obvious. These four are the parts that are easy to skip and are exactly
what turns "we sort of do this" into a real system:

1. **Verified research, not generated research.** The research stage runs through
   fan-out → **adversarial fact-check** → cited claims. A single agent's confident summary of
   "the market" is banned — the model states stale facts as truth (it once claimed Arne Slot was
   still at Liverpool). Every competitive/market claim is checked before it informs a decision.
   See [[feedback_reddit_fact_check]].
2. **Locked, testable criteria — written *before* building.** Each feature gets a written
   acceptance spec at plan time (definition-of-done + impact hypothesis + vision-alignment).
   Stage 6 grades against *that document*, not a fresh opinion — otherwise "did it hit the
   criteria" is just another vibe review.
3. **Exactly two human gates.** Everything else is autonomous. The two irreversible/expensive
   actions stay yours: **which features we build** (Gate 1) and **ship to prod** (Gate 2).
4. **Post-ship measurement closes the loop.** Stage 8 checks the real result against the stage-3
   prediction and writes the lesson down. This is what makes it a loop, not a feature factory.

**Alignment guardrail:** every stage is anchored to `YOURSCORE.md` (the product-truth doc —
two-game + social layer, locked vocabulary, what's discontinued). An agent flags any proposed
feature that drifts from it, so alignment is checked without the founder eyeballing everything.

---

## 1. The pipeline

| # | Stage | Autonomous? | Output |
|---|---|---|---|
| 1 | **Research** — competitors, market, opportunity (verified + cited) | ✅ | opportunity brief |
| 2 | **Plan / architecture** — how we'd build it | ✅ | technical plan |
| 3 | **Grounded impact estimate** — user happiness + speed/perf, tied to real data | ✅ | impact hypothesis + metric to check |
| — | 🚦 **GATE 1 — founder approves which features proceed to build** | ❌ you | ranked go/no-go |
| 4 | **Build** — in isolated worktrees/branches, never auto-push `main` | ✅ | branch + diff |
| 5 | **Review: does it work?** (adversarial, end-to-end) — **opt-in**: money / core loop / real-time only | ✅ | works/doesn't + evidence |
| 6 | **Review: does it hit the locked criteria?** — always | ✅ | pass/fail vs the stage-2 spec |
| 7 | **Review: is it technically sound?** (deep bug hunt; lint/build run as commands, not agents) — always | ✅ | findings |
| — | 🚦 **GATE 2 — founder approves ship to prod** | ❌ you | ship/hold |
| 8 | **Post-ship measure** — real result vs stage-3 hypothesis → lesson | ✅ | measured delta + memory note |

**Prod-safety (non-negotiable, from CLAUDE.md):** build-agents work on branches in isolated
worktrees, stage exact files (never `git add -A`), and never push `main`. Ship is Gate 2.
Generated imagery / brand creative stays gated regardless (see [[feedback_creative_assets_need_approval]]).

**Portfolio batching:** run stages 1–3 for *all* candidate features in one pass, then Gate 1 once
(approve the winners), then build only the survivors. Cheaper — you don't pay to build things
that die at the gate — and it's one decision instead of many.

---

## 2. Model + effort policy per stage

Two levers: **model** (capability tier) and **effort**. Both are **ceilings** (§0a Rule 1):
`xhigh` is permitted **only on stage 2 (plan)**; builds run at `high`; sweeps at `low`.

Cost per 1M output tokens (for reference): **Fable 5 $50 · Opus 4.8 $25 · Sonnet 5 $15 ($10 intro
thru 2026-08-31) · Haiku 4.5 $5.**

| Stage | Model | Effort | Why |
|---|---|---|---|
| **1a. Research fan-out** (**max 3 agents**) | Haiku 4.5 / Sonnet 5 | low–med | Blind, cheap; pick the 3 angles that could actually kill the feature |
| **1b. Fact-check + adversarial verify** ⭐ | **Fable 5** | high | The gate that catches confident-wrong research — max capability where a wrong claim is most expensive |
| **2. Plan / architecture** | **Fable 5** | **xhigh** (the only stage allowed it) | Highest-leverage reasoning; full spec up front. A wrong architecture call is costly rework |
| **3. Grounded impact estimate** | Sonnet 5 | high | Reasoning over *our* data + YOURSCORE.md, not novel invention |
| 🚦 **Gate 1 (founder)** | — | — | — |
| **4. Build / execution** | **Sonnet 5** — always | **high** | The build is ~80% of all tokens; keeping it on Sonnet-at-high IS the cost mechanism. Opus 4.8 only by stated exception: real concurrency/races, scoring/money, or the core game loops — announced at the time (§0a Rule 1) |
| **5. Review: does it work? — OPT-IN** | Opus 4.8 | high | Only for features touching money, the core game loop, or live/real-time behaviour. Otherwise stage 6 + direct verification covers it |
| **6. Hits the locked criteria?** | Sonnet 5 | high | Grading against a *written* rubric — cheaper judge is fine when criteria are explicit. Always runs |
| **7. Technical / code review** ⭐ | **Fable 5** (deep bug hunt) | high | The one deep review on the final artifact. Always runs. The mechanical sweep is **not an agent** — run `next build` + `next lint` directly (prod build fails on ESLint unused-imports — see [[project_yourscore_app_audit]]) |
| 🚦 **Gate 2 (founder)** | — | — | — |
| **8. Post-ship measure** | Sonnet 5 | med | Reading funnel/health data vs the stage-3 hypothesis |

**The shape:** *Fable verifies, plans, and final-reviews · Sonnet builds and judges the volume ·
Opus only by stated exception · lint is a command, not an agent.*

**Agent arithmetic (why the ceiling is 12):** default run = 3 research + 1 fact-check + 1 plan +
1 impact + 4 build + 2 reviews = **12**. The ceiling **includes** any opt-in: if stage 5 is
warranted, cut an agent elsewhere (a build workstream or a research angle) — 12 is the number,
not 12-plus-exceptions.

Founder decision (2026-07-14): use **Fable 5** on 1b, 2, and 7 — accept the ~2× Opus premium on
those stages, since they're the highest-stakes and lowest-token (the token-hungry build stays on
Sonnet, so total spend stays contained).

### Fable 5 operational notes (for when this runs headless)
- **Thinking is always on** — omit the `thinking` param; `{type:"disabled"}` 400s. Control depth
  with `output_config.effort`.
- **Requires 30-day data retention** — Fable requests 400 under zero/short data retention. Confirm
  the org's retention config before running Fable headless on the VPS.
- **Refusal handling** — safety classifiers can return `stop_reason:"refusal"`; wire an
  **Opus 4.8 fallback** (server-side `fallbacks` on the Claude API, or client-side middleware).
- **Cost watch** — Fable is premium; the VPS headless routines already risk `$100s/mo` on Opus
  (see [[project_yourscore_offlaptop_infra]]). Fable on 3 stages × many features needs a budget cap.

---

## 3. How to run it

The model/effort column maps to real knobs — it's enforceable, not just documented:

- **In Claude Code (interactive):** set the session model per stage, and route sub-work with the
  Agent tool's `model` param (a Haiku filtering subagent, a Fable reviewer).
- **As a workflow (recommended home):** each `agent()` call takes `model` **and** `effort` opts,
  so the table above becomes literal code — the assignment is enforced. **A workflow cannot pause
  for user input**, so the gates live in the main loop: run stages 1–3 as one workflow that
  *returns*, hold Gate 1 via AskUserQuestion, then run stages 4–7 as a second workflow. Never put
  a gate inside a workflow — it will stall or be skipped.

Start heuristic, then tune — **within the §0a ceilings**. Tuning means moving *down* (does the
criteria-grader work on Haiku? does research need 3 angles or 2?), never re-testing escalations
the cost rules forbid.

---

*Maintainer note: a feature that skips §0's four items — verified research, locked criteria, the
two gates, post-ship measurement — isn't running this framework, it's just coding with extra
steps. Those four are the point.*
