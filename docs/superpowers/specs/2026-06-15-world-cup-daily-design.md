# World Cup Daily — design spec

- **Date:** 2026-06-15
- **Status:** Draft for review
- **Owner:** (founder)
- **Mode/route:** `/38-0/wc` (World Cup game), new daily competition layer

## Summary

Turn the 38-0 **World Cup** game into a **daily, all-round competition**. Once a day, a
player drafts a **World XI** — each pick gated by a fresh football question on a timer —
and sends it through a World Cup run (group → knockouts). How far they get and their
record bank into a **season-long leaderboard** spanning the WC2026 window. The better your
football knowledge, the stronger your draft, the closer you get to a perfect **8-0-0**.

This is largely a **repackaging of the already-shipped World Cup Run + quiz-gated draft**
into a daily ranked contest, plus a practice mode, a question timer, a qualification
playoff, and a season board.

## Goals

- A daily ritual: new questions every day, one ranked attempt, a board to climb.
- Knowledge is the lever: answering well (and fast) yields a stronger XI and a better shot
  at going unbeaten.
- Authentic World-Cup feel: group stage, best-third-placed qualification drama, knockout
  penalties, a champion at tournament's end.
- Reuse the shipped engine; keep the new surface small and isolated.

## Non-goals

- National Team (nation-locked) mode — **hidden for now** (World XI only).
- Reworking H2H, YourScore Rank internals, or the async/live ladders.
- Real-calendar fixture syncing (play at your own pace within the day).

## Two ways to play

The World Cup game is **World XI only**. National Team mode is hidden in the UI (code
retained, entry points removed).

