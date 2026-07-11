# YourScore — Content Marketing Evaluation (outside-in)

**Date:** 2026-07-11 · **Companion to:** `AUDIT-2026-07-11-full-product-audit.md` · **Detail annexes:** `docs/audit-2026-07-11/content-blog.md`, `content-social.md`, `content-ops.md`

**Method:** three audit passes over code + content at HEAD — the blog/SEO engine (all five posts read in full), social & distribution (the social-media kit, all X/Reddit automation, the OG/share system, the giveaway engine), and content operations (the daily quiz pipeline, evergreen catalogue, question-quality ops, email, and the player dataset). Live site and prod DB unreachable from this sandbox; everything is verified against files and git history.

---

## Executive summary

**The content machinery is unusually good; the content strategy has three structural holes.**

What's genuinely strong: the daily-quiz pipeline is a real editorial operation (Telegram-gated approvals, idempotent publishing, per-question source citations, a daily LLM QA reviewer, deterministic answer-shuffling with a health check guarding a known past bug). The X automation is disciplined and voice-locked, with no auto-posting by founder rule. The blog shipped in two days with better technical SEO than most funded startups (static MDX, JSON-LD from one source, RSS, llms.txt, UTM'd CTAs feeding the new attribution tables). The share-card system is a real asset — the WC Mastermind scorecard and the debate ballot card are best-in-class creative.

The three holes:

1. **Everything daily is World-Cup-fueled and dies Jul 19–20 with no successor.** The quiz series, its tweet ("Top the board by the final to win £100"), its email, the Mastermind edition roll, and the £25 giveaway copy are all hardcoded `wc2026` or hardcoded prize strings — and the fantasy launch is mid-August, leaving a ~4-week daily-content vacuum exactly when WC-acquired users decide whether to stay. Debates run dry Aug 5.

2. **Content pours into a funnel with no bottom.** Four of five blog posts sell a mid-August launch with **no email capture or waitlist anywhere on the site**; the blog has zero inbound links from the product; the daily quizzes — 22+ dated, searchable pages with approved art — aren't in the sitemap and `/challenges` redirects away; the giveaway UGC engine has no mentions-harvest, so entries tweet into the void.

3. **The two most defensible content assets are unbuilt.** Per-question gameplay stats (migration 76 was created *specifically* to power "Question Guru / hardest-question" content, plus `times_answered/times_correct` accruing since the quiz bank existed) have **zero consumers** — "only 8% got yesterday's hardest question right" is free, daily, self-refreshing, data no competitor has. And the 10,051 player-season FIFA-ratings dataset has no public page for a single footballer — the biggest untapped programmatic-SEO surface in the repo, evergreen, and it feeds the flagship game directly.

Cross-cutting operational risk: the entire content operation — daily quiz generation and publishing, all X/Reddit posting, winback email, send-time inference — runs from LaunchAgents on the founder's Mac, and published content is drifting out of git (daily packs after Jul 2 exist only on that machine and in the DB; one referenced email template isn't in the repo at all; a seed script reads from `~/Downloads`).

---

## Do this week (before the Jul 19 final)

