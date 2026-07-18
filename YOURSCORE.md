# YourScore — Master Definition (Single Source of Truth)

> **This is the canonical definition of what YourScore is.** When anything in this repo
> or in conversation conflicts with this document, **this document wins.**
> `PRODUCT.md`, `MARKETING_BRIEF.md`, `MOBILE.md`, `STORE_LISTING.md`, `DRAFT-XI.md` and
> the old `~/Downloads/*build-doc.md` files are historical/subordinate — read them only
> for detail this file points to, never as current scope.
>
> **Confirmed:** 2026-07-18 (**Nav: 38-0 now lives under the Play tab** — Quiz | 38-0
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

- **2026-07-18** — **Versus instant match: real opponents before "CPU" + matched-lobby
  cleanup (founder: matching with "CPU" after Find an opponent "is not what should be
  happening")** — the quiz bot fallback now EXHAUSTS shadows before the literal CPU:
  fresh shadow → least-recently-met RERUN (heavy players had emptied the fresh pool,
  which is exactly why the founder kept landing on "CPU") → other published packs
  (generic find only; a pinned find keeps its quiz) → CPU only for a truly empty pool.
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
- **Spin** — deal a random squad of real-rated legends (drawn across FIFA editions/eras).
- **Draft** — place spun players into your formation's best-fit slots to build your XI.
- **Strength** — your XI's computed rating (~40–99).
- **Projected season** — Strength mapped to a 38-game record + tier (the "could it go 38-0?" projection).
- **Classic / Expert** — Expert mode hides player ratings during the draft (names + positions only).
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
again** (the old "stale team → forced rebuild" model is retired). **Classic vs Expert**
mode (Expert hides ratings). **Anonymous play is the deliberate hook** — guests get the full draft + Quick
Match loop on `localStorage`; sign-in unlocks cloud save / ranked / social.

**Match types — live status:**
| Type | Status |
|---|---|
| **Quick Match** (guest/anon, local) | ✅ Live |
| **Live H2H multiplayer** (simultaneous two-half match, watch-it-play-out, halftime swaps; friend code or random queue w/ disguised bot fallback) | ✅ Live |
| **Interactive penalty shootout** — every drawn *played* match goes to pens and **the user takes the kicks** in a real-time **2D sprite scene** (`PenaltyScene2D` — floodlit goal, keeper dive, ball arc; the R3F 3D scene was descoped, code comments corrected 2026-07-11). Pick one of **9 aim zones** (3×3) + time a **POWER meter** (under/good/perfect/over); dive as keeper vs CPU in solo modes; in live H2H both players shoot simultaneously vs a seeded AI keeper, kicks streaming live. Pens win = full win (1,500 pts / streak survives); the old live opt-in ("both must agree") is retired. Group games in WC Run and the simulated season keep draws (league formats). Outcomes resolve server-side from a peppered seed in ranked modes; abandoning a shootout auto-completes it seeded — quitting never dodges a loss. The 3D scene is lazy-loaded (code-split to the pens route); striker/keeper are GLTF-ready slots for future rigged models. | 🔧 Built 2026-06-13, awaiting migration 35 + deploy |
| **Custom leagues + friend challenges** (create/join 38-0 leagues by code; challenge a specific friend via share code; shareable result graphics) | ✅ Live |
| **World Cup** — two player-facing modes, both an open **World XI** draft (nation/National-Team mode **retired** from the UI): **🧠 World Cup Mastermind** (quiz-gated — each pick unlocked by a **25s/question** timer; right answers + streaks deal stronger players) with **Today's Run** (ranked, one locked go/day, today's seeded questions, feeds the season board + Rank via the WC bucket) and **Practice** (unlimited, random past questions, no board/Rank); plus **🌍 World Cup Run** (open, no-quiz draft, replayable). The run: group → knockouts. Group qualifies on points (**≥4 auto · =3 play-off · ≤2 out**); a 3-pt play-off and any **drawn knockout are settled by a quiz decider** — one timed WC question, server-graded (temporary, until the penalty-shootout work lands) — knockout loss = out; perfect run = **8-0-0**. Season board `/38-0/wc/board` ranks closest-to-8-0-0 across the WC2026 window; **tap any player → `/38-0/wc/board/[userId]` to browse their daily drafts** (switch between days to see each day's XI + result + match-by-match road + **Mastermind quiz score** (how many of the day's questions they got right — `quiz_correct`/`quiz_total` on the run, recorded at submit; pre-migration-42 runs read null); `get_wc_player_history` definer RPC, public read). **Share/viral loop:** the daily result has a personalised **Mastermind scorecard** (`/api/draft/wc-og?mode=mastermind` — name + record + 🧠 quiz hero + world rank + date; "38-0 for the fans that know football") that **unfurls on X** via the `/38-0/wc/share` page (its `og:image` IS the card — fixes the old generic-image unfurl); the result screen pushes a **£25 daily-giveaway** tweet (mirrors the season giveaway, `@yourscore_app_`) and a **Challenge-a-friend** invite (`InviteMastermind`, also on the `/38-0/wc` entry) that shares the mode link. World Cup is now the **first/default 38-0 tab**. | ✅ Live 2026-06-16 (migrations 39–42 applied) |
| **World Cup H2H** (take your WC squad head-to-head — own queue/lobbies/leaderboard, WC competition lane) | ✅ Live 2026-06-15 |
| **Ranked + global leaderboards** (Daily/All-time, points ladder W3/D1) | 🔧 Being built now |
| **Verified "Leaderboard ✓" tab** (closest-to-38-0 season records per competition + closest-to-8-0 WC runs; server re-simulates every submitted XI — client never trusted; personal bests card on /profile) | ✅ Live 2026-06-12 (boards activate with migration 29) |

**Competitions:** **Premier League** is live. **La Liga** (2nd competition) is now
**live** too — released 2026-06-11 (migration 26; club crests added). Pick a competition,
then draft your all-time XI from that league's ~20 years of players.

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
  (honestly named "CPU", keeper avatar) takes the second seat; its seeded answers
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