### 🏆 Daily (ranked) — one locked attempt per day
- Questions are **today's** pack (the dated `wc2026` daily quiz), same for everyone.
- Counts toward the **season leaderboard** and credits **YourScore Rank**.
- One attempt per `(user, date)`, enforced server-side. No redrafting once questions are
  revealed (answers lock in as they're shown).

### 🎮 Practice (unranked) — unlimited
- Same World XI run (same 25s-timer draft), but questions are drawn **at random from the
  back-catalogue** of WC quizzes (previous days / previous WC quiz packs).
- **Does not** touch the leaderboard and **does not** credit YourScore Rank (prevents
  infinite farming).

> Framing: users are never told they're "doing the daily quiz." To them it's the World Cup
> draft with fresh questions each day. The quiz origin is internal.

## The daily play loop

1. **Draft your World XI.** Each of the 11 picks is gated by a question on a **25-second
   timer**. Answer correctly and in time → the spin deals from a stronger overall band; a
   wrong answer **or a timeout** → weaker band + streak reset. A correct streak escalates
   quality (existing `draft-quiz.ts` engine). Timeout is treated as a wrong answer.
2. **Play the run** (existing World Cup Run engine):
   - **Group stage — 3 games.** Draws are allowed (1 pt) and a single group loss does not
     end the run. Qualification is by points (see below).
   - **Knockouts — R32 → R16 → QF → SF → Final (5 games).** A knockout **draw goes to the
     player's penalty shootout**; a knockout **loss eliminates** the player for the day,
     capped at the points already banked.
3. **Result.** A W/D/L record and the stage reached. Surviving all 8 games = **8-0-0**.

## Scoring & qualification rules

### Group qualification (after 3 group games)
Points from the group: Win = 3, Draw = 1, Loss = 0.

| Group points | Outcome |
|---|---|
| **≥ 4** | **Auto-qualify** to the knockouts (a clear top-2 finish). |
| **= 3** | **Qualification playoff** — a penalty shootout. Win → through to R32; lose → eliminated at the group. |
| **≤ 2** | **Eliminated** at the group stage (no playoff). |

The playoff shootout is a **gate, not a scored game**: it decides advancement but does not
add to W/D/L or points. A 3-pt qualifier still shows 3 group points, then stacks knockout
results on top.

### Knockouts
- Draw → penalty shootout (player-taken; existing interactive-pens feature). Shootout win
  counts as advancing; loss eliminates.
- Loss → eliminated for the day.

### Points & leaderboard math
- Per day, points `= 3·W + 1·D`. A perfect day (8-0-0) = 24.
- **Never surfaced as "you won 24 points."** Points exist only to **rank**.
- Leaderboard **displays: W / D / L / total points**.

## Authentic World-Cup explanations (UX requirement)

Every branch that sends a player to penalties or knocks them out must be explained in
real-World-Cup terms — never arbitrary. The copy uses the player's **actual** numbers.

- **Qualification playoff (3 pts):** frame via the real WC2026 rule that the **8 best
  third-placed teams** qualify. Example: *"You finished 3rd in your group on 3 points —
  level with other nations on the qualification cut-line. It goes to a playoff shootout for
  the final Round-of-32 spot."*
  - Win: *"You grabbed the last spot — into the Round of 32."*
  - Lose: *"Heartbreak — the other third-placed teams edged you. Out at the group stage."*
- **Group elimination (≤2 pts):** *"X points wasn't enough to finish in the top places or
  among the best third-placed teams. Out at the group stage — go again tomorrow."*
- **Knockout penalties:** *"Level after 90 — knockout football, so it's settled from the
  spot."*
- **Knockout exit:** *"Knocked out in the {Round}. Your run ends on {W}-{D}-{L}."*

## Season & leaderboard

- **Window:** the WC2026 tournament (~Jun 11 – Jul 19 2026). Configurable start/end.
- Each day's record **adds to season totals**. Board ranks by **total points**; ties broken
  by total wins, then fewest games/most-recent (TBD in plan).
- Displays **W / D / L / total points** per player. A **champion** is crowned when the
  window closes.
- This board is **its own competition**, separate from the H2H board and YourScore Rank.

## YourScore Rank crediting

- The **daily ranked** run's game results credit YourScore Rank like other 38-0 games
  (consistent with the existing model).
- **Practice runs do not credit Rank** and do not appear on the season board.

## Integrity

- One ranked attempt per `(user, date)` — unique constraint server-side.
- Today's **questions and opponents are fixed/seeded by date** so everyone faces the same
  test on the same day.
- **25-second** per-question timer on **every** draft (ranked and practice); timeout =
  wrong answer.
- Outcomes are **server-authoritative**; per-attempt match variance is **seeded by
  (user, date)** so a player can't re-roll for a better result.

## Reuse vs new

**Reuses (already shipped):**
- World Cup Run engine: `planWorldRun`, `gamesForStage`, `advanceStage`, group
  qualification, knockout elimination (`src/lib/draft/wc.ts`).
- Quiz-gated draft: `draft-quiz.ts` (band/streak), `wc-quiz.ts` (question pool + shuffle).
- Interactive penalty shootout (knockout draws).
- Leaderboard UI pattern + per-competition crediting RPC.

**New:**
- **25-second question timer** in the ranked draft (timeout → wrong-answer band).
- **Daily-vs-practice split** + **one-ranked-run-per-day** gating.
- **Question sourcing:** ranked = 11 questions picked at random **seeded by date** from
  today's dated pack (same set for everyone that day); practice = random back-catalogue.
- **Group qualification playoff** at exactly 3 points (penalty shootout gate) + the
  authentic explanation copy.
- **Season daily leaderboard** (cumulative W/D/L + points over the WC2026 window) and
  champion logic.
- **Rank crediting hook** for the daily ranked run only.
- **Hide National Team mode** (World XI only).

## Data model (sketch — finalised in the plan)

- A daily entry per user: `(user_id, date, squad, formation, strength, quiz_correct,
  wins, draws, losses, points, stage_reached, status, seed)`. Unique `(user_id, date)`.
- Season leaderboard = aggregate (sum W/D/L/points) over entries within the window,
  ranked by points. Reuse the existing leaderboard read/seed pattern where possible.
- Whether this extends `draft_wc_runs` (add `date`, `ranked`, daily uniqueness) or a new
  `draft_wc_daily` table is a plan-stage decision; **separate table preferred** to keep the
  daily competition isolated and the migration additive.

## Open questions / assumptions

1. **Qualification band** assumed **exactly 3 pts** → shootout; ≤2 → out. (Founder
   confirmed 3 → shootout; copy always reflects real points.)
2. **Season tie-breakers** beyond total points: assume total wins, then most recent. Refine
   in plan.
3. **Timer:** the 25s per-question timer applies to **every** draft, practice included
   (founder confirmed).
4. **Missed day:** simply no entry that day; no catch-up. (No backfill.)
5. **Ranked question selection:** the draft needs 11 questions; the daily pack holds 15 —
   pick **11 at random, seeded by date** (same set for everyone that day), not first-11.

## Verification

- **Engine/unit:** group qualify tiers (≥4 auto / ==3 shootout / ≤2 out); knockout loss =
  eliminated; pens only at knockout draws (and the 3-pt playoff); 8-0-0 = win all 8;
  points = 3W+1D; timeout grades as wrong.
- **Integrity:** second ranked attempt same day is rejected; ranked uses today's pack;
  practice uses random pool and never writes to the board / Rank.
- **Leaderboard:** season aggregate sums correctly across days and ranks by points; window
  start/end honoured; champion at close.
- **Manual (preview):** play a ranked day to 8-0-0; force a 3-pt group → see the playoff
  shootout + authentic copy; lose a knockout → capped record; verify board + Rank update;
  play a practice run → board/Rank unchanged.
- `tsc` clean; `bash scripts/draft/run-tests.sh` green.
