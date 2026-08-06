# YourScore — Master Definition (Single Source of Truth)

> **This is the canonical definition of what YourScore is.** When anything in this repo
> or in conversation conflicts with this document, **this document wins.**
> `PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md`, `DRAFT-XI.md` and
> the old `~/Downloads/*build-doc.md` files are historical/subordinate — read them only
> for detail this file points to, never as current scope.
>
> **Confirmed:** 2026-08-06 (**League Games Hub shipped: Games tab in every league, live games leaderboard, hub module, history results, action badge — see Recently Shipped top entry. Same day, challenge engine COMPLETE: lifecycle, Quiz Duel + Gameday adapters, rematches, result actions — see the three Recently Shipped entries. Adapters Phase 3B shipped: Quiz Duel and Gameday Quiz playable as challenges, game picker in the challenge sheet — see Recently Shipped top entry. Same day, Challenge lifecycle Phase 3A shipped: one-tap accept,
> cancel, quiet decline, server-derived results posting into league chat, challenge
> messages + rate limiting — see Recently Shipped top entry. Same day: video/photo
> upload unblocked in prod (CSP + missing bucket policies).** Earlier: **Native video shipped across Social: uploads, inline +
> fullscreen playback, video in replies and league chat, YouTube embeds and rich video
> previews, football-context combos — see Recently Shipped top entry.** Same day:
> **People layer shipped, all 3 phases: structured @mentions
> with member-first chat autocomplete, the shared member action sheet + members list +
> squad compare, and the challenge foundation (member_challenges, mig 255 applied; Quiz
> Battle invitations live end to end) — see Recently Shipped top entry.** Prior confirm
> 2026-08-05: **Penalties feature RETIRED + La Liga competition RETIRED — both removed completely, see Recently Shipped top entry.** Earlier same day: **Postgame fantasy promo shipped — interstitial pop-up + inline card at every game end, see Recently Shipped top entry.** Same day: **Social Phase 3b (bookmarks/mentions/notification tabs/profile tabs, mig 251 applied) + Phase 3a (post detail + reposts + quotes) + Phase 2b (links + poll durations + player/fixture attachments, mig 250 applied) + Phase 2a rich media + Phase 1 visual upgrade shipped — see Recently Shipped.** Prior confirm 2026-08-04: **FPL-Twitter feed pass: bot personas, quiz results in the feed, Twitter-grammar cards.**
> The fantasy feed (Social → Live) now reads like an FPL-Twitter timeline. (1) **Cards use Twitter grammar** —
> BOLD screen name, muted non-bold `@handle` (hydrate now resolves `profiles.username`), time inline after a
> dot, and a **⋯ overflow menu** on every card (Share post → the existing multi-channel sheet, Copy link,
> View profile, Invite to a league — invite moved out of the action row so it breathes like a tweet's).
> `SharePost` gained a controlled mode (`open`/`onClose`) so both the inline Share and the ⋯ menu drive one
> sheet. (2) **New feed kind `quiz_result`** (mig 248): emitted on a strong Football Quiz finish (≥70% on a
> 5+-question pack, `/api/quiz/solo-complete`) and a strong knowledge round (≥7/11, `stepRound`); renders a
> score card ("9/10 · pack title") with a "Beat it ›" door to `/play` or `/fantasy/round`. (3) **Posts can
> embed a player card** (`postToFeed` accepts `playerId`, payload.player renders the same tile as shortlist).
> (4) **16 bot personas** (`src/lib/fantasy/botContent.ts` — Template Tim, Knee Jerk Kev, FPL Nan, Banter FC…)
> with a pre-season-safe content library (takes/polls/player spotlights/banter/quiz brags; opinions only,
> never invented results or news). Accounts created by `scripts/fantasy/bots.sh` (profiles `source='bot'`,
> `is_seed=true` → excluded from standings, one-query teardown); an hourly cron `/api/cron/fantasy-bots`
> (`runBotTick` in `src/lib/fantasy/bots.ts`) posts 0–2 moves per tick with 3h persona cooldowns + payload.k
> dedupe, reacts to recent items (real users first) and votes on open polls. `bots.sh` also has `--backfill N`
> (36h of warmed-up content + engagement), `--seed-handles` (usernames for the 50 old seed accounts, which
> were created handle-less) and `--teardown`. NOT yet run against prod — needs mig 248 applied + the script
> run locally; the cron goes live on merge.)
>
> **Previously confirmed:** 2026-08-04 (**"Rate your FPL team" signed-out screenshot funnel shipped to prod.** A public
> acquisition surface at `/fantasy/rate` (hero on the signed-out Fantasy home): a visitor uploads a screenshot
> of their FPL Pick Team screen, Claude VISION reads the 15 players (name + club off the kit + position +
> captain/vice), a pure club-aware matcher (accent/ligature folding, Spurs/Tottenham alias) resolves them to
> our pool, they confirm the XI on a real pitch (tap a player to change/captain/vice/bench), and the Scout
> grades it with the same score + strong/decent/weak bands + one-line verdict a member gets, with NO account.
> A 3-card "how it works" beat (league chats, monthly prizes, earned transfers) plays before the reveal, then
> a "create your account and save it" CTA writes the 15 to the `ys-fantasy-draft` key the builder restores.
> New routes `/api/fantasy/rate-photo` (vision, per-IP + global daily caps, image never stored) and
> `/api/fantasy/rate-guest` (grades ad-hoc ids, zero DB writes). Verified end to end on a real screenshot:
> 15/15 high-confidence match, model-written verdict. Commits `0d23495`..`f1e7939`. Same session the Rate My
> Squad verdict was fixed to name players not recite numbers, so both surfaces now show a real AI line.)
>
> **Update (same day):** the analysis now ends on a shareable page `/r/[id]` — the single end page for BOTH an
> uploader and a future Twitter bot. It carries a share row (native sheet on mobile / copy link / X / WhatsApp)
> and an auth-aware save CTA: create a free account when signed out, save to the account when signed in, or
> keep/replace when a squad already exists. New `/api/fantasy/rate-share` grades AND persists server-side (so a
> shared "rated by the Scout" score can never be client-faked) into the `fantasy_rate_share` snapshot table;
> `/r/[id]/opengraph-image` is the per-team "Scout's Report" unfurl (real score + verdict + strong/risk/move on
> the left, the analysed squad with player portraits + bench + grade on the right). The upload flow at
> `/fantasy/rate` no longer shows an inline result — it redirects here after grading. Commits ..`18a8bb0`.
>
> **Update (same day):** the Scout rating's two horizons are now **August ｜ Next 5** (was
> Month ｜ Season). A season-long score never made sense once fantasy shipped a transfer every
> gameweek — the fifteen being rated won't exist in that form for long. Both horizons now read
> the SAME fixture-run signal (`computeSFixRun`) and diverge only by weight: NEXT5 leans harder
> on fixtures (0.45) and less on projection/balance than MONTH (0.35). The MONTH tab's label and
> copy are computed from the real calendar month (`currentMonthName()`), never hardcoded
> "August" again. `FIXTURE_LOOKAHEAD` bumped 3→5 so NEXT5 genuinely covers five games (the
> upstream ticker already builds 5 GW windows; this was the one place still truncating it).
> Applies everywhere a rating renders: `/fantasy/rate`, the member Scout card, and the `/r/[id]`
> share page. Commit `180ce9b`.
>
> **Previously confirmed:** 2026-08-04 (**"Rate My Squad" AI shipped to prod, founder-gated.** A one-tap read on the
> Fantasy Scout's "Your Squad" surface: a 0 to 10 SCORE computed 100% in code from our own data
> (projected points, availability, next-GW fixture difficulty, balance/budget, differential mix), plus an
> AI-written verdict + strength/risk pills + one suggested move. The AI never invents the score and never
> uses its own football knowledge — it only rephrases a facts payload we built, through the same grounding
> gate as `tips.ts`/`scoutPicks.ts` (every name/number must trace or the field drops to a code template;
> no key or grounding failure still renders the full deterministic score). Cached per squad-hash so a
> re-open bills nothing; recomputes only on a squad change, a newer snapshot, or a "fresh take" (3/day),
> all under a per-user daily compute cap. New `squadRating.ts` + `/api/fantasy/squad-rating` + `SquadRating.tsx`;
> migration **247 APPLIED to prod**. Commit `09925dd`.)
>
> **Previously confirmed:** 2026-08-02 (**Avatar photo upload FIXED + unified with the picker.** Branch
> `fix/avatar-upload`, migration **241 APPLIED to prod**.
> **The bug:** the `avatars` storage bucket had NO policies on storage.objects — RLS is on, so
> every authenticated upload was denied. The Settings "change photo" flow has been broken since
> launch: **0 of ~10k profiles had ever uploaded a photo** (working avatars are all preset SVGs
> or external Google URLs). Proven with a real user token — same upload returned **403 "new row
> violates row-level security policy" before, 200 after** the fix; a cross-user path stays 403
> (writes scoped to `<uid>.<ext>`), public read 200.
> **The unification:** tapping your avatar only offered preset players; Settings only offered
> (broken) upload. Now there's ONE `AvatarPicker` — "Upload a photo" button + the player catalog
> + "use my initial" — and **Settings renders the same component**, so both flows are identical
> and both work. Shared `uploadAvatar()` helper (`src/lib/avatarUpload.ts`, 5 MB cap, image-only).
> ⚠️ Note: changing the avatar via the card-overlay updates the DB but the card's SVG face only
> refreshes on reload (pre-existing; the card avatar is server-rendered) — Settings updates live.)
>
> **Previously confirmed:** 2026-08-02 (**Versus promo tile at the top of the Play tab.** Versus lost its
> bottom-nav slot when Fantasy took the fifth tab, and a full app audit the same day measured the
> cost: 7 friend challenges and 34 new friendships in 30 days — the social layer had no door.
> Founder call: not a nav change; an ad tile instead. First content element of the Solo view on
> `/play` (above the Gameday rail, hidden on the Build a Quiz sub-tab which leads with its own
> CTA): a big ad banner — eyebrow "⚔️ TIME TO PLAY", display heading "VERSUS / PLAY WITH
> PEOPLE" (34px, lime + white), subline "Find an opponent now, challenge a friend or battle for
> your league", lime "FIND A RIVAL →" pill → `/versus`. Aria-labelled, whole banner tappable,
> in `src/app/play/page.tsx`. Verified in-browser at 375px: renders above the fold, tap lands
> on the Versus hub. Founder sized it up from a slim tile to the banner same day.)
>
> **Previously confirmed:** 2026-08-01 (**Profile Fantasy tab → "Fantasy PL", now with a world rank and a
> weekly streak.** Branch `feat/fantasy-pl-profile`, migration **238 APPLIED to prod**.
> The tab is renamed **Fantasy PL**, and above the XI-by-gameweek pitch it now shows real detail:
> a **world rank** ("#8,421 of N managers · 214 pts") and a **fantasy streak** = consecutive
> gameweeks you locked a squad, plus gameweeks-played and season points.
> **New `get_fantasy_world_rank(user)` RPC** — the FIRST global fantasy-points ladder (nothing
> ranked all managers by points before; only league-scoped ranks and a knowledge-accuracy board
> existed). Ranks managers by summed `fantasy_entries.points`; a manager is on the ladder only
> once they have SCORED points. **Honest pre-season:** GW1 is 21 Aug, nobody has points or a
> locked gameweek yet, so the RPC returns a null rank and the UI shows "Unranked — season
> starts 21 Aug" and "streak starts GW1" rather than a fake #1-of-everyone. It all populates the
> instant scores land — verified by scoring two real users in a rolled-back transaction (80pts
> → #1) and by a sim preview. Streak logic is a pure helper (`src/lib/fantasy/streak.ts`,
> 8 unit cases). Still gated by `fantasyAllowed()` — dark to real users until launch.)
>
> **Previously confirmed:** 2026-07-30 (**Profile tidied — Games vs Fantasy tabs, a real award cabinet.**
> Branch `feat/profile-tabs`. The page was one long scroll that mixed everything; now the
> shared identity (player card + YourScore rank + ladder) stays on top, and a **Games ｜ Fantasy**
> tab bar splits the stats underneath — some players are here for 38-0/quiz, some for Fantasy,
> some both. **The Fantasy tab is gated by the SAME `fantasyAllowed()` flag as the rest of
> fantasy** (env-on or allowlist), so real users don't see it until fantasy launches; it reuses
> the existing `ProfileFantasyTeams` (XI-by-gameweek) and shows a "build your squad" state when
> empty. There is no honest pre-season rank/points, so the tab is the squad only.
> **Awards overhaul:** the weak six-tile cabinet is now a compact "best few + N more" row that
> opens a full modal — all 25 medals grouped, **earned lit and locked visible with dashed
> borders**, and **tapping any medal explains it** (what it rewards, rarity word, your progress /
> what it takes). **Removed the Recent Games list** (founder: not important) and its dead
> component + query. New: `ProfileTabs`, `MedalsModal`; `MedalShelf` rewritten client-side.
> Verified in-browser against a real squad-holder: tabs switch, awards modal + explainers work,
> the Fantasy XI pitch renders with real faces/crests. `next build` green.)
>
> **Previously confirmed:** 2026-07-30 (**Fantasy nav + UX overhaul shipped to prod, founder-gated.** The Fantasy tab
> now wears a PL-style header — a big **"YourScore Fantasy PL"** title + a segmented **Squad ｜ Scout ｜
> Leagues** section bar (`FantasyHeader`), rendered identically on the hub and every Scout page so
> switching reads as a tab, not a page jump (retired the old wordmark Header + the Scout back-pill
> masthead; **Leagues is now a top tab**, not a tile). The **Scout page has a cover** — a teal-on-pitch
> tactical **radar** (`ScoutCover`): rings/crosshair/rotating sweep/blips, the four face blips are the
> live most-owned players (real headshots), NEXT FIXTURES is the top club's real run, "YourScore Scout"
> heading overlaid. The **player profile is tabbed** — Overview / Fixtures / Stats / Updates. **How It
> Works** is now a chronological numbered walkthrough (Build → Captain → Deadline → Prove-you-know-football
> → Bank moves → Chip → Score → Tables) over the engine-backed reference tables. The no-squad **hero**
> dropped its redundant eyebrow and gained real premium faces; the **Shortlist** rows are bigger with real
> headshots; the **Sheet** clears the BottomNav; both shells pad the iOS safe-area insets. Commits on
> `main`: `e4b1dfa`, `250afc4`, `9c9073a`, `c71bdc8`, `693b1f6`, `153b531`, `725844b`, `e1dfaf3`.
> Previously confirmed 2026-07-30:** **Scout visual + data pass shipped to prod, founder-gated.** Real SportMonks
> headshots now render across every Scout surface (Players rows, Comparison, Four Picks, Player profile,
> Briefing editorial cards) via `avatarUrl`/`faceUrlById` instead of the sparse name-keyed `faceFor`. The
> **player profile now shows real stats pre-season**: with no current-season match yet, it pulls last
> season's totals from FPL `bootstrap-static` (labelled e.g. "2025/26") + FPL's `ep_next` projection +
> availability, and flips to live per-GW rows once GW1 is played (`buildPlayerProfile` gains
> `preseason`/`lastSeason`/`projection`; pool id == FPL element id). The **Compare picker** gained the full
> Players-tab filters (position/availability/sort + count) so picking side two keeps the browse. **"Where
> to start"** is a formation spine (FWD→GK, faces + price). Briefing **Captaincy Call / Differential** cards
> show the player's headshot (surname match against the pool, single confident match only). The **Sheet**
> was lifted above the BottomNav (z-60) and both fantasy shells now pad `env(safe-area-inset-top/bottom)`
> so the back pill clears the status-bar clock and content clears the nav. Commits on `main`: `e4b1dfa`,
> `250afc4`, `9c9073a`, `c71bdc8`. Previously confirmed 2026-07-29:** Fantasy "Scout" research hub shipped to prod, founder-gated. The Fantasy
> tab's research area, reached by a persistent `Squad | Scout` sub-tab (`FantasySubNav`) that shows in
> every state including no-squad, so a manager can research before building. Scout carries its own tabs
> — Briefing / Players / Shortlist. Facts-not-verdicts throughout: **Squad Update** (FPL availability
> feed), **Player profiles** + **Players browser**, **Shortlist** (`fantasy_shortlist`, mig 219),
> side-by-side **Comparison**, named **Scout Report** cards, and the **Scout's Four Picks**
> (Safe / Form / Value / Scout's Gamble — mechanical selection + a grounded AI copy layer, admin
> approve→publish via `/api/admin/scout-picks`, `fantasy_scout_picks` mig 220). The **captain tip** is
> wired into the squad-selection tab (self-hiding, flag `FANTASY_CAPTAIN_ASSIST`). Plus **iOS safe-area
> fixes** across the Fantasy shells (`page`/`shell` now pad `env(safe-area-inset-top/bottom)`) so the
> back control clears the status-bar clock and content clears the BottomNav. Merged `scout/hub` →
> `main` (`73fd010`); migs 219+220 already applied to prod. Still gated by `FANTASY_ALLOWLIST`
> (vossybaba only); the captain tip stays hidden until `FANTASY_CAPTAIN_ASSIST=1` is set in Vercel.
> Also today: **Fantasy squad builder gains "Start Fast" — one-tap starter presets +
> up to 3 core players a shape builds around + flip-with-core — and real SportMonks player faces on
> every player surface (pitch, chips, add/candidate lists, selling card, profile sheet, planner, hub;
> ~99% coverage via `pool-faces.json`, monogram fallback). Additive to the monthly-chips game; no
> migrations. Previously confirmed 2026-07-27:** Fantasy "Manager's Matchday" redesign shipped to prod — one reusable
> Squad Board is now the spine of every Fantasy screen, plus the screen upgrades built on it. New
> `SquadBoard` (portrait pitch with build / complete / plan / transfer / live / final modes) + pure,
> tested `lib/fantasy/board.ts` replaced three divergent inline pitches; **Builder, Command Centre,
> Transfer Room and Planner all draw the same board**, and the hub's captain/vice/bench menu is
> preserved through a `renderMenu` hook. **Transfer Room is board-first** — tap a shirt and the OUT
> player is ringed, IN candidates open below (factual data only; **no projections**). **Weekly Round**
> now shows the reward WHILE you play: banked moves + a live progress bar to the next move, off the
> real credit curve. **Live** markers show points (yet-to-play dimmed); the point-driver table was
> extracted to its own `GameweekBreakdown.tsx` (FantasyHub 1,378→~1,160 lines), and a gold,
> portrait-led `FinalStory.tsx` cover (star man / captain / biggest regret / moves earned / Share)
> sits above it — every figure from the real breakdown. **News** became named editorial cards
> (Captaincy Call / The Differential / Fixture Swing / Worth Knowing / The Risk), each mapped to a
> real doc field. **Fixtures** is squad-first: a client `FixturesGrid` (My clubs / All clubs toggle,
> owned-club highlight, difficulty legend) fed by the server-rendered doc, which still lists all clubs
> for SEO. Tested live-event core: `liveEvents.ts` (SportMonks goal/assist events → a squad's own
> moments) plus the `events` include added to the fantasy ingest — scoring untouched. **No
> scoring/engine changes, no global-nav change, portraits-only imagery, no invented data.** `flag.ts`:
> founder id restored to `FANTASY_ALLOWLIST` so the redesign is visible on his account while everyone
> else still gets the teaser. Tests 93/93, real `next build` green on every ship. Commits on `main`:
> `5f8030d` (core), `70eb7c7` (news), `9b2e6ac` (fixtures + planner). **Still pending, gated on live
> matches (21–22 Aug):** the Leagues rivalry/live-battle strip and the on-screen live event ticker
> ("GOAL, 34'"); minor: the Planner's GW1–5 timeline selector and a systematic empty-states pass.)
>
> **Previously confirmed:** 2026-07-25 (**The public Fantasy tab teaser (`/fantasy` → `FantasyTeaser`) rebuilt as
> a landing page and shipped to prod.** The lead flipped from "One transfer. Earn the rest." to the
> differentiator itself — headline **"The more you know, the more you move."**, subhead "the fantasy
> game where your football brain earns you more transfers." The old numbered rulebook became a
> landing page: an **earn showpiece** (a correct Gameday Quiz answer → transfers earned, drawn not
> asserted), two supporting cards (**your starting lineup** / **rules you already know**), a
> **monthly-table block** selling join-any-time, and a closer. The opt-in (the shipped `WaitlistCard`,
> `source="fantasy-tab"`) moved **high, right under the hero**, and now **pulses** — an expanding lime
> ring (`animate-save-pulse`, reduced-motion safe), added via a scoped `pulse` prop so the blog
> waitlist is unaffected. The hero gained a cluster of **licensed PL star portraits** (Haaland, Saka,
> Palmer, Rice, Foden — reusing the Higher-or-Lower headshots via `faceFor` + `PlayerAvatar`, monogram
> fallback so it never blanks). Copy rules held: "correct answers earn transfers" (never
> every-answer-banks-one), zero dashes; `WaitlistCard` launch date corrected "mid-August" → "Friday 21
> August". Also fixed an **iPhone safe-area bug** on the teaser — the header sat under the status bar
> and the closing tile was clipped by the bottom nav; padding now uses `env(safe-area-inset-*)`.
> Commits on `main`: `7417d49`, `fab0dc5`, `b6fd9cf`, `fc20106`. FantasyHub and the game itself are
> unchanged and still allowlist-gated.)
>
> **Previously confirmed:** 2026-07-25 (**Duplicate-rank bug FIXED — every player has one rank again.**
> Migration **211 APPLIED to prod**, recorded on `main`. `yourscore_user_ratings` joined
> `draft_standings` on `league_id` alone, ignoring `competition` — so anyone active in more than
> one competition (PL/WC/LaLiga) got a SEPARATE row per competition. Result: **340 users had two
> overall_ranks** (one appeared at both #45 and #4,895), **280 had their 38-0 score split and
> never summed** (goat1993 saw 143,000 instead of 257,000), and every rank was inflated by ~358
> phantom rows. Fix: aggregate `draft_standings` per user (sum wins/draws/losses across all
> competitions) BEFORE the join. Verified live: 0 duplicate users, view rows == profiles ==
> 10,046, 10,046 distinct contiguous ranks, `get_yourscore_rank`/`get_yourscore_ladder` return
> one correct row per user, goat1993 now at #23 with the full 257,000. Column list unchanged, so
> the dependent RPCs needed no drop/recreate. This closes the ⚠️ flag from the 2026-07-21
> profile-card entry below.)
>
> **Previously confirmed:** 2026-07-25 (**The Halftime Quiz shipped as the GAMEDAY QUIZ — published at
> 09:00 the MORNING OF each fixture, not at the halftime whistle.** Merged to `main` as `c8b4488`; migration
> `110_gameday.sql` applied to prod. *(Publish timing corrected 2026-07-25 from day-before to
> day-of-9am per founder — see the newer entry above.)*
> **What changed and why:** a pack per PL fixture now publishes from a daily Vercel cron
> (`/api/cron/gameday-publish`, `0 8,9 * * *` — both hours cover 09:00 London across BST/GMT) on the
> morning of the match, against questions approved on Telegram the day before. This retires the whole
> live-timing surface — no halftime-whistle detection, no 15-minute assembly window, no
> confirmed-lineup "fresh" slice — so a dead VPS can no longer stop a pack going live. The physical
> table keeps the name `halftime_releases` (renaming it would touch the live PL tab and club-fan
> leaderboard for no user benefit; same precedent as `rooms*` tables staying "Lobbies").
> **Two prediction polls, both keyed on the fixture (never a quiz pack):** a **pre-match** poll at
> the end of a Gameday attempt if you finish before kick-off (predicts full time), and a standalone
> **halftime** poll at the real whistle (predicts the second half) that every player sees whether or
> not they played the quiz. `halftime_predictions`/`_results` gained a `phase` column; settlement
> grades pre-match against the full-time score and halftime against `2ND_HALF_ONLY` (the
> second-half split — `2ND_HALF` is cumulative, a trap that would have mis-graded every pick).
> **A gameweek Recap Quiz** (`kind='recap'`) publishes after each gameweek from that week's match
> events — the only quiz that can be *this* week's football.
> **Verified post-deploy:** the two live readers of `halftime_releases` (`/api/pl/fixtures`,
> `/api/clubs/table`) both 200 with unchanged shapes; `/api/gameday/today` 200. Build green, 137 tests.
> **STILL TO DO:** VPS crontab for the generation scripts; one real Telegram send from `gate.mjs`
> (only dry-run tested so far); the `111` drop-migration for the retired fresh-slice columns +
> `halftime_control`, days later once a grep proves zero readers. **The fantasy transfer bridge
> (a club pack feeding transfer credits) is DEFERRED** until the fantasy game is finished — founder's
> call. Spec: `docs/gameday-quiz-spec.md`; deploy steps: `docs/gameday-deploy-runbook.md`.)
>
> **Previously confirmed:** 2026-07-24 late (**Higher or Lower and Guess the Player now keep a score, and the
> daily Higher or Lower tile IS the question.** Shipped to prod as `49f7f11`.
> **The leak this closed:** a `/ux-walk` found those two games told every player "Practice mode:
> these don't count on the leaderboard yet" — accurate, because they persisted **nothing**. A guest
> finished a round owning nothing and was asked for nothing.
> **Scores now persist** (`game_scores`, mig 112; board + rank functions, mig 113 — both already on
> prod). Rows are written only from a **server-side re-grade**: the client posts its seed and its
> taps, the round is rebuilt from that seed and rescored on the server, so a client cannot post a
> score. One banked run per seed per player.
> **The results screen** gets the Quiz's guest block — score, the rank it would take, `SIGN UP &
> SAVE SCORE`, share. A guest run is parked locally and **claimed on the way back in**, so signing
> up genuinely banks the score it promised. Each game gets a **leaderboard on its own intro screen**
> (best per player, not per run) rather than a route nobody would find.
> **Sign in** takes the fifth **guest** nav slot: every other route to it was reactive (trip a gate,
> get bounced), so someone with an account on a new phone could not *choose* to sign in.
> **Today's Game tile** for Higher or Lower now renders today's **actual first question with both
> players' faces**, rebuilt from the same London-date seed the round uses; tapping opens that exact
> question, unanswered ("opens", not "counts").
> **The question pool was a season stale** — its ids were 2025/26 FPL elements, reassigned every
> summer, and ~40 players it named had left the league, capping headshots at 65%. New generator
> `scripts/games/build-pool.mjs` rebuilds it from live FPL (plus SportMonks for ages, which FPL does
> not publish); official PL headshots now resolve for **240/240** questions. Difficulty is fitted
> from the old pool (0.904 correlation with closeness) so rounds keep their feel. `who-am-i`,
> `career-path` and `classic-trivia` are copied through untouched.
> **FPL points** joins Higher or Lower as a pickable topic (`HL_TOPICS`), held to **at most one
> question in ~a quarter of mixed rounds** — a fantasy-manager question, not a football-knowledge
> one, so pickable but never pushed.
> **STILL OPEN:** Guess the Player's tile is still text-only (its clues and single photo belong to
> the answer, so nothing there is safe to preview); the `price` questions (60) remain generated but
> unserved; the pool's prompts still say "2025/26" and the generator warns to bump `SEASON_LABEL`
> the first time it runs after a gameweek is actually played.)
>
> **Previously confirmed:** 2026-07-24 (**Signed-out home page rewritten around the rank, and a batch of
> guest-flow fixes.** Shipped to prod as `b024193`.
> **Positioning:** the landing page led with 38-0 and a World Cup that finished on 19 Jul. It now
> leads with **YOUR FOOTBALL KNOWLEDGE. RANKED.** The rank is the product: quizzes, gameday,
> fantasy and Versus all feed one score, so the promise has no upper bound and absorbs new
> features without a rewrite. Breadth moved to the eyebrow (`Quizzes · Gameday · Fantasy ·
> Versus`), which keeps the headline to one promise and the fold to one decision. An earlier cut
> said "FIVE FOOTBALL GAMES" and was rejected: **never put a count of games in the headline** —
> it reads as a ceiling and goes stale the day a game ships.
> **New components** in `MarketingLanding.tsx`: `GamesHeroCard` (the animated what-feeds-your-score
> card) and `GamesExplainer` (a tab per game). Both read `GAMES`, now **exported from
> `GameSwitcher.tsx`** with a per-game `blurb`, so the marketing page cannot describe a game the
> app doesn't have, and a new game gets a row and a tab with no copy written. Every line in the
> explainer is drawn from the game's own code (`ROUND_SIZE`, `MAX_STRIKES`, `HL_TOPICS`, the quiz
> speed bands), not from memory.
> **Removed:** the "HOW IT WORKS" 01-04 steps (they walked the 38-0 arc as if it were the app),
> the "SPEED SCORED" demo-question section (quiz scoring given its own section; it now lives in
> the Quiz tab) and its 45s countdown interval that ran on every signed-out load, the duplicate
> 38-0 / Football Quiz tiles, and the invented league activity rows.
> **World Cup framing retired:** `WorldCupCountdown` → `SeasonCountdown`, counting to PL GW1 on
> **21 Aug**. The old one passed zero on 11 Jun and had rendered "THE CUP IS LIVE" every day
> since, including the four days after the final. Fantasy and gameday quizzes are written as
> landing **with the season**, never as playable today.
> **Guest-flow fixes from a `/ux-walk`:** Today's Game moved above the hero (it sat 1280px down,
> 1.6 screens below the fold); `/38-0` lands on Premier League, not a finished World Cup; the WC
> edition strip is signed-in only (a guest's first visit opened with "34 days to catch up" and 35
> CATCH UP chips); guests are no longer told "your first score counts on the leaderboard" 40px
> above "sign in first to save your score", which contradicted it and was false for them.
> **Copy gate:** "mates" → "friends" (8 more the 22 Jul sweep missed, because that grep was case
> sensitive and the headline was uppercase), every em/en dash out, and the OG image no longer
> calls Perfect 10 a **daily** list.
> **STILL OPEN:** recommended packs have no browse surface; club packs still fall back to crests
> instead of real covers; the games card sits ~1000px down on mobile, below the fold.)
>
> **Previously confirmed:** 2026-07-23 (**Home hero rebuilt: Today's Game shows its topic + crowd stats,
> debate comments open to all, Mastermind resume prompt removed.** Branch `fix/quiz-flow-ux`,
> migration **102 APPLIED to prod**.
> **Today's Game tile** is now two halves: cover art on top, a live stats strip underneath —
> players / average score / % who got the hardest question. Numbers come from two new SQL
> aggregates (`get_daily_pack_stats`, `get_daily_p10_stats`, migration 102, `security definer`,
> anon-executable so the logged-out hero can use them too). The strip shows the hardest
> question's PERCENTAGE only, never its text, so the tile can't spoil a question the player is
> one tap from being asked; zero plays shows "Nobody has played it yet" rather than three zeros.
> **Perfect 10 tiles lead with the list title, not the mode name** ("Perfect 10" alone read as a
> menu entry). Root cause was real: P10 lists release in BATCHES, not daily, so most P10 days
> have no row of their own — `src/lib/daily-game.ts` read only `day` and came up empty. It now
> mirrors what `/api/games/perfect-10` actually serves (`loadListForDay ?? loadLatestServed`).
> Same bug was silently breaking the Perfect 10 **done state** on every non-release day; fixed.
> **Today's debate:** the comment thread is now INSIDE the debate card (one tile, not two) and
> is readable by everyone, voted or not — posting is what voting buys you (`canPost` on
> `DiscussionThread`, plus an `embedded` mode that drops its own frame). "DRAG A FRIEND IN" and
> "THE ARGUMENT" buttons are gone. The sign-up pitch is now opt-in (`withSignUpPitch`) and OFF
> inside the app, where it was flashing in before the client session resolved.
> **Home no longer surfaces an active Mastermind run at all** (founder call) — the mode tile is
> the only way back in. **STILL OPEN:** recommended packs have no browse surface, so anything
> not in the rec strip is unreachable and unplayed, and club packs still fall back to crests
> instead of real covers.)
>
> **Previously confirmed:** 2026-07-22 (**Club pages + a batch of quiz-flow UX fixes shipped.**
> Branch `fix/quiz-flow-ux`, merged to main.
> **Club pages `/club/[slug]`:** the Quiz hub's Club tab used to send all 20 crest cards
> straight into a single 2025/26 season-review quiz. It now opens a club page: crest, the
> season-review pack, and four topic quizzes (History & Honours, Legends, Modern Era,
> Rivalries) drawn from the verified club question bank. Built by pre-generating the topic
> packs as real `quiz_packs` rows (`status='published'`, `rotation_active=false`,
> `is_custom=false`, `created_by=null`, `metadata.club_topic=<slug>`) via
> `scripts/club-pages/generate-topic-packs.mjs` (imports the draw from `src/lib/questions.ts`
> so it can never drift from `/api/quiz/generate-custom`; dry-run by default, `--commit` to
> write). **50 packs seeded to prod.** Real draw (fact_key distinctness) yields 50 of 80 club
> x topic combos, not the 57 a raw row-count suggested: Arsenal / Liverpool / Man City / Man
> Utd get all four topics, Forest gets one, most land at two or three; a topic that can't deal
> 15 shows a disabled card with an honest reason. Nothing new to generate or auth: `/api/quiz/packs`
> still filters `rotation_active=true` so the hub grid stays 20, while `/api/challenges/pack`
> serves any published pack, so guests play these on the existing play screen with the sign-in
> wall only at save-score. Club-page payload at `/api/club-page/[slug]` (named `-page` because
> `/api/club/[slug]` already belongs to Club Leagues). Every topic link carries `?pid=` because
> two published packs are named "Brighton" and slug-only resolution is order-unstable.
> **Quiz-flow UX fixes (from a `/ux-walk`):** results screen leads with PLAY ANOTHER and moves
> save-your-score up under it (was two stacked share CTAs with the next-game route buried last);
> Accuracy on the results screen is now questions-right, not score/maxScore (it disagreed with
> "7/15 Correct"); AnswerButtons gets a `key` per question in all three quiz players so
> `transition-all` no longer flashes a wrong option green on the next question; the username
> prompt no longer mounts over hubs and games (it ate the first tap) and skip is once-ever in
> localStorage; Featured drops the finished World Cup packs and the verified-competition card
> reads FINAL STANDINGS not a pulsing LIVE; the quiz builder club grid no longer clips two-line
> names or loses Birmingham City. Copy gate: "mate" to "friend" in 8 places, em/en dashes
> stripped from shipped strings, home hero stops naming the delivery mechanism. **STILL OPEN:**
> user-built quizzes and guest scores still have no home surface (the "your quizzes" list and
> guest score memory are the next two pieces).)
>
> **Previously confirmed:** 2026-07-21 (**Profile rebuilt around a FUT-style player card.**
> Branch `feat/profile-player-card`, migration **82 APPLIED to prod**.
> **The page:** a hero row — YourScore rank, accuracy, streak and Share on the left; the
> **player card** on the right (rating, archetype, real club crest from `club_supporters`,
> avatar, six attributes). Then the **ladder** (2 above / you / 1 below, progress bar, and a
> concrete "18,150 pts overtakes tatty · a strong quiz run closes it"), the **medal shelf**,
> **"where your points come from"** — which says out loud that daily quiz, World Cup and
> seasons earn NOTHING toward Rank — and recent games.
> **The card is rated on being a YourScore player, never one game:** KNO accuracy · PAC answer
> speed · WIN record · CON streak · RNG breadth · SOC social. A new game feeds the existing six
> rather than earning its own slot. Tiers Bronze/Silver/Gold/Icon; archetype = your leading
> attribute, so two players on 84 read differently. **Nobody scores zero** — floor 38, a new
> player is a real Bronze ROOKIE.
> **25 medals** (`src/lib/medals.ts`), every threshold calibrated against the REAL distribution,
> not instinct: 67% of players have a 38-0 win but only 0.7% have answered 100 quiz questions,
> so the 38-0 ladder carries the volume and quiz tiers sit at 15/50/150. Rarity is the pride
> mechanic and is printed on each medal. **Social medals deliberately absent — no player has 5
> friends.** `Ever-Present` (30 days) has zero holders on purpose. Percentages are DATED
> constants measured 2026-07-21; they drift, and a nightly job is the fix when wanted.
> **Avatars:** 16 generated character portraits at `public/avatars/*.webp`
> (`scripts/gen-avatars.mjs`), replacing the old object icons. Only 1 user had the old set.
> **Gotchas:** a cross-origin URL in an SVG `<image href>` renders as a BROKEN TILE — 3,367 of
> 9,786 profiles are Google account photos, so the card layers the photo as an HTML `<img>` over
> the SVG (`foreignObject` is worse: blank). Readable content must clear the badge taper or it
> reads off-centre when it isn't. Card size is a `width` prop so a share/OG render can use full
> size. Also: `profiles.games_played` is 0 on all 9,400 rows — never read it.
> ⚠️ **STILL OPEN — `yourscore_user_ratings` is wrong:** it joins `draft_standings` on
> `league_id` only, ignoring `competition`, so **340 users get two ranks** and **280 have their
> 38-0 score split across PL/WC and never summed** (worst: `goat1993`, −114,000 pts). Untouched
> — it changes real ranks and needs a product call.)
>
> **Previously confirmed:** 2026-07-21 late (**First-launch onboarding tour + guest Versus preview SHIPPED
> to prod.** A 5-step spotlight walkthrough (`SpotlightTour`, mounted in the root layout) that
> navigates the real app: Play games row → Versus action cards → PL section bar → your rank
> (signed-in only) → ends on Home spotlighting the Today's Game hero. Pulsing beacon on the
> bottom-nav tab each step references; once-ever via `ys:tip:app-tour:v1`; Skip/Escape end it;
> steps whose target can't be found in 3s skip silently; `?tour=1` = QA replay that never burns
> the flag (dev also gets `window.__resetTips()`). **NEW USERS ONLY (founder-locked):**
> signed-in requires `created_at >= 2026-07-22T00:00:00Z` (`TOUR_EPOCH` in `src/lib/tips.ts`)
> — current customers never see it; guests only on a **fresh native install** (detected by
> stamping `ys:tip:fresh-install:v1` at module load while `yourscore:onboarding:v1` is still
> absent, i.e. before the first-run carousel marks itself) and only after that carousel
> completes; web guests never. Storage errors fail closed in the safe direction per flag.
> Gotcha shipped around: `scrollIntoView({behavior:"smooth"})` silently no-ops in some
> webviews — all tour scrolls are `behavior:"auto"`, plus a throttled pull-back if the page
> scroll-resets under an active step. **Also: guest `/versus` now mirrors the real first-time
> hub** (welcome hero, action cards, choose-your-game, live activity/community/public-league
> rails with real anon data; every tap capture-routed to `/auth/sign-in?next=/versus`; slim
> create-account banner) — replaces the old sign-in wall so guests see the actual hub.)
>
> **Previously confirmed:** 2026-07-21 (**WC Mastermind thank-you flow SHIPPED to prod** — migration 100
> seeds `wc_thanks_prompts` with the 199 players who played >10 ranked WC days; on their next
> signed-in visit they get a one-time "What would you like to see on YourScore?" modal (free
> text → `product_feedback`, write-only mailbox RLS), then after ~600px of scrolling a one-time
> App Store review ask (native star popup in the iOS app; card on iPhone web; desktop leaves the
> ask unconsumed so it still fires on a later phone visit). `WcThanksPrompt` mounted globally;
> dev previews `?preview=wc-thanks` / `?preview=wc-review`. Verified live: seed = exact cohort,
> anon-curl returns nothing on both tables, test feedback row round-tripped. **Companion email
> (copy LOCKED Jul 21) to the 190 non-suppressed cohort members is NOT yet sent — awaiting
> founder go.**)
>
> **Previously confirmed:** 2026-07-20 (**Club question bank: categories remapped + Rivalries filled 0→20 clubs.**
> On branch `quiz/content-factory`, nothing on `main`.
> **The remap:** 2,207 verified questions across 44 clubs were invisible to the category flow
> because they carried six legacy labels while only 69 (Arsenal) carried the new four. 2,213
> questions rehomed deterministically (no API cost); Season Performance / Records & Milestones
> split by era (modern-era = 2015+). Backup + `--revert` on disk.
> **Rivalries:** was zero for every club — 498 questions written across all 20 PL clubs, $21.49.
> **The honest number is 6/20 dealable as a full 15-question quiz** (Arsenal, Chelsea, Liverpool,
> Man City, Man United, Newcastle), not 20/20. Eleven clubs are blocked on `easy` alone; three
> (Bournemouth 6, West Ham 7, Palace 11) are capped by distinct-fact supply — `fact_key` stops a
> quiz reusing one fact, so **row count is not capacity**. See `scripts/quiz-factory/bank-status.mjs`.
> **RESOLVED same day — 19/20 clubs now deal a full 15-question Rivalries quiz** (was 6/20;
> was 0/20 before today). Two changes: (a) the difficulty mix is now a TARGET with top-up
> rather than a hard floor (`fillToSize` in `src/lib/questions.ts`), and (b) a `--top-up`
> research pass for the three fact-capped clubs — West Ham 7→28 distinct facts, Palace 11→33,
> Bournemouth 6→14. **Bournemouth is the only club still short, by ONE fact**; 17 of its 25
> researched facts were dropped as untrusted, so its rivalry material is genuinely scarce.
> **The four topics are now LIVE in `/quiz/create`** (clubs only) and `/api/quiz/availability`
> filters by category too — without that the builder would show a club's total count while
> generating from one topic. Verified in-browser: Sunderland · Rivalries offers Generate,
> Sunderland · Legends correctly refuses.
> ⚠️ **The easy shortage was a CALIBRATION artefact, not a content gap.** Difficulty
> is rated for a *neutral* fan, but only a club's own fans pick that club's quiz. Newcastle and
> Sunderland from the same derby, same tier-1 sources, zero facts dropped: Newcastle 2/9/16,
> Sunderland **0/1/27**. No research produces a neutral-easy Sunderland fact, so the supply the
> threshold demands does not exist at any budget. Relaxing the easy requirement for club quizzes
> was the fix, and it landed: the mix is now a target, not a floor.
> **Also learned:** grounded Modern Era authoring (SportMonks league tables) produces
> *structurally* zero easy questions — positions/points/top-scorers are precision recall. It is
> the cheapest category to generate and it makes the easy shortage worse.
> **New: an editorial gate** (`scripts/quiz-factory/editorial.mjs`). True + trusted ≠ publishable:
> research surfaced hooligan-firm facts (West Ham's ICF, Millwall Bushwackers, Seaburn Casuals)
> from tier-1/2 sources. Fired on 4 of 20 clubs. Drops violence/crime/tragedy/abuse at the FACT
> stage; deliberately conservative about football idiom ("crushed 5-1", "fired a shot").)
>
> **Previously confirmed:** 2026-07-17 (**Profile page redesigned + a silent P1 fixed** — the page now
> leads with a *ladder* (2 players above / you / 1 below, a progress bar and "one 38-0 win does
> it"), a *trophy cabinet* of verified bests per game where an unplayed game is a dashed empty
> slot, and a *"where your points come from"* band that says out loud which games earn nothing
> toward Rank. Killed the Lobbies/Friends tiles and the dead solo-challenge block.
> **The P1:** `/profile` selected `room_scores.created_at`, a column that does not exist — the
> query errored, so **quiz accuracy, recent multiplayer and recently-played-with had rendered
> empty for every user since launch**. Accuracy is now true lifetime across quiz + lobbies + WC
> Mastermind (`get_profile_accuracy`); "Games" counts real rows because `profiles.games_played`
> is 0 on all 9,400 profiles; best-quiz is questions-right, not score/max_score (score carries
> speed bonuses, so it read "5950/4800"); best-WC-run is a real max, not an unordered
> `.limit(50)` of 22k rows. Migration **82** adds `get_yourscore_ladder`, `get_profile_accuracy`,
> `get_best_wc_run`, `get_best_quiz`; streak maths extracted to `src/lib/streak.ts` and shared
> with the home dashboard. ⚠️ **OPEN — `yourscore_user_ratings` is wrong:** it joins
> `draft_standings` on `league_id` only, ignoring `competition`, so 340 users get **two ranks**
> and 280 have their 38-0 score **split across PL/WC and never summed** (worst case `goat1993`,
> −114,000 pts). Every user's rank is inflated by 358 phantom rows. Not fixed — it changes real
> ranks and was explicitly out of scope. See `challenge_attempts`: 0 rows, no writer, so the
> `SUM(challenge_attempts.score)` half of `knowledge_score` is permanently 0.)
> **Also confirmed:** 2026-07-20 (**Conversion-event schema completed for the ad relaunch** —
> new pixel events: `FantasyWaitlist` (Meta `Lead`/TikTok `SubmitForm`, fires on waitlist
> save success in WaitlistCard — blog + Matchweek fantasy tab), `ClubPick` (ClubPicker
> confirm, `{club}` param), `InviteAccepted` (viral-loop RECEIVE side — league join,
> 38-0 challenge accept, live-H2H code claim, WC-H2H join, group-challenge join; Share
> remains the send side), `HabitFormed` (3rd distinct play-day, once per device — fired
> from the ReturnPlay path in trackGame.ts), `TeamDrafted` (full XI complete on
> /38-0/play — the pre-match IKEA moment), web `PushOptIn` twin in lib/push.ts, and
> GA4-only `trackDiag` (`redraft_used`). EVERY pixel event now carries
> `client: "native"|"web"` so app-webview activity is separable from web (the iOS app
> wraps yourscore.app — pixels fire in both). Accuracy fixes: fire-once guards moved to
> sessionStorage (`firedOnce`/`hasFired` in trackGame.ts) so refresh can't double-count —
> 38-0 match result, live H2H, live-match quiz, multiplayer quiz; multiplayer quiz "play"
> now fires on the player's FIRST ANSWER (room viewers no longer count); group-quiz
> starts correctly tagged `mode:"group"`. X Events Manager audit same day: all events
> code-defined, no URL rules. NEW-GAME RULE: a new quiz PACK needs nothing (tracking
> lives in the page); a new game PAGE must call trackGamePlay/Complete + get a GameId.
> Prior confirm 2026-07-19: **Nav: 38-0 now lives under the Play tab** — Quiz | 38-0
> game switcher on both hubs, see §9 + Recently Shipped. Prior confirm 2026-07-16:
> **Perfect 10 — new standalone list game SHIPPED to prod.**
> Third Quiz game-type ("name everyone in a ranked top-10 football list", e.g. all-time
> PL top scorers): tapering "floodlit tower" of 10 rungs (#1 narrowest at the top) that
> ignite gold as solved; free-text input with autocomplete chips (tap chip = submit, NO
> submit button; word-exact/surname matches rank above prefix matches); 3 strikes
> (wrong player = strike + tower shake); 3 hint tokens spent per-rung (tier 1 clubs clue
> → tier 2 "starts with"; clue chips persist under the rung until solved, no rung
> restyle); scoring +10 clean / +6 one hint / +3 two hints; dots per rung = one per
> letter, grouped by word (server-sent lengths — answers NEVER reach the client
> pre-solve; grading is server-side vs service-role-only `p10_lists.entries`). Daily
> list by Europe/London date; win = tower-ignition cascade, 3 strikes = missed names
> revealed in red. Signed-in attempts persist (`p10_attempts`, unique per list+user,
> share_token drives the async challenge link `?c=` → same list, side-by-side compare);
> guests play via localStorage (house guest pattern, sign-up nudge on results). Guess
> pool = ALL PL history: `p10_players` + `public/perfect10/players.json` (4,669 names)
> backfilled live from SportMonks league-8 season squads 2003/04→now
> (`scripts/perfect10/build-player-index.mjs` — validates every season against the
> verified "season id aliases to current squad" trap; SportMonks' topscorers endpoint is
> UNRELIABLE for historical rankings, verified live, so lists are NOT SportMonks-ranked);
> pre-2003 legends are force-inserted whenever a list ships. Lists are authored+verified
> by `scripts/perfect10/generate-lists.mjs` (author → per-entry independent web-search
> verification, any failed entry drops the WHOLE list → insert as draft; a list only
> serves once it's assigned a `day`). Migration 85 applied to prod (tables RLS
> deny-all/service-only). Hub tile on /play, gold #ffc400; typographic placeholder cover
> pending approved key art. **Same day: the playable LIBRARY shipped** (founder model:
> a list drops daily, the back-catalogue stays playable) — `library` API action +
> "Previous days" on the intro with PLAY / n-of-10 / score badges; `?list=` replays any
> served list; drafts/future days unreachable (`isServed` gates state/guess/hint).
> **(2026-07-18 pm: daily framing DROPPED from the UX — founder: "forget this daily
> thing." Every list is a GAME MODE in one "Game modes" picker; dates/"today" never
> reach the player. `day` remains the server-side release gate/order only.)**
> **GAMEPLAY NEVER SCROLLS (Jul 17, founder requirement).** The play screen is `height:100dvh` + `overflow-hidden` (NOT `min-h-screen`/100vh — vh ignores mobile browser chrome, which is what caused 301px of overflow at 375x667); rungs are `flex: 1 1 auto` in a `min-h-0` column so tall screens fill without dead air and short ones compress; hint chips are one line and scale to full tower width so a paid clue isn't truncated. **Verify layout at 360x600 / 375x667 WITH hints spent — never at a bare 812 viewport.** **SINGLE-SOURCE ANCHOR SHIPPED (Jul 17) — the tie problem is SOLVED.** `generate-lists.mjs --anchor "<source + its tiebreak rules>"` switches the verifier from "find an article printing this exact numbering" (impossible for tied stats) to "verify the player's stat value per this source, and that the rank is defensible under its published tiebreakers" — stricter on FACTS, looser on editorial order. Rationale: **a tie never reaches the player** (they type names; the rank is display only). First run took the 2026 WC list from 0/10 to 7/10 confirmed, resolving Messi/Mbappé 8-8 (assists), Kane/Bellingham 6-6 (minutes) and Dembélé/Oyarzabal 5-5 (assists). Also withdrew `/tenable` (an earlier prototype under a name that is another party's registered trademark for this exact format) — 301s to Perfect 10; the LukePingu partner page now points at Perfect 10. **TIES WERE THE #1 GATE KILLER — and the unlock is a single-source anchor (Jul 17).** The verifier needs a source confirming an EXACT rank; most football top-10s are tie-bunched so none exists. 2026 WC top scorers DROPPED (Messi 8 = Mbappé 8, Kane 6 = Bellingham 6, Dembélé 5 = Oyarzabal 5, four players on 4) — **the final will not fix this, ties only grow.** Note **ties don't affect gameplay** (players type names; the rank is never needed) — the order only has to be defensible for display. Fix: anchor titles to ONE canonical source with published tiebreakers (FIFA Golden Boot = goals → assists → fewer minutes; Transfermarkt for fees) and verify against that source only. NOT built — needs founder sign-off. **TOPIC SHAPES THAT CANNOT SHIP (Jul 16–17):** (a) **fee-ranked lists** — all four transfer topics (most expensive PL / all-time / biggest PL sales / summer-2026 window) were DROPPED because no canonical ranking exists (Wirtz #7/#3/#2, Coutinho #4/#3/#11 across sources); shipping transfers needs the title anchored to ONE named source ("per Transfermarkt") + a gate change — NOT built. (b) **shared awards** — "last 10 PL Golden Boot winners" was factually CONFIRMED but 3/10 seasons were shared, giving untypeable rungs ("Salah, Mané & Aubameyang") → status='unplayable-shared-award', never released. **LIVE Jul 17: Last 10 Ballon d'Or Winners** (Messi ×4 / Ronaldo ×2 — double-winner grading verified on prod). **RECALL WINDOW = the topic test (Jul 16, proven live):** the "last 10 WC Golden Boot winners" list was VETOED by the founder (40-year window) and the data agreed — 3 real players all scored 0 pts, 0/10 found. Pulled to status='vetoed'; the WC captains/Golden Ball lists were pulled to draft unreleased. A verifiable list is NOT a playable list — a casual fan must land 5–7. Topic titles get founder approval as TEXT BEFORE any generation spend. **Content live:** Jul 13–15 = PL library seeds (25/26 scorers · appearance makers ·
> all-time scorers), Jul 16 = last 10 WC Golden Boot winners (Salenko added as an
> accepted answer on the shared-1994 rung), Jul 17 = last 10 WC-winning captains —
> founder wants WC-themed dailies while WC 2026 runs; Jul 18 = last 10 WC Golden Ball winners (Messi twice → the DOUBLE-WINNER fix same eve: solved names stay suggestible, grading skips to the next unsolved rung, all-solved returns alreadyFound with NO strike). Gate lessons (all drops were
> CORRECT): tie-bunched topics (all-time assists 94-94, clean sheets 132×3, mid-
> tournament tallies) are structurally unshippable — pick recency-ranked or clean-order
> topics; all-time WC scorers/appearances regenerate AFTER the Jul 19 final. ⚠️ NO
> daily automation yet — someone must generate + assign `day` rows (founder decision
> pending on a cron). NOTE: `scripts/lib/anthropic.mjs` got its first git commit on this
> branch (was untracked WIP from the quiz-factory session) — reconcile if the factory
> branch commits its own copy. Nav decision RULED 2026-07-18: founder ordered "all
> games under one Play tab incl. 38-0" — SHIPPED same day (see §9 Navigation Canon +
> Recently Shipped).)
>
> **Previously confirmed:** 2026-07-13 (**Product-audit fix batches A–C verified + merged with main** —
> see Recently Shipped; audit docs at `docs/AUDIT-2026-07-11-*.md`. Verification was live:
> room-watchdog e2e 12/12 against the real DB via two QA bots, the full guest 38-0 loop
> played through win→swap and loss, h2h accept + guest game-link gate exercised in the
> browser. It also CAUGHT AND FIXED a P0: `loadTeam()` ran its drop-unknown-players
> migration while the lazy 2.6MB player pool was still cold — `getPlayer()` returns
> undefined for every id then — so any cold navigation to a loadTeam() caller (deep
> link/refresh on /38-0/swap, pens, challenge/league pages) silently WIPED the guest's
> whole team and PERSISTED the wipe. The migration now only runs once the pool is loaded.
> Same-session deferred pickups: team-page sign-up prompts carry `?next=/38-0/team`; the
> logged-out landing's dead "before Jun 11" dates replaced with evergreen copy; the landing
> + quiz-intro scoring explainers now show the real engine (×2 under 6s / ×1.5 under 12s /
> +50 streak — the old "+200 pts" / "Instant 1,000" tiles were fiction); push "Maybe later"
> snoozes 7 days instead of killing every ask forever (`snoozePushPrompt`, lib/onboarding);
> and the £25 giveaway is RETIRED (founder 13 Jul: "There's no giveaway live") — all four
> WIN £25 surfaces (quiz results, season scorecard, live-match result, WC-run result) plus
> the WC share page are now plain "SHARE YOUR SCORECARD / Post it on 𝕏" actions with the
> giveaway phrasing stripped from every share-tweet string; the £25 sheets are deleted.
> Post-loss recovery shipped the same day: the loss scorecard offers **REDRAFT A POSITION →**
> (`/38-0/redraft`) — re-spin any slot, but each position gets exactly ONE redraft over the
> team's life (`team.redraftedSlots`); the post-WIN one-slot swap is unchanged. Also same day: **blog waitlist capture is live** —
> a one-field "get gameweek-1 access" card on every blog post + the /blog index
> (`WaitlistCard`), POSTing to `/api/waitlist` (IP rate-limited, server-validated) which
> stores contacts in the Resend audience **"Fantasy Waitlist"** (resolved/created by name
> at runtime; audience id e1d3b3ca-5913-417c-aef1-545db9bd35d8). ⚠️ Prod needs
> `RESEND_CAMPAIGNS_API_KEY` added to Vercel env (the base RESEND_API_KEY is sending-only
> and 401s on /audiences) — until then the endpoint 502s in prod.)
> **Previously confirmed:** 2026-07-12 (**Guest quiz "save your score" + WC Mastermind
> position drafting — SHIPPED to prod 2026-07-12.**
> (1) A guest who finishes a solo quiz now sees a highlighted **"You" row at their true rank**
> on the pack leaderboard (below a full 25-row page it shows "N+"), the sign-up card says
> exactly which spot they'd claim, and the run is held locally (`quiz:guest-result:v1`, 48h)
> and **auto-submitted to `/api/quiz/solo-complete` when they return signed-in** — SIGN UP &
> SAVE SCORE genuinely saves that exact run (server re-grades; local copy never trusted).
> **The guest row is render-only, visible only on that guest's own device** — nothing is
> written until they sign up, so other players' leaderboards are never polluted (founder
> requirement, confirmed).
> (2) **WC Mastermind: tap an empty pitch slot to scout that exact position** (all draft modes
> incl. ranked + open WC Run; target cleared after each placement). Ranked stays verifiable:
> the per-pick `target` slot rides the slate request AND the submit (`targets[]`), is folded
> into the server seed (`…:step:k:target:<slot>`; untargeted seeds unchanged → old clients
> verify as before), and `verifyRankedDraft` replays it. Caveat flagged to the founder: a
> modified client could fish slates across targets — bounded, deliberate trade-off.
> (3) **Streak-1 draft band retuned up** (founder: a player who got their first question
> right complained the first deal was too weak — "stronger from the start" meant TUNING,
> not messaging; no copy changed): first correct answer now deals **70–80 OVR (was 66–76)**
> — `QUIZ_BASE_FLOOR` 66→70, `QUIZ_BASE_CEILING` 76→80, `QUIZ_CEILING_STEP` 3→2 so **elite
> (88+) still opens exactly at streak 5** per the Jun 18 rebalance. Deep-streak ceilings are
> marginally lower (s6 90 vs 91, s8 94 vs 97). Deploy note: anyone MID-ranked-draft when
> this lands would fail `verifyRankedDraft` on submit (band changes the replayed slates) —
> same accepted window as the Jun 18 rebalance.)
>
> **Previously confirmed:** 2026-07-11 (**YourScore Fantasy Football — Phase 1 MVP
> built (branch `your-pl-xi/gate-generator`, not yet merged).** The 4th game, formerly
> "Your PL XI". Locked model: build a **15-man squad ONCE** (2GK/5DEF/5MID/3FWD, £100m,
> max 3/club, 4-man bench + auto-subs) → each gameweek a **knowledge round earns TRANSFER
> CREDITS** (curve B: 5+→1, 7+→2, 9+→3, 11→4; bank cap 5) → extra moves cost −4 pts →
> captain ×2 (carry-over → vice → best-form default chain) → **real-gameweek YourScore
> points** from SportMonks match facts (deterministic, **no BPS-style bonus, ever**;
> validated at the familiarity ceiling, Spearman 0.99 vs FPL actual). Wildcard: 1 issued
> per half-season + 1 minted by a perfect round (max 1 bonus/half). Competitions =
> **calendar-month tables** (season behind as prestige); deadline = FPL's convention
> (90 min before the GW's first kickoff). Live at **/fantasy** (+ /api/fantasy/*,
> migration 76: fantasy_gameweeks/squads/entries/player_scores). Phase 1 excludes chips,
> wildcards, leagues, share cards. Dev **replay mode** scores real 25/26 gameweeks until
> the season starts 21 Aug. Spec: `docs/your-pl-xi-design.md`; research + validation:
> `docs/fantasy-transfer-research.md`; sims/tests: `scripts/fantasy/*`.)
>
> **Previously confirmed:** 2026-07-10 late (**Social cards fixed — robots.txt was
> blocking every OG image** — the Jul 9 robots.ts shipped `Disallow: /api/` for all agents,
> and every preview image lives under /api (og/*, draft/*-og, club-preview), so X, Facebook,
> LinkedIn, Slack, Telegram, WhatsApp and Discord silently unfurled with no image from that
> day. robots.ts now names the link-preview crawlers (Twitterbot, facebookexternalhit,
> Facebot, LinkedInBot, Slackbot-LinkExpanding, TelegramBot, WhatsApp, Discordbot, redditbot,
> Applebot) with `Allow: /` minus /admin, and the AI + `*` groups carry explicit `Allow:` rules
> for each OG path ahead of the /api disallow. /api and /admin remain closed to everything else.)
> Same day (**Debate OG card accepts `?day=`** —
> `/api/og/debate?day=YYYY-MM-DD` renders that exact day's debate card instead of
> today's (regex-validated; default behaviour unchanged, crawler caching unchanged).
> Used by the Studio content dash to preview the whole week's upcoming debate cards
> exactly as they'll unfurl on X. Debates are world-readable seeded content, so
> early visibility is deliberate and fine.)
> Previously 2026-07-09 (**Blog scaffold live on yourscore.app** —
> founder approved blog-as-path on the main domain for SEO authority consolidation
> (unblocks Week 1 of the Your PL XI launch plan). /blog index + /blog/[slug] render
> MDX from `content/blog/*.mdx` (frontmatter: title, description, date, tags,
> optional ogImage, draft — drafts excluded from index/params/sitemap/RSS), fully
> static (generateStaticParams + force-static; dynamicParams=false so unknown slugs
> 404 at the edge — zero app-runtime impact). Per-post metadata + OpenGraph article
> tags + Article JSON-LD; OG fallback is a **typographic gold-on-pitch plate** at
> /api/og/blog (deliberately no artwork — the locked contact-sheet-approval rule);
> RSS 2.0 at /blog/rss.xml. Also the site's **first-ever sitemap.ts + robots.ts**
> (Search Console verified same day per marketing session; prod previously 404'd
> both) — sitemap covers /, /play, /38-0, /how-it-works, /debate, /leaderboard,
> /blog + posts, legal pages (all verified 200 logged-out); /api and /admin
> disallowed; per-user profile/league pages deliberately excluded (build-time DB
> fetch + thin content). **AI crawlers explicitly allowed** in robots.ts (founder
> decision: get YourScore cited in AI answers) — GPTBot, ClaudeBot, Claude-Web,
> PerplexityBot, Google-Extended, Applebot-Extended, CCBot named, /api + /admin
> still off-limits to all. **/llms.txt live** (static route) with the
> founder-approved entity line (incl. Your PL XI mid-Aug launch) + key-page
> links — wording changes need marketing sign-off. **FAQPage JSON-LD supported** via frontmatter `faq:`
> list — one source drives both the rendered "Quick answers" accordion and the
> schema (NOT body comments: HTML `<!-- -->` comments break MDX builds — see
> content/blog/README.md, the authoring guide). Publishing = commit an
> .mdx to content/blog/ and deploy; seed post "Welcome to the YourScore blog"
> (with live FAQ) is ready. New deps: next-mdx-remote, gray-matter. Build note:
> next.config.mjs now
> honours a NEXT_DIST_DIR env override so verify builds don't clobber a running dev
> server's .next; verified with a real `next build` — all blog routes emit static.)
> Same day (**WC Mastermind gate answers recorded** —
> ranked run creation now persists the gate quiz per-question detail on the run row
> (`draft_wc_runs.quiz_answers` jsonb, migration 76): question, letter-keyed options,
> correct letter, the player's pick, correctness — all server-derived (the server
> already re-grades the gate; nothing new is trusted from the client). Feeds the
> content pipeline (Question Guru / hardest-question stats) so Mastermind players —
> the biggest daily pool — power those formats. E2E-verified via a full ranked
> draft as the health bot; no client change; data accrues from deploy onward.)
> Previously 2026-07-07 late (**Tap guard + nav progress** —
> founder: "the app is really sensitive as I'm scrolling, it accidentally clicks
> into different areas… and the loading between screens is a little too long."
> `TouchGuards` in the root layout: capture-phase click filter kills phantom taps
> (finger moved >8px measured touchstart→click, since browsers drop touchmove
> below their own ~15px slop and STILL fire click; plus any tap landing <100ms
> after a scroll event — momentum taps stop the scroll, they don't open things),
> and paints an instant 3px teal top progress bar on internal-link taps so
> navigation is acknowledged immediately. E2E-verified: scroll-drag + 12px jitter
> no longer navigate, clean taps do. Measured nav (4x CPU throttle): picker→quiz
> ~1s, back 37ms, tab switch ~150ms — deeper page-weight work is the open lever.)
> Same day (**Quiz covers shown whole + CDN crop bug
> fixed** — founder: covers are designed cards (logo + title baked in); size the CARD
> to the image, never crop the art. Root cause of "images don't fit at all":
> `coverUrl()`'s Supabase render transform with only `width` centre-crops the sides —
> `resize=contain` now appended in `src/lib/img.ts`, fixing every cover in the app at
> once. Card media zones in /play + /versus/quiz take the image's own aspect
> (`w-full h-auto`); Q/New chips sit at the BOTTOM of covered cards (off the baked
> title strip); home featured + versus hero backdrops crop from the bottom (pure art —
> the HTML overlay carries the title); /challenges hero shows the cover whole. Also
> `fetchCache="force-no-store"` on api/quiz/packs, api/challenges/pack,
> api/cron/wc-mastermind — the durable Data Cache was pinning pack reads, so metadata
> edits never reached the app between deploys. PROCESS RULE (founder, after an
> unapproved art batch went live): **generated imagery/brand creative NEVER ships
> without agreed art direction + contact-sheet approval.** The ~48 new artworks now on
> previously-coverless packs (records/EOS evergreens + 4 June dailies + variants) are
> unapproved placeholders pending replacement. STYLE SYSTEM LOCKED same day after a
> four-direction sample review: **retro matchday poster = base · fan's-eye terraces
> in rotation · cinematic story + comic ink reserved for big moments.** The daily
> pipeline (gen-quiz-images.mjs) now rotates poster/terraces by date; each
> Regenerate press on the Telegram gate steps poster → terraces → story → ink;
> `--style N` forces one; poster palettes rotate daily; a dark scrim keeps titles
> readable on bright poster art. The 19 regenerated covers went through
> contact-sheet review and founder revisions (black plates behind every headline;
> real club crests composited INTO the artwork — Panini-style sticker rows on the
> records posters, a Man Utd/Man City pair on The Derbies, corner crest on club
> cards; bigger crests in the rail/picker; hard FOOTBALL-ONLY rule in every art
> prompt — never American football imagery) and are **LIVE (approved Jul 7)**:
> uploaded to quiz-share/<slug>-art.png with the ~29 records variants inheriting
> their parent's poster. Crests always composited from public/badges/, never
> model-drawn. Same day: the nine postered records evergreens (PL/CL/Euro/WC
> Records, Golden Boot, Iconic Managers, Penalty Shootout Lore, The Derbies,
> Transfer Market) switched to rotation_active=true — the picker's Records tab
> is now a stocked catalogue (9 packs) instead of one.)
> Previously 2026-07-05 round 6 (**Anonymous debate voting** —
> nobody needs an account to vote on the daily debate. Guests vote under a per-device
> key (`debate_anon_votes`, migration 72; localStorage `ys:debate:voter`), votes
> remembered on-device, rate-limited per IP; `?pick=N` share links auto-cast for
> guests on landing — the tap on X IS the vote. The split counts account + anonymous
> votes together. **Sign-up now gates the argument (comments), not the ballot** — a
> post-vote nudge invites guests in. Accepted trade-off: device keys are spoofable;
> debates are banter, not the £100 board.)
> Same day, round 5 (**Debates are date-allocated,
> not rotated** — founder: one per day, allocated to dates, reviewable in advance,
> keep it very simple. Migration 71 adds `debates.day` (unique); "today's debate" =
> the row dated today (UK), else the most recent past one. **The schedule IS
> `scripts/seed-debates.mjs`** — literal dates Jul 5 → Aug 5, edit + re-run to change;
> `--list` prints the calendar. The earlier modulo rotation switched the live debate
> mid-day when the bank changed (scarves→Gazza, 27 votes mid-flight) — scarves
> restored to Jul 5 with votes intact, Gazza scheduled Jul 6.)
> Same day, round 4 (**Debate share card** — the
> /debate link unfurl is now a pixel-copy of the in-app Daily Debate tile: gold header,
> question, UNVOTED option buttons with tick circles (founder call: buttons, not the
> split — the whole point is landing people on yourscore.app). `/debate?pick=N`
> per-side links pre-highlight the option for guests and auto-cast the vote once
> they're signed in — the tap on X *is* the vote, sign-up is the gate. No native X
> poll (deliberate: don't give X the engagement). Rotation order now has an `id`
> tiebreaker (seeded rows share created_at) and the OG fetch is no-store.)
> Same day, round 3 (**Back navigation retraces steps**
> — founder: "when they go back, they just want to retrace their steps". Session nav
> trail (`src/lib/nav.ts` + NavTracker in the root layout) + `BackPill fallback=` mode:
> back controls now return the player to the screen they actually came from, skipping
> transient screens (matchmaking radar, game rooms, auth) and falling back to the old
> hardcoded target only on deep links. Rolled out to: player profiles, league tables
> (quiz + 38-0 via DraftHeader), scorecards, quiz picker/find/challenge/shadow,
> featured-quiz detail, /debate (which previously had no back at all). New **nav layer
> in the 4x/day health checks** (`scripts/health/checks/navigation.mjs`) walks the
> golden paths in a real browser and fails the Telegram scorecard if back stops
> retracing.)
> Same day, round 2 (**Home v3 polish**: zero-streak
> copy is positive ("START A STREAK", never "no streak" — first thing a player reads);
> **Today's Debate card moved from Versus to the home page** (one-tap ballot with tick
> circles + "Tap one — that's your vote, done." microcopy; full argument thread stays
> at /debate); featured quiz card carries a gold **WORLD CUP QUIZ SERIES** chip
> (metadata.series="wc2026") + posted date; **debate editorial bar**: every debate must
> be real and specific — an actual moment/player/rule/part of fan life — and work for
> every fan, not just big-club fans (bank rewritten in scripts/seed-debates.mjs, which
> is authoritative: it deactivates active debates not in its list). GOTCHA fixed:
> service-role supabase GETs in route handlers get pinned forever by Vercel's data
> cache (constant cache key) — debate/comments routes + home now set
> `fetchCache = "force-no-store"`.)
> Same day, round 1 (**Home v3** — signed-in home rebuilt to
> the founder's "Version 3" mockup: compact progress card with real day-streak +
> weekday play-dots + points + global rank + chase line, a Rivalries module (live h2h
> challenge with real expiry countdown, else all-time head-to-head record), a
> full-width Featured Quiz play-now card, a behaviour-based "Because you played 38-0 /
> Picked for you" rail of unplayed packs, and a compact 3-up mode-tile row replacing
> the full-width game tiles. All stats real; leagues + open-lobby nudge + pending
> notices kept. `src/app/page.tsx` + `src/components/home/Dashboard.tsx`.
> Previously 2026-07-04: **Versus phase 2**: daily debates +
> discussion threads — §9, migration 70. Previously 2026-07-03: **Versus phase 1 +
> rounds 2–3**: Play-tab
> redesign, instant matchmaking for both games incl. pick-your-quiz, shadow matches,
> results-feed highlights, public leagues — §9. Previously 2026-06-30:
> **Versus tab** replaces Leagues — §9;
> async multiplayer Phases 1–2 + group challenges shipped, see §7; native track:
> challenge push + universal links + haptics).
> Earlier: 2026-06-16 (World Cup Daily + World Cup H2H — §5B, migration 39; interactive
> penalties — migration 35). Prior full reconciliation 2026-06-10 against `src/` + migrations.
> **Updated 2026-06-14:** added **Club Leagues** (built, not live — migration 36 + push pending).
> **Updated 2026-06-16:** **World Cup** reorganised into **two modes** — **World Cup
> Mastermind** (daily quiz-gated ranked run + Practice, season board) and **World Cup Run**
> (open, no-quiz draft). **Nation / National-Team mode retired** from the UI. World Cup is
> now the **first/default tab** in 38-0. A drawn knockout (and the 3-pt qualification
> play-off) is the **player's choice**: take an interactive **penalty shootout** OR answer
> one more **World Cup quiz question** (25s) to go through. **Shipped to prod** (migrations
> 35 + 39 applied).
> **Updated 2026-06-18:** **World Cup Mastermind rebalanced so knowledge pays off.**
> (1) Opponent difficulty no longer rubber-bands to your own Strength — each round is a
> **fixed standard** (group 68 · R32 72 · R16 75 · QF 79 · SF 83 · Final 87, in `wc.ts`
> `OPP_TARGET`/`oppTargetFor`). A well-drafted XI (≈84 Str) is now the favourite from the
> group through the semi and a slight underdog only in the Final; a weak XI is found out in
> the knockouts. (2) The draft band's **ceiling now climbs with the correct-answer streak**
> (`draft-quiz.ts` `QUIZ_BASE_CEILING`/`QUIZ_CEILING_STEP`) — a lone correct answer deals a
> solid (sub-elite) player; **elite players (~88+) only unlock around a streak of 5**, so the
> best players come up toward the end of the draft once you've earned them.
> **Maintenance:** update this file in the same session you change the product, bump the
> date, and run `graphify update .` after code changes.

---

## 0. Recently Shipped (last ~30 days)

Scan-list so any session gets current in one glance — newest first. Full detail is in the
Confirmed preamble above and the referenced section.

- **2026-08-06** — **League GAMES HUB SHIPPED** (PRs #86 + #87): every league now has a
  fifth Games tab. One overview answers who challenged me, what needs my play, what
  just happened and who leads: a Your Turn section, a quick challenge flow, open
  challenges, recent results, a games leaderboard computed live from completed
  challenges (win 3, draw 1, loss 0, documented tie break, QA accounts excluded) with
  a full table sheet and per member gaming summaries (record, win rate, streak,
  challenge them from the sheet). The league Hub carries a compact League games
  module whose Challenge someone lands on the Games tab with the rival picker open;
  History appends completed results; the Games tab shows a gold badge counting only
  the games waiting on you. Game cards open how it works detail sheets. Zero new
  schema: the tab reads the same challenge machinery as chat, so state never drifts
  between surfaces. Games standings and Fantasy standings stay fully separate.
- **2026-08-06** — **Challenge close-out (Phases 3C/3D/3E) SHIPPED** (PR #83): Rematch
  from the completed chat card and the member sheet — always a new linked challenge
  (rematch chains share one series id), prep sheet opens prefilled with the game
  preselected; a duel's pack is burned once either player has duelled on it. The h2h
  result screen gains Share (system share sheet with copy fallback) and Back to the
  league for the two participants. Challenge analytics events across accept, decline,
  cancel, result views, rematches and shares. The master prompt's acceptance loop is
  complete: pick a league rival, choose a game, send it, play, settle the result in
  the league, run it back.
- **2026-08-06** — **Challenge adapters (Phase 3B) SHIPPED** (PR #82; mig 259 applied):
  **Quiz Duel** — pick a quiz neither of you has played, you both play it fresh, best
  score wins. Attempts are held privately (own row only) until both sides finish, so
  nobody can see the other player's answers or score mid duel; the same server grading
  engine as Quiz Battle scores both sides. **Gameday Quiz** challenges are live too: a
  matchday pack head to head, riding the Quiz Battle machinery (first real pack lands
  at GW1). The challenge sheet now opens with a game picker (Quiz Battle, Quiz Duel,
  Gameday Quiz) plus a duel pack picker filtered to packs neither player has tried,
  and a finished challenge always offers a fresh Challenge action alongside the result.
- **2026-08-06** — **Challenge lifecycle (Phase 3A) SHIPPED** (PR #81; mig 258 applied):
  one-tap accept — the opponent's Play tap IS acceptance (locked), no separate Accept
  step; challenger can Cancel while pending; decline is quiet and stamped. A completed
  challenge posts one compact result message into league chat on top of the card
  updating in place (locked), with the winner calculated server-side off the linked h2h
  row and `scoring_version` stamped. Challenges carry an optional 140-character message
  (quoted on the card) and created-from attribution, and creation is rate limited to 10
  an hour. The member action sheet chip is now a state machine (Challenge / Pending /
  Your turn / Back in / In play / See result). Locked roster for the next phase (3B):
  Quiz Duel (both play fresh after accept, rides h2h `mode`) + Gameday pack adapter;
  38-0 deferred. NOTE: all challenge notifications ride `notifyFantasy`, which is still
  dark on prod until `FANTASY_NOTIFY_ENABLED` is flipped in Vercel.
- **2026-08-06** — **Native video upload UNBLOCKED in prod** (PR #80): CSP `media-src`
  was missing `blob:` so every native upload failed at the client probe, and the
  `post-media` bucket had lost its insert/delete policies (photo uploads had never
  worked — 0 objects ever). Both fixed and browser-verified end to end; league chat
  video card no longer collapses on tap.
- **2026-08-06** — **Native video SHIPPED across Social** (PRs #77/#78/#79; migs 256+257
  applied; `post-videos` bucket + project upload cap 100MB): direct upload from iPhone
  (60s / 100MB / one per post, MIME-sniffed, progress + retry + cancel, client-captured
  poster), one shared inline player (poster first, muted hysteresis autoplay, one active
  player at a time, session sound memory, reduced-motion and data-saver respected, honest
  "Video unavailable." fallback), fullscreen with scrub + position handoff. Video in
  replies (tap to play) and league chat (compact card, never autoplays), share-to-league
  cards carry the poster, profile Media tab shows video tiles with duration. External
  links: YouTube gets a lazy tap-to-load nocookie embed; any og:video page gets a rich
  "Watch on <publisher>" preview; everything else keeps the plain card — never a dead
  player, nothing rehosted. Video combines with player cards, fixtures and polls in one
  post. Architecture is Supabase storage direct (founder call: no transcoding service);
  accepted risk: an HEVC-only .mov may not decode on Android/Chrome and falls back
  honestly.

- **2026-08-06** — **People layer SHIPPED, all 3 phases** (PRs #74/#75/#76; mig 255
  applied): **1A structured @mentions** — composers store validated
  `{userId, usernameSnapshot}` entities in `payload.mentions` (posts, replies, league
  chat; legacy rows keep the regex fallback); league chat gets member-first @autocomplete
  off a new roster endpoint (instant from 1 char); people search now excludes blocked
  accounts everywhere and ranks followed users first in mention mode. **1B member
  actions** — one shared MemberActionSheet from league table (row tap; round chart moved
  inside), chat avatars/names, hub, and a new searchable members list (position/A-Z sort,
  OWNER badge); Compare squads sheet (facts only: points, captain/vice, shared vs
  differential) off a new shared-league-gated `/leagues/[code]/squad` endpoint; Mention
  routes into chat (`?mention=`) or the post composer (`?compose=`). **1C challenge
  foundation** — `member_challenges` table (participant-read RLS, service-role writes,
  one open pending challenge per pair+game), Quiz Battle only (rides the real
  h2h_challenges backend end to end: create → chat invitation card with Accept/Decline →
  opponent plays at /h2h/[id] → reconcile flips to completed/expired with winner),
  Challenge/Pending chip on the member sheet, ChallengePrepSheet with quiz picker;
  gameday_quiz + 38-0 documented as future adapters, never rendered.
- **2026-08-06 (am)** — **Social polish batch SHIPPED** (PR #73, no migrations) after a
  founder /ux-walk + hands-on pass: caught-up terminal now doors into Discover (walk A4);
  floating Sign In/Up pill hidden on /fantasy/social — the join bar owns the one ask, nav
  door stays (walk B5, master prompt §21); **player picker default fixed** (no-query list
  was the first 20 of a club-ordered pool = a wall of Arsenal reading as club-locked; now
  price-desc big names across clubs); sheets lock html+body scroll (jumpy background);
  **composer modernised to X grade**: glassy translucent sheet (24px backdrop blur, inset
  highlight, layered shadow), bare 20px teal SVG icon toolbar (image/GIF/poll/shirt/
  calendar; 40px hit areas, aria-labels), placeholder + entry pill now "What's happening?"
  (quote mode keeps "Add a comment"), every emoji icon + dashed outline gone, feed React/
  Share controls matched. LOCKED STYLE RULE (founder, 6 Aug): social surfaces use glassy/
  glossy elements + bare SVG icon rows, never emoji icons, never dashed outlines.
- **2026-08-06** — **Social Phase 5b SHIPPED (PR #72) — THE SOCIAL MASTER BUILD PROMPT IS
  COMPLETE (all 5 phases, PRs #61 #62 #63 #64 #65 #67 #69 #71 #72, migs 250-253 applied).**
  5b: For You Top ranking (`src/lib/fantasy/feedRank.ts`, pure fns, 12 unit tests: score =
  reactions + 2x comments + 3x reposts, 24h half-life decay, 1.25x follow boost; diversity
  pass caps consecutive same-author/same-class at 2, demote never drop; Latest untouched;
  Top ranks within the fetched window). Discover chips Trending/Players/Leagues/Polls/
  Squads/Games + Managers kept; **Trending = raw engagement >= 5 in 48h, hard floor, under
  3 qualifiers shows the honest empty state** (founder rule: never fake trends). Search
  overlay (Users/Posts/Leagues/Players; posts = 30-day ilike, wildcard-escaped,
  deleted/bot/blocked filtered via hydrateEvents). trackSocial.ts analytics on the
  trackDiag transport (§27 events). A11y pass on all social components (labels, focus trap,
  aria-live polls, reduced motion, 44px targets; composer thumb micro-badges stay small,
  documented). Verified live: trending floor holds, diversity active on prod data (max 1
  consecutive same-author in Top), 12/12 tests re-run by reviewer.
- **2026-08-06 (small hours)** — **Social Phase 5a SAFETY SHIPPED** (PR #71; **mig 253
  APPLIED**: `social_reports` insert-own/service-reads + `user_blocks`/`user_mutes` own-row
  RLS): report post/message/profile (reason sheet, one per reporter per subject), BLOCK
  (bidirectional server-side hide in one batched query across feed/detail/league feed/chat
  AND all comment threads — review pass added threads; hidden top-level comments tombstone;
  follows severed both ways; league member lists/tables still show blocked members, shared
  spaces), MUTE (one-way), delete-own-content (posts soft-delete via payload flag, stubs for
  reposts/quotes; chat wires comment soft-delete), /admin/reports queue (is_admin gate),
  and CURSOR PAGINATION on the feed (infinite scroll; Top ranks within each fetched window,
  documented; builder caught a stale-closure bug that silently disabled scroll loading).
  App Store UGC compliance surface (report + block) now exists. Bot-drilled live: block
  hides then unblock restores, report dedupes to one row, encoded cursor pages correctly.
- **2026-08-05** — **PENALTIES RETIRED + LA LIGA RETIRED (founder call: both gone completely,
  branch `chore/remove-pens-laliga`).** (1) The interactive penalty shootout is deleted end to
  end — engine, 2D scene, `/38-0/match/pens`, kick/pens API routes, sprites, models, Blender
  pipeline, sfx. **A drawn played match now stands as a draw** in every mode (quick / ranked /
  challenge / live H2H; live phase machine goes half2 → result, legacy in-flight
  `penalties`/`draw_decision` rows fall through to result). WC drawn knockouts + the 3-pt
  qualification play-off are settled by the **quiz decider only** (the pens-vs-question chooser
  is gone). Historic pens wins keep their winners via silent legacy reads; **migration 254**
  settles stranded `pens_pending` rows as draws and drops `draft_live_kick`. `pensSeed` →
  `serverSeed` (`seed-server.ts`, same env/pepper so dealt slates stay valid). (2) **La Liga is
  gone as a competition** — tab, pool (dataset rebuilt PL-only, 2.7MB → 1.3MB), importer,
  badges (30 files), launch email, board toggle, queued marketing. `League` = `"PL"` only;
  `asLeague()` normalises legacy `"LaLiga"` rows/teams to PL; DB rows keep their history.
  §5's feature table + Competitions block updated. 88/88 engine tests, tsc, lint, `next build`
  all clean.

- **2026-08-05** — **Postgame fantasy promo SHIPPED** (branch `feat/postgame-fantasy-promo`).
  Every game end now advertises YourScore Fantasy twice: (1) a full-screen **interstitial
  pop-up** before the results screen — FULL TIME + the player's score always visible on top,
  under it a gold-glow advert (mini CSS pitch with Saka/Haaland/Palmer portraits from the
  licensed PL headshot map in `src/lib/fantasy/faces.ts`, big "FANTASY PREMIER LEAGUE / ON
  YOURSCORE" type, founder copy, one CTA **BUILD YOUR TEAM →** — guests route via sign-in with
  `next=/fantasy?ref=postgame-pop`); (2) a quieter inline `FantasyPromoCard` on the results
  screen itself (CTA PLAY FANTASY → `/fantasy?ref=postgame`). Interstitial fires on EVERY game
  end until the player owns a fantasy squad (founder call): squad owners are suppressed via one
  `GET /api/fantasy/state` per browser session (sessionStorage cache, permanent localStorage
  stamp once a squad is seen; fetch failure fails CLOSED). It only fires on a genuine
  just-finished transition — each surface passes its own gate (quiz: answered this session;
  P10: prev phase was "playing"; WC run: went active→terminal this mount; live H2H: observed a
  pre-result phase) — so revisiting an old result or opening a shared match link never pops.
  Surfaces: quiz solo, multiplayer quiz, Perfect 10, 38-0 quick match, WC run, live H2H
  (+ inline card also on the public `/38-0/match/[id]` share page, pop-up deliberately not).
  Diagnostics: `fantasy_pop_shown` / `fantasy_pop_click` / `fantasy_promo_click` with the
  surface name. Components: `src/components/fantasy/FantasyResultInterstitial.tsx`,
  `FantasyPromoCard.tsx`.
- **2026-08-05 (late, 4)** — **Social Phase 4b hub states + system messages SHIPPED** (PR #69,
  no migrations — comments.kind is free text): pre-deadline READINESS block on the league hub
  ("{n} of {m} squads in" + neutral "Waiting on..." avatars; NOTE: no captain-unset state
  exists — captain is auto-assigned at squad build, mig 200), post-gameweek recap card
  (winner + biggest riser off the season table's movement field, unit-tested incl. GW1
  null-movement), and three deduped SYSTEM messages in league chat (centred muted lines,
  excluded from unread + previews): "Gameweek N is live" (scoreGameweek, once per gw),
  "{name} joined the league" (joinLeague), "{name} moved into first" (finaliseGameweek,
  settled only). Both scoring hooks are void fire-and-forget + swallow errors — cannot
  block scoring. ⚠️ Hooks + recap unobservable before GW1 (nothing has ever scored):
  **confirm system lines + recap render correctly when GW1 scores on 21 Aug.** Pre-existing
  guest 401 on club-league chat GET flagged (spawn-task chip raised), not fixed here.
  **PHASES 1 THROUGH 4 OF THE SOCIAL MASTER PROMPT ARE NOW COMPLETE.**
- **2026-08-05 (late, 3)** — **Social Phase 4a league chat upgrade SHIPPED** (PR #67; **mig 252
  APPLIED** — adds only `fantasy_leagues.pinned_message_id`; replies reuse `comments.parent_id`
  live since mig 221): replies with quoted context on every chat kind (one level deep, reply-to-
  reply flattens to the top-level parent), 5-minute sender grouping, images in chat (post-media
  pipeline, bucket-validated, MediaGallery on tap), share-a-feed-post-into-chat (new `feed`
  ChatKind, id-only payload resolved fresh each read, unavailable stub), owner-pinned message
  banner (403 for non-owners; degrades hidden pre-migration). Chat payload reports
  `capabilities {replies, pin}`. Bot-drilled in an ephemeral league (created, drilled, purged).
  Typing indicators DEFERRED by founder (polling chat, no presence infra).
- **2026-08-05 (late, 2)** — **Social Phase 3b SHIPPED** (PR #65; **migration 251 APPLIED**:
  `fantasy_feed_bookmarks` own-row RLS + `profiles.pinned_event_id`): bookmarks (overflow
  menu, acts on the original for reposts; Saved list at /fantasy/social/saved, entry beside
  Discover sub-tabs), @mention autocomplete in composer + comments (prefix search gated
  behind `mode=mention` — Discover keeps its substring match, shared-surface rule; review
  caught the builder silently changing it), server-resolved mention linkify (unknown handles
  stay plain), mention + repost notifications via notifyFantasy (cap 5, never self/synthetic,
  fantasy_feed comments only), notification centre All | Mentions | Leagues tabs (all-read-
  on-open kept), profile Posts | Replies | Media tabs + pin-your-own-post (403 otherwise;
  player card/ladder/medals untouched). Drilled live: bookmark toggle + hydrate, pin 403,
  Discover substring regression. Mention-notify happy path code-reviewed only (a live drill
  would push a REAL user).
- **2026-08-05 (late)** — **Social Phase 3a conversation SHIPPED** (PR #64, zero migrations):
  post detail pages at `/fantasy/social/post/[id]` (guest-viewable, thread expanded; legacy
  `?e=` engagement-email deep links redirect there; post share links now target it; body tap
  on plain posts opens it), **reposts** (`payload.repostOf` pointer rows; chain-resolved to
  the original; one per user per original; undo; "Reposted by {name}" above the ORIGINAL
  card whose reactions/comments stay keyed to the original) and **quote posts**
  (`payload.quoteOf`; compact tappable embed; quote-of-quote renders as a link, never nested
  cards; missing targets render "This post is unavailable"). Bot-authored rows 404 on detail
  and stay feed-filtered. Verified with reviewer bot drills (dup rejected, undo, quote) on a
  live dev server; drill rows deleted.
- **2026-08-05 (night)** — **Social Phase 2b SHIPPED** (PR #63; **migration 250 APPLIED to
  prod**): pasted links auto-unfurl in the composer (debounced, dismissable) and render as
  tappable cards in the feed. `/api/unfurl` is signed-in-only with a full SSRF guard
  (private/reserved v4+v6 ranges incl. CGNAT/TEST-NETs/mapped-v6/ULA, literal-IP + localhost
  checks, DNS check per REDIRECT HOP, 3-hop cap, 5s timeout, 512KB body cap) and a 7-day
  `link_previews` cache (RLS deny-all, anon-curl verified; falls back to uncached fetch on
  table errors). **Polls now have durations** (1h/6h/24h/3d, default 24h; `endsAt` computed
  server-side from a whitelist; votes after close 400 "Poll closed"; closed polls show final
  results; legacy polls stay open forever). **Player + fixture attachments** in the composer
  (pool search sheet; current-GW fixture sheet off `fetchFixturesWindow` — NOT the news
  difficulty ticker, which has no match pairs); toolbar = Photo/GIF/Poll/Player/Fixture, one
  row at 375px. Fixed pre-existing: `commentRejection` bans URLs, so every link post 400'd —
  posts opt out via `allowLinks`, comments/chat keep the ban. Accepted residuals, documented
  in PR #63: DNS-rebinding TOCTOU (fix = pinned-IP dispatch) and feed preview images loading
  from external origins (fix = image proxy). Deferred by founder: comparison cards, game
  attachments. Phases 3-5 (replies/reposts/notifications; league hub+chat; discovery/
  ranking/search) not started.
- **2026-08-05 (eve, later)** — **Social Phase 2a rich media SHIPPED** (PR #62). Posts take
  up to FOUR images (`payload.images[]`, per-thumb upload state, remove/reorder; legacy
  single `payload.image` untouched) with feed layouts 1 large / 2 columns / 3 large+pair /
  4 grid (`ImageGrid`) and a full-screen `MediaGallery` (swipe, pinch zoom, counter, scroll
  lock). **GIF posting is live via Klipy** (`GifPicker`: search + trending + Celebration/
  Reactions/Disappointment/Banter chips; GIF and images mutually exclusive): `/api/gif/*`
  proxy keeps `KLIPY_API_KEY` server-side (set in Vercel + .env.local; missing key = graceful
  "GIF search isn't available yet" state); feed renders GIFs as looping muted mp4 video,
  paused offscreen via IntersectionObserver. ⚠️ Klipy nests media under quality tiers
  (`file.{hd,md,sm}.{mp4,webp,gif,jpg}`) — the mapper descends them (`src/lib/gif.ts`),
  verified against the live API + a full bot round trip into the DB. `postToFeed` accepts
  gif URLs only from klipy.com/subdomains (`ALLOWED_GIF_HOSTS`). No migrations.
  Deferred from Phase 2 by founder: player-comparison cards, game-result attachments.
- **2026-08-05 (eve)** — **Social Phase 1 visual upgrade SHIPPED** (PR #61, merge `42ae427`) —
  first slice of the new Social master build prompt (5 Aug), which supersedes the 3 Aug spec.
  Social tabs renamed **For You | Following | Discover** (internal id stays `live`, old `?tab=`
  links work); **Top | Latest** sort lives only inside For You; tab + sort persist
  (`ys:social:tab` / `ys:social:sort`, URL `?tab=` wins). Feed is a **flat timeline** — the
  per-post rounded cards are gone, posts are rows split by 1px dividers. Reactions collapsed
  to ONE React control + a top-3 emoji summary chip; the 6-emoji tray opens on tap. Action row
  (React · Comment · Share) never wraps at 375px, ~44px tap targets. Tab panes stay mounted
  after first visit so switching keeps scroll + data (zero refetch, verified). Composer entry
  is the user's avatar + "Share your FPL take". Signed-out visitors get a sticky portaled
  "Join YourScore" bar that measures the real BottomNav height live (guest nav is 80px at
  375px — "Premier League" wraps; never hardcode 58px). **Squad feed posts keep the FULL
  pitch** — founder settled the 3×-flipped question on 5 Aug: PR #60 stands, the compact card
  built for this branch was deleted in review; do not re-compact without a fresh founder yes.
  No migrations, no API changes. Phases 2–5 of the master prompt (media/GIF/link unfurl,
  replies/reposts/notification centre, league hub+chat, discovery/ranking/search) are separate
  gated /feature runs, not started.
- **2026-08-05 (later)** — **Bot community variety pass.** (1) **Drifters** — the 50 seed
  accounts now double as one-line-a-day visitors: 2–3 per London day (deterministic pick) each
  post ONE thing — a real quiz score or a short one-liner — at a random waking hour, so the feed
  shows NEW names every day instead of the same cast per scroll. (2) **Follower trim** — a
  standard contributor has 3–4 followers at most; existing bot follow edges trimmed on prod and
  the seeding script now creates 1–3 each way. (3) **Around-the-app energy** — casual lines about
  38-0 runs and quiz head-to-heads, plus "why don't you play me?" challenge replies under quiz
  scores. (4) **De-synced stamps** — posts written by one cron run get jittered created_at
  (up to ~22 min back) so nothing lands on the same minute.

- **2026-08-05** — **Bot community realism pass (founder feedback: "it feels batch-generated").**
  (1) **Real identities** — gimmick names (Template Tim, Banter FC, Captain Cal…) replaced with
  names modelled on ACTUAL sign-up patterns (marcr, jordo88, Ellie, suecarter, tomo_9…); renamed
  in code AND in place on prod, posts kept. (2) **London clock** — hard sleep 23:00–07:00
  Europe/London on ALL bot actions, plus per-hour activity bands (commute/lunch/evening peaks).
  (3) **Tempo** — per-persona cooldowns (5h–30h, jittered) + deterministic day-offs, so some
  accounts post twice a day and others vanish for days. (4) **Getting-started phase until Sat
  8 Aug** — new `casual` category ("nah I'm ripping this up again", "rate this midfield pls")
  dominates and tidy discussion polls are suppressed while real users are still finding the app.
  (5) **Lopsided engagement** — a third of ticks add nothing; occasional magnet post collects a
  cluster on 1–2 emojis; every poll has a seeded favoured option (~65%), rare vote surges.
  (6) **Compact squad cards** — only the first squad pitch in the feed renders full-size; later
  ones collapse to "C {captain} · V {vice} · 15 players picked · Show squad ›" (FeedStream).
  (7) Persona writing styles (caps never/proper) drive `roughen()`. Existing prod feed data was
  restamped/rebalanced to match (waking-hours timestamps, thinned even reactions).

- **2026-08-04 (late)** — **Bot community v1: launch-week ramp, replies, squad reveals, marked
  profiles.** The 16-persona cast now arrives in waves (7 on day 0 → 11 on day 2 → 16 on day 4;
  `activeBotPersonas` gated on `BOT_LAUNCH_EPOCH_MS`, enforced in the tick AND the backfill). The
  hourly tick also drops 0–2 REPLIES under items 20 min–36 h old (real-user content first, max 2
  bot comments per item; canned lines only where the reply can't contradict the target — template
  posts, polls by option name, quiz scores, squad reveals; real users' free-text posts get
  reactions, never replies) and occasionally posts a one-time squad reveal per persona (direct
  insert, never `emitFeedEvent` — the emit path would push notifications to followers). New
  low-weight `meta` category on day-0 personas only: early-community posts (feature asks, mild
  criticism, 🫡). New take/banter templates from an FPL-Twitter format sweep (talk-me-out-of,
  draft-number jokes, eye-test vs spreadsheet, grudge picks, week-late-season) — all pool-driven,
  no invented news. `roughen()` adds light grammar variance (lowercase starts, dropped full stops,
  missing apostrophes) so 16 accounts don't share one copy editor. Bot profiles now carry a
  visible **"🤖 Automated community account"** chip (`/profile/[userId]`, `profiles.source='bot'`).
  "mate" → "friend" in the one template that broke the copy rule.

- **2026-08-04** — **FPL-Twitter feed pass: bot personas + quiz results + Twitter-grammar cards.**
  Feed cards now show bold name / muted `@handle` / inline time + a ⋯ menu (share, copy link,
  profile, invite). New `quiz_result` feed kind (mig 248) from strong quiz/knowledge-round
  finishes; posts can embed a player card. 16 bot personas (`botContent.ts`, `scripts/fantasy/
  bots.sh`, hourly `/api/cron/fantasy-bots`) drip FPL-Twitter takes/polls/banter — pre-season-safe
  voice, `source='bot'`, one-command teardown. See Confirmed preamble. **Prod steps pending:**
  apply mig 248, run `bots.sh` + `--seed-handles` + `--backfill`.

- **2026-08-04** — **Engagement email fallback for non-app users** (ships DARK behind
  `ENGAGEMENT_EMAILS_ENABLED`). Twitter-style events (likes, replies, feed reactions) reach people
  without the app by email: the **first 2 a day** send as individual emails the moment they happen
  (templates 31), everything after is held and wrapped into **one end-of-day digest** at 19:00 UTC
  (template 32 + `cron/engagement-digest`), which also lists what the managers you follow did today.
  "No app" = no `device_tokens` row (same signal gameday uses), so nobody the push reached is
  double-emailed; suppression-aware; unsubscribe on every send. Also closes a real gap: **liking a
  feed post used to notify nobody** — `feed_reaction` now writes an aggregated inbox row too (mig 248
  adds `notifications.emailed_at` + the feed-reaction aggregate index). Friend requests keep their
  existing dedicated immediate email, unchanged.
- **2026-08-04** — **Fantasy identity + guest access.** (1) Settings now has a real **Display
  name** field, separate from the @username (previously username was mirrored into display_name);
  it's the headline shown above the @handle. (2) Every activity feed (Social, league feed, Hub
  rail) leads with display name over @handle and shows the crest of the club the manager
  **supports** (club_supporters), matching the quiz. (3) **All Fantasy tabs are open to guests** —
  a signed-out visitor can browse every tab and build a full XI; only SAVE needs an account
  (build → sign-in keeps the local draft). (4) `/api/og/fantasy-squad` now sends edge cache-control
  so a crawler burst stops re-rendering the Satori card each hit (Vercel CPU usage alert).
- **2026-08-02** — **Rules page: four missing definitions added** (`/fantasy/rules` + rules bot
  grounding). Gap analysis vs the Premier League's own FPL explainer ecosystem found four rules
  the engine enforces but nothing user facing defined; all four are now in THE DETAIL (new LIVE
  SCORES AND THE CALENDAR section) and `buildRulesDoc()`, engine verified: live provisional
  scores settle a few hours after the last kickoff and finalise the day after; assists are
  whatever the official match data credits; a double gameweek scores each match separately and
  sums; prices snapshot at gameweek open and hold all week. Two new bot pills (score finality,
  blank/double). The `rules-qa` route now strips dashes from model output.

- **2026-08-02** — **Home Mastermind tile no longer promises "Daily · £100".** The signed-in
  home's compact mode-tile row (Dashboard `ModeTiles`) still sold the Mastermind tile with a
  cash prize, but all giveaways were retired on 13 Jul and the WC daily run ended with the
  tournament (19 Jul) — a false cash promise on every signed-in home. Sub-copy is now
  **"WC quiz"**, matching the row's mode-blurb style (Draft XI / Fast Qs). One line in
  `src/components/home/Dashboard.tsx`, shipped `02fabd3`. Closes app-audit S4.

- **2026-08-02** — **Versus promo tile at the top of the Play tab** (see Confirmed preamble).
  Versus has no bottom-nav slot, so the games tab now opens with an ad tile for it →
  `/versus`. Hidden on the Build a Quiz sub-tab. `src/app/play/page.tsx` only, no migration.

- **2026-08-02** — **Fantasy tab is now feed-first.** Tapping **Fantasy** lands on a social
  **Home** instead of the squad. App nav is unchanged (Home · Play · Premier League · Fantasy ·
  Profile); this is all *inside* the tab. Two layers: a **"You" strip** (where you stand — squad
  in / build it, deadline, rank once scored) and a **feed** that degrades so it is NEVER blank —
  your leagues' chatter (one-tap into chat) → other managers' moves (people you follow, else the
  global game) → get-started nudges (start a league / follow) → a cold floor. The squad moved to
  **`/fantasy/squad`**; the internal nav is now **Home · Squad · Scout · Leagues** (the old
  standalone Feed folds into Home). New: `fantasyHome()` + `GET /api/fantasy/home` + `FantasyHome`.
  Squad-return links in build/round/transfers/plan repointed to `/fantasy/squad`. (§9)
- **2026-08-01** — **Private league polish 2 + a league feed.** (1) **Chat composer is now a
  slim bar PINNED above the nav** (`position: fixed`, not the earlier sticky that scrolled away);
  (2) **tighter message spacing** — reactions are tap-to-open (no dead ＋ row padding every
  message), the Hub/Chat/Table/History tab strip is thinner; (3) **keeper's name no longer
  clipped** in shared/feed squads (reserve room past the square pitch edge — chat, the new league
  feed, and the main `/fantasy/feed`); (4) **NEW: a "Recent activity" rail on the Hub** above the
  chat tile — a horizontal, swipeable feed of the league's own moves (squads, transfers, captains,
  hauls), with **"See all →" into a full league feed page** (`/fantasy/leagues/[code]/feed`). Data
  via `loadLeagueFeed` (the global feed, filtered to member ids) + `leagueFeed()` +
  `GET /api/fantasy/leagues/[code]/feed`, member-gated. (§9)
- **2026-08-01** — **Fantasy slickness pass.** (1) **The squares are now on EVERY fantasy
  screen** — the faint grid backdrop is painted once globally via `main[data-fantasy]::before`
  in globals.css (keyed off the attribute every fantasy `<main>` already sets), so leagues,
  chat, players, knowledge etc. no longer ship flat; removed the per-screen `bg-grid-pattern`
  divs from FantasyHub/FantasyTeaser. (2) **League Chat redesign** (`LeagueChatView`): compact
  composer, tighter message rhythm, **shared squads render full-width**, and **colour-coded
  entry types** — gold captain, lime poll, amber news, teal squad/player/compare. (3) **Hub chat
  preview** now summarises structured cards ("📊 …", "👕 shared your squad") instead of leaking
  the raw internal body. (§9)
- **2026-08-01** — **Fantasy "How it works" redesign + rules bot** (`/fantasy/rules`). The
  numbered walkthrough is replaced by an eight-card story stepper (tap/swipe, segmented
  progress) whose scenes are LIVE slices of the real app: real SportMonks player faces and
  real prices from the public `/api/fantasy/pool`, this gameweek's real fixtures from
  `/api/pl/fixtures`, scoring rows computed by `pointsFor` — static samples as silent
  fallback. Reference detail sections and the computed scoring table stay below. New
  floating rules bot: 16 canned engine-computed Q&As answer instantly; free text goes to
  `POST /api/fantasy/rules-qa` (Haiku, grounded ONLY in `buildRulesDoc()` from
  `rulesFaq.ts`, refuses off-topic, behind `withFantasyUser` auth + allowlist + rate
  limit; degrades to canned-only if the model is unreachable). No migration.

- **2026-07-30** — **Feed UX fixes.** (1) **Back from a profile returns to the same view** — scope +
  sort live in the feed URL (`?scope=&sort=`, kept via `history.replaceState`), so back restores
  the tab (and Next restores scroll) instead of dumping you on Following. (2) **No Following tab
  when you follow nobody** — the feed API returns `followingCount`; 0 → only Global shows (and a
  following-scope request falls back to global). (3) **Sort: Recent or Top** — Top ranks by
  engagement (likes + comments), like old IG; feed API `sort` param, in-memory rank over a wider
  window. (4) **Shortlist tiles open the player** — tap the player on a shortlist/squad-update tile
  to open the scout `PlayerProfile` sheet (feed carries the player's pool id). Also fixed a
  hydration mismatch (don't read `window` in a `useState` initializer — restore the URL in a mount
  effect).

- **2026-07-30** — **Feed share cards + Instagram-compact comments.** (1) **Share any manager's
  squad from the feed** — the Share button mints a squad share CARD (`/api/fantasy/share` now
  accepts a `userId`, so it builds the card for that manager, not just the caller; resolves to the
  existing `/s/<id>` + `/api/og/fantasy-squad`). Squads are public, so this is fine. (2) **Comments
  are now Instagram-style**: composer moved to the BOTTOM as a compact "Add a comment…" pill (was a
  bulky top input that pushed the thread off screen), tighter per-row padding + spacing, so several
  comments fit on screen and posting keeps the thread in view (`DiscussionThread`).

- **2026-07-30** — **Feed + squad-tab polish pass.** (1) **squad_complete feed tiles now render the
  real pitch board** — formation rows + **club crests** on each marker (new `PlayerMarker` crest,
  `SquadBoard` passes `club`), captain gold-ringed; payload carries xi+bench+captain+vice.
  (2) Copy "finalised" → **"selected their squad"** (pre-season = filled the spaces, nothing to
  submit). (3) **Share** button on squad tiles (native share of the manager's profile). (4) Seed
  avatars: ~72% now null (monogram) — an all-avatars roster read as fake. (5) **Squad-tab hero**
  dropped the "already entered, nothing to submit" copy for "Change your team… play the weekly quiz
  to earn transfers" + a tappable **"Earn transfers by playing the weekly quiz"** explainer tile →
  `/fantasy/rules`. (6) **"Move Bank" → "Transfer Bank"**, and it now lists the three chip powers
  (Triple Captain / Bench Boost / Insight) by name. (7) **Chips tile** gold-tinted + **not playable
  pre-GW1** ("unlock once gameweek 1 kicks off"). (8) Fantasy nav **tab titles bigger** (13.5→16,
  pills unchanged).

- **2026-07-30** — **Feed activity is now PRE-SEASON, with faces.** The season hasn't started, so
  nobody's making transfers or playing chips — they're building teams. New feed event types (mig
  231): **`squad_complete`** (finalised their squad — the tile renders the XI as player headshots,
  captain ringed gold), **`squad_update`** (added a player), **`shortlist_add`** (shortlisted a
  player — tile shows the portrait). Real emitters wired: `squad_complete` on first squad finalise
  (`createSquad`, `!existing` only, no spam), `shortlist_add` on a genuinely-new shortlist star.
  `feed.ts` resolves payload player-ids → faces off the pool. The 50 seed managers were re-fed to
  pre-season activity (`seed-users.sh --refeed`): squad_complete (40) + shortlist_add (43) +
  squad_update (19), no transfers/chips. transfer/captain/chip/haul/rank_jump types stay — they come
  alive at GW1.

- **2026-07-30** — **Cold-start: 50 seed managers + follower/following lists + a feed discover door.**
  Two UX-walk gaps closed and the follow graph bootstrapped. (1) **Follower/following counts are now
  tappable** → `/profile/[id]/followers` + `/following` list pages (`FollowList` + `/api/follow/list`);
  each row's follow state is primed by the list so there's no per-row fetch (`FollowButton`
  `initialFollowing`). (2) **Feed empty state has an on-ramp** — a "Find managers to follow" button +
  a persistent "Find managers" pill → `/fantasy/feed/discover` (managers ranked by followers, minus
  you + those you follow). (3) **50 seed managers** (`scripts/fantasy/seed-users.ts`, mig 229
  `profiles.is_seed`): real auth users, realistic handles + avatars, a legal £100m squad each (real
  engine/preset solver), webbed into a follow graph (~386 edges), light feed activity (transfers/
  chips, ~41 events) — **NO fabricated points/ranks** (standings fill honestly from GW1). Every seed
  is `is_seed`, excludable from prizes/analytics; `seed-users.sh --teardown` wipes them in one go,
  `--rename` re-handles them in place. Names are realistic careless-signup handles (adam766, beardo,
  dave186, josh, kalvin21 — modelled on real usernames, not copies), not banter. **Seeds are
  EXCLUDED from the competitive standings** (mig 230 rebuilt `fantasy_global_standings` +
  `fantasy_rank_jumps` to inner-join `profiles` and drop `is_seed`), so they never rank against real
  managers or claim prizes; they stay social (followable, in the feed) only.
- **2026-07-30** — **Fantasy social suite + a one-way follow layer.** Four surfaces (migs 224–226):
  (1) **Weekly teams on profiles** — a "Fantasy XI by gameweek" section on own + public profiles,
  a gameweek-chip selector over a read-only SquadBoard; "This week" is the live team (public on
  submit), numbered chips are the immutable `fantasy_deadline_squad` snapshots, GW total once
  scored. (2) **Global standings** on the league tab — rank every fantasy player, month the hero
  (shown by NAME, e.g. "August"), Season/This-week toggles; `fantasy_global_standings` RPC
  (mig 224) aggregates in SQL past the 1000-row cap, returns top N + your row. (3) **Follow
  layer, LIVE app-wide (NOT gated)** — one-way `user_follows` (mig 225), coexists with the mutual
  `friendships` system (friends = play together, follow = spectate/feed); `FollowButton` rides
  the shared `AddFriendCard` onto every game surface (opt-out `showFollow`); follower/following
  counts + Follow on profiles; `/api/follow`. (4) **Activity feed** (`/fantasy/feed`, new FEED
  nav tab) — Following/Global tabs of interesting moves; `fantasy_feed_events` + `fantasy_feed_likes`
  (mig 226), `comments.subject_type` gains `'fantasy_feed'` so each move reuses the like/comment/
  reply stack. Emitted on transfers + chip plays now; **big hauls + rank jumps** emit at settle
  time from `finaliseGameweek` (idempotent + fail-open) — hauls via a filtered read (>= 80 pts),
  rank jumps via the `fantasy_rank_jumps` RPC (mig 227, global rank before vs after the gw,
  climbers only; none at GW1). Thresholds (haul 80, jump 100 places, cap 25/type) are TUNABLE —
  calibrate against the real spread after GW1. Surfaces 1/2/4 are founder-gated (dark until
  launch); the follow layer is live now.
- **2026-07-30** — **Comment push notifications, deep links, and a public quiz thread page.** Stage 3
  of 3, no migration. **Push** (native, opt-in respected, via `notifyUsers`): a like pushes only on
  the **first** like of a comment, forever (dedupe key `comment-like:<commentId>` in
  `notification_log`, which logs before delivery and is never pruned); **every reply** pushes
  (`comment-reply:<replyId>`). Unlike-then-relike does NOT push again. No quiet hours. Self actions
  and `fantasy_league` chat push nothing. **Deep links**: notification rows and push payloads carry
  `/debate?c=<commentId>` or `/play/pack/<packId>?c=<commentId>`; the thread scrolls that comment to
  centre, **auto-expands its parent if it is a collapsed reply**, and flashes a highlight that clears
  after 2s. A missing or deleted target is a silent no-op. Push taps already routed natively
  (`push.ts` reads `data.url`), so no native change. **New public page `/play/pack/[packId]`** gives a
  quiz pack's thread its own home (previously threads only existed inside a Lobby), gated on
  `status = published`, selecting only safe columns and **never `quiz_packs.questions`**; reachable
  from a "Talk about this quiz" link on the quiz results screen. "Play this quiz" goes to **solo**
  play (`/challenges/<slug>?pid=<packId>`), not multiplayer matchmaking. A debate deep link whose
  comment belongs to an older debate lands cleanly on the **current day's** debate (the page always
  renders today's; the missing target is a silent no-op, verified: 200, no errors, nothing leaked).
- **2026-07-30** — **PL News: a half-view sheet instead of a browser tab, and a feed that is
  actually PL.** Tapping a card in Matchweek → PL → News no longer punts the reader out to the
  outlet. It opens **`PlNewsSheet`** over the feed: hero image, source and time, headline, and the
  outlet's own standfirst, with **Read the full story** (the only thing that leaves the app) and
  **Share**. **Swipe up for the next story, swipe down to close**; the sheet walks the list as the
  active chip filters it. On the pull-in side: **two new desks** (Sky Sports' PL feed, The Standard)
  alongside BBC and Guardian, every item now carries the feed's `<description>` as **`summary`**
  (free — it was being fetched and thrown away, so no model cost), and a **`isPremierLeague` gate at
  the ingest** keeps the PL tab to PL stories (was: all football, World Cup and Scottish Prem
  included). Two bugs fixed on the way — a Sky `pubDate` of "…BST" threw on `.toISOString()` and
  silently killed that whole source, and numeric entities went unrendered ("&#163;51m"). (§7)
- **2026-07-30** — **Daily Briefing: the day's five biggest PL stories, as links** (migration 228,
  `pl_briefings`, one row per London date). A tile sits above the news feed — "DAILY BRIEFING ·
  Today" over a compiled subhead like *"Guimaraes set for Arsenal, Real Madrid eye Rodri and more"* —
  and opens **`/matchweek/briefing`**: the subhead, five numbered bullets, then the five source
  articles with their own thumbnails and outbound links. **We publish no reporting of our own**, and
  that is enforced, not just intended: the model may only compress the outlets' headlines and
  standfirsts, and every proper noun and number in a bullet must trace back to **that story's own**
  payload (reusing `isProseGrounded` from the fantasy tips) or it is replaced with the outlet's words
  verbatim. `rejected` in the cron response counts those replacements — it fired on the first live
  run, correctly. **"Biggest" is measured, not guessed:** stories are clustered by shared names and
  ranked by **how many separate desks ran them**, which the nine-desk feed made possible. New cron
  `/api/cron/pl-briefing` at 06:40 UTC; safe to re-run (upsert by date). Two bugs caught on the first
  live run: cluster entity sets grew by union, so one cluster became a magnet that swallowed eight
  desks and led the briefing on the *Football Daily* podcast (seeds are now fixed); and the model
  ignored the subhead length limit (90 chars), so `tidySubhead` now trims to whole hooks. (§7)
- **2026-07-30** — **The half-view sheet is now shared, and the Fantasy feed uses it too.**
  `PlNewsSheet` became **`src/components/news/NewsSheet.tsx`**, fed a neutral `SheetStory` shape so
  each feed maps its own items and keeps its own clock. Fantasy news cards were still links straight
  out to a browser tab — the exact thing the PL feed had just stopped doing — and now open the same
  sheet. **Tweets** get the treatment too: gold handle and accent (as everywhere else a tweet
  appears), the text set as body copy rather than a headline, and a **"Read on X"** primary button.
  Swiping stays **inside the section you tapped** (team news vs transfers) — sliding from one into
  the other mid-swipe reads as a bug. (§7)
- **2026-07-30** — **PL News reads NINE desks, and feed parsing moves to `src/lib/rss.ts`.** Added
  **FootballLondon, Football365, Sports Mole, Sport Witness and SPORTbible** to BBC, Guardian, Sky
  and the Standard. Three things had to be built for them: **Atom support** (SPORTbible publish
  `<entry>` from `index.rss`, not `<item>`, and the old parser silently returned zero for it), an
  **image fallback to the first real `<img>` in `content:encoded`** (WordPress desks ship no media
  tags, so they rendered as walls of text), and a **`requireCategory`** filter (SPORTbible run NBA
  and UFC through the same feed). A **per-desk cap of 8** stops Sports Mole's ~148 items a pull from
  owning the feed. Measured live: **40 items, 38 with an image, 40 with a summary**, all nine desks
  represented, and every image host verified to load in-browser. `scripts/pl-news-ingest.mjs` now
  **imports the real source list and gate from `src/`** (node strips the types) instead of carrying
  hand-synced copies that had already drifted. **Goal.com and FootballTransfers.com publish no feed
  at all** and were left out — they would need scraping. (§7)
- **2026-07-30** — **Fantasy desks feed the fantasy river, not PL news.** **Fantasy Football Scout**
  and **FantasyFootball247** land in `fantasy_news_items` (topic `general` → "Transfers & talk") via
  a new `ingestFantasyRss` called from the existing hourly `/api/cron/fantasy-news` — no new cron,
  no new trust boundary. They stay OUT of PL news on purpose: that feed is general football, tips
  and price talk belong to the Fantasy tab. Rows carry the story's **own publish time** (defaulting
  to `now()` would stamp a three-day-old post as "just now") and a **14-day cutoff** drops the May
  and June posts still sitting in FF247's feed. Note: **Fantasy Football Scout's RSS carries no
  image in any field**, so their cards are text-only — nothing to fix in code, the data isn't
  there. (§7)
- **2026-07-30** — **In-app notification inbox: bell in the home header + `/notifications`** (migration
  222). Stage 2 of 3 on the comment layer. A **bell** sits in the Dashboard header beside the profile
  circle with a lime dot when anything is unread, computed **server-side** inside the home page's
  existing `Promise.all` (no client fetch, no pop-in; the home screen is the most-hit surface).
  **Comment likes notify the author aggregated per comment** ("Dan and 1 other liked your comment" —
  one upserted row per comment carrying a count and the latest actor); **replies notify per reply**.
  A new like resurfaces the row as unread; **an unlike never does**. You are never notified about your
  own action, and `fantasy_league` chat generates nothing. **The two daily pushes (Today's Game 12:30,
  Today's Debate 08:30) now also write ONE broadcast inbox row each** — stored once with `user_id`
  null, visible to ALL users including web users who cannot receive push, never fanned out (10,206
  profiles vs 266 device tokens: a fan-out would be 20,412 rows a day). Read state is a **single
  `profiles.notifications_read_at` timestamp** — opening the page marks everything read in one write,
  no per-row bookkeeping; broadcasts age out of the page at 30 days. Notification writes are
  fire-and-forget and can never fail a like or a reply. RLS: read your own rows plus broadcasts, and
  no write policy at all (service role only). ⚠️ Known, not fixed: a lost-update race can leave
  `like_count` off by one when two people like in the same instant (upgrade path is an atomic
  increment RPC). Stage 3 (push for likes/replies, deep-link to a comment with scroll and highlight)
  is NOT built.
- **2026-07-30** — **Club page rebuilt as per-category quiz carousels; Quiz "Club" tab → "PL Club".**
  Going into a club (`/club/[slug]`) used to show four *topic* tiles that hid the actual quizzes behind
  a bottom sheet of "Quiz 1 / Quiz 2 / Quiz 3" — poor discoverability. It now renders **one section per
  category** (History & Honours / Legends / Modern Era / Rivalries), each a **horizontal scroller of the
  real quiz packs**, selectable directly; the volume sheet is gone. Cards use the **club crest** (no
  per-category poster art) on **smaller tiles**, led by a **themed title**. Those titles were backfilled
  into `quiz_packs.title` for all **98** club topic packs, each derived from 2–3 of the pack's own
  questions (e.g. *The Invincibles Era*, *The Merseyside Derby*, *Henry & the Greats*; generic mixes get
  functional names like *Club Essentials* / *Seasons & Stats*). `/api/club-page/[slug]` now returns
  `title`; a "Volume I/II" label is the fallback. The Quiz Solo sub-tab set is now **Featured / World Cup
  / PL Club / Records / Build a Quiz**. Also this window: nav glow on the Play + Fantasy tabs, and the
  `/play` pack grid went 3-up (Featured club cards keep their "Premier League 2025/26" theme; the PL Club
  grid is crest + OPEN only).
- **2026-07-30** — **Discussion threads become conversations: replies, collapse, and club crests**
  (migration 221). Stage 1 of 3. **Replies** are Instagram-shaped and **exactly two levels** — a flat
  tier under each top-level comment; replying to a reply lands in that same tier. Depth is guaranteed
  by a DB trigger (`comments_validate_reply`), not UI convention: a reply-to-a-reply, a reply to a
  soft-deleted comment, or a reply crossing subjects all fail at the database with 23514, and the API
  mirrors each as a clean 400. **Collapse** applies to replies only — 2 shown, then "View N more
  replies" (top-level list is never collapsed). **Club crest** sits between the commenter's name and
  the timestamp, read LIVE from `club_supporters` (latest row per user, one batched query — never
  stamped onto the comment row, so a club change updates old comments); no club renders nothing, no
  placeholder. Replying is **auth-gated only, NOT vote-gated** (founder call): on the debate card an
  un-voted signed-in user can reply even while the top-level composer stays locked. A soft-deleted
  parent that still has replies renders as a "Comment deleted" tombstone **in its chronological
  position**, replies intact, carrying no identifying fields (not even `userId`). `Crest` extracted to
  `src/components/ui/Crest.tsx` (`fantasy/shared.tsx` re-exports it). Replies share the existing 8/min
  comment bucket. Lands on BOTH surfaces (today's debate + quiz packs) via the shared component.
  ⚠️ Known, not fixed: account deletion still hard-deletes other users' replies via the `auth.users` +
  `parent_id` cascades; the 500-reply and 50-top-level page caps can truncate very large threads.
  Stages 2–3 (notifications for likes/replies; deep-link to a comment) are NOT built.
- **2026-07-30** — **Instagram-style likes on discussion threads** (migration 100, PR #32). Heart +
  counter on every comment, across all `DiscussionThread` surfaces (today's debate and quiz-pack
  threads — shared component, no prop gate). `comment_likes` table (composite PK, self-write RLS,
  no public read; API aggregates via service role). GET `/api/comments` now returns `likeCount` +
  `likedByMe` and runs `private,no-store` (was `public,s-maxage=15`) since `likedByMe` is per-user.
  POST/DELETE `/api/comments/like`, idempotent, rate-limited 30/min. Guest tap on heart bounces to
  sign-in (same gate as posting). Tally caps at 5000 raw rows/page for now (upgrade path: count RPC).
- **2026-07-29** — **Fantasy squad builder: "Start Fast" + real player faces.** Two shippable-now
  pieces on top of the Manager's-Matchday board. **(1) Start Fast** kills the cold-start wall: an
  empty squad now shows one-tap **starter presets** (three spend shapes — Stacked attack / Balanced
  / Solid at the back), and you can **pick up to 3 core players** (must-haves) that a shape then
  **builds a legal £100m squad around**, keeping them as you **flip** shapes. Board-first; the strip
  is collapsible and a hand edit tucks it away (the header always brings it back). Pure, tested
  solver `lib/fantasy/presets.ts` (greedy + feasibility guard + cheapest-legal fallback; anchors
  always survive a flip). **(2) Player faces everywhere.** `scripts/fantasy/build-pool-faces.mjs`
  bakes SportMonks headshots for the whole pool by pool id → `data/fantasy/pool-faces.json` (~99%
  coverage, no new API surface); `clientPricedPool` exposes `avatarUrl`, and every player surface
  now draws a portrait (SM photo → licensed PL photo → monogram, never a broken image): the pitch,
  the core-player chips, the add list, the Transfer Room candidate/prospect lists + "selling" card,
  the **player profile sheet** (`PlayerDetailSheet`), the planner and the hub/final-story. No
  migrations, no engine change. (§5B fantasy)
- **2026-07-28** — **A supported club can now be changed, once every 30 days** (migration 212).
  Supersedes the old season-long lock: a fan may switch their `club_supporters` club at most once
  per 30 days, measured from a new `changed_at` column. The first pick is free and starts the first
  30-day window. Enforced in the DB (a BEFORE UPDATE cooldown trigger re-stamps the clock and
  rejects a change inside the window; the validity trigger now covers updates too) and reflected in
  the UI: `ClubPicker` warns "you won't be able to change your club for 30 days" on first pick, and
  Settings' `ClubSetting` shows the next-eligible date while cooling then a **Change club** action
  once it is up. `/api/clubs/me` GET returns `canChangeNow`/`canChangeAt`; POST allows the change
  but 409s with the date if still inside the window. The anti-hopping intent survives in softer
  form (once a month, not never). (§ club-fan leaderboard)
- **2026-07-26** — **Fantasy squads open 1 August** (three weeks before the season, so players
  can plan). Copy updated on the "Save my spot" card (`WaitlistCard`), the `/fantasy` teaser
  tab (`FantasyTeaser`), and the games page; season/first-whistle references stay 21 August.
  Also removed the "COMING SOON" pills from the two `SeasonSection` squares (Fantasy + Gameday).
- **2026-07-25** — **38-0 promo tile on the app home** (`Play38Tile` in `Dashboard.tsx`, under
  Today's debate). Sells the viral team-builder with a mini 4-3-3 pitch graphic + "38-0"
  scoreboard chip; links to `/38-0`. App home only — deliberately NOT on `MarketingLanding`
  (the signed-out web homepage). (§7)
- **2026-07-24** — **App Store rating asks are counted, and paced by Games played** (migrations
  104 + 105). We could not previously answer "how many review requests have we made?" for any
  surface, ever: the post-game ask was gated by a localStorage stamp that left no server-side
  trace and reset on reinstall, so 7 GB ratings had no denominator. `review_prompts` now logs
  every ask shown, with surface, variant and outcome. Three behaviour changes with it. **The ask
  no longer requires a win** — it needed a points increase measured against an on-device rank
  snapshot, so it skipped anyone on a bad run and could never fire on a returning player's first
  Game on a new phone. **Apple's native star popup is gone**: it converts better, but Apple never
  reports who rated through it, so "once they rate we stop asking" could not be honoured there.
  Every ask is now our own card, which is observable, and acting on it is terminal and lifetime.
  **The schedule counts Games, not days** — asks land on Games 3, 6, 10, 15, then the gap widens
  by one each time (21, 28, 36…). `profiles.games_played` was the obvious home for the count and
  is dead (0 across all 10,001 rows, written by nothing); `player_game_counts` replaces it, seeded
  from every real play record across all games and both sides of 38-0 (7,146 players, 70,104
  Games) so veterans are not treated as new. Card copy rewritten to lead with the ask and give a
  reason the player benefits. ⚠️ The copy names the Premier League and **needs swapping on
  2026-08-21**. Related: the iOS app is delisted across all 27 EU storefronts (Ireland 404s),
  which caps ratings far harder than prompt frequency does.

- **2026-07-24** — **Club page: back button reachable, and back retraces your steps** (founder).
  `/club/[slug]` has no GamesNav above it, so the back pill sat at the very top of the viewport —
  under the iOS status bar / Dynamic Island — and couldn't be tapped; it now takes the safe-area
  inset (`pt-safe`). Separately, the Quiz hub's solo sub-tab (Featured / World Cup / **Club** /
  Records) was local state the nav trail couldn't see, so tapping back from a club landed on a
  reset-to-Featured `/play`. The sub-tab is mirrored in the URL now (`/play?solo=club`), so
  smart-back retraces to the exact tab the player left.
- **2026-07-23 (late)** — **Pro's club ask is a POP-UP, not a section** (founder). A 20-crest
  grid sitting inline pushed the formation picker and the draft button off the screen and read
  as another form to fill in before you could play. It's now a sheet on the same pattern as the
  global `ClubPrompt`, dismissible by **Not now** or by tapping the backdrop.
  What stays inline is a **one-line status row** once they have a club — *"Pro is asking about
  Arsenal · 35 questions"* with **Change** for guests, **Locked** for signed-in players. That
  row is the fix for the UX-walk cross where the club was invisible with no way to change it,
  so it is not a section and must not be removed.
  ⚠️ **`picking` is held separately from `current`** in `ProClubPrompt`. Conflating them was a
  real bug: **Change** cleared the saved club to reveal the picker, so cancelling left a club
  still saved and nothing on screen saying so — the exact problem the status row exists to
  solve. Cancelling an edit is not the same as waving the question away, so it also does not
  burn the session skip.

- **2026-07-23 (eve)** — **Every Pro question is now independently verified, and three wrong
  answers were retired from the live bank.** Founder's bar: zero wrong answers.
  **The three retired in prod** (all `status=retired`, each shown 0 times, so no player ever
  saw one): Forest's European Cups answered 1 (they won two, 1979 and 1980); West Ham's
  answered 1 (they have won none — Cup Winners' Cup 1965 and Conference League 2023 are
  different competitions); AFC Bournemouth's nickname given as "The Cherries Boscombe", two
  names concatenated, with the correct answer not among the options. **Retired, not re-keyed** —
  re-keying means writing answer keys from recall, which is the exact failure that produced
  them. Reversible, and it matches what `clean-live.mjs` already does.
  **Every one of the 278 then went through the factory's real Stage 2 gate**
  (`scripts/draft/verify-pl-quiz.mjs` → `verify.mjs verifyQuestion`): a fresh context, never
  told the author's answer, must search, derive it independently and cite a URL. Disagreement,
  no source, low confidence or any flagged ambiguity fails. **216 passed, 62 failed.**
  Verification is now a **hard, fail-closed gate on the build** — a question absent from
  `scripts/data/pl-quiz-verify.jsonl` does not ship, so adding questions later *requires*
  re-running the verifier. Results are checkpointed per question and the run resumes.
  **It found 4 more wrong answers no filter could have caught:** both Spurs nickname questions
  offer "The Spurs" AND "The Lilywhites" (both real, so whichever is keyed a correct player is
  marked wrong); Bournemouth's stadium offers "Dean Court" and "The Vitality Stadium" (same
  ground, traditional vs sponsored name); and a Brentford/Chelsea/Fulham season the verifier
  resolves differently. 56 more failed as ambiguous — about half genuine (the 1970 FA Cup
  question lists both the final score 2-2 and the replay 2-1; Salah has since tied Gerrard's
  Everton record so "who holds it" now has two answers), about half conservative over-flags.
  **Kept the conservative ones as failures** — the bar is zero wrong answers, and every failure
  is recoverable from the checkpoint.
  **Bundle 278 → 216, neutral 74 → 66.** Coventry still 0; Ipswich 1, Hull 2, and Sunderland,
  Forest, Leeds, Bournemouth 3 each. ⚠️ **Neutral 66 is thin** — that's the pool a guest or
  no-club player draws from, so repeats start around 6 drafts. Growing it needs new questions,
  and they must pass the verifier to ship.
  ⚠️ Filter ORDER matters in the build: the content gates (denylist, verification) run LAST.
  Putting them first made every shape filter report zero and blanked the coin-flip cut sheet,
  destroying the record of what was removed. Diagnostics first, gates last.

- **2026-07-23 (pm)** — **Pro: coin-flip questions cut from the gate.** If all four options
  are bare numbers the question can't be answered by knowing football: "How many goals did
  Salah score in 2024-25?" [28/30/29/31] is a 1-in-4 guess however much you know. In Pro a
  wrong answer caps the pick at 72 AND resets the streak, so a guess costs a player, which
  directly contradicts the mode's premise. **213 questions cut; bundle 452 → 280, neutral
  96 → 75** (still ~7 drafts before a repeat). No club is wiped out; Coventry was already 0,
  Sunderland 4, Hull and Ipswich 2 each. A test now fails the build if one creeps back.
  ⚠️ **The cut is deliberately blunt and takes good questions with it.** Forest's two
  European Cups [2/1/3/0] is iconic and knowable; Manchester United's 13 FA Cups
  [11/15/12/13] is not — and they are structurally identical, so no filter can tell them
  apart. Everything removed is listed in `scripts/data/pl-quiz-cut-numeric.md` for hand
  restoring (which means re-authoring the options, not just re-adding the row).
  🐛 **Found incidentally: a wrong answer live in the bank.** `076f2b3d-bd51-40f6-ab49-0bdaf37d5b78`
  ("How many European Cup / Champions League titles have Nottingham Forest won?") is `active`
  and answers **1**. Forest won **two** (1979 Malmö, 1980 Hamburg) and dozens of *retired*
  Forest questions in the same bank say so. Shown 0 times so far, so nobody has hit it. **Not
  edited — a live-bank write is the founder's call.** It suggests the bank's fact-checking
  isn't airtight, which is worth knowing before the question review.

- **2026-07-23** — **38-0: EXPERT mode retired, Premier League leads, Pro's UX walk fixed**
  (branch `feat/38-0-pl-gated`, not on `main`).
  **Expert is gone.** 38-0 is classic only (founder). The DIFFICULTY switcher is removed and
  nothing honours `mode:"expert"` on read any more — `redraft`, `swap`, `team` and `season`
  all render legacy expert teams like everyone else, so nobody is stranded in a format with
  no switch left to leave it. The `DraftMode` union and the field stay so saved localStorage
  teams keep parsing. **Do not reintroduce a difficulty switch without asking.**
  **Tab order is Premier League, Leaderboard, WC Mastermind** (La Liga retired 2026-08-05),
  and PL is the default tab. It's the year-round game and the one with Pro; the World Cup is over.
  **A `/ux-walk` of Pro returned FAIL and all five crosses are fixed:**
  1. **Copy gate** — em dashes had crept back into new copy. Cleared across the whole 38-0
     hub, the draft loop, QuizGate and ProClubPrompt, including the pre-existing WC strings
     on the same page. Placeholder glyphs (an empty OVERALL) are now "0", not a dash.
  2. **The club grid promised what 3 clubs can't deliver.** Measured: over 22 draws a
     Coventry fan got **0** own-club questions, Ipswich 0, Hull 1, against Arsenal's 11 —
     while being told "Pro asks about your team". The picker now states the real number
     before you commit ("No Coventry questions yet, so Pro will ask you Premier League
     ones" / "62 Arsenal questions, mixed in"). Counts ship in a new answer-free
     `src/data/draft/pl-quiz-clubs.json`, because `pl-quiz.json` carries every answer and
     is server-only.
  3. **The gate had no exit** — once open, the only ways out were answering or waiting out
     the 25s clock, which grades as a miss anyway. There's now a "Skip this one (counts as a
     miss)" that costs exactly what the timeout already cost. Verified: skipping deals a
     squad capped at 70, inside the 72 wrong-answer ceiling.
  4. **A guest's club was invisible and unchangeable.** ProClubPrompt used to self-hide once
     set, so the club was never named in the flow and a mis-tapped crest was permanent. It
     now shows a status row ("Pro is asking about Liverpool") with **Change** for guests;
     signed-in players see "Locked", because theirs is a season-locked competition entry.
  5. **Pro sat 344px below the fold** under a full pitch diagram while the sticky CTA
     started the *other* mode. HOW YOU DRAFT now comes before PICK YOUR SHAPE: 1156px → 540px,
     above the fold. Which game you're playing outranks which shape you play it in.

- **2026-07-21** — **38-0 Premier League now has two modes: PRO and JUST DRAFT**
  (branch `feat/38-0-pl-gated`, not on `main`). **"Pro" is the locked player-facing name**
  (founder, 2026-07-22); the code says `gated` throughout because that's the mechanic —
  don't rename the flag, and don't call the mode "Gated" in any copy. Pro is a *difficulty*,
  never a paid tier: the app promises "Free forever — no subscription, no catch", so Pro
  copy must always read as skill, and the card carries a ⚽ not a padlock.
  Pro brings the World Cup Mastermind
  mechanic to the PL tab: every spin is unlocked by a Premier League question, and a
  correct **streak** raises both the floor and ceiling of the quality band the squad is
  dealt from — a wrong answer caps the pick at 72 overall, ~streak 5 opens the elite tier.
  Same band maths as WC (`src/lib/draft/draft-quiz.ts`, untouched). **Replayable, not a
  daily ranked competition** — no locks, no new board, no new tables; it feeds the existing
  team → season → H2H flow. Just Draft is byte-identical to the old behaviour.
  New: `src/lib/draft/pl-quiz.ts` (server-only — it carries every answer),
  `/api/draft/pl/gate-quiz` (stateless, seed-graded, anonymous-OK — cloned from the WC
  practice-quiz route), `src/components/draft/QuizGate.tsx` (shared gate UI; **the WC page
  still renders its own inline copy — migrating it is a deliberate follow-up**), and an
  optional band argument on `spin()` in `pool.ts`.
  **The question bank (357) is a snapshot of the live `questions` bank**, built by
  `scripts/draft/build-pl-quiz.mjs` → `src/data/draft/pl-quiz.json`, with a review sheet at
  `scripts/data/pl-quiz-review.md`. Inclusion rule is the founder's: *if it involves a
  Premier League club, it's in* — tallies, cup competitions and pre-1992 all stay. Only two
  shapes are cut: finishing-position recall (105 rows — verifiable but a neutral fan lands
  none of them) and answers that are two answers concatenated ("The Villans The Lions", 5
  rows — they make a distractor correct too). **Note `Premier League Records` files under its
  own categories** (`PL Records`, `PL History`, `PL 2024-25`) so the script queries it
  separately — miss that and the 32 most on-brief questions in the bank vanish.
  **A failed gate is graded as a MISS, never a free pass.** The first cut fell back to an
  unbanded spin (0–99) so a draft couldn't dead-end on a network blip — which made failure
  the strongest move in the game: trip the endpoint's rate limit and every remaining pick
  came through ungated at full quality. Now a refused/failed gate resets the streak and caps
  the pick exactly as a wrong answer does (verified: forced 429 deals a squad topping out at
  72, not 99). The limit also went 60→120 req/min per IP, because one draft is 22 requests
  and punishing a rate-limited player makes shared IPs (pub wifi, carrier NAT) a real UX
  problem rather than just an abuse control.
  **SCOPED to who's asking (founder review, 2026-07-22).** The first bundle read as club
  trivia — 274 of 357 questions needed one club's internal history, so a Liverpool fan got
  asked about Aston Villa's honours. Now every question carries a `scope` and a player is
  only ever asked two kinds: **neutral** (Premier League records, history, league-wide
  moments — everyone) and **their own club's** (from `club_supporters`, season-locked). A
  guest, or anyone who hasn't picked a club, draws the neutral pool alone — no special case.
  Bundle is now **452 questions: 96 neutral + 356 club-scoped across 19 clubs.** Mix is
  uncapped by choice: an Arsenal fan draws from 158, a Sunderland fan from 102, a guest 96,
  so how often you meet your own club just follows how much material it has.
  Two traps worth knowing. (1) Two thirds of the neutral pool is *club-filed but
  league-wide in framing* ("Which club was Harry Kane at when he won the Golden Boot?") —
  without that reclassification the neutral pool is 32, not 96. (2) `club_supporters.club`
  and `questions.entity` are different name spaces: "AFC Bournemouth"→"Bournemouth",
  "Brighton & Hove Albion"→"Brighton", and **Coventry City has no entity at all** (11 fans →
  neutral only). A missed alias doesn't error, it silently gives those fans zero club
  questions, so the map ships inside the bundle.
  **The club is signed, not trusted.** The pool a seed draws from depends on the club, so
  the same seed with a different club derives a different question. Sending the club back
  as a plain value would let a wrong answer be re-graded against each club in turn until one
  matched (~25% a go). The draw HMACs (seed, club) with the server secret and the grade call
  verifies it — swapped club, forged sig and omitted sig all return 400 (verified).
  **Pro asks for a club itself, and GUESTS are asked too** (founder, 2026-07-22).
  `ClubPrompt` (global, layout.tsx) already asks new signed-in accounts, but a skip there
  sticks for the session and it never explains what a club does in 38-0. So Pro has its own
  `ProClubPrompt` (`src/components/draft/ProClubPrompt.tsx`), shown under the PL tab only
  when **Pro** is selected, with its own skip key so an earlier skip doesn't silence it. It
  leads with the concrete reason — *"Get asked about your team"* — and never blocks: Pro
  plays fine on the neutral pool.
  **A guest's pick is local, and that's the conversion hook** — they can't have a
  `club_supporters` row (no `profiles` row), so it lives in localStorage
  (`src/lib/clubs/guestClub.ts`), flavours their questions immediately, and gives them a
  reason to make an account: to keep it. `ClubPrompt` then pre-selects that pick after
  sign-up and clears the local copy once the real row is written.
  ⚠️ **The two picks are NOT the same promise and the copy must never blur them.** A
  signed-in declaration is a competition entry, changeable at most once every 30 days ("locked
  for 30 days"; migration 212); a guest's is a freely changeable device-local preference ("saved
  on this device — make an account to keep it"). Never tell a guest their pick is locked.
  **Trust boundary:** on `draw`, a `club` in the request body is honoured **only when signed
  out**. A signed-in player's club always comes from `club_supporters`, so a locked entry
  can't be overridden from the client (verified: bot locked to Sunderland, sent Arsenal, got
  Sunderland + zero Arsenal questions). Guest clubs are validated against the bundle, so a
  bogus one ("Real Madrid") falls back to neutral rather than erroring.
  ⚠️ **The bundle is NOT founder-reviewed yet** — `pl-quiz-review.md` is the gate before
  ship. It now splits **Neutral** (read these hardest — they go to everybody) from
  **Club-scoped** (only ever seen by that club's own fans, so they can be as parochial as
  you like).

- **2026-07-20 (pm)** — **Versus guest dead-end fixed** (`src/app/versus/page.tsx`, working
  tree, not yet committed). Signed-out users hitting Versus got a bare sign-in gate with NO
  BottomNav (guest nav vanished — trapped) and no create-account CTA. Now: guest BottomNav
  stays, primary **CREATE FREE ACCOUNT →** + secondary **SIGN IN** (both to
  `/auth/sign-in?next=/versus`, that page handles both), copy sells the mode. Verified in
  browser desktop+mobile, no console errors.
- **2026-07-20 (pm)** — **Versus psychology-audit fixes** (branch
  `versus/hide-shadow-reveal`, MERGED to main 2026-07-20). Live numbers showed the constraint: 87 of 103
  quiz h2h matches in 14d were shadows (9 human), 255 solo players vs 59 versus players,
  20 new friendships. Fixes: **solo result screen ends on a "Beat someone's score" rail**
  (`BeatScoreRail` + `/api/versus/recommended` + `lib/versus/recommend.ts`) — up to 3
  quizzes the player has NOT attempted where other players' replayable runs are waiting
  (same bar as the shadow pool: score>0, answers log ≥3), each card naming the top runner
  + their score ("@x scored 4,850 · 12 others played"), hero card with faces + top/median;
  tap → `/versus/find` pinned to that pack — fair (unseen questions) AND guaranteed to
  match (those runs ARE the pool). Founder killed the first cut (same-quiz pin — "you'll
  just get the same answers again"; rigged vs a blind shadow). Empty pool → plain
  unpinned FIND AN OPPONENT fallback. Live pool check: top pack 101 players / 5,850 top
  score, so recommendations exist for essentially everyone. Live-now strip's second tile
  falls back to a real **"Matches this fortnight"** aggregate (`matches14d` on
  `/api/versus/activity`) when today's counts are under the show-threshold; the empty
  rivalries section now shows a **first-rivalry teaser** ("play the same player twice")
  instead of vanishing; **shadow opponents get the standard add-friend card** on the
  scorecard (consistent with "they played each other").
- **2026-07-20** — **Shadow matches: the honest reveal is RETIRED** (branch
  `versus/hide-shadow-reveal`, MERGED to main 2026-07-20). Founder call: never disclose the replay — the
  scorecard now presents a shadow match as a normal head-to-head result ("they played each
  other"). The reveal panel ("You just played X's real run from {date}" + PLAY THEIR RUNS /
  CHALLENGE LIVE) is deleted from `/play/[roomId]`; matchmaking chain, persona overlay,
  timing replay, keep-playing panel all unchanged. Owner-side revenge push + the
  `/versus/shadow/[userId]` library still use "run" language — deliberately untouched
  (founder gave no preference; revisit if inconsistent).
- **2026-07-24** — **Fantasy Football: STILL NOT LIVE TO USERS — branch `fantasy/season`.**
  The game is built and the 26/27 season is cut over, but it is deliberately gated: read it
  as *ready to test*, not shipped, until the founder opens it.
  **What changed on 24 Jul:**
  **(1) THE 26/27 CUTOVER IS DONE.** FPL published its 26/27 bootstrap, so the pool was rebuilt
  (season 25583 → 28083, 522 players, 20 clubs, 100% smId coverage among regulars: Coventry,
  Hull and Ipswich in; Burnley, West Ham and Wolves out) and the real 38-gameweek calendar was
  seeded. GW1 deadline **2026-08-21 17:30Z**. The demo was wiped — squads, entries and
  player-scores are zero — **leagues and their members were kept on purpose**.
  ⚠️ `fantasy_gameweeks` is keyed on `gw` alone so it holds ONE season: a single leftover
  replay row puts the whole game back into replay and prices every squad at seed. Verified
  zero replay rows after the cutover.
  ⚠️ `pool.json` is a static import baked into the build, so the pool only reaches users on
  DEPLOY, and `/api/fantasy/pool` sets `s-maxage=3600` — expect up to an hour of the old pool
  from the CDN after a ship unless it is purged.
  **(2) THE BASELINE TRANSFER.** Everyone gets one transfer per gameweek, granted at gameweek
  finalise to every entry including rolled-over managers; the round earns EXTRA ones on top.
  This makes the PL-tab pitch ("One transfer. Earn the rest.") literally true — before 22 Jul
  the engine gave no baseline, so a 2/11 round meant a squad you could not touch. It caps
  rather than cashing out, and the grant rides the scored → final compare-and-swap so a
  double-tap cannot mint two (verified under a real concurrent request).
  **(3) FANTASY IS A PL SECTION, NOT A STANDALONE ROUTE** — reconciled with the nav canon (§9).
  It renders inside the Premier League tab; `/fantasy` survives only as a deep-link target for
  share cards, result emails and the deadline push, and renders the bottom nav so it is not a
  dead end.
  **Still open before it can face users:** no live gameweek has ever run itself end to end
  (the engine is drilled but no real deadline has locked → ingested → scored → finalised on
  its own), and replay-mode testing is no longer available now that the season is live.

- **2026-07-20** — **Perfect 10 gets its own share card (founder)** — a shared Perfect 10
  link used to unfurl the platform-wide YourScore card, which said nothing about the game.
  New `/api/og/perfect-10` renders **the tower itself**: ten tapering rungs, gold where the
  player named the answer, dark where they didn't, plus topic title, PERFECT 10 / TOWER
  FALLS verdict and points. **No names ever appear on the card** (rungs are lit/unlit only)
  so a posted result cannot spoil the list — same rule `buildShareText` follows. Modes:
  `?c=<share_token>` = verified scorecard · `?list=<id>&s=&f=` = **guest** scorecard
  (guests have no attempt row, so their result rides in the link; self-reported and
  forgeable, which is fine as nothing is scored off an image) · bare = promo card with an
  **empty** tower (ten blanks to fill — a fully-lit promo read as somebody's 10/10).
  `page.tsx` is now a thin server shell exporting `generateMetadata` (only a *page*
  receives `searchParams`, which is what lets a challenge link unfurl that player's own
  tower); the game moved unchanged to `Game.tsx`.
- **2026-07-19** — **Home link-preview card redesigned to sell the whole platform
  (founder)** — `/api/og/home` (the og:image every yourscore.app unfurl shows) no longer
  promotes only 38-0: "The Home of Football Gaming" headline + a fanned trio of mocked
  game cards in the app's real design language (38-0 green / Perfect 10 gold with a real
  list topic / Quiz teal). Bebas + DM Sans TTFs now bundled in the route for Satori.
- **2026-07-18** — **Perfect 10: official result card + spoiler-safe X share + back to
  the picker (founder)** — the results screen is now a proper scorecard (topic title,
  PERFECT 10 / TOWER FALLS verdict, big points, n/10 named, then the tower) with the
  house "SHARE YOUR SCORECARD / Post it on 𝕏" CTA (guests included — their link points
  at the game mode; signed-in posts carry the challenge link). **The share text names
  only ~50% of the player's found answers** (every other one, spread down the tower;
  the rest stay `•••` and missed rungs are NEVER revealed) so posting can't give the
  list away — same text for X, native share and copy. New "PICK ANOTHER GAME MODE →"
  button returns to the intro's Game-modes picker (whose primary button reads "SEE MY
  RESULT" once that mode is done, since finished modes can't be replayed).
- **2026-07-18** — **Versus instant match: real opponents before "CPU" + matched-lobby
  cleanup (founder: matching with "CPU" after Find an opponent "is not what should be
  happening")** — the quiz bot fallback now EXHAUSTS shadows before the literal CPU:
  fresh shadow → least-recently-met RERUN (heavy players had emptied the fresh pool,
  which is exactly why the founder kept landing on "CPU") → other published packs
  (generic find only; a pinned find keeps its quiz) → CPU only for a truly empty pool.
  **Same day (follow-up ruling): the CPU seat is never shown as "CPU" anymore** — it
  presents as an imaginary player (deterministic per-room name + generated avatar,
  `cpuPersona()`), across the found screen, lobby, live header and scorecard.
  Resumed bot-seat rooms surface their shadow persona (not the bot profile), and the
  server tags matches `kind: human|shadow|cpu` so the AppsFlyer chain is measured, not
  guessed. Matchmade "Instant Match" lobbies (and any full lobby) no longer show the
  invite-code/QR block — you already have your opponent. Fix: `/play/[roomId]` headers
  (lobby / live / completed) got `pt-safe` — on the wrapped iPhone build the back
  control sat on top of the status-bar clock, leaving players stuck on the lobby page.
- **2026-07-18** — **Perfect 10: topics are GAME MODES, daily framing dropped
  (founder: "forget this daily thing")** — the intro is now a topic picker: "Game
  modes" lists every served list (selected one highlighted, PLAY / n-of-10 / score
  badges), no dates anywhere, no "Previous days" / "today's list" / "latest" copy.
  Server model unchanged: `day` still gates+orders what's served (ops concern only,
  never shown); state/guess/hint/challenge APIs untouched.
- **2026-07-18** — **Games nav is ONE persistent bar (founder: "it's a NAV, not a
  page selector")** — `GamesNav` moved into the root layout: mounts once, shows on
  the five game-section routes, pages swap below it with zero remount/flash
  (verified: same DOM node across all five tab hops). Game pages hide it mid-run via
  `useHideGamesNav`; height published as `--games-nav-h` for the Quiz hub's sticky
  header. Active tab glides to centre on switch. Per-page switcher copies deleted.
- **2026-07-18** — **38-0 competition tabs cleaned up (founder)** — same treatment as
  the quiz filters: the emoji pill-box (🏆 WC Mastermind / ⚽ Premier League / 🇪🇸 La
  Liga / Leaderboard ✓) is now clean underline text tabs, no emoji or badges, each
  competition keeping its accent as the underline. The secondary action pills (Live
  H2H / My Teams / H2H Ladder) are links, not filters — unchanged.
- **2026-07-18** — **No back buttons on game sections (founder)** — games are tabs, so
  the switcher is the navigation: removed the 38-0 hub's "YourScore" BackPill and the
  three game intros' Back buttons; results CTAs relabelled "MORE GAMES" (the games
  aren't Quiz anymore). The in-game exit Back on an active Perfect 10 run stays —
  it's the only way out mid-game.
- **2026-07-18** — **Perfect 10, Higher or Lower, Guess the Player are separate games
  (founder ruling)** — the GameSwitcher is now five games (Quiz | 38-0 | Perfect 10 |
  Higher or Lower | Guess the Player), each with its own section; the switcher renders
  on each game's intro as its section header (never over gameplay), scrolls and
  auto-centres the active tab. The GAME TYPES tile block was removed from the Quiz
  hub. Higher or Lower recoloured to orange #ff7800, Guess the Player to blue #4fc3f7
  (own identities — they'd been borrowing Quiz teal / 38-0 lime). §9 updated.
- **2026-07-18** — **Perfect 10: intro/results scroll snap-back fixed** — the Jul-17
  "pin the board" fix registered its `window.scrollTo(0,0)` pin for the page's whole
  life, but mobile URL-bar collapse fires `resize` MID-SCROLL, so scrolling the intro
  ("Previous days") or results screen snapped back to the top. Pin now applies only in
  the `playing` phase (gameplay still never scrolls); also reset the keyboard-detection
  height baseline on `orientationchange` so rotating to landscape no longer reads as a
  permanently-open keyboard. Repro + fix verified headless (Playwright: scrollY survives
  a resize event; pre-fix build snapped 250→0).
- **2026-07-18** — **38-0 moved under the Play tab (founder ruling)** — the Play tab now
  holds both games via a top **Quiz | 38-0 game switcher** (`GameSwitcher` component) on
  both hubs (`/play`, `/38-0`); routes frozen, switcher navigates. Bottom nav unchanged
  otherwise (Home · Play · Versus · Premier League · Profile); Play highlights on
  `/38-0`. §9 Navigation Canon updated to current truth. **Same day, v2 (founder
  direction):** switcher restyled to Coral-style icon tabs (icon above label, per-game
  colour + underline); the /play solo filter pills (emoji + caps + count badges)
  replaced with clean underline text tabs (Featured / World Cup / Club / Records, no
  counts); Featured tab now leads with a **full-width marketing hero tile** — the lead
  featured pack's cover art with a FEATURED badge + PLAY, falling back to the plain
  grid when the lead pack has no cover.
- **2026-07-16** — **Perfect 10 SHIPPED** — third Quiz game-type: name everyone in a ranked
  top-10 list. Floodlit-tower UI at `/play/game/perfect-10`, daily list (Europe/London),
  hints/strikes, async challenge links, all-PL-history typeahead (4,669 names). Server-only
  answers (mig 85, RLS deny-all). Lists gate-verified before a `day` is assigned. See the
  Confirmed preamble for the full mechanics + gotchas (SportMonks topscorers unreliable;
  season-id alias trap; `scripts/lib/anthropic.mjs` first committed here).
- **2026-07-16 (pm3)** — **Legacy question-bank triage (APPLIED TO PROD).** The bank predates the
  gate, so it was measured against it. Results: **2,823 active → 1,205 (43%) were tagged
  expert/master and are UNREACHABLE** (`/api/quiz/start` is typed `"easy"|"medium"|"hard"` and
  draws 6/6/3 — it can never ask for them). Re-rated the whole bank with the independent rater
  ($0.86): **93% of the "unreachable" genuinely ARE hard** (only 84/1,145 recover), and **554 of
  1,520 served questions (36%) were at the WRONG difficulty** — the old rating was self-declared
  by the author. Applied: **525 difficulties fixed · 73 stranded recovered as easy/medium · 1,070
  left stranded** (genuinely hard AND unverified — recovering them would add unverified questions
  to our most oversupplied tier) · **158 rotting questions retired** (fail temporal/specificity:
  "Reading's MOST RECENT PL season", "who IS the all-time CL scorer"). **The easy shortage is
  STRUCTURAL, not mislabelling** — re-rating everything moves easy 5%→6%; only new authoring fixes
  it. Deleted `/api/cron/reclassify`, which reclassified difficulty from `times_correct/times_answered`
  — the thing the founder explicitly forbade (unscheduled, so harmless, but a landmine).
  **`times_answered` IS incremented** — inside the Postgres RPC `record_quiz_results` (grepping
  `src/` can't see it) — but it's starved, not missing: max 4 answers on any question, and
  `user_question_history` holds 314 rows from ONE user, because `/quiz/create` COPIES bank
  questions into a `quiz_packs` JSONB snapshot and pack plays never report back to the bank row.
  New: `scripts/quiz-factory/{audit-live,rerate-live,clean-live}.mjs`.

- **2026-07-16 (pm2)** — **Quiz factory rebuilt FACTS-FIRST** (founder's call; branch
  `quiz/content-factory`, not on main). The old order was backwards: an author searched the web
  and wrote 30 questions, then a verifier did 30 *more* web searches to check them. Now:
  **gather verified facts → author ONLY from that sheet → cheap consistency check (no web) →
  independent difficulty rating**. Web search happens ONCE per category instead of twice per
  question, and a question derived from a verified fact can't be a hallucination — the worst
  case is a misreading, which is caught without a search. Projection **$346 → ~$58** for the
  full 20-club bank. Facts are reusable across categories and packs. The trade-off, accepted
  knowingly: correlated failure (one bad fact poisons every question from it), mitigated by
  **source tiering** (`scripts/quiz-factory/sources.mjs` — tier 1 governing bodies/official
  club sites, tier 2 major press/Wikipedia/Transfermarkt, everything else = NO source, fact
  dropped) and by the founder reviewing the ~30-fact sheet rather than 30 questions.
  - **Difficulty model** (`scripts/quiz-factory/difficulty.mjs`): assigned **a priori**, never
    from live player answers — club questions are answered by that club's fans, so accuracy
    would measure fandom not difficulty, scores would stop being comparable, and a question
    everyone fails is often *wrong* rather than hard. (`times_answered`/`times_correct` keep a
    job as a **quality alarm**, not a difficulty knob.) **Three levels only** — `/api/quiz/start`
    is typed `"easy"|"medium"|"hard"` and draws 6/6/3, so expert/master are **stranded: 1,101 of
    2,447 club rows (45%) can never be served**. A separate rater (never the author, which drifts)
    scores against a fixed **anchor set**, plus deterministic guards (tight numeric options ⇒
    never easy; 10+ seasons old ⇒ never easy).
  - **Specificity gate** (`checkSpecificity`): now that we hold league AND European data for the
    same club+season, "Arsenal's top scorer in 2015/16" has two answers — every scope-dependent
    question must name the competition.
  - **Category swap: Transfers & Rivalries → European Nights.** Transfer fees aren't in
    SportMonks at any tier (most expensive category, and fees are genuinely disputed — the gate
    killed a Bellingham question over £88.5m-base vs £115m-with-add-ons). European Nights is
    fully groundable off the finals index and is the better fan material.

- **2026-07-16 (pm)** — **SportMonks subscription upgraded to European club tournaments.**
  Accessible competitions are now exactly five: Premier League (8), Champions League (2),
  Europa League (5), Europa Conference (2286), UEFA Super Cup (1328) — all back to 2000/01.
  **No domestic cups** (FA/League Cup remain web-only). `scripts/lib/sportmonks.mjs` gained
  `europeanFinalsIndex()` — every European final since 2000 (67 of them), built once (~200
  calls) and cached, so a club's honours is a free lookup. Getting a cup winner needs two hops
  (fixtures are paginated, the final is never on page 1): `/stages/seasons/{id}` → the stage
  named `Final` → `/fixtures?filters=fixtureStages:{id}` → `participants[].meta.winner`.
  Club fact sheets now carry European honours, so History & Honours grounds ~60% (was ~35%)
  and the full 20-club bank projects at ~$207 (from ~$346 all-web). Spot-checked green: UCL
  23/24 Real Madrid, 18/19 Liverpool, 20/21 Chelsea, UEL 18/19 Chelsea.

- **2026-07-16** — **Quiz factory: SportMonks grounding (the cost fix) + club-bank runner**
  (branch `quiz/content-factory`, NOT on main). `scripts/lib/sportmonks.mjs` builds a
  disk-cached PL fact sheet per club (final tables + points + per-season top scorers, 2000/01→,
  league 8). The fact-check gate now grounds BOTH authoring (`authorBankGrounded`, no web
  search) and verification (`verifyAgainstFacts`, no web search) in that sheet wherever it
  covers the question, with web fallback for what it doesn't. **Measured: Arsenal × Modern-Era
  = $0.12 with zero web searches** (vs ~$4.32 all-web); full 20-club bank projection $346→$222.
  `scripts/quiz-factory/run-bank.mjs` fills the club question BANK (`questions` rows, drawn per
  play — NOT packs), 4 locked categories (History & Honours / Legends / Modern Era / Transfers
  & Rivalries), easy-skewed; default mode is a zero-spend cost projection. `audit-bank.mjs`
  audits the live bank — which turned up FABRICATED questions still active (e.g. "Haaland PL
  goals for Man City 2010-11"), not just staleness, and a 5%-easy / 74%-hard difficulty skew.
  Bank not filled yet — awaiting founder's go on scope.

- **2026-07-15** — **Retention tracking: `ReturnPlay` event + durable device id** (analytics
  plumbing, no user-facing surface). `ReturnPlay` fires once per device the first time a player
  plays on a later calendar day than their first-ever play — the D2+ "they came back" signal,
  fanned out to X/Meta/TikTok/Snapchat/GA4/Vercel/AppsFlyer so ad platforms can finally build
  repeat-player audiences + lookalikes off retained users (they previously optimised for first
  play/signup only). Pure logic in `src/lib/analytics/returnPlay.ts` (unit-tested); fan-out in
  `trackGame.ts`; native arm `afReturnPlay`. Also: a durable anonymous `ys:did` device id, saved
  to new `profiles.device_id` at signup (migration 81, first-touch) so guest activity can later
  be linked to the account. X arm is gated on `NEXT_PUBLIC_X_RETURNPLAY_EVENT_ID` (unset →
  no-op until the X event is created). Phase B (stamp device_id onto guest play rows) still TODO.
- **2026-07-14** — **Quiz content factory** (branch `quiz/content-factory`, ⚠️ NOT on main,
  migration 80 NOT yet applied). Themed packs on a schedule, with approval decoupled from
  release. **The pack lifecycle is now three states**: `draft` (invisible) → approved +
  scheduled (`approved_at` + `release_at` set, still invisible) → `published` +
  `rotation_active` (live). `status='draft'` was always permitted by the CHECK but nothing
  ever wrote it — migration 80 activates it and adds `release_at` / `approved_at` /
  `approved_by` / `theme`.
  - **The factory** (`scripts/quiz-factory/`, weekly VPS cron): pick theme (calendar peg →
    football news → evergreen backlog) → author OVERGENERATED grounded candidates → **the
    gate** → select 15 → deterministic shuffle → write as a draft. Never publishes.
  - **The gate** (`scripts/quiz-factory/verify.mjs`) is the load-bearing part. The bank holds
    2,823 active questions and **31,541 retired** — every `source='generated'` question ever
    written was binned, only `data-grounded` survived. So: Stage 0 (free) rejects temporal
    claims, hedge/duplicate/mixed-type options, and near-dupes against the live bank; Stage 2
    sends each survivor to an **independent** verifier in a fresh context that is NOT told the
    author's answer and must derive it itself and cite a URL — disagreement, ambiguity, no
    source, or an unconfirmed time-sensitive claim all DROP the question. The citation is
    stored in `questions.verification_note`. **A high drop rate is the gate working.**
  - **Review**: `/admin/quiz` — pack cards, every question with its source link. Approving is
    the only way out; `scripts/release-packs.mjs` refuses to publish `approved_at IS NULL`.
  - **Release** (`scripts/release-packs.mjs`, daily VPS cron): flips due+approved packs live,
    pushes via `/api/internal/notify-release` → `notifyUsers()`, emails via `segments.mjs`.
    Idempotent (the UPDATE is its own guard). **Approve nothing → ship nothing**, and it
    Telegrams the drought rather than failing silently. Email self-throttles to ~1.75/week
    per person via the existing frequency cap, so an every-other-day cadence can't burn the list.
  - Lives on the VPS, not Vercel, because `RESEND_CAMPAIGNS_API_KEY` (campaign email) is
    referenced nowhere in `src/` and transactional email is over quota.
  - Also extracted: `scripts/lib/question-text.mjs` (was copy-pasted 4×; must stay in lockstep
    with `src/lib/questions.ts` + migration 67's unique index), `scripts/lib/shuffle-options.mjs`
    (byte-identical extraction from `seed-daily-quiz.mjs`), `scripts/lib/anthropic.mjs` (one
    client + **per-call cost accounting** — web search is the dominant cost and was invisible).
  - **Proven live** (migration 80 applied to prod): state machine 7/7 via
    `scripts/verify-pack-release.mjs`; full 2-pack authoring run built 2/2 with a **23–31%
    gate drop rate** (healthy — the gate is cutting, not rubber-stamping) at **~$3.66/pack**
    (verification = 80% of cost). Registered in the content-dash `registry.json` (weekly
    factory + daily release). ⚠️ VPS cron entries + git commit still pending.

- **2026-07-13 (pm)** — **UI-audit approved fixes** (docs/AUDIT-2026-07-13-ui-first-impressions.md;
  founder walkthrough): site tagline standardized to **"The Home of Football Gaming"** (root
  title/OG/twitter); /how-it-works scoring is **top-line only** (founder: no explicit point
  tables — exact bands stay in-game; fake +200pts/45s copy gone, "Opening Day" demo refreshed);
  **WORLD CUP MASTERMIND title no longer clips** on 375px (fluid clamp in DraftHubHero); landing
  footer gains **Privacy / Terms / Blog** links; **finale week staged**: WcFinaleStrip ("THE
  FINAL — IN N DAYS · board freezes at full time") on the WC picker + season board, self-hides
  after Jul 19. £100 board copy: founder ruled **no change**.
- **2026-07-13 (pm, batch 2)** — **UI-audit round 2 (founder approve/decline)**: landing
  truth pass — the fabricated live-match teaser ("2 watching"/"who's live in a match") REMOVED,
  retired "lose and rebuild" → "lose and go again", the fake match-picking fixture cards
  (June-dated, "+340 pts earned") → real game-result cards (Quiz / 38-0 / Quiz Battle feeding
  one table, evergreen); hero subline now decodes 38-0 ("go 38 games unbeaten"), "Join a league"
  dropped from the hero CTA stack, contradictory "No app needed" caption reworded; **"Challenges"
  → "Quiz"** on public nav/card/footer (locked vocab); footer gains Privacy/Terms/Blog; **daily
  World Cup quiz cards no longer mislabeled "All-Time Records"** (RecordsCard derives "World Cup
  2026" from isWorldCupPack). DECLINED: #7 (keep the illustrative "The Mates" mock leaderboard),
  #10 (desktop tab-bar pass), #14 (hide low debate vote counts). NON-ISSUES (browser-pane render
  glitches, not real defects — DOM verified): the "blank landing screen" and "sign-in white
  logo box". FLAGGED for founder: one stale pack description (id 0f8020c2… "Big Kickoff") — prod
  DB copy write was permission-gated.
- **2026-07-12** — **Guest quiz "You" row + save-your-score claim** (render-only on the
  guest's device — never written to others' boards; localStorage-held answers auto-claimed
  post-sign-up via solo-complete), **WC Mastermind position-targeted drafting** (tap an empty
  slot to scout it; ranked target verified server-side), and **streak-1 band retune 66–76 →
  70–80** (elite still gated at streak 5; no messaging changes). SHIPPED to prod.
- **2026-07-11** — **Product-audit fix batch** (branch `claude/yourscore-ux-audit-pe7e5y`,
  from docs/AUDIT-2026-07-11): win now EARNS the one-player swap again (`recordWin` sets
  `swapAvailable` — the result-screen CTA + team-page banner work again); loss CTA is
  "GO AGAIN →" (stale-team framing removed from UI + this doc); **guests get Practice vs
  CPU** (Quick Match is fully local); Quick Match playback has "Skip to result"; the £25
  giveaway sheet no longer auto-opens over scorecards (inline card opens it); **quiz
  multiplayer resilience**: any Lobby member can advance an overdue question (server
  watchdog + atomic claim in /api/room/next — a vanished host no longer stalls the game),
  refresh/foreground restores the in-flight question, guests hitting a game link get a
  sign-in gate instead of an infinite spinner, spectators are no longer enrolled as
  players, failed answers surface an error + retry; home streak now counts WC-run days
  and lost its limit(12) corruption; PostHog mounted (env-gated, EU host); ~12 routes got
  the fetchCache guard; validate-email rate-limited; realtime kill-switch env-backed;
  Sentry PII off; pinch-zoom re-enabled; sign-up prompts return players to their context
  (`?next=`); h2h accept links full sign-in options; branded global-error screen.
  ⚠️ Quiz-loop changes need an end-to-end multiplayer run before merging to `main`.
- **2026-07-10** — **"Continue with Facebook" built, env-gated** (e129380): renders on the
  sign-in panel between Google and email once `NEXT_PUBLIC_FACEBOOK_LOGIN=1` is set in
  Vercel. NOT live yet — needs a Facebook app (Meta developers console) + the Facebook
  provider enabled in Supabase first. OAuth redirect URI for the Meta app:
  `https://auth.yourscore.app/auth/v1/callback`.
- **2026-07-07** — **Play-level acquisition attribution** (mig 75): WC runs + solo quiz
  attempts now store first-touch `source`/`utm_*` (client sends localStorage `ys:acq` at
  creation; server sanitizes) — plays-per-platform/campaign is now a direct DB query,
  covering guests and pre-capture signups. Paid ad URLs on Meta/TikTok carry UTMs from today.
- **2026-07-06** — WC quiz answer bank is now **server-only** (audit C1): client draws
  answer-free questions via `/api/draft/wc/practice-quiz`; server grades from the seed —
  prevents offline pre-computation of the £100 board. (§5B)
- **2026-07-05** — **Anonymous debate voting** (guests vote device-keyed; sign-up gates the
  argument, not the ballot); **date-allocated debates** (`scripts/seed-debates.mjs` is the
  schedule); **debate share card** + `?pick=` one-tap vote funnel; **back-navigation retrace**
  (session nav trail + smart BackPill fallbacks); **Home v3** (progress card + week dots,
  rivalry module, featured quiz, behaviour rail). (§7 / §9)
- **2026-07-04** — **Daily Debates + discussion threads** (Versus phase 2); email
  **open/click engagement** capture via Resend webhook; Resend **unsubscribes** mirrored into
  `email_suppressions`. (§7)
- **2026-07-03** — **Public player profiles** (`/players/[id]`: record, battles, quizzes,
  add-friend); **Leagues Discover** round 2; email **deliverability** MX-check at signup +
  audience sweep. (§7 / §9)
- **2026-06-27** — **Push notifications LIVE** (opt-in via NotifyOptInCard; WC Mastermind daily
  push at personalized per-timezone send times) — no longer "tied to launch". (§7)
- **2026-06-17** — **Usernames as public identity** (`@username` replaces real-name display
  across profiles, challenge invites, and league tables). (§2)

> **Maintenance:** shipped a product change? Add a line here (newest first) and bump the
> Confirmed date. This list is what keeps the next session from being out of date.

---

## 1. What YourScore Is

**YourScore is a football competition platform — one app, one account, two games, a
shared social layer.** It's where you prove and rank how well you know and understand
football, against your mates, over time.

The two games:
1. **38-0** — a competitive head-to-head **team-builder** game. *(The current flagship /
   acquisition hook.)*
2. **Quiz** — the football-**knowledge** quiz game. *(The depth / retention play.)*

Around them sits a shared layer: accounts, **Friends**, **public profiles**, a **players
database**, and (per game) **Leagues** and rankings — with a unified **YourScore Rank**
being built to bridge the two games.

**Positioning:** 38-0 leads (it's the hook that pulls people in); the Quiz is the depth
that keeps them. In-product quiz tagline: **"Your football knowledge. Ranked."** (say
"football knowledge", never "football IQ").

It is **not a World Cup app.** The FIFA World Cup 2026 (11 Jun – 19 Jul 2026) is the
launch moment / marketing hook; both games are built for football year-round.

---

## 2. Glossary — Locked Terms

Use these words, with these meanings, everywhere. No synonyms.

**Platform & people**
- **YourScore** — the football competition platform (the app) containing 38-0 + Quiz + social.
- **38-0** — the team-builder game (name = an unbeaten 38-game season). *("Draft XI" is the internal/descriptor name only — brand it "38-0".)*
- **Quiz** — the football-knowledge game. *(User-facing label; its route is still `/play` in code — do not change paths.)*
- **Player / User** — anyone using YourScore (signed in or guest).
- **Username** — a player's unique, public handle (e.g. `@lukepingu`); the public-facing identity across profiles, challenge invites, and league tables (replaced exposing real OAuth names). Shipped 2026-06-17.
- **Guest** — no account; can play (esp. 38-0 Quick Match + Quiz solo) but can't earn ranked points / leaderboards / cloud save.
- **Game** — one play-through (a Quiz game or a 38-0 match).

**Quiz terms**
- **Question / Window** — one MCQ; the time allowed to answer (default 30s; speed scored as % of Window).
- **Quiz pack** — a reusable bundled question set; the question source for a Multiplayer Quiz game.
- **Lobby** — the place players group up before a Multiplayer Quiz game (joined via 6-char code). *(DB table still `rooms` — rename pending, §8. Never say "Room".)*
- **Lobby type** — **Private** (invite, ≤8) · **Public** (anyone w/ link, ≤20) · **1v1** (you vs one). *(1v1 = code's `h2h`.)*

**38-0 terms**
- **Pro** — the Premier League draft mode where every Spin is unlocked by a Premier League
  question and your answers set the quality of the squads dealt. Say **"Pro"**, never
  "Gated" (the code's `gated` flag is the mechanic, not the name). It is a **difficulty, not
  a paid tier** — YourScore is free forever, so never dress Pro in padlock/upgrade language.
  A player is only ever asked **neutral** questions or ones about **their own club** — never
  another club's trivia. That rule is the feature, not an implementation detail.
- **Just Draft** — the open Premier League draft: no questions, every squad at full
  quality. The counterpart to Pro, and what 38-0 has always done.
- **Spin** — deal a random squad of real-rated legends (drawn across FIFA editions/eras).
- **Draft** — place spun players into your formation's best-fit slots to build your XI.
- **Strength** — your XI's computed rating (~40–99).
- **Projected season** — Strength mapped to a 38-game record + tier (the "could it go 38-0?" projection).
- **Classic / Expert** — ❌ RETIRED 2026-07-23. Expert (ratings hidden during the draft) is
  gone and the difficulty switch with it; 38-0 is one format now. The `mode` field survives
  only so teams saved as `"expert"` still parse, and nothing honours the value on read.
  **Do not reintroduce a difficulty switch without asking.**
- **Match types** — **Quick Match** (guest/practice, local) · **Ranked** (signed-in, feeds leaderboards — *building*) · **Live H2H** (simultaneous two-half match you watch play out) · **Challenge** (snapshot your XI → friend resolves via share code) · **World Cup Run** (solo WC2026 campaign).
- **Stale team** — ❌ RETIRED concept: a loss now resets the streak but the team stays active (win → earn a one-player swap).

**Leagues & ranking**
- **Quiz League** — a group's table for the Quiz game (`leagues`). Two boards planned: Live / Offline (§6).
- **38-0 League** — a custom group league for 38-0 (`draft_leagues`), joined by code, with its own board.
- **Club League** 🆕 — a *partner-owned, branded* league + community space (a PUB, CREATOR, or SPONSOR). Distinct from the user-created leagues above: own tables (`club_leagues`), own hub at `/l/<slug>`. ⚠️ Built but NOT live (§6/§8). Never conflate "Club League" (partner-owned) with "custom/38-0 league" (user friend-group).
- **YourScore Rank** ✅ — the unified cross-game leaderboard: **YourScore points = Knowledge pts (Quiz) + Match pts (38-0: win 1,500 / draw 500)**; one strict position per player (no shared ranks). Position is the status; badges (👑/Elite/Diamond/…) are cosmetic, derived from position.

---

## 3. Target Audience & Positioning

Two audiences that reinforce each other:

1. **Consumer / friend-groups — the goal.** Football fans and their mate-groups are the
   end users. Growth runs on viral loops (invite your group; some start their own
   leagues/challenges). The objective is always **more users**, and **38-0 is the lead
   hook** because anonymous play + shareable results spread fast.

2. **Pubs & venues — acquisition channel now, product later.** Pubs are a *channel* to
   reach consumer users (`~/yourscore-pub-outreach`), judged by users they bring in.
   Later (roadmap): a dedicated **Pub League**.

---

## 4. Platforms

**Strategic direction: native apps primary.** Native iOS/Android (Capacitor shells around
the web app) are the intended primary distribution, with App Store / Play Store listings
drafted and store-readiness work in progress.

**Current reality: the web app is the primary live product; the iOS app is now LIVE**
(App Store, approved ~2026-06-15). Everything runs at **https://yourscore.app** (Next.js on
Vercel; also a PWA). The web now carries a **"Get the app" CTA** (`DownloadAppButton`, in the
logged-out hero) that fires a **Download (app-install *intent*) conversion** across all
ad/analytics platforms (`trackDownload`; X event `tw-p6vxh-p6vxk`, audience on) — the CTA stays
hidden until `NEXT_PUBLIC_IOS_APP_URL` is set. This tracks download *intent* (web clicks), not
confirmed installs; true install attribution (Apple App Analytics / an MMP) is not wired. Two
things were historically **gated on the mobile launch**:
- **Live-match Quiz** (playing along to a real fixture) — see §5A.1.
- **Push notifications** — see §7.

- Domain: **yourscore.app** (the old `yourscore.gg` is dead). Bundle ID `app.yourscore.app`.
  Web deploys from `main`; native shell on `mobile-wrap`.

---

## 5. The Two Games

### 5A — QUIZ (football knowledge)

The knowledge game. Nav tab **"Quiz"** (route `/play`). Ways to play:

- **5A.1 Live match** — playing along with a *real* fixture; questions fire during the
  game, scored live. **⛔ NOT live yet — gated on the mobile app launch.** (We aren't
  running live-match quizzes until the mobile app is confirmed.)
- **5A.2 Multiplayer** — on-demand Quiz game with others in a **Lobby** (Private / Public
  / 1v1); question source = a Quiz pack or a category+difficulty filter. ✅ Live.
- **5A.3 Solo challenge** — self-paced single-player quizzes (club season-review packs:
  PL 2025/26, Championship). Lowest-friction entry; SEO surface. ✅ Live.
- **5A.4 Custom Quiz Builder** (`/quiz/create`) — *tool* (not a mode): generate your own
  Quiz pack to use in Multiplayer.

**Quiz scoring (`src/lib/scoring.ts`, current):** `points = 100 × difficulty × speed`.
Difficulty easy ×1.0 / medium ×1.5 / hard ×2.0 / expert ×2.5 / master ×3.0. Speed bands
(% of Window): Lightning ×2.0 (0–20%) → Fast ×1.5 → Normal ×1.0 → Slow ×0.75 → Very Slow
×0.5 (80–100%). Bonuses: +50 streak (2+ correct), +50 comeback (after 3+ wrong), +500
perfect round. Penalties: −25 timeout, −50 hint/skip, −100 ragequit. *(Hints system
deferred — its +75 no-hints bonus / −50 hint penalty aren't live until hints ship.)*

### 5B — 38-0 (team-builder) — *the flagship*

> **One-liner:** *Build an XI good enough to go a 38-game season unbeaten — spin a squad
> of real-rated legends across football eras, draft your best XI, and go head-to-head.*

A **separate game** (not a Quiz mode). Nav tab **"38-0"** (route `/38-0`). Core loop:
pick a formation + difficulty → **Spin** a random legendary squad → **Draft** into best
slots → see live **Strength** → **projected 38-game record + tier** → play a match → win
→ **earn a one-player swap** / lose → streak resets but the **team stays active — go
again** (the old "stale team → forced rebuild" model is retired). Ratings are always shown:
**Expert mode was retired 2026-07-23** and 38-0 is one format now. The only mode choice is on
the **Premier League** tab — **Pro vs Just Draft**: Pro unlocks each spin with a Premier
League question and lets your answers set the quality of the squads you're dealt (see §0,
2026-07-21). **Anonymous play is the deliberate hook** — guests get the full draft + Quick
Match loop on `localStorage`; sign-in unlocks cloud save / ranked / social.

**Match types — live status:**
| Type | Status |
|---|---|
| **Quick Match** (guest/anon, local) | ✅ Live |
| **Live H2H multiplayer** (simultaneous two-half match, watch-it-play-out, halftime swaps; friend code or random queue w/ disguised bot fallback) | ✅ Live |
| **Penalties — RETIRED 2026-08-05 (founder call: penalties are gone from every game).** The interactive shootout (2D sprite scene, 9 aim zones, power meter, live simultaneous kicks) was removed entirely: engine (`pens.ts`/`pens-server.ts`/`pens-resolve.ts`), scenes, `/38-0/match/pens`, the kick/pens API routes, sprites and models are deleted. **A drawn played match now stands as a draw** in quick/ranked/challenge/live H2H (draws credit 1 pt, streak resets, no swap); WC drawn knockouts + the qualification play-off are settled by the **quiz decider only**. Historical pens results keep their winners (legacy `pens_*` columns + `detail.pens` read silently for old records; never displayed). Migration 254 settles any stranded `pens_pending` quick/challenge rows as draws and drops `draft_live_kick`. | ⛔ Retired 2026-08-05 |
| **Custom leagues + friend challenges** (create/join 38-0 leagues by code; challenge a specific friend via share code; shareable result graphics) | ✅ Live |
| **World Cup** — two player-facing modes, both an open **World XI** draft (nation/National-Team mode **retired** from the UI): **🧠 World Cup Mastermind** (quiz-gated — each pick unlocked by a **25s/question** timer; right answers + streaks deal stronger players) with **Today's Run** (ranked, one locked go/day, today's seeded questions, feeds the season board + Rank via the WC bucket) and **Practice** (unlimited, random past questions, no board/Rank); plus **🌍 World Cup Run** (open, no-quiz draft, replayable). The run: group → knockouts. Group qualifies on points (**≥4 auto · =3 play-off · ≤2 out**); a 3-pt play-off and any **drawn knockout are settled by a quiz decider** — one timed WC question, server-graded (the permanent mechanic; penalties retired 2026-08-05) — knockout loss = out; perfect run = **8-0-0**. Season board `/38-0/wc/board` ranks closest-to-8-0-0 across the WC2026 window; **tap any player → `/38-0/wc/board/[userId]` to browse their daily drafts** (switch between days to see each day's XI + result + match-by-match road + **Mastermind quiz score** (how many of the day's questions they got right — `quiz_correct`/`quiz_total` on the run, recorded at submit; pre-migration-42 runs read null); `get_wc_player_history` definer RPC, public read). **Share/viral loop:** the daily result has a personalised **Mastermind scorecard** (`/api/draft/wc-og?mode=mastermind` — name + record + 🧠 quiz hero + world rank + date; "38-0 for the fans that know football") that **unfurls on X** via the `/38-0/wc/share` page (its `og:image` IS the card — fixes the old generic-image unfurl); the result screen pushes a **£25 daily-giveaway** tweet (mirrors the season giveaway, `@yourscore_app_`) and a **Challenge-a-friend** invite (`InviteMastermind`, also on the `/38-0/wc` entry) that shares the mode link. World Cup is now the **first/default 38-0 tab**. | ✅ Live 2026-06-16 (migrations 39–42 applied) |
| **World Cup H2H** (take your WC squad head-to-head — own queue/lobbies/leaderboard, WC competition lane) | ✅ Live 2026-06-15 |
| **Ranked + global leaderboards** (Daily/All-time, points ladder W3/D1) | 🔧 Being built now |
| **Verified "Leaderboard ✓" tab** (closest-to-38-0 season records per competition + closest-to-8-0 WC runs; server re-simulates every submitted XI — client never trusted; personal bests card on /profile) | ✅ Live 2026-06-12 (boards activate with migration 29) |

**Competitions:** **Premier League** only. **La Liga was RETIRED 2026-08-05** (it ran
2026-06-11 → 2026-08-05; DB rows with competition='LaLiga' remain for history but the pool,
tab, importer and badges are gone — `asLeague()` normalises everything to PL).

**Data & engine (high level):** real **FIFA/SoFIFA ratings** across ~8 editions over ~20
years (~4,900 player-seasons). `score.ts` → Strength; `match.ts` is the single engine for
all scorelines (attack-line vs defence-line, Poisson on a seeded RNG); `live-score.ts`
drives the live two-half match. **Season feel (2026-06-12):** strong XIs (>74 STR) play
"on form" — `formFactor` (season.ts) lifts the player's λ and damps the opponents', so
wins climb with Strength and good seasons reveal as a long unbeaten streak that breaks
late ("looked like 38-0"). Calibrated against all real saved XIs: a genuinely elite,
well-built XI (top ~3-5% by Strength, ~89.5+) now has a real, repeatable shot at the
perfect **38-0 Invincible** (~0.3% of all teams, ~10-15% of elite ones); mid/weak teams
essentially unchanged. A 38-0 triggers a full-screen gold celebration + gold scorecard
banner. **Per-play roll (2026-06-14):** the season is seeded by the XI PLUS a per-play
salt, so two players with the identical XI get DIFFERENT seasons — a copied Invincible
XI (share cards expose the XI) no longer reproduces the 38-0; the copier gets the same
per-roll odds anyone at that Strength gets. A roll is cached per-XI per-device (stable on
revisit) and server-verified by re-running the same salt; building 38-0 stays achievable
but is genuinely earned per attempt, not copy-pasteable.
**Impact subs:** halftime subs in Live H2H are 3×-weighted in second-half scorer/assist
picks — the player you bring on visibly pays off, sometimes.
**Integrity note:** the leaderboard is "verified ✓ — real results only". We do NOT
fabricate or back-date Invincibles onto real users' names; the board fills with genuine
38-0s as players earn them under this engine. (A request to manufacture/disguise wins was
declined — see [[project-38-0-leaderboard-gamefeel]].)

**Account deletion (2026-06-14):** Settings → Danger Zone → typed-DELETE confirm →
`POST /api/account/delete`. The route (service role, always the caller's own session id)
runs the `delete_user_account()` SQL function then `auth.admin.deleteUser()` then clears
the avatar. The function erases the user across every public table in FK-safe order — a
bare auth delete can't, because `profiles.id`/`quiz_packs.user_id` are NO ACTION,
`answers`/`room_members`/`room_scores`/`rooms` reference profiles with no cascade, and the
club tables are RESTRICT. Shared content they authored (custom quiz packs, lobbies,
leagues) is kept with ownership nulled. Verified end-to-end against the live schema.

---

## 6. Leagues & Ranking

**Two separate, per-game league systems — they do not merge:**

- **Quiz Leagues** (`leagues`, `league_members`) — a group's table for the Quiz game.
  Target model: **two boards that never combine — Live** (live-match points) and
  **Offline** (Multiplayer incl. 1v1; Solo counts *lighter*, exact rule **TBD — founder's
  partner**). This two-board model is **still the plan / build target**.
  > *Current code:* `/api/answer` calls `update_league_member_stats` — every point flows
  > into ALL a user's Quiz leagues as one pooled total. No Live/Offline split or
  > per-match tracking yet. The two-board model is the target, not today's behaviour.

- **38-0 Leagues** (`draft_leagues`) — custom group leagues for 38-0, joined by code, with
  their own board (in-league wins, challengeable members). ✅ Live.

- **Club Leagues** (`club_leagues`) — ⚠️ **BUILT, NOT LIVE** (migration `38_club_leagues.sql`
  unapplied). Partner-owned, branded league + community space for PUBS, CREATORS,
  and SPONSORS — the productised, generalised form of the roadmap's "Pub Leagues" (§8). Own
  first-class tables (chosen over extending `draft_leagues`/`leagues` or reviving shelved
  sponsored Lobbies). Per partner:
  - **Branded hub** at `/l/<slug>` (logo, cover, brand colour, welcome/prize text, pinned
    announcement, shareable join link/QR). Tabs: **Board · Events · Feed** (+ **Manage** for owners).
  - **Overall board** = `get_yourscore_leaderboard(p_user_ids := members)` — the *same*
    YourScore Rank, scoped to that partner's members. Read-time only; **zero new scoring writes**.
  - **Quiz events** = partner-run quiz nights: pick/build a `quiz_packs` pack → questions are
    **snapshotted** onto the event (pack edits can't break a live night) → members play in the
    window → per-event board. Correct answers are **never sent to the client**; server-graded;
    one attempt each. **Event points count ONLY on the event board** — they do NOT feed
    `profiles.total_score`/`quiz_attempts`/YourScore points (integrity: partner packs must not
    mint global ranking points).
  - **Feed** = read-time derived activity (`get_club_league_feed`): joins, 38-0 H2H results,
    solo quizzes, event results. No chat in v1.
  - **Provisioning:** admin at `/admin/club-leagues` (create + owner-by-email + kill switch);
    partner self-manages branding/events on the hub. **Free for pubs/creators; sponsors invoiced
    manually** (`tier` field is reporting-only — no in-app billing).
  - **Outreach asset:** `/api/club-preview` — a parameterized `next/og` PNG of a branded board
    (`?pub=&color=&logo=&prize=&kind=`) to embed inline in cold email; DB-free mockup.
  - **Immersion direction (Jun 14, NOT built):** the hub should be a *branded TAKEOVER*
    ("Spotify artist page" feel) — full-bleed dimmed wallpaper backdrop + page-wide accent shift
    from the partner's colour, while a subtle "Powered by YourScore" mark + the app's nav/dark
    surfaces remain. More immersive than a Facebook page, less than white-label.
  - **v1 deferrals:** chat, 38-0 event types, billing, staff/manager roles, partner analytics,
    brand-bleed into game screens, true white-label.

**YourScore Rank — ✅ LIVE (shipped 2026-06-12).** The unified cross-game leaderboard and
the deliberate **38-0 ↔ Quiz bridge**. One currency, one table, one #1:

- **YourScore points = Knowledge pts + Match pts.** Knowledge = Quiz points as-is
  (multiplayer + live + solo). Match = ranked 38-0 record converted at **win = 1,500 /
  draw = 500** (keeps football's 3:1; one win ≈ one strong quiz session). The exchange
  rate is the single tuning dial — set in `supabase/migrations/30_yourscore_points.sql`.
- **Position is the product.** Strict unique positions (`row_number`; ties → earlier
  account). **No percentiles, no point-based tiers** — v1's percentile blend (migration 27)
  is superseded. Badges (👑 #1 · Elite top 10 · Diamond top 50 · Platinum top 200 · Gold
  top 1000) are cosmetic, client-side, derived from position (`src/lib/rank.ts`).
- **The reward loop:** a **RankRewardCard** mounts on every Game end (38-0 live result,
  Solo challenge, Multiplayer quiz): points earned, places climbed (never shows a drop),
  current position, and the chase — "N pts behind <player above> — overtake them".
- **Surfaces:** `/leaderboard` (Global + Friends scopes), profile hero (position-led),
  38-0 live-match header shows the opponent's #position.
- **Data:** `yourscore_user_ratings` view + `get_yourscore_rank` / `get_yourscore_leaderboard`
  RPCs (migration 30). Read-time only — per-game scoring/writes unchanged.
- *Known watch-items:* top of table is currently pure 38-0 volume (quiz pts small by
  comparison); wins vs disguised bots count toward Match pts (bot-farming lever if needed:
  human-only wins or daily caps). No seasonal reset yet — all-time.

---

## 7. Auth, Notifications & Social

**Auth — live in production:** **Google**, **Apple**, **Email (password + magic link)**.
*(Facebook button exists in the UI but is NOT enabled in prod.)* Native OAuth uses the
`yourscore://` deep link. Guests can play; account needed for ranked/cloud/social.

**Push — tied to mobile launch:** the **send-push** Edge Function (APNs/FCM) is built but
comes online with the mobile app.

**Lifecycle email — LIVE on web (Resend, hello@yourscore.app):** 23 branded templates in
`emails/lifecycle/` + 6 Supabase Auth templates. Event-triggered: welcome (neutral 4-path),
first quiz/league/invite (quiz side), first XI/match/H2H/league (38-0 side, 16–19), friend
request/accepted (20–21), H2H challenge result to the challenger (22), and a once-ever
come-back nudge via daily cron (23 — gated behind `COMEBACK_EMAILS_ENABLED=true` + the
`email_log` table, migration 31). Governance: event emails only for things that happened
while the user was away; campaigns (11–15) are one-off scripts. "Friends online" is
deliberately push-only, not email.

**Unsubscribe (2026-06-14):** every email footer link → `/settings/email?unsub=all|pause=<scope>&u=<userId>`
(previously 404'd — now fixed). The page (prefetch-safe, button-triggered) and
`POST /api/email/unsubscribe` write a `reason='manual'` row to `email_suppressions` —
the table `loadSuppressions()` reads, so all send scripts skip them. Resubscribe lifts
only the user's own opt-out (bounce/complaint suppressions stay). Runtime emails also
carry `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click) headers.

**Shared social features:**
| Feature | Status |
|---|---|
| **Friends** (add/search/requests, `/friends`) | ✅ Live |
| **Public profiles** (`/profile/[userId]`, stats) | ✅ Live |
| **Players database** (`/players/[id]`) | ✅ Live |
| **Messages / DMs** (`/messages/[userId]`) | 🔜 Planned only (page exists but is a stub; not released) |

---

## 8. Roadmap (rough order)

- **38-0 Ranked + global leaderboards** (in progress).
- **YourScore Rank** — two-track (38-0 Match + Quiz Knowledge) cross-game bridge (in progress).
- **Mobile app launch** — unblocks **live-match Quiz** and **push notifications**.
- **Quiz Live/Offline league boards** + the Solo-weighting rule (founder's partner).
- **Club Leagues** (the productised "Pub Leagues") — ✅ **built, awaiting migration 36 + push to
  go live**; then the immersive brand-takeover redesign of `/l/<slug>` (see §6).
- **Messages / DMs**, **Hints system** (Quiz scoring hooks exist).
- **Naming cleanup:** `rooms` → `lobby`/`lobbies` and `/join` → `/matches` (code paths;
  do NOT touch yet — user-facing labels already say Lobby / Matches / Quiz).

---

## 9. Navigation Canon

**Bottom nav (signed-in, 5 tabs, founder order 2026-07-16):** **Home · Play · Versus ·
Premier League · Profile.**
- **Home** (`/`) · **Play** (`/play`) · **Versus** (`/versus`) · **Premier League**
  (`/matchweek`) · **Profile**.
- **Play is the games tab (founder ruling 2026-07-18):** every game lives under it via a
  top **Quiz | 38-0 | Perfect 10 | Higher or Lower | Guess the Player game switcher**
  (`GameSwitcher`) — five separate games, each its own section (second founder ruling
  same day: the three list/stat games are NOT tiles inside the Quiz hub anymore). Quiz =
  `/play` (sub-tabs Solo + Leaderboards); 38-0 = `/38-0` (its own sub-nav: WC
  Mastermind · Premier League · La Liga · Leaderboard); Perfect 10 =
  `/play/game/perfect-10` (gold #ffc400); Higher or Lower = `/play/game/higher-lower`
  (orange #ff7800); Guess the Player = `/play/game/guess-the-player` (blue #4fc3f7 —
  the last two were recoloured from Quiz teal / 38-0 lime when they became their own
  sections). Routes are frozen — the switcher navigates between them. **The switcher
  is ONE persistent bar** (founder 2026-07-18: "it's a NAV, not a page selector"):
  `GamesNav` mounts once in the ROOT LAYOUT, shows on exactly the five section
  routes, and never remounts on a tab switch — pages swap BELOW it and must NOT
  render their own copy. Game pages hide it during a live run via
  `useHideGamesNav` (`src/lib/gamesNav.ts`); it publishes its height as
  `--games-nav-h` for anything sticking beneath it (the Quiz hub's header does).
  It scrolls horizontally and glides the active tab to centre; the Play tab stays
  highlighted on all of them. 38-0 is no longer a bottom-nav tab. **No back buttons on game sections
  (founder 2026-07-18):** each game is a tab, so the switcher IS the navigation — the
  38-0 hub's "YourScore" BackPill and the game intros' Back buttons are gone. The
  ONLY Back left is the in-game exit on an active Perfect 10 run (no other way out
  mid-game); results screens say "MORE GAMES" (→ /play), not "BACK TO QUIZ".
- **Versus** is the game-first cross-game hub for playing other people (the Leagues tab
  was replaced by it). Sub-nav: **Play** · **Friends** (`/friends`) · **Leagues**
  (`/leagues`, nested). The pending-turns badge lives on this tab. (The Leagues route
  still exists; the bottom-nav Versus tab stays active across `/versus`, `/friends`,
  `/leagues`.)
- **Versus Play tab (2026-07-03, carousel-mockup redesign):** welcome hero with
  **FIND AN OPPONENT as the full-width primary action** (Challenge friend / Join code
  secondaries) → Choose-your-game tiles → the user's matches/results/record/rivalries →
  two-stat **Live now** strip (`/api/versus/activity`; real metrics + seeded presence
  baseline flagged `TODO(real-presence)`) → swipeable **Community Highlights**
  → public-league rows → Better-with-friends banner. An urgent your-turn card
  suppresses the hero. Both game start screens lead with **"How do you want to
  play?"** chevron rows (find opponent / challenge friend / share code); Quiz adds
  a FEATURED hero cover + POPULAR rail above the full filtered library. Friends tab
  leads with RIVALS. Leagues tab = **My Leagues | Discover** views with
  All / 38-0 / Quiz Battle chips + a CREATE LEAGUE / JOIN WITH CODE action row.
  The Play | Friends | Leagues tabs are full-width segments; bottom sheets sit at
  z-60, ABOVE the fixed BottomNav (z-50) — a sheet must never be covered by the nav.
- **Community Highlights (2026-07-03 round 3) = a real results feed:** recent
  finished matches across BOTH games ("X beat Y 2–1", "A beat B's run 4,200–3,800"),
  each card game-chipped (38-0 / Quiz Battle) with names, avatars, scoreline, time
  ago and a one-tap way in (quiz items deep-link the find flow pinned to that pack).
  Fed by `feed` on `/api/versus/activity` (completed h2h Lobbies last 48h — pure-CPU
  rooms skipped, shadow rooms shown under the run owner's persona, QA bots excluded —
  plus resolved 38-0 live matches). Then the standing spotlights: top-ranked player
  (TRY TO BEAT → shadow library), busiest player (CHALLENGE), hottest quiz (PLAY IT
  NOW → pack-pinned find). The old "People ready to play" rail was REMOVED
  (founder call, round 3); `/api/versus/ready` is gone.
- **Pick-your-quiz head-to-head (2026-07-03 round 3):** the quiz picker's step 2
  ("Who are you playing?") leads with **FIND AN OPPONENT — get matched on this
  quiz, no friends needed** → `/versus/find?game=quiz&pack=<id>`; the find flow +
  queue API accept an optional `packId` that pins the match to the picked quiz
  (Human → Shadow → CPU chain unchanged; unpublished/bogus pack falls back to the
  default featured pack; a paired waiter gets the claimer's pack).
- **Discover leagues (2026-07-03, revised same day):** the Discover tab leads
  with TWO official "board" cards — **World Cup Mastermind League** (VIEW →
  `/38-0/wc/board`, real ranked player count + top faces) and **World Cup Daily
  League** (VIEW → `/play?tab=leaderboards`, backed by the REAL wc2026 daily-quiz
  prize board — everyone playing the daily quiz is on it; the earlier seeded
  5-member league row was retired). Below them: three SEEDED banter leagues that
  read as user-made ("It's Never a Pen FC", "xG Deniers Club", "Agüerooooo
  93:20"), ~10 members each with plausible points/games/accuracy. Every Discover
  card carries a prominent game badge (38-0 lime / Quiz Battle teal — founder
  call: it must be obvious which game a league is for) and the WHOLE CARD opens
  the league's table — **public league tables are viewable by non-members**
  (guest banner + one-tap JOIN on the quiz league page; 38-0 league page already
  did this). Leagues tab chips = **38-0 | Quiz Battle only (no "All")**, scoped
  to MY LEAGUES. Seed accounts (24 fans + "YourScore") are email-suppressed, have
  no gameplay data (invisible to global rank/activity/shadows), and every trace
  is removable via `node scripts/seed-public-leagues.mjs --remove`. Banter
  leagues are REAL rows — anyone can join and their points count (verified E2E).
  GOTCHAS fixed en route: `trg_sanitize_league_member_insert` (mig 13) zeroes
  stats on INSERT so seeding writes stats via a second-pass UPDATE; the quiz
  league page's `profiles(...)` embedded select has NO FK and errored for
  EVERYONE ("No members yet" on every table) — now a two-step fetch.
- **Public player profiles (2026-07-03):** `/profile/[userId]` shows any player
  to any player: rank + tier, head-to-head W-D-L record + score (rank RPC),
  RECENT BATTLES (h2h results from their side), QUIZZES PLAYED (attempts w/
  score + accuracy — cross-user reads via the service client; RLS scopes
  quiz_attempts/h2h to their owner so the viewer's session sees nothing),
  plus **Add friend**, **CHALLENGE THEM** and **PLAY THEIR RUNS**. Reachable by
  tapping players in league tables, the global leaderboard, Friends (rivals +
  friends rows), rivalry cards and highlights result cards. This partially
  supersedes the old "public profiles not built yet" note — profiles ARE public.
- **Daily debates + discussions (2026-07-04, Versus phase 2 — the deferred
  "Debate questions" shipped):** ONE subjective football debate a day ("Golden
  boot or clean-sheet record: which says more?") — vote, see the live community
  split (gold treatment, your pick highlighted), change your vote anytime,
  **DRAG A FRIEND INTO IT** shares the public **`/debate`** landing (guests can
  read + see the split; voting/commenting routes through sign-in; the page's OG
  unfurl image carries the actual question via `/api/og/debate`). Rotation is
  **date-seeded over the active bank** (UK day, `src/lib/debate.ts`) — no
  scheduler; when the cycle wraps a debate returns with its votes intact. Bank
  of 30 fan-voice debates seeded via `scripts/seed-debates.mjs` (idempotent —
  add rows anytime, rotation adjusts). **Discussion threads** (`comments`
  table, polymorphic): flat 280-char threads on **debates** ("The argument",
  under the card) and **quiz packs** ("Talk about this quiz", on the post-match
  scorecard). World-readable; posting needs an account (8/min rate limit,
  slur/link filter in `src/lib/moderation.ts`); authors soft-delete their own
  (via service role — a soft-deleted row fails the `deleted_at is null` SELECT
  policy, so an author-session update 42501s). Debate card placements: Versus
  Play tab (below Live-now), every completed-match scorecard, `/debate`.
  Tables: migration 70 (debates / debate_votes / comments, additive, APPLIED).
- **Scorecard forward motion (2026-07-03 round 3):** every bot/shadow scorecard
  leads with a **KEEP PLAYING** panel — primary **PLAY AGAIN — NEW OPPONENT**
  (find flow pinned to the same quiz) + **PICK A DIFFERENT QUIZ**; the honest-reveal
  panel keeps its info but its links (PLAY THEIR RUNS / CHALLENGE LIVE) are
  secondary. h2h scorecards navigate back to **/versus** (not the quiz tab).
- **Instant matchmaking:** 38-0 uses its existing random queue (silent 2-3s disguised-bot
  fallback). **Quiz Battle matchmaking is new** — `quiz_queue` + `quiz_pair()` RPC
  (migration 64, mirrors `draft_live_pair`) pairs two waiters into a 1v1 Lobby named
  "Instant Match" on a featured pack. Fallback chain after ~5s: **Human → SHADOW → CPU**.
- **Shadow matches (2026-07-03):** the fallback preferentially replays a **real player's
  previous multiplayer run** in the CPU seat — their exact answers at their exact speed
  (`rooms.shadow` jsonb, migration 66; shadow Lobby copies the source room's questions
  VERBATIM so the sequence replay is exact). During the match it looks live (their
  name/avatar); the result screen makes the **honest reveal** ("You just played X's real
  run from {date}" + their original score) with **PLAY THEIR OTHER RUNS** (revenge
  library `/versus/shadow/[userId]`) and **CHALLENGE THEM LIVE**. On completion the
  run's owner gets an opt-in-gated push ("X beat your {quiz} run — get revenge") deep-
  linking to the beater's own shadowable runs — the revenge loop. **Pool = ONE pool:
  solo quiz attempts AND multiplayer runs both count** (solo attempts replay from
  quiz_attempts.answers — graded in pack order, so idx maps 1:1 to sequence);
  QA/CPU accounts excluded; the shadow owner's own stats are never touched by a
  replay. **Notification rules:** (1) **RALLY BYPASS** — when the
  owner and beater are actively trading blows (owner played the beater's shadow
  within 7 days), every beat notifies INSTANTLY, uncapped, with rally copy ("X hit
  back! … your turn"); playing the full quiz (~2-3 min) is the natural rate limit.
  (2) Otherwise max ONE push per owner per rolling 24h — absorbed completions
  aggregate into the next push ("X and 2 others took on your runs — 2 beat you").
  (3) **Beats open the push, holds never do** — holds only appear inside aggregate
  copy. (4) The named player + revenge link always point at an actual beater.
- **CPU fallback** (when no shadow exists for the pack): one dedicated CPU auth user
  takes the second seat, **presented as an imaginary player persona** — name picked
  deterministically from the room id (`cpuPersona()`, lib/versus/quizBot.ts), varied
  avatar per match (founder 2026-07-18: "CPU should be an imaginary player profile
  name — to make it seem like there are other players"; this REVERSED the original
  honestly-named-"CPU" call). The disguise is display-only — friend prompts, global
  rank, league stats and the activity feed still exclude the seat by id; its seeded answers
  (62% accuracy, 2.8–10.5s) are written server-side in `/api/answer` when the human
  answers — room scores only, NEVER global rank or league stats. Result screen offers
  one-tap "Rematch CPU" (no play-again voting vs the CPU).
- **Public leagues (2026-07-03):** both league tables now carry `is_public` + `featured`
  (migration 64, applied; default private). Creators opt in via a visibility toggle on
  both create flows; `/api/leagues/discover` powers "Discover public leagues" in the
  Leagues tab + a Play-tab teaser. Public = join code exposed by design.
- **Guests** see a reduced nav (Home · Quiz · 38-0).
- **Matches** (`/join`) still exists as a route (browse fixtures, set up a league around a
  match) but is **not a primary bottom-nav tab** while live-match Quiz is gated.

---

## 10. Admin (`/admin`)

`/admin/matches` (fixtures + AI question generation) · `/admin/questions/[matchId]`
(approve question bank) · `/admin/rooms` ("Lobbies" — view/fire live questions) ·
`/admin/fire/[roomId]` (live match control) · `/admin/challenges` (upload Quiz packs).

---

## 11. Tech Stack

Next.js 14 (App Router) · Supabase (Postgres + Auth + Realtime + Edge Functions) ·
Capacitor (iOS/Android, pre-launch) · Tailwind · Vercel · pnpm · Anthropic Claude API
(Quiz question generation). 38-0: pure TS engines (`src/lib/draft/*`) over a FIFA-ratings
dataset; Supabase Realtime for live matches; `next/og` for shareable result graphics.
Patterns: server-authoritative scoring/grading (service role), RLS on all tables, rate
limiting. `next.config.mjs` sets `typescript.ignoreBuildErrors: true` (build tolerates
pre-existing type errors).

---

## 12. Discontinued / Shelved — DO NOT reference as current

| Thing | Status |
|---|---|
| **38-0 Expert mode** (ratings hidden while drafting) | ❌ Retired 2026-07-23 — 38-0 is classic only, no difficulty switch. The `DraftMode` union and `LocalTeam.mode` survive so old saved teams still parse, but nothing offers or honours "expert". Don't rebuild the switcher without asking. |
| **WhatsApp API notifications** | ❌ Discontinued (replaced by native push; share links unaffected). |
| **Sponsored / branded rooms** | 🅿️ Shelved (vestigial DB columns only). |
| **`yourscore.gg`** | ❌ Dead — domain is **yourscore.app**. |
| **"Football IQ" phrasing** | ✏️ Replaced by **"football knowledge"**. |
| **"Room" as a term** | ✏️ Replaced by **"Lobby"** (DB tables pending rename). |
| **"Play" as the quiz tab label** | ✏️ Now **"Quiz"** (route stays `/play`). |
| **Old flat-45s / linear-bonus scoring** | ❌ Superseded by §5A scoring. |

---

## 13. Maintenance Rule

Update this file in the same session you change the product; bump the "Confirmed" date.
New games/modes, killed features, renamed tabs, scoring tweaks, prod-status changes, and
positioning shifts belong here first. If a future session references something not in this
document, reconcile against the code — don't trust an older doc.
