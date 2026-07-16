# "YourScore Fantasy Football" — a knowledge-powered fantasy football game

> **Naming (founder-decided 10 Jul 2026):** the product name is **YourScore Fantasy
> Football** (formerly "Your PL XI"). "YourScore FPL" and "YourScore Fantasy PL" were
> REJECTED for trademark/passing-off risk — never brand with "FPL" or "Fantasy PL";
> "fantasy Premier League game" is fine as a lowercase description in prose, never as
> the name. Community shorthand to seed: **"YS Fantasy"**. The route slug
> `/your-pl-xi` remains an internal code path.

## Context — why we're building this

The Premier League season is starting and YourScore needs a **big** new game. Today the
platform has **38-0** (draft team-builder + knowledge) and **Quiz** (knowledge), with a
weekly **Halftime quiz** push coming. None own the space FPL owns — the week-to-week,
squad-invested, season-long ritual that hooks football fans hardest.

Two research passes (street/short-form formats + competitor apps) plus a codebase review
led here:
- The open lane is a **weekly-habit game wrapped in identity + friends**. FotMob owns
  prediction, Sofascore owns fantasy, the web games own daily guessers — none combine the
  habit with an account, leaderboards, and friends. YourScore already has the account +
  social layer — that's the moat.
- Founder's core insight: **FPL is beloved for squad-building + season investment, but
  "there's no strategy beyond picking."** YourScore Fantasy Football *is* a new FPL — with the missing
  skill layer bolted on the front: **your football knowledge earns you better players.**

Outcome: simple to grasp (it's fantasy, with a twist), addictive (weekly ritual + season
chase), competitive (real scoring + leagues), shareable, and it rewards knowing football.

## The game — complete design (locked with founder)

A **brand-new fourth game**, weekly, tied to PL gameweeks. **Jump in any week; regulars
rewarded.** Each gameweek:

**1. Build your squad once — then your knowledge earns your transfers.**
*(PIVOTED 10 Jul 2026, founder-locked, from "fresh XI from a fresh knowledge budget every
week." Research — see `fantasy-transfer-research.md` — showed the weekly rebuild made every
week a free wildcard, deleting the scarcity, irreversibility, and squad attachment that fuel
FPL's entire conversation economy: A-or-B dilemmas, bank-or-roll, hit-taking, wildcard
timing, the regret cycle.)*
- **Join / season start:** build a **15-man squad, full FPL structure (founder-locked 10
  Jul): 2 GK / 5 DEF / 5 MID / 3 FWD, £100m base budget (same for everyone — knowledge
  never gates entry), max 3 per club, field 11 in a legal formation with a 4-man bench
  (auto-subs in bench order for anyone who plays 0 minutes).** The squad **persists week
  to week** — it's *your team*, all season. The bench is load-bearing here: with scarce
  knowledge-earned transfers, it's what absorbs rotation/injury so a zero-credit week
  never forces fielding dead players. Bench order + captaincy stay free weekly decisions.
  *(The warm-up game stays XI-only — a quick one-shot needs no bench.)*
- Each gameweek, play the **knowledge round** — position-themed challenges, **mostly
  data-generated formats** (transfer-value higher/lower, guess-from-stats, career path) that
  spin up near-infinite unique instances (solves content volume *and* answer-sharing), plus a
  **small rotated minority of bespoke trivia**.
- **Every correct answer (harder ones weighted more) earns TRANSFER CREDITS** — free moves on
  your squad. Credits climb live as you answer (the momentum); a great round = several free
  moves, a poor round = maybe none. **No speed or difficulty-choice scoring** (both invite
  cheating); a **per-question timer** runs purely as an anti-look-up guard with **zero effect
  on earnings**.
