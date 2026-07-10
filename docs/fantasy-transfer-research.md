# FPL transfer/wildcard research → the missing layer in YourScore Fantasy Football

*10 Jul 2026. Sources: multi-agent web research (105 agents, every claim adversarially
verified 3-vote, primary sources = premierleague.com announcements + FFScout + LiveFPL)
plus a full r/FantasyPL archive mine (complete 2024/25 season via PullPush, incl. a
100-post census of the GW37 deadline weekend). Companion to `your-pl-xi-design.md`.*

## 1. What the research established

### FPL's transfer economy (2025/26, verified)
- **1 free transfer per GW, bankable up to 5.** Extra moves cost **-4 points each**.
- FPL treats a bundle of 5 free transfers as a **near-wildcard-grade reward**: in GW16
  it topped every manager up to 5 FTs as an AFCON amnesty ("almost as powerful as a
  wildcard" — Flashscore). **Transfer grants are FPL's own lever for keeping teams
  alive through disruption.**
- **Chips doubled to 8** (two sets of Wildcard/Free Hit/Triple Captain/Bench Boost),
  first set **expires at GW19 (30 Dec)** — a manufactured use-it-or-lose-it decision
  spike at Christmas. One chip per GW → chips are **sequenced as multi-week combos**
  (the community's default: Wildcard GW35 chained into Bench Boost GW36 around doubles).
- **Assistant Manager chip was killed after half a season** — community consensus: too
  much variance. FPL removes mechanics that tip luck over skill; the community noticed
  and approved. (Design warning for us: no high-variance gimmick chips.)
- **Price changes are deliberately opaque** (±£0.1 on secret net-transfer thresholds;
  best community predictors hit ~60–70% on falls). The opacity itself sustains a
  prediction sub-industry (LiveFPL, FPL Statistics) and a **daily scheduled price
  thread all season**. FPL gets a nightly engagement loop out of a mechanic nobody
  fully understands.
- Peer-reviewed motivation research (Martin et al. 2020; FanSMI) lists **"sports
  knowledge utilization" and "vicarious manager role-play"** among core fantasy-sport
  motivations — the two things our premise fuses. The premise is validated; the
  execution layer is what's thin.

### What r/FantasyPL actually talks about (archive-measured, not vibes)
The sub is a **weekly heartbeat of scheduled threads that absorb 75–80% of all
comment volume**:

| Ritual | Cadence | Volume |
|---|---|---|
| Rate My Team / Quick Questions daily | daily, stickied | **median ~1,600 comments/day**, peak 5,872 |
| GW Rant & Discussion thread | every GW at kickoff | **4,000–8,700 comments/GW** |
| **Post-Deadline Regret Thread** | every GW, minutes after deadline | 190–425 comments — *regret is so reliable it's scheduled* |
| "50 Minutes to Deadline" | every deadline | ~250 comments in under an hour |
| Player Price Changes | **daily all season** | constant |
| "How Did ___ Play?" | every GW | post-mortem |

The dominant genre inside the daily: micro transfer decisions, verbatim — *"Play
Konaté or Milenkovic?"*, *"Isak to Watkins for free?"*, *"I'll roll the transfer
then mate !thanks"*, *"I don't like defender transfers for -4"*. Standalone help
posts are auto-removed into the daily; advice-giving is gamified with a `!thanks`
points bot.

Chip talk is the marquee strategic agonizing: *"When to use my triple captain?"*
(886 pts), *"Why your GW6 wildcard team sucks"* (674 pts), *"What are you saving it
for? 2031?"* vs *"I'd wait till GW38"*, chip-combo threads, chaser-vs-leader
psychology.

Churn/pain is itself a content genre: the canonical rage-quit (*"friend took a -64
hit instead of playing WC and quit"* — 602 pts), **dead/zombie teams** (*"Highest
ranked dead team beats 99.6% of all managers"* — 555 pts), luck-vs-skill grievances
(768 pts), template fatigue, early-season ruin (*"i quit"* posted at GW3).

**The miner's conclusion, verbatim:** *"FPL's conversation economy is ~80% decision
anxiety (transfers/captain/chips) and ~20% football itself. The genius is scarcity +
irreversibility on a weekly clock — every deadline manufactures a fresh regret. Any
competitor needs its own recurring, discussable, second-guessable decision with
visible social consequences; without a 'what would you do?' moment, there is nothing
to post."*

## 2. The gap in our current design

Today's spec: every GW → knowledge round → fresh budget → **build a fresh XI from
scratch**. There is no persistent squad. Mapped against FPL's conversation engines:

| FPL conversation engine | Our current design | Verdict |
|---|---|---|
| A-or-B transfer dilemmas (the #1 volume driver) | none — no transfers exist | **missing** |
| Bank-or-spend / take-a-hit dilemmas | none | **missing** |
| Wildcard timing debate (the marquee debate) | none — **every week is effectively a free wildcard**, which is exactly why the layer feels thin | **missing** |
| Deadline → regret arc (needs irreversibility) | deadline exists, but a full weekly rebuild means nothing carries consequences into next week — no regret with teeth, and 11 simultaneous choices produce no crisp debate | **weak** |
| Daily between-deadline loop (price threads) | nothing between gameweeks | **missing** |
| Squad ownership / sunk-cost attachment ("my team") | reset weekly | **missing** |
| Dead teams / locked-out-after-bad-start (FPL's wound) | our auto-draft floor + monthly tables + knowledge track genuinely fix this | **our differentiator — keep** |
| Template herding | per-user knowledge budgets naturally vary what people can afford → anti-template | **our differentiator — keep** |

The fresh-weekly rebuild was chosen for casual jump-in friendliness — but it deletes
scarcity AND persistence, the two ingredients every conversation engine above runs on.

## 3. The fix: knowledge earns TRANSFERS, not a weekly team

The research points at one pivot: **make the squad persistent and make the knowledge
round earn transfer power.** This is a *cleaner* version of our own premise — "your
knowledge is your transfer budget" currently means "your knowledge is your whole team,
re-rolled weekly." FPL itself confirmed transfer grants are the reward currency worth
hoarding (the GW16 top-up).

### Proposed shape (for discussion, not locked)
- **Join/season start:** build your XI once from a fixed base budget (same for
  everyone — knowledge doesn't gate entry).
- **Weekly knowledge round earns transfer power:** correct answers (difficulty-
  weighted) earn **transfer credits** — a great round = 2–3 free moves + budget
  headroom, a poor round = maybe none. Credits **bank up to a cap (~5, like FPL)**
  → bank-or-spend becomes OUR dilemma too.
- **Moves beyond your earned credits cost points** (the -4 equivalent) — or framed
  our way: *"pay for it in knowledge or pay for it in points."* The -4 debate ports
  straight over.
- **Wildcard is EARNED, not issued:** a knowledge feat (e.g. a perfect round, or a
  cumulative accuracy threshold) mints a Wildcard/Free-Hit-grade token. "When do I
  play the wildcard I earned?" = FPL's marquee debate + a bragging right FPL can't
  offer ("earned my wildcard with an 11/11"). Keep chips one-per-GW so combos/timing
  stay a multi-week plan; consider a half-season expiry like FPL's GW19 spike.
- **Daily loop replacement:** FPL's nightly ritual is passive, opaque price-watching.
  Ours can be active and on-brand — e.g. a short **daily knowledge drip that tops up
  the transfer bank** between deadlines (their price thread → our streak check-in).
  Transparent economy (we know opacity frustrates), same daily pull.
- **Keep our churn fixes:** missed deadline → squad rolls over unchanged (persistence
  makes this MORE natural, no auto-draft rebuild needed); monthly tables; and the
  comeback story becomes concrete — a dead team is never dead because a big knowledge
  round always mints the transfers to resurrect it. *FPL's biggest wound, answered
  by our core mechanic.*
- **Captaincy unchanged** (double + vice) — it's FPL's other daily argument and we
  already have it.

### What this buys us (mapped to evidence)
1. Every conversation engine in §2 flips from "missing" to "ours, with a knowledge
   twist" — including the regret thread (your transfer is now irreversible and its
   ghost follows you next week).
2. The knowledge round gains WEEKLY stakes beyond this week's XI: it feeds a bank,
   a wildcard progress bar, and your ability to react to injuries — reasons to play
   the round even on a week you'd otherwise skip (chip accrual said this weakly;
   transfer credits say it loudly).
3. Sharper social objects: "earned a wildcard", "3 banked", "took the knowledge-hit"
   are all chat-native, screenshot-native states.

### Open questions for the founder
1. **The pivot itself:** persistent squad + knowledge-earned transfers (recommended),
   vs keep weekly rebuild, vs a hybrid (persistent core XI + knowledge-earned weekly
   "loan" slots)?
2. If pivoting: does the **warm-up game stay as-is** (it teaches knowledge→budget,
   still true) — recommend yes, no change needed.
3. Transfer-hit currency: points (FPL-familiar) or knowledge-only (purist)?
4. Wildcard mint condition: perfect round (rare, dramatic) vs cumulative accuracy
   (grindable)? And adopt FPL's use-it-or-lose-it half-season expiry?
5. Daily knowledge drip: in scope for launch or phase 2?

*(Not addressed by design: FPL's team-value/price-change metagame. We could add
price movement later — but it's their most complained-about opaque mechanic, and
our transparent knowledge economy is the counter-position. Recommend: skip at
launch, revisit if the daily drip needs more pull.)*

---

# Part 2 (10 Jul, PM): Why FPL needs 15 players + what FPL players complain about/request

*Method: r/FantasyPL archive mining via PullPush (background agents hit the session API
limit, so this pass was done inline with curl — thread scores + top comments are archive
snapshots), cross-referenced with the morning's verified findings.*

## Why FPL is 15 players (2 GK / 5 DEF / 5 MID / 3 FWD, field 11)

1. **DNP insurance.** PL managers rotate; players injure/suspend. The 4-man bench
   auto-substitutes (bench order, formation-legal) anyone who plays 0 minutes. Without
   it, every surprise benching = a 0 and the game becomes lineup-news roulette.
2. **The deadline-to-lineup gap.** You lock before most lineups are known (Sat deadline;
   Sun/Mon games). The bench absorbs the unknowable. This is why leak-camping (below)
   is painful but not fatal in FPL.
3. **The construction puzzle.** Position quotas + max-3-per-club + £100m across 15 =
   playing-XI-vs-bench-strength trade-off (premium bench vs "£4.0 bench fodder").
4. **Free weekly decisions.** Bench order + captaincy cost nothing — engagement between
   transfers ("Bench 1 of Wissa Isak KDB" — live RMT quote).
5. **Chip surface.** Bench Boost only exists because the bench does.
6. **For US the clincher: the bench is what makes transfer scarcity tolerable.** With
   knowledge-earned credits, a player with zero credits and an injured striker MUST have
   a bench to route around it — XI-only + persistence + scarce transfers = forced dead
   players = rage-quit. Simple XI was fine when the team re-rolled weekly; it isn't now.
   Bonus: full-game budget becomes FPL's exact £100m/15 (warm-up's £83 XI already encodes
   "£100 minus the bench").

## What FPL players complain about / request (evidence-ranked)

1. **Deadline leak-camping + timezone unfairness.** "It's time FPL changed the GW
   deadlines to the first game's kick-off" (267pts/175c); top comment on the leaks thread
   (378pts): "so cringe having to sit there refreshing Twitter till the last seconds so
   you don't miss out on massive [team news]"; "unfair for non-Europeans — west coast
   Canada, getting up at 3am" ; FPL servers "always down" at deadline. Community is split
   on the fix (earlier vs at-kickoff), but the pain is universal: **the hour before
   deadline is hostage to Twitter leaks.**
2. **Daily price-change chore + opacity.** Same thread, 100pts: "Easily the worst part
   about this game, along with having to check the stupid price change websites every
   day." Confirms the morning finding (opacity sustains a prediction sub-industry) — it
   generates FPL engagement but is widely HATED.
3. **BPS (bonus points) injustice.** "What more do Goal Keepers have to do for BPS?"
   (498pts/120c): "Haaland bonus 3 is a joke, touched the ball about 6 times all game"
   (463); "Onana saved a pen + clean sheet and got 1 bonus" (219); "all the BPs are a
   joke" (120). A black-box bonus layer on top of real events reads as theft.
4. **Luck-vs-skill.** Top comment of the contrarian-opinions thread (478pts): "FPL is
   30% skill and 70% luck." "5% pleasure, 50% pain" (161).
5. **Template groupthink.** "This sub narrows everything down… the average user believes
   there are rules they have to follow" (98); sarcastic: "I need to meticulously copy
   the teams of thousands of other people, that's the only way I can have fun."
6. **Social formats need critical mass + built-in banter is absent.** "The only real
   negative: you need a lot of friends who play Fantasy and really care" (82). The
   loser-punishment culture ("loser keeps this trophy in his living room for a year" —
   113pts) thrives OUTSIDE the app; FPL offers no chat, stakes, or banter surface.
7. **App/stat gaps (literal petitions).** "Petition to make team IDs visible in the
   profile" (632pts); "Petition to have injuries listed in players' gameweek history"
   (396pts); watchlist requests. Third-party tools (LiveFPL, FFScout, Fix, Hub) monetize
   what the app won't build.
8. **Mental load.** "Fantasy football — Mental health and surviving the season" (492pts);
   "FPL Burnout" threads; the game is described as a second job (price checks daily,
   leak-camping weekly, 38 deadlines).
9. **FPL Draft is neglected** (players use Fantrax instead: "Fantrax scoring is
   customizable… you hate the FPL draft").
10. FPL's own 25/26 changes confirm known pain: defensive contributions (defenders felt
    pointless), two chip sets + AFCON amnesty (mid-season deadness), Assistant Manager
    killed (variance).

## What our knowledge-earns model can deliver natively (proposals)

- **Kill the price-change chore:** transparent economy, no nightly price roulette —
  position it explicitly ("no 2am price watching").
- **Kill BPS injustice:** YourScore points are deterministic from public match facts —
  no black-box bonus. The "bonus" layer in our game is knowledge-earned (captain, chips,
  credits), i.e. things YOU control.
- **De-weaponize leak-camping (the spicy one):** knowledge could EARN the right to react
  to team news — e.g. an earned "Insider" perk/chip: one post-lineup substitution. Turns
  FPL's most-hated ritual into an earned, transparent advantage. Needs care (fairness,
  scope) — founder decision.
- **Luck-vs-skill counterweight:** already ours — the knowledge rating/leaderboard means
  a brilliant round is never erased by a bad football weekend; tiebreaks by knowledge.
- **Anti-template by construction:** credit timelines differ per user, so squads diverge
  structurally; differentials are personal, not herd-defined.
- **Own the social layer FPL refuses to build:** league chat/banter wall with
  auto-generated moments ("X took a -8 and it paid off", regret receipts), stakes/
  forfeit tracker for the loser-punishment culture, workplace-league flow.
- **Cheap app wins FPL petitioned for:** watchlist, injury history on player pages,
  full stat transparency.
- **Bounded time positioning:** one knowledge round + transfers per week, no daily
  chores — "15 minutes a week, deeper if you want."

---

# Part 3 (10 Jul, late): pre-build validation tests — results

*(Scripts: `scripts/fantasy/familiarity.mjs`, `supply.mjs`; cheat-lookup done manually
via live web searches on real pool questions. Sim studies in `analysis.mjs` + artifact §08.)*

## 1. Scoring familiarity — PASS, at the theoretical ceiling
Candidate YourScore values (deterministic, no BPS, ~2.6× FPL scale, incl. our own
defensive-contribution award) scored real GW30 + GW15 raw stats:
- Spearman rank correlation vs FPL's actual points: **0.993 / 0.987** — the ceiling for
  ANY no-bonus system (FPL-minus-bonus vs FPL-total) is 0.998/0.999.
- Top-20 overlap **15/20 — identical to the ceiling**. Verdict: dropping BPS costs
  essentially zero familiarity; an FPL player's instincts transfer fully, and the 2.6×
  scale reads as our own system. Tuning note: our DC award (5) boosted Groß well above
  his FPL rank — the one dial to watch when values are finalised.

## 2. Question supply — data formats infinite; archive formats need guards
- Exact capacity from real data: higher-lower **162k (price) + 132k (goals)** valid
  pairs; this-season-form **52k + 41k** among regular starters → weekly pool rotation
  makes repeats structurally negligible for 4 of 5 formats.
- BOUNDED: classic-trivia ~50–60 total ever (26 seasons × ~2 types); career-path
  ~150–200 eligible careers; who-am-i ~300–400/season. A 314-question static pool
  would repeat 44% of draws over a season; ≥5k effective pool → ~4%.
- BUILD REQUIREMENTS: (1) weekly pool rotation (already planned via build-pool cron);
  (2) **per-user seen-question exclusion** for the bounded formats (server knows the
  user — new requirement); (3) archive formats stay a small minority per round (spec
  already says so).

## 3. Time-to-cheat per format (live lookups on real questions) → timer calibration
| Format | One-search result | Cheat time est. | Resistance |
|---|---|---|---|
| classic-trivia | instant, definitive (Henry 05/06 first hit) | ~10–15s | **weak** |
| career-path | option-check confirms via Wikipedia first hit | ~20–30s/candidate | weak–moderate |
| higher-lower (price) | got ONE price of two; needs 2nd search/tool site | ~45–90s | moderate |
| this-season-form | one player resolved, not both | ~40–80s | moderate |
| who-am-i | FAILED — clue combos aren't web-indexed; needs Transfermarkt digging | 2–3+ min | **strong** |

Implications: per-format timers (trivia/career-path short ~12–15s; comparisons ~20s;
who-am-i relaxed) — and since credits saturate (cheating ≈ worthless in fantasy points,
analysis.mjs), timer strictness matters mainly for the KNOWLEDGE LEADERBOARD, where
trivia/career-path should carry less weight or tighter timers.