1. **Decide the post-WC daily quiz and parameterize `series`.** The pipeline is reusable as-is — the recap-of-yesterday format maps cleanly onto transfer-window news; the changes are copy (`composeTweet`, the daily email) and an editorial brief, not code. Pair with a successor board/prize hook to replace the £100 line.
2. **Gate the giveaways.** One config-driven prize object consumed by all four "WIN £25 TODAY" surfaces (currently hardcoded with no off-switch — after Jul 19 it's either an unbudgeted liability or a false promise), plus a `/giveaway` terms page (UK CAP Code applies to prize promotions; today there are no published terms, no entry tracking, no winner mechanism).
3. **Ship `hardest-question.mjs` while the pool is at peak.** ~100 lines: aggregate yesterday's `quiz_answers`, render a card through the existing OG pipeline, add an evening Telegram gate to launch-daily. It also feeds the finale-week arc ("the hardest questions of the tournament") and the post-WC blog data piece.
4. **Ship the mentions-harvest script** (clone of x-engage searching the brand handle + `/s/` links, gated quote-RT drafts) before finale-week entries flood in unseen — and script the £100 board finale as a content event: board freeze, final standings, winner announcement (the biggest trust post of the year).
5. **Add blog waitlist capture + publish the WC quiz post.** A one-field "get gameweek-1 access" block on all four fantasy posts and /blog (Resend infra already exists), and the "50 World Cup 2026 quiz questions" post by ~Jul 16 — the search spike doesn't come back.
6. **Automate the daily debate tweet** through the existing Telegram gate — the most natural daily, zero-marginal-cost brand post the product has, currently manual.

## The next month (post-WC → mid-Aug launch)

- **Blog cadence: 2 posts/week against the prioritized Next-10 list** (in the blog annex): WC data post-mortem (Jul 20–22, the first link-earning piece), fantasy team names 2026/27 (top-volume/low-difficulty, perfectly timed), best-all-time-XI from the ratings dataset (opens the 38-0 cluster), FPL-vs-YourScore comparison (the page paid traffic lands on), pub-quiz-night post (first to deep-link a /challenges pack), gameweek-1 hub at launch. Every post gets the waitlist block, one game/pack deep-link, and an author byline (currently no E-E-A-T signals at all).
- **Fix the discoverability plumbing:** packs + dailies into the sitemap; `quiz.angle` → pack description (one line in the seed script); restore a real /challenges archive index; link the blog from the product (footer, /how-it-works, a Home card); UTM the blog shell CTAs.
- **Freeze the fantasy-game claims pipeline.** Four posts state hard mechanics ("credits bank up to five") in FAQ JSON-LD for a game with no code in the repo, whose model pivoted three times in the 24h after publishing — and robots.ts deliberately invites AI crawlers to ingest it. One internal spec doc the posts derive from + a launch-week re-verification checklist. (Also reconcile YOURSCORE.md, which still says "Your PL XI" while the blog says "YourScore Fantasy Football".)
- **Stand up ONE short-form video channel (TikTok first — the ad account exists).** This is the single biggest distribution gap: the audience is 16–34 football fans, the medium is vertical video, and the brand's only organic channel is text-first X. Three formats cut from product capture: penalty-shootout POV, "rate this spun squad" reactions, debate read-overs. The founder-gated compose-image-prompt pattern extends naturally to a caption+clip pipeline. (An `ig-watchlist.json` exists that no script consumes.)
- **New share artifacts by emotional payload** (all parameter additions to existing `next/og` routes): streak-milestone card, pens "held my nerve" card, rank-overtake card on RankRewardCard (which computes the chase but has no share affordance), PERFECT ROUND badge. Fix the one locked-vocab violation in share copy ("My Draft XI drew…" → 38-0, `38-0/match/result/page.tsx:42`).
- **Wire the weekly digest email (template 07 — written, unwired).** It's the only content-bearing template (real personal stats) and the natural post-WC home for hardest-question + the day's debate; put one actual question (no answer) in the daily email.
- **Retire or re-skin the static social kit.** `social-media/content-brief.md` is a dead May doc that says "football IQ" 9×, describes "Rooms" and live-match quiz as current, and — worst — instructs fabricating engagement stats ("always skew the % down… specific non-round numbers"), which contradicts the codebase's own integrity culture and is now unnecessary given real answer-rate data. Templates use an off-brand palette (green/purple vs the product's lime/gold). Stamp it HISTORICAL or rewrite around the real pillars already encoded in x-ideas.mjs.
- **Move content ops off the laptop:** the X/Reddit runners, launch-daily, reengage, and send-time inference all hardcode the founder's Mac; the Telegram approval gate already makes location irrelevant. Have launch-daily commit the daily-quiz JSONs it publishes; bring the missing email template and Downloads-based seed sources into the repo.

## The quarter (durable moats)

- **Programmatic SEO from the ratings dataset:** `/legends/[player-slug]` (rating trajectory across seasons + "Draft them in 38-0"), `/legends/[club]/[season]` squad pages, editorial indexes ("every 90+ rated PL season") — static-generated from the JSON already in the bundle, ~2,000–3,000 unique player pages, all ending in a native game CTA. This also gives the AI crawlers robots.ts deliberately welcomes something to actually cite.
- **Evergreen pack catalogue as an editorial calendar:** 8–12 packs against fan-interest categories (club legends × top-6, PL 90s, CL finals, Messi/Ronaldo) — the daily pipeline's JSON format and seed scripts support this with zero new code. Roll the season-review packs into a repeatable end-of-season product before they read stale in mid-Aug.
- **A wrong-answer report path** (one tap on the answer reveal → table → the existing Telegram health channel). In a prize-paying knowledge product this is trust infrastructure — and "every question sourced and player-auditable" becomes a marketable claim, since the citations already exist in every daily JSON, unexposed.
- **Question Guru as a product surface:** the same stats that power the daily card become an in-app board (most correct on hard questions) and a weekly "this week on YourScore" post fed by the Versus activity feed — closing the UGC flywheel the giveaway engine already primes.

## Scorecard

| Dimension | Grade | One line |
|---|---|---|
| Content production ops | **A−** | Real editorial pipeline with approval gates, QA, and citations; single-laptop + wc2026 hardcoding are the deductions |
| Technical content SEO | **B+** | Excellent per-post plumbing; sitemap/index/internal-link gaps waste it |
| Content strategy & calendar | **C** | One two-day blog burst, a dead May social brief, no post-WC plan, no owner/cadence anywhere |
| Distribution | **C−** | One disciplined X channel + Reddit listening; zero short-form video, no UGC harvest, no capture endpoint |
| Data-as-content | **D** | The two best assets (question telemetry, ratings dataset) are built for content and feed nothing |
| Brand/voice consistency | **B** | Locked vocab clean in product/blog/email; stale social kit and one share string violate it |