- **Credits bank up to a cap (~5 — FPL's own number)**, so bank-or-spend is a real weekly
  dilemma. **Moves beyond your credits cost points** (FPL's -4 pattern, our values) —
  *"pay for it in knowledge or pay for it in points."*
- Transfers buy at live FPL-style prices within your squad's budget; **no position lock and
  no stuck players** — any legal swap within budget until deadline lock.

**2. Scarcity is preserved deliberately (the make-or-break rule).**
- **The fixed base budget can't buy eleven elite players** — same as FPL — so squad-building
  is always a real trade-off; and **knowledge earns room to manoeuvre (transfers), never the
  best team automatically** (the ~10–15% edge).
- So **most of every XI is always value picks** — where the FPL joy lives (the cheap
  differential who outscores a superstar). Knowledge is an **edge, not an auto-win.**
- Transfer scarcity is the conversation engine: limited earned moves + banked credits +
  irreversible deadline choices = the "what would you do?" moment every week.

**2b. The simplicity doctrine (founder question 10 Jul → principle): simplify the
OVERHEAD, never the DECISIONS.**
- Research verdict: FPL users don't complain about the 15-man squad or transfers — they
  complain about the *chores* (daily price-site checks, deadline leak-camping, BPS
  disputes) and the lock-outs (dead teams). Meanwhile the decision surface IS the
  conversation economy (~80% of community talk). Cutting decisions cuts the talk.
- So we delete the chores (no NIGHTLY price-watching, no leak-camping — bench + Insider, no BPS,
  missed week = squad rolls over) and keep the decisions (transfers, captain, bench
  order, chip timing) as OPTIONAL depth — easy to learn, hard to master.
- **The LOW FLOOR (founder-locked 10 Jul).** The floor = the minimum a player must do
  each week to not fall behind or have a bad time. FPL's floor is high (nightly price
  checks, leak-camping, use-your-transfer-or-waste-it, miss two weeks and you're done).
  Ours is one small sitting: **play your knowledge round, glance at your team, done.**
- **The round is ENCOURAGED, never forced.** Skipping it is fine — your team still
  plays; you simply earn no transfer credits or chip progress that week. The game
  nudges (deadline push, chip accrual counting only played weeks), it never blocks.
- **Smart defaults after the round:** captain carries over week to week; if he's
  unavailable the **vice steps up; if both are unavailable, the best-form player**
  wears the armband. Bench order auto-sorted. Formation is emergent from your starters
  and auto-validated (FPL's own model — never an explicit 4-4-2 picker). Transfers,
  chip plays, and captain switches are optional depth on top.
- **Bounded-time constraint (locked): no mechanic may require daily attention to stay
  competitive.** Positioning line: *"FPL depth, one sitting a week."*
- The casual end of the attention spectrum is served by the PLATFORM ladder (Quiz →
  38-0 → warm-up one-shot), not by thinning the flagship — the same play FPL made with
  FPL Challenge as a separate casual mode.
- **Launch commitments from the complaint research (founder-locked 10 Jul):** league
  banter layer (chat/wall with auto-generated moments — "X took a -8 and it paid off",
  regret receipts — plus a stakes/forfeit tracker for the loser-punishment culture;
  reuses Versus/debates plumbing) · deterministic no-BPS scoring (§3) · the app basics
  FPL petitioned for (watchlist, injury history on player pages, stat transparency —
  phase 2/3 backlog) · the bounded-time constraint above.

**3. The weekend → real scoring.**
- Your XI scores from real gameweek performances, computed as **YourScore points from the
  public match facts** (goals, assists, clean sheets, minutes, cards) with our own values —
  FPL data masked as our own system (brand + legal distance).
- **Fully deterministic, no black-box bonus (founder-locked 10 Jul):** every point traces
  to a public match fact — there is NO BPS-style judged bonus layer, ever. (FPL's BPS is a
  top-tier grievance: "Haaland bonus 3 is a joke" — 463 upvotes. Our bonus layer is the
  knowledge-earned stuff you control: captain, chips, credits.)
- **Captain** doubles one player; a **vice-captain** auto-covers a captain who doesn't play.
- **Real-world variance** is the equalizer — the stacked team doesn't win *every* week.

**4. Loyalty → streak chips (across weeks).**
- **Chips are the loyalty reward** — earned by **playing ~every 4 gameweeks (cumulative, not
  consecutive)**, *not* by performance. Miss a week and you just accrue slower — no wipe, no
  grace rule needed. Deliberate: skill already earns a better squad, so chips reward the
  committed grinder and don't compound for the strong. **Same rule for everyone — no welcome
  chip; a late starter earns from zero.**
- You earn a **generic chip token**, spent as whichever chip you want: **Triple Captain**
  (biggest swing — hoard it for a double gameweek), **Bench Boost** (all 15 score — unlocked
  by the 15-man pivot; the classic chain is wildcard-into-Bench-Boost around doubles),
  **Insight** (a hint on one tricky challenge), **Second Chance** (retry your worst challenge).
- **The "Insider" (founder-approved 10 Jul, TO DESIGN):** an earned perk allowing **one
  post-lineup substitution** — the direct answer to FPL's most-hated ritual (leak-camping
  Twitter before deadline; 378-upvote complaint). Knowledge earns the right to react to
  team news. Scope to settle during design: earn condition, swap scope (bench-swap only vs
  any within budget), frequency cap (likely once per half), and whether it's a chip or a
  separate perk track. Guardrail: transparent and earnable by anyone — never sold.
- **Launch chip set stays lean (simplicity doctrine):** wildcard + the token chips above.
  No Free Hit, no cup at launch — add depth later if the season rhythm wants it.
- **Hold up to ~3, spend one per gameweek** (~8–9 a season) — scarce by design, can't
  inflate. Refunded if the entry is void; **resets each August** with the season.

**4b. The Wildcard (founder-locked 10 Jul 2026) — its own track, FPL's cadence.**
- A wildcard = **one gameweek of unlimited free transfers** — rebuild the whole XI within
  the base budget, **changes permanent**, no credits or point hits spent. One chip per GW
  rule applies; irreversible once confirmed.
- **Everyone is issued ONE per half-season, use-it-or-lose-it at the halfway deadline**
  (FPL's GW19 Christmas spike — it works, copy it). Universal because the wildcard doubles
  as the rescue tool: a broken team must never be locked out (our anti-dead-team law).
- **A PERFECT knowledge round mints ONE bonus wildcard, max one bonus per half** — the
  marquee earned moment ("earned my second wildcard with an 11/11"), capped so elite
  quizzers can't stockpile weekly (chips must never compound for the strong).
- **Further perfect rounds overflow into banked transfer credits** (top-up toward the cap)
  — FPL itself treats a full transfer bank as near-wildcard-grade (its GW16 AFCON amnesty).
- Design guardrail from FPL's own history: they killed the Assistant Manager chip after
  half a season for injecting too much variance — **no high-variance gimmick chips, ever.**

**5. Competition — its own leaderboards (a separate track).**
- **The month is the headline (founder-confirmed 10 Jul):** the monthly table is the
  default screen and the thing pushes/recaps lead with — a bad month *ends*, and a fresh
  winnable table starts every ~4 GWs. The season table sits behind it as prestige.
- **Unit = CALENDAR MONTHS (founder-locked 10 Jul over equal 4-GW blocks):** instantly
  legible (Manager-of-the-Month culture), accepting uneven sizes (Aug ≈ 3 GWs, Dec ≈ 6).
  Flow: nothing to join or re-join — when a month's last GW finalises, the winner is
  announced (reward-card + league-chat banter moment) and the monthly scoreboard simply
  starts from zero at the next GW. Squad, credits, chips, season total all carry on.
- **Primary competition = monthly tables + gameweek winners + friend leagues** (fresh
  winnable goals for everyone). The **season table sits behind them as prestige, scored
  cumulatively** — every gameweek counts, a bad week counts as-is, no arbitrary dropping.
  Late-join fairness lives in the sub-tables; the season is PL-bound and **resets each
  August**. Jump in any week.
- **YourScore Fantasy Football does NOT feed the unified YourScore Rank.** Deliberate: many users only do
  quizzes or play casually, so pumping weekly fantasy points into the cross-game rank would
  distort it and punish the non-fantasy crowd. It runs on its **own** leaderboards.
- **Tiebreak:** the week's **knowledge-round performance** (rewards the better football brain).
- **Knowledge rating + leaderboard (its own competition):** climbs purely on knowledge-round
  accuracy/streaks, with **weekly + monthly + season cuts** (mirroring the fantasy tables, so
  late joiners can win knowledge recognition immediately). Separate from the fantasy points, so
  a brilliant round is **never wasted** even on an unlucky football weekend. Also the tiebreak.
  (Name TBD — not "IQ".)
- **Season rhythm:** runs with the **PL season** (Aug–May), closing each May — off-season
  dormant (38-0 / Quiz cover the summer). During **international breaks, streaks hold (pause)**
  and resume when the PL does; no one's punished for the schedule.

## What we reuse (verified in codebase exploration)

- **Streak-gated draft** → WC Mastermind tech `src/lib/draft/wc-draft.ts`
  (`verifyRankedDraft`, `rankedQuizScore`, `DraftBand`) — adapt "quiz gates draft quality"
  → "correct answers set one freely-spent squad budget."
- **Challenge formats** → Quiz engine + `src/lib/scoring.ts`; players DB for name-the-player;
  the data feed for transfer-market + higher/lower.
- **Squad-building UI** → `src/components/draft/*` (`Pitch`, `DraftHeader`, `formations.ts`).
- **Result-reward UI + own leaderboards** → reuse the `RankRewardCard` pattern and the
  `draft_leagues`/standings + league-RPC patterns for YourScore Fantasy Football's own season/monthly/GW/
  friend tables. It does **not** write into the unified YourScore Rank (`get_yourscore_rank`).
- **Share cards** → `/s/[id]` + `draft_shares` + edge `next/og` route pattern.
- **New-game skeleton** → WC Run precedent: pure engine → server layer → migration →
  `/app/<game>` routes → `/app/api/<game>/*`.

## What we build new

- **FPL / football-data ingestion** — player prices, positions, availability, and raw match
  stats; a **weekly price snapshot taken at gameweek open** sets that week's player prices
  (prices track form week to week — no daily updates, since users draft once a week). *Unofficial
  API — use the facts as input, never brand as FPL/official.*

  > **PRICES — FOUNDER-LOCKED 14 Jul.** An earlier line in §2 read "no price changes", which
  > contradicted this paragraph and misled a build session into freezing prices. Settled:
  > **prices DO change, weekly, in line with FPL.** What we delete is FPL's *nightly* price
  > chore (leak-camping, 2am rise alerts) — not the price economy itself. One snapshot at
  > gameweek open, never daily.
  >
  > **Sell rule = FPL's own:** you sell at **purchase price + half the rise, rounded down to
  > 0.1**; a fall costs you the full drop. This is not a detail — it is the PARITY MECHANISM.
  > Moving prices with a sell-at-purchase-price rule is a slow squeeze: your fixed £100m buys
  > less every week and you can only ever downgrade. Half-the-rise lets team value climb with
  > the market, exactly as FPL managers already expect.
  >
  > **Consequence:** prices cannot live in `src/data/fantasy/pool.json`. It is a static import,
  > frozen into the build — changing a price would mean a redeploy, tying the game's economy to
  > shipping code. Prices move to a per-gameweek table, written by the gameweek-open snapshot.
- **YourScore scoring engine** — own point values on the public match stats (pure, tested).
- **Knowledge-round budget engine + free-allocation draft** — correct answers → one squad
  budget spent at FPL prices; live budget growth for momentum; anti-look-up timer (not scored).
- **Captain + vice-captain + streak-chip system** (earn/hold/spend, one free miss grace).
- **Season / monthly / gameweek tables + friend leagues** (own leaderboards, separate track).
- **Knowledge rating + leaderboard** — scores each player's knowledge-round accuracy/streaks
  in its own right; serves as the tiebreak and a parallel "best football brains" competition.
- **Streak/consistency infra** — net-new (only a notification scaffold + WC Mastermind cron
  exist today); benefits the whole app.
- **Persistence** — `gaffer_gameweeks`, `gaffer_entries` (user, gw, XI, captain/vice, streak,
  upgrades, chip), `gaffer_chips`, `gaffer_standings`, friend-league tables. (`gaffer` = the
  internal code slug; product name is "YourScore Fantasy Football".)
- **Weekly content pipeline** — ~11 challenges/gameweek, **hybrid: auto-generated from AI +
  the data feeds, then a light weekly human approval pass** (same as the daily-quiz workflow),
  themed to the gameweek, published on a PL-deadline cadence.
- **Share card + OG route** for a gameweek result.
- **Friend-league chat/banter** + **view another player's completed run** (their right/wrong
  answers, visible **after the deadline only** — safe, fuels the banter), **facts-only hints**
  (injury/form/fixture overlays), and a **season/monthly "Wrapped" recap** (reuses share-card
  infra) — from the fantasy-UX review.

## Launch strategy (go-to-market)

**Pre-launch warm-up game → funnel into the PL-season launch.** Right after the World Cup, ship
a **calendar-independent warm-up**: a 38-0-style game where a **knowledge round earns your
transfer budget**, you **draft an XI**, and the result is **simulated** (reuses the 38-0 sim
engine — no live fixtures, so it's playable *any* time). This closes the live-events onboarding
gap — a newcomer always has something to play.
- **At the end of each warm-up game**, announce **"YourScore Fantasy Football"** (the Premier League Fantasy) is
  coming: the warm-up *is* the mechanic, so explain how it'll work and prompt them to **sign up
  in advance** and **pre-form leagues with their mates.**
- **Effect:** by PL kickoff you've accumulated a **warmed-up audience + pre-seeded friend
  leagues** (the #1 retention lever) who already grasp the mechanic — then YourScore Fantasy Football goes live
  with **real gameweek scoring** swapped in for the sim.
- **Build path:** the warm-up (knowledge→budget draft + 38-0 sim) reuses existing 38-0 heavily
  (draft/pitch UI, pool, sim engine, result + share) + WC Mastermind's quiz-gating — the fast
  first ship; the full game adds live-PL scoring, tables, and chat.
- **Warm-up branding + funnel:** wears the **YourScore Fantasy Football gold** brand (builds launch recognition);
  the end-of-game funnel **A/B tests which CTA leads** — *get early access* vs *start a league*
  (reuse the already-wired **PostHog** for the experiment + funnel metrics) — with a **social-proof
  sign-up count**. New work = the funnel + advance sign-up + pre-league flow.
- **Warm-up vs full model:** the **warm-up uses per-position gating + a per-game knowledge
  budget** (each slot gated by its own question) — fine because it's a quick, low-stakes,
  *simulated* one-shot where a dud pick doesn't matter (just replay). The **full game uses a
  persistent squad + knowledge-earned transfers** (season-long, real-world, high-investment,
  where rage-quits matter). The warm-up teaches the *concept* — knowledge builds a better
  team — and **stays unchanged after the 10 Jul transfer-layer pivot**; the full game turns
  the concept into a weekly transfer economy.

## Build phasing

- **Phase 0 — spike:** ingestion proven end-to-end (prices + a gameweek's raw stats →
  YourScore points).
- **Phase 1 — playable MVP (one gameweek, single-player):** initial XI build from the base
  budget → knowledge round earns transfer credits (anti-look-up timer) → transfers +
  captain/vice → real-GW YourScore scoring → result + share. First thing a user can play.
- **Phase 2 — the meta:** season/monthly/gameweek tables, friend leagues, streak chips +
  grace, jump-in/late-join handling.
- **Phase 3 — polish:** onboarding, weekly deadline push, content-pipeline automation.
- **Test gates (from the 10 Jul validation suite):** Phase 0's acceptance test = the
  scoring-familiarity check (Spearman ≥ 0.98 on a real GW). Pre-launch checklist adds a
  **deadline-burst + feed-downtime drill** (everyone locks Sat morning; SportMonks dies
  near deadline → hold open, never lock stale). **Warm-up instrumentation is top of the
  launch-prep list** — completion/drop-off/replay + the REAL accuracy distribution,
  which recalibrates every provisional number above within minutes of the warm-up going
  live.

## Weekly operation & edge-case register

**Cycle:** gameweek opens → knowledge round (open from early in the week) earns transfer
credits → make transfers & set XI/captain → **deadline = FPL's convention (founder-locked
10 Jul): 90 minutes before the gameweek's first kickoff, derived from the SportMonks
fixture calendar** (usually Sat morning; moves with Friday/midweek fixtures — users'
FPL muscle memory transfers) → matches & scoring → results & standings → repeat.
*(Persistence makes missed weeks graceful: the squad simply rolls over.)*

- **Participation / missed deadline:** miss the deadline → **your squad rolls over
  unchanged** (captain/vice persist; vice covers as usual), so you always score — no auto-
  draft rebuild needed, no flat 0. A rolled-over week **counts on the season table but not
  toward chip accrual** (you didn't genuinely play), and **earns no transfer credits** —
  though your banked credits keep. Abandon a round mid-way → resume before deadline. Late
  join → build your XI from the base budget, in from the next open GW (or this one if
  before deadline).
- **Round integrity:** transfer credits = your correct answers (harder weighted more);
  broken/disputed question voided (no credit penalty). Anti-look-up = per-question timer (not
  scored) + per-user question variation + rotating pools + server grading.
- **Squad & transfers:** 15-man FPL structure (2/5/5/3, £100m, max 3/club); shared
  ownership (anyone can pick anyone); injury/rotation flags from the feed; transfers at
  FPL-style prices within the squad budget — no stuck players, any legal swap until lock;
  **credits bank to ~5; extra moves cost points**; **auto-subs in bench order** for 0-minute
  players (GK↔GK, formation-legal — copy FPL's rules); price only *predicts* points
  (fixtures/form/blanks), so value overlaps and picking stays a real skill.
- **Captain & chips:** captain doubles, **vice covers a benched captain**; if no captain
  is set (or last week's is gone), the default chain is **carry over → vice steps up →
  best-form player**; one chip per GW; chip refunded if the entry is void.
- **Scoring & fixtures (match FPL):** YourScore points from public facts, finalised after all
  GW games + bonus; player DNP → 0; **postponed player scores 0 that week; the rescheduled
  match scores in the double gameweek it's actually played** (blanks & doubles inherited from
  the official structure); stat corrections re-scored within a window then locked.
- **Competition:** season + monthly + gameweek + friend leagues (own track, not unified
  Rank); **tiebreak = knowledge-round performance**.
- **Loyalty:** chips accrue every ~4 gameweeks **played** (cumulative, not a streak); the
  knowledge round itself is scored by correct answers → budget (no in-round streak).
- **Data/ops:** feed downtime near deadline → hold open, never lock stale data; season price
  reset; bad auto-question caught by the weekly approval pass.

**All six audit decisions resolved:** (1) postponed/blank/double GWs → match FPL; (2) Rank →
separate track (does not feed unified YourScore Rank); (3) anti-look-up → non-scored timer +
pool variation; (4) vice-captain → yes; (5) cross-week streak → one free miss; (6) tiebreak →
knowledge-round performance.

## Validated defaults & requirements (10 Jul — simulation + test suite)

*Provisional numbers recalibrate on the warm-up's REAL accuracy data.*

1. **Credit curve (launch default, kinder floor — founder 11 Jul after playtest):**
   3+ correct → 1 · 5+ → 2 · 7+ → 3 · 9+ → 4; bank cap 5. (Was 5/7/9/11→1/2/3/4;
   4/11 earning nothing felt punishing in playtest.) Re-measured: elite-vs-casual
   edge 16.4% (was 17.3% — still healthy), casual dead-slots 0.13 (better, was 0.17),
   point-hits 11/season (was 46 — casuals now fix problems without hits). Flat top
   (elite≈solid) holds, so answer-lookup stays worthless (cheat resistance intact).
2. **Scoring: lock the METHOD.** Deterministic no-BPS values validated at the
   familiarity ceiling on real gameweeks. Acceptance test forever: final values must
   hit **Spearman ≥ 0.98 vs FPL actual** on real GWs (`scripts/fantasy/familiarity.mjs`).
   Scale ~2.6× FPL; the defensive-contribution award is the sensitive dial.
3. **Timer: ONE uniform countdown** (founder 10 Jul — per-format lengths feel broken).
   Parked option if cheating bites: reveal the question stem first, clock starts on the
   full reveal. Quiet mitigation available without UI change: googleable formats
   (trivia ~10s to look up, career-path ~25s — measured) can weigh less on the
   knowledge leaderboard; who-am-i measured cheat-resistant (2–3+ min).
4. **Per-user seen-question exclusion (build requirement):** trivia (~50–60 possible
   questions EVER) and career-path (~150–200) repeat within a season without it.
   Comparison formats are effectively infinite (~386k clean pairs) with the weekly
   pool rotation already planned.
5. **December wildcard nudge (product requirement):** ~22% of simulated managers let
   the first-half wildcard expire silently at the halfway deadline.
6. **Congestion rescue lever:** when the REAL fixture calendar (from SportMonks —
   never assumed; no AFCON touches 2026/27) produces a mass-absence or congestion
   window, the standing remedy is a one-off transfer top-up (FPL's proven AFCON-2025
   move). A config flip, not a redesign.
7. **Evidence on locked calls:** monthly competitions — in a 10-person league players
   are alive for the month 37–52% of all weeks and reset to alive monthly; chips —
   involved in ~19% of monthly titles (drama, not the decider; "let it ride" holds).
7b. **CASH-OUT: credits → points (founder-locked 14 Jul).** The hole this fills: the round's
   only payoff was transfers, so a manager happy with his team earned **nothing** from a perfect
   11/11 — and at the credit cap, literally zero. The game's own differentiator was optional and
   unrewarding. Now knowledge is always worth something; you just choose the form.
   - **Uncapped, and OVERFLOW-ONLY**: credits cash out only when the round mints more than the
     bank can hold. Nobody drains a bank they might want — the transfer stays the better deal
     and cashing is the consolation, which is the point.
   - **A cap was tried and rejected.** It restores cheat-resistance, but it makes 3 correct pay
     the same as 11 — the round loses its reason to exist past the third question. The founder
     killed it: *"then what's the point of completing the eleven questions?"*
   - **Cheating goes positive and that is ACCEPTED (founder, 14 Jul):** measured +6.0% at rate 4.
     The structural reason is worth knowing — the round is cheat-proof today *precisely because*
     credits are worthless to someone who won't transfer. That is the same property that made the
     round pointless for a settled manager. One coin, two faces: **any accuracy→points path pays
     cheating.** Founder's call: *"People aren't gonna cheat every single week... It's too much
     work."* 11 lookups × 38 weeks, with who-am-i measured at 2–3 min each.
   - The cash-out is the garnish, **not** the answer for the settled manager. The **knowledge
     rating** (§5) is: a real table, climbing on accuracy alone, that can't distort a fantasy
     title no matter who cheats it.

8. **Economy regression suite:** any change to any economy number re-runs
   `scripts/fantasy/season-sim.mjs` + `analysis.mjs` (redteam/chaos/sense/hope).
   Invariants: no strategy beats honest play (hoarding −12%, deliberate skipping −9%,
   hit-spam ≈ 0, cheating ≈ 0, late-join never optimal, casual floor ≤ ~0.2 dead
   slots/wk under the default curve).

## Open items (tuning, settle during build)

- **Transfer economy numbers (measure, don't estimate — use a measure.sh-style harness):**
  base XI budget; correct-answers→credits curve (how many rights = 1 free move; can a poor
  round earn zero); credit bank cap (default 5); points-hit size; wildcard half-season
  expiry dates; what "perfect" requires if a round has variable question counts.
- **Daily knowledge drip** (a short daily top-up challenge feeding the transfer bank — our
  answer to FPL's nightly price-change ritual): phase 2 candidate, not decided. NOTE it
  must respect the bounded-time constraint — a bonus for those who want it, never required
  to stay competitive.
- **Insider perk scoping** (see §4b): earn condition, swap scope, frequency cap, chip vs
  separate track.
- **Round encouragement/nudge tuning:** deadline-push timing, skip-week messaging
  ("your team plays on — come earn your transfers"), how chip accrual framing rewards
  played weeks. Encourage, never block.
- **Bench/auto-sub tuning:** default bench-order suggestion, £100m/15 economy re-measure
  (the warm-up's measure.sh pattern) once the credit curve exists.
- Exact upgrade-cap number, streak→tier curve, chip earn rate, timer length.
- YourScore point values (calibrate to feel familiar vs deliberately different).
- **Balance targets (from simulation):** tune the premium-vs-standard scoring gap so knowledge
  is a **~10–15% season edge** (real, but any week still live); **Triple Captain on doubles =
  let it ride** (big dramatic swings allowed).
- Formation options (fixed vs choosable); minimum batch sizes per position.
- Weekly content authoring load (bespoke vs generated mix).
- Branding kept visually distinct from the official PL (no official marks/colours), since
  "PL" leans on the association.

## UX principles & social (from the FPL / Sleeper review)

Steal the ritual + pitch metaphor + mini-leagues; avoid FPL's 2025 redesign sins —
**reliability at the deadline is sacred, never make users hunt for the core action, one obvious
CTA per screen, don't break familiar patterns.** Design for **micro-check-ins** (people glance
several times a day) — the live-scoring home hub is built for this.

New, locked from the review:
- **Friend-league chat / banter** — Sleeper's killer retention lever; the mate-group becomes the
  reason to return. (New build + light moderation.)
- **Personality in notifications** — timely and personal ("your captain hauled 24", "Priya
  overtook you"), never generic.
- **Facts-only hints** — surface injuries / form / fixtures / availability so picks are
  informed, but **never auto-suggest the optimal pick or captain** (knowledge stays the edge).
- **Season/monthly "Wrapped" recap** — personalised, shareable ("what kind of manager are you"),
  reusing the share-card infra — a growth loop.

## Data & media providers

- **Football data + crests → SportMonks** (data is commercially licensed; €29–249/mo, self-serve;
  fixtures, stats, players, crests across the app). Crests used for identification.
- **FPL feed → the app's PRICE source** (SportMonks doesn't carry FPL's price economy). Pull
  `bootstrap-static` (prices, positions, availability).
  > **SUPERSEDED 14 Jul — scoring source is SportMonks, not FPL.** This section originally made
  > `event/{gw}/live` the live-scoring source too. What shipped instead: per-player stats come
  > from **SportMonks Match Facts**, baked `smId` → `fantasy_player_scores` → `values.ts`. It was
  > proven end-to-end first (Spearman **0.993 / 0.987** vs FPL actual, top-20 overlap 15/20 — the
  > familiarity ceiling), and it keeps ONE feed for both scoring and the fixture calendar. FPL
  > remains the price source only. The code is right; this paragraph was stale.

  `fixtures` (doubles/blanks), and per-player stats → our own YourScore
  points. **Cadence:** snapshot prices/fixtures/availability at gameweek open (+ a near-deadline
  refresh for late injuries); poll live stats over the weekend showing **live provisional scores
  that lock to final once the gameweek is `data_checked`** (bonus confirmed). **"In full every
  week" guardrails:** validate each pull (player/team counts, no nulls), **never overwrite the
  last-good snapshot on a bad/incomplete fetch**, alert via the existing health-check/Telegram
  monitor, manual override if FPL breaks, and re-baseline at the **Aug season reset**. The owned
  DB snapshot means a transient outage never breaks a gameweek.
- **Player photos → ship SportMonks' images now, risk accepted (founder's call).** SportMonks'
  terms class its images as non-commercial, but the founder is comfortable using them during
  validation and only paying for a licensed provider (Sportradar Images / Getty) *if* a takedown
  is ever requested. **Mitigation is built in:** the UI's **headshot slot + stylised fallback**
  makes a takedown a config flip, not a redesign — so keep photos easily swappable. Guardrail: be
  more cautious using player photos in **paid-ad creative** (higher visibility/risk than in-app).

## Visual identity

**Gold on deep pitch** is the signature (alongside 38-0's lime and Quiz's teal). Premium,
broadcast-graphic register — deep pitch-green / near-black surfaces, **gold = earned/reward**
(the premium tier you unlock, the armband, the lock CTA), bold matchday-condensed headers. One
consistent premium **"gate" frame** wraps every challenge format (higher/lower, guess-the-
player, grid) so the varied mini-games read as one classy family — the 38-0 gated-pick feel,
never a flat quiz.

## Monetisation (later — retention first)

Not a launch concern. The immediate goal is to **validate that players accumulate and return
weekly**, not to earn. **Hard rule: never pay-to-win** — chips and every advantage are only
ever **earned by playing**, never bought; ads never touch the tables or points. Eventual model:
- **Sponsorship** — sponsored gameweeks / branded leaderboards / sponsored challenges
  (brand-safe, non-intrusive) — the premium lever. **Fee basis = impressions × CPM** (weekly
  players × ~4 touchpoints = impressions; engaged endemic football audience commands a premium
  ~£10–30+ CPM). Value scales with the user base — a grow-first lever; start with a cheap
  "founding sponsor" for a logo + case study, then price up.
- **Interstitials at natural transitions** (post-round, results) + **banners** in non-gameplay
  areas.
- **Rewarded video only for non-competitive perks** (cosmetics, a fun replay) — never
  chips/budget/points.
- Kept **light until retention is proven**, so ads don't throttle early growth.

## Retention & growth

- **North-star:** **weekly players who complete a gameweek** (play the round + lock a team) —
  the clearest read on "accumulate + consistent weekly use".
- **The lever:** an **active friend league** is the biggest retention predictor — the warm-up +
  onboarding pre-seed leagues; watch the in-league vs solo retention gap.
- **Retention loops:** within-week (Tue open push → build + league banter → Sat deadline reminder
  → weekend live scoring → view mates' runs → Sun recap); week-to-week (deadline ritual, chip
  accrual, rivalry nudges, monthly reset, knowledge rating); season (table chase, Wrapped).
- **Growth loops:** squad + gameweek share cards, monthly/season Wrapped, friend-league invites
  (the K-factor), view-runs banter. The **post-WC warm-up** is the top-of-funnel that accumulates
  the audience + pre-forms leagues before kickoff.
- **Activation funnel to instrument:** first visit → first round played → first team locked →
  joined a league (the lever) → returned GW2 → 4+ consecutive GWs (habit). Leading indicators:
  first-round completion, team-lock, and league-join in week 1.
- **Nudge caveat:** native push is mobile-gated in YourScore today, so the web build leans on
  email / web-push for deadline reminders until the mobile app.

## Gate formats & content base

The gate library serves **both** games (warm-up + full). Rule: **mostly data-generated**
(infinite unique instances → volume + anti-cheat) + a **small authored minority**.

**Initial clean base (build first) — the core data-generated four:**
- **Higher or Lower** — pick the bigger stat (value / goals / apps / age).
- **Who am I** — name the player from position / club / nationality / stat clues.
- **Career path** — name the player from a run of clubs.
- **This-season form** — who's hotter / more goals this season.

**Later formats:** Odd one out, Rank these, Guess the club (crest), Guess the player (photo),
classic trivia (authored / AI + human approval, reusing the daily-quiz pipeline).

**The generator (keeps the base big *and* clean):** one engine produces instances from
SportMonks + FPL data — each = prompt + options + a **verifiable correct answer** + a
**difficulty score** (fame/ownership + value closeness) + tags (format, position). **Validation
gates = "clean":** reject Higher/Lower near-ties, reject "Who am I" clues that fit more than one
player, reject stale data — exactly one unambiguous answer per question (a bad question dents
trust and, in the real game, a budget). A large generated pool gives **per-user variation** (the
anti-cheat); difficulty tiers serve easy→hard and weight the budget.

## Gate generator (build blueprint)

**Pipeline:** data store → per-format generators → validators → difficulty scorer → pool →
per-user serving (server-graded).

- **Data:** players (name, position, club, nationality, age, photo), season + career stats,
  market value + FPL price, **transfer history** (ordered clubs), **FPL ownership %**, fixtures.
- **Fame/difficulty index (linchpin):** a per-player "how well-known" score from ownership % +
  price + apps — drives difficulty (obscure = harder) *and* keeps easy questions on famous players.
- **Generators + clean validators:** Higher/Lower (reject near-ties, no nulls); This-season form
  (reject ties, require regular starters); Who-am-I (**reject clue sets that fit >1 player** +
  plausible distractors); Career path (reject sequences shared by >1 player, complete data).
- **Difficulty:** scored from fame + closeness/clue-count → serve easy→hard, **weight the budget**.
- **Serving/anti-cheat:** big pool → seeded-different subset per user per gameweek; **server-side
  grading, answer never sent to client**; regenerate each GW; dedupe; **tag by position** (warm-up
  gates).
- **Build order:** ingest → fame index → Higher/Lower → This-season form → Who-am-I → Career path
  → serving layer.

## Verification

- **Ingestion:** fetch prices + a gameweek's raw stats; assert they parse and produce sane
  YourScore points for a known past gameweek.
- **Loop e2e:** with a signed-in QA account (`hc` / `hc2`), play the round → draft an XI
  (verify streak raises tiers + capped upgrades + timer) → resolve against a **known past
  gameweek's real stats** → verify the YourScore score, captain/vice doubling, and share card.
- **Pure engines** (`node --test`) for the scoring and the streak/upgrade draft logic,
  data-free like `wc.ts`.
