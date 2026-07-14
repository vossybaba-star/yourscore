# Fantasy News Hub — acceptance criteria

**⚠️ RECONSTRUCTED AFTER THE BUILD (2026-07-14), not locked before it.**
The framework requires criteria written at plan time so stage 6 grades against a document
rather than a fresh opinion. This build didn't do that. These criteria are reconstructed from
the decisions the founder actually made during the build session, so they are honest about
intent — but they are *weaker evidence* than pre-locked criteria, because the person who built
the thing also wrote the rubric. Founder should challenge any that don't match what he thought
he was approving.

Feature: fantasy news & insights hub. Branch `fantasy/news-hub`. Not on `main`.

---

## A. Scope (locked with founder during the session)

| # | Criterion | Source |
|---|---|---|
| A1 | Feed is **GENERAL** — same content for every user, no personalisation | founder: "general for now" |
| A2 | **Solo-first** — no social features in v1 (friend-ownership etc. deferred) | founder: "solo first" |
| A3 | Hub does **NOT** earn transfer credits; the earn-from-insight wedge is parked | founder: "nothing on the insight content earning just yet" |
| A4 | An AI recommendation ("here's the move I'd make") **is** wanted — it's useful, not a betrayal of the knowledge-gated model | founder: "The idea that you are removing the thinking isn't crazy. It's just useful." |
| A5 | Fixture ticker lives on its **own tab**, not in the feed | founder: "it should probably have its own tab for fixtures" |
| A6 | Reference data (form table) becomes **feed cards**, not tables | founder: "Feed cards are also good" |
| A7 | Ships on its **own branch**, to go live when the fantasy work does | founder: "its own branch so that we can get this live when the fantasy work is completed" |

## B. It is a FEED, not a dashboard (the founder's central critique)

| # | Criterion |
|---|---|
| B1 | The feed contains **no data tables**. Every block is a content card you scroll and tap into |
| B2 | Cards are **tappable** and open their source |
| B3 | Cards carry **images** where the source has one — the founder asked for tweet embeds "for images especially" |
| B4 | Content is from **verified sources**, surfaced and credited — NOT reworded (rewording is the social pipeline's job, a different product) |
| B5 | There is a real **interaction** beyond scrolling (filters) |

## C. Data correctness (where the sharp edges are)

| # | Criterion |
|---|---|
| C1 | Fixture difficulty has an **unambiguous subject** — a match list can't say who a fixture is tough *for*. Rows = clubs, cells = that club's opponent |
| C2 | Club codes are **distinct** — MCI ≠ MUN. (A name heuristic collapsed both to "MAN") |
| C3 | Form/insight cards **lead with points** (the game's own currency, which we cannot be wrong about), not a stat line that overclaims |
| C4 | **No fabricated football facts.** The AI tips may speak ONLY from data we verified (our fixtures, our scores, our doubts) and must be blocked from using its own training knowledge — the model states stale facts as truth |
| C5 | Team news and Transfers show **different** items (they must not read the same table) |
| C6 | The hourly ingest loop is **idempotent** — re-running must not duplicate items (LOOP-STANDARD rule 4) |

## D. Engineering / prod-safety

| # | Criterion |
|---|---|
| D1 | Real `next build` passes (not just `tsc` — prod build fails on ESLint unused-imports) |
| D2 | The pages are **ISR/prerendered** — no per-user SportMonks calls on the request path |
| D3 | The persisted feed doc **outlives the code that wrote it**: a shape change must degrade to "no section", never crash the page |
| D4 | Only this feature's files are committed — no other session's WIP swept in (the tree holds 240+ dirty paths) |
| D5 | Nothing is pushed to `main`; migrations are applied by the founder, not by Claude |

## E. Impact hypothesis (stage 3 — MISSING, written late)

The framework requires a **testable prediction + the metric to check post-ship**. This was never
produced, so there is nothing to measure against later. Stated now so a post-ship check is at
least possible:

- **Hypothesis:** a fresh, verified news feed inside the fantasy section increases return visits
  in the 48h before a gameweek deadline (the FPL habit-loop window the research identified).
- **Metric to check post-ship:** sessions hitting `/fantasy/news` per active fantasy manager in
  the 48h pre-deadline window, and whether those managers make more transfers / set a captain
  more often than managers who never open the hub.
- **Confidence:** low. This is a late, ungrounded guess — exactly the failure mode stage 3 exists
  to prevent.
