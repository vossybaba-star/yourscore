# Content Marketing — Social & Distribution Audit

**Exec summary:** the X pipeline is genuinely sophisticated — five approval-gated, voice-locked engines (x-ideas, x-engage, launch-daily announce, Reddit listener, Telegram review). But distribution is single-channel, single-point-of-failure: everything posts to one X handle (or the founder's personal Reddit account), everything runs on the founder's Mac via launchd, and there is ZERO organic presence on the channels where football fans are (TikTok/IG Reels/Shorts — no pipeline, no assets, no account refs in code). The static social-media/ kit is a stale, off-brand pre-launch artifact ("football IQ", "Rooms"). The WC Mastermind scorecard is best-in-class share creative, but it + the £25/£100 giveaway engine hit a hard cliff Jul 19 with no post-WC plan encoded anywhere.

## 1. The social content system

**P2 — content-brief.md is a dead pre-launch doc:** covers "May 22 → Jun 11" (:2); day-by-day post list, no pillars/platform strategy; implicitly Instagram — a channel with no automation anywhere. The actual operating strategy lives in code (x-ideas.mjs:51 pillars: identity · feature · community · proof) with no human-readable doc. No current calendar.

**P1 — brief + templates violate the locked brand system:** "football IQ" ×9 in content-brief.md (:20,:152,:331), in templates/stat-card.html:334 and posts/post-01; brief describes "Rooms" and live-match quiz as current (:388-410), positions YourScore as "free football quiz app" ignoring 38-0. Templates use green #00C853 / purple #9B7FFF / Barlow Condensed vs the product's lime #aeea00 / gold #ffc233 / teal on #0a0a0f (promo-og/route.tsx:11) — two visual identities in the wild.

**P2 — integrity landmine:** content-brief.md:592-598 "The Stat Psychology" instructs inventing engagement stats ("Only 11% of 312 people got this right", :636) — contradicts the codebase's own integrity culture, and is now unnecessary: migration 76's quiz_answers gives REAL per-question correct-rates. **Strike the section; use real data.**

**P2 — production vs promise:** brief promises 26 assets; posts/ has 4 + 3 rendered PNGs; nothing touched since early July. The static track is abandoned in favour of X automation — defensible, but undocumented; delete or stamp HISTORICAL.

**Good:** platform-correct aspect ratios; self-contained HTML screenshot-factory templates; SOCIAL-REPURPOSE.md is an excellent ops doc with founder rules in writing ("NO auto-posting").

## 2. Automation & channels

Engines (all X + Reddit, all founder's Mac launchd): x-ideas (every 3h, ≤2 tweets/run, 4 pillars, Telegram-gated), x-engage (hourly reply/quote drafts on ≥80k-follower viral football tweets), launch-daily (daily quiz announce + segmented email), x-telegram poll (60s; 12-min drip; tap = post), reddit-track/telegram (27 subs, value-only replies from the founder's PERSONAL account, product mentions hard-banned in the prompt — lib/reddit.mjs:219), post-tweet/video (manual CLI; chunked video upload works).

**Strengths to keep:** everything approval-gated, no auto-post (X_AUTOPOST off by default); voice discipline enforced IN CODE (sanitize() strips em-dashes; anti-hype rules; "never equate our players with real footballers"); dedup + drip spacing; retired paths documented.

**P1 — zero organic short-form video during a World Cup:** no TikTok/IG/YouTube pipeline anywhere; scripts/data/ig-watchlist.json exists but NO script consumes it. post-tweet-video proves the team can ship video. The product's most camera-ready moments (pens shootout, Invincible gold celebration, Mastermind streak) never cut into vertical video. Paid runs on Meta/TikTok (accounts exist) — organic surfaces simply unstaffed. Single biggest distribution gap.

**P2 — bus factor:** every runner hardcodes /Users/zchukwumah/yourscore; "only fires while the Mac is awake." Founder travels → brand goes quiet in the highest-attention week. Move to a scheduled runner; Telegram gate already makes location irrelevant.

**P2 — docs drift in the automation:** SOCIAL-REPURPOSE.md:64-83 documents x-propose as current; x-ideas.mjs:5-8 says x-propose is retired. Next operator can't tell which.

**Reddit: sound, well-managed — keep it boring.** Layered no-product-mention rules + Telegram gate + megathread skips + 30-day memory + "default UNUSABLE" bar. Notes: it builds an account, not a funnel (3-6 month credibility investment, no conversion path — recognize it as such); LLM-drafted comments from a personal account cut against some subs' bot rules — founder-edit rate is the real mitigation; never raise maxQueuedPerRun (6).

**Cadence reality:** theoretical max high, but founder-attention-bound (~3-6 posts/day). Good for X; the problem is channel concentration, not cadence.

## 3. In-product moments as content (OG/share system)

**Inventory (real asset):** WC Mastermind scorecard (best in system — self-contained from run id, never half-empty); WC Run path card; 38-0 season card w/ gold INVINCIBLE treatment (credit: the Invincible DOES have a share artifact); live H2H card; quiz result card; debate ballot card (excellent — ?pick=N makes the tap the vote); blog/home/club-preview/promo utility cards. The Jul 10 robots.txt fix un-broke all of these on social.

**P1 — high-emotion moments with NO share artifact:**
- Penalty shootout — most cinematic thing in the product; pens are only a footnote on the live card. "HELD MY NERVE — 4/4" card is the obvious viral unit.
- Streak milestones — no share surface anywhere (the most-proven share mechanic in daily games: Wordle/Duolingo).
- Quiz PERFECT ROUND (+500 exists in scoring) — generic share only.
- Rank overtakes — RankRewardCard computes the chase and climb but has NO share affordance (grep confirms). Born social, dies on the result screen.
- ShareStatsButton is text-only + bare homepage link → unfurls generic (ShareStatsButton.tsx:19-23).

**P2 — share copy formulaic + one vocab violation:** all surfaces read identically ("I scored N on X @yourscore_app_ ⚽ Entering the daily £25 giveaway"). Best line is Mastermind's (stakes + challenge: "🧠 8/10 … and I won the whole thing 🏆 (8-0-0) … Beat my score 👇") — others should learn from it; loser copy has no hook (revenge framing would). **Vocab violation:** 38-0/match/result/page.tsx:42 shares "My Draft XI drew…" — internal-only term; must say "38-0". One-line fix.

**P3 —** "Studio content dash" referenced (og/debate:27) but not in this repo; the debate-card→X publishing loop it implies has no automation on this side.

## 4. The giveaway engine

Pure client-side tweet-intent CTAs; every entry is a public tweet carrying a self-rendering scorecard — a UGC machine by design. £100 season prize = retention spine, baked into the daily announce tweet (lib/quiz-launch.mjs:239).

**P1 — no backend, no rules, no winner mechanism:** no giveaway table, entry tracking, or winner-selection script anywhere; no published T&Cs; the overlay makes an unconditional "WIN £25 TODAY" promise. UK CAP Code on prize promotions applies. Minimum: /giveaway terms page + nightly mentions-harvest script that records entries and winners.

**P1 — the Jul 19 cliff cuts both ways:** £100 board hard-ends (WC_SEASON_END, wc.ts:28) and its tweet hook dies with no successor; the £25 daily CTA NEVER ends — hardcoded across four result surfaces with no flag/date check → post-Jul-19 it's an unbudgeted liability or a false promise. **Fix pre-cliff:** one GIVEAWAY_ACTIVE/config prize object consumed by all four surfaces; re-point to the mid-Aug launch board.

**P3 —** entry loop never closes: nothing verifies/thanks/amplifies entries; entrants tweeting into the void stop entering.

## 5. Community / UGC flywheel

**P1 — nobody harvests user moments back into brand content:** zero inbound listening on the brand handle — no mentions search, no quote-RT queue, no best-card curation; x-ideas' "proof" pillar is fed no real user data, so it can only gesture at proof. **Fix:** x-mentions.mjs clone of x-engage searching @yourscore_app_ / yourscore.app/s/ links, Telegram-gated quote-RT drafts; nightly "board leader" auto-draft from the leaderboard RPC.

**Debates: strong product loop, missing the publishing leg.** Posting the daily debate card to X is not automated or scripted — the most natural daily zero-marginal-cost brand post the product has. ~50-line script through the existing Telegram gate.

**Community Highlights feed is inbound-only:** /api/versus/activity builds "X beat Y 2-1" — raw material for a weekly "this week on YourScore" post; nothing exports it.

**P3 —** /l/lukepingu is a hardcoded creator hub (works! but one-off) — Club Leagues (built, unapplied) is the systemized version; post-WC, creator leagues are the most plausible successor UGC/giveaway anchor.

## 6. Recommendations, prioritized

**Before Jul 19:** (1) gate the giveaway (config flag + terms page; recommend pivoting £25 daily → weekly "card of the week" repost prize — cheaper and forces the curation loop); (2) script the £100 board finale as a content event + winner announcement (biggest trust post of the year); (3) ship the mentions-harvest before finale-week entries flood in unseen; (4) automate the daily debate tweet.

**Weeks 2-4 post-WC:** (5) stand up ONE short-form channel (TikTok first — ad account exists): pens POV clips / "rate this spun squad" reactions / debate read-overs; extend the compose-image-prompt founder-gated pattern to caption+clip; (6) retire/re-skin social-media/ to the real palette, purge IQ/Rooms, strike fake stats for real quiz_answers rates; (7) new share artifacts by emotional payload: streak card, pens card, rank-overtake card, PERFECT ROUND badge — all parameter additions to existing og routes; (8) move launchd stack off the laptop; fix SOCIAL-REPURPOSE↔x-ideas drift; fix "Draft XI" share line.

**Post-WC weekly calendar skeleton (channels that exist):** daily debate card (auto-draft, gated) every morning; midday rotation = UGC repost / feature post / real-stat trivia from quiz_answers / community / £25 card-of-week winner / quiz-pack push / weekly board movers from the versus feed; evenings = x-engage as-is; weekly blog post feeding the mid-Aug launch; Reddit karma-building continues product-free. Aug arc: wk 1-2 "the World Cup's over, football isn't" (38-0 evergreen + PL countdown); wk 3 launch week re-points launch-daily.mjs from WC quizzes to PL + successor board/prize.

**One-line thesis:** the machine that makes and approves content is excellent; the map of where it goes and the loop that brings user moments back are the gaps — and the Jul 19 giveaway/board cliff is the forcing function to fix both.
