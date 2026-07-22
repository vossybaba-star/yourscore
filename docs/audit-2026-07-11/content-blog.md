# Content Marketing — Blog & SEO Content Engine

**Big picture:** technically excellent for a 2-day-old blog (static MDX, canonicals, Article + FAQPage JSON-LD from one source, RSS, sitemap/robots, AI-crawler allowances, llms.txt, UTM CTAs feeding mig-75 attribution). Writing has a genuinely distinct fan voice — would not read as AI-generic. Problems are strategic: funnel dead-ends five weeks before the launch it serves; four of five posts market an unshipped game whose rules pivoted twice in 24h; zero WC content (final in 8 days) and zero 38-0 content; blog orphaned from the product.

## P0 — The funnel has no launch-capture endpoint
All four commercial posts funnel to "launches mid-August" (how-to-play:88, 50-questions:207, fpl-alternatives:43, transfers:116). NO email capture, waitlist, or notify-me anywhere (grep newsletter|subscribe → nothing). Only CTAs are /play links + layout footer "Play YourScore" → /. Ranking takes 4-8 weeks; traffic peaks around launch; every pre-launch visitor unrecoverable. Resend + 23 templates + suppression infra already exist. **Fix:** one-field "Get gameweek-1 access" capture block at the end of all four fantasy posts + /blog index; store to a table or Resend audience. Single highest-leverage content change before launch.

## P1.1 — Four posts document, in FAQ schema, a game that doesn't exist in code with a visibly fluid spec
grep "Fantasy Football" src supabase scripts → only llms.txt. No fantasy game code or spec doc. Model pivoted repeatedly within a day of publishing (4d16645, 10a4507, 4b0cf75 — all Jul 10). Hard mechanics stated as fact ("Credits bank up to five", how-to-play:50,62,72) baked into FAQPage JSON-LD (fpl-alternatives:15); robots.ts invites GPTBot/ClaudeBot/PerplexityBot to ingest it; llms.txt leads with it. If rules change again pre-launch, the site serves wrong structured data about its own product to Google + every AI engine. **Fix:** single internal spec the blog is generated from + launch-week re-verify checklist; soften unshipped specifics in FAQ answers; reconcile YOURSCORE.md's stale "Your PL XI" name (blog rebranded to "YourScore Fantasy Football", 41131e1).

## P1.2 — Blog orphaned: zero product links to /blog
grep '"/blog' src (excl. blog routes) → none. Internal links are the cheapest authority signal a new blog can get. **Fix:** logged-out footer + /how-it-works + "From the blog" card on Home.

## P1.3 — Zero World Cup content 8 days from the final; zero 38-0 content at all
No post targets WC quiz queries (the year's biggest search moment) or "build your all-time XI"/team-builder queries; migration 76's quiz_answers capture was built to feed "Question Guru / hardest-question" content and feeds nothing public. **Fix:** WC quiz post before Jul 19; data post-mortem Jul 20-22 (see Next-10 list).

## P1.4 — The self-promotional roundup, honestly assessed
Disclosure is immediate and repeated ("starting with ours — declared honestly, judged like the rest", :18; "Ours, so read accordingly", :37; trade-off admitted :43); competitor verdicts genuinely fair. Reads as an opinionated vendor page most searchers will tolerate. Real risks: #1 recommendation is an unlaunched product nobody can try (fails the reviews-system "first-hand experience" test harder than the self-promotion does), and at 872 words for 8 games it's the thinnest post against a query where incumbents run 2,500+. **Fix:** keep YourScore first; deepen every competitor section with first-hand detail/screenshots; add waitlist capture as the YourScore action; target 1,800+ words.

## P1.5 — E-E-A-T: no author anywhere
Article JSON-LD author = Organization ([slug]/page.tsx:133); no byline, author page, or About link. **Fix:** author: frontmatter → byline + credential line; /about linked from blog footer.

## P2.1 — Infographics: heavy, no dimensions, one missing
5 of 6 shipped (8f50764): 1536×1024 WebPs 191-322KB; the FLAGSHIP post (50 PL questions) has zero images. Rendering uses plain <img>, no width/height (CLS), no lazy ([slug]/page.tsx:98-102); how-to-play carries ~900KB of images. Alt text good. Also: ChatGPT-generated with no contact-sheet approval evidence — the Jul 7 art rule may apply; confirm with founder. **Fix:** dimensions + lazy; recompress ≤120KB at 1200px; sixth infographic ("what your score says about you" tier graphic); confirm sign-off.

## P2.2 — "Living post" promise with no maintenance mechanism
transfers:16 "Living post, updated through deadline day 1 September. Bookmark it." — no updated: frontmatter, no dateModified, no schedule/tooling. Visibly stale "living" pages damage trust. **Fix:** updated: → dateModified + rendered line; weekly calendar slot; or cut the framing.

## P2.3 — Solo challenge packs (the declared "SEO surface") invisible to search
/challenges root redirects to /play; pack pages force-dynamic; no pack URLs in sitemap; no post links a pack. **Fix:** indexable pack landings + sitemap, or blog posts as the indexable wrapper deep-linking packs with UTM.

## P2.4 — Conversion architecture: good in-body pattern, two gaps
Good: mid-post UTM CTAs (four escalating in the 50-questions post), fantasy cross-links, shareable closers. Gaps: (1) no post links /38-0 — the flagship is never the CTA; (2) blog layout header/footer CTAs carry no UTM → attribution blind on shell clicks. **Fix:** ?utm_source=blog&utm_medium=shell; 38-0 CTAs on dataset posts.

## P2.5 — Keyword prospects (honest)
- 50 PL questions (1,762w): best post; long-tail plausible in 2-3 months; head terms no.
- FPL alternatives (872w): medium-tail possible IF deepened; seasonal spike is NOW — indexing speed matters.
- How-to-play (848w): owns its brand SERP; fine.
- Transfers (864w): head terms none; only viable as genuinely maintained living page; highest effort-to-ranking ratio — deprioritize.
- Welcome (269w): no SEO role; fine.
Misses: "football quiz with friends / quiz night questions" (Lobbies + pub channel!), all WC queries, "fantasy football team names 2026/27" (top-volume low-difficulty seasonal), the FIFA-ratings dataset ("best premier league XI of all time"), data journalism from quiz telemetry.

## P2.6 — Cadence: a two-day burst, nothing scheduled
All publishing Jul 9 16:28 → Jul 10 17:44. README is format-only — no calendar/owner/cadence. **Fix:** 2 posts/week through mid-Aug; calendar in the README so every session sees what's due.

## P3
- FAQ rich results won't show in SERPs (2023 restriction) — still useful for AI answers; fine.
- Keyword-stuffed visible tag chips (50-questions:5-9) — use human tags.
- All posts use the typographic OG plate; a custom "Can you beat 31/50?" card would lift social CTR on the shareable post.
- StaticTweet returns null on fetch failure — 9 embeds can vanish silently at build; log a warning.
- Sitemap: no lastModified/changeFrequency.
- Welcome post claims "thousands" vote in debates (welcome:26) — verify before it reads as puffery. All other product claims checked clean vs YOURSCORE.md; locked vocab clean throughout.
- 50-questions answer key: all verifiable answers checked out; 2025/26-season answers need one internal fact-check pass.

## Next 10 posts (prioritized, target queries)
1. **"50 World Cup 2026 quiz questions" — by Jul 16** ("world cup 2026 quiz questions and answers"); asset: WC Mastermind bank; CTA: daily run + £100 board.
2. **"The WC 2026 questions fans got wrong: 30 days of daily quiz data" — Jul 20-22**; asset: draft_wc_runs.quiz_answers (mig 76) — nobody else has this data; first link-earning piece; pitch to newsletters.
3. **"Fantasy football team names 2026/27: 150 ranked" — late Jul** (top-volume, low-difficulty seasonal); CTA: waitlist.
4. **"Best Premier League XI of all time, per 20 years of FIFA ratings"**; asset: the player-season ratings dataset; ends the 38-0 drought; CTA → /38-0.
5. **"FPL vs YourScore Fantasy Football: what actually changes"** — the conversion page paid/social lands on; waitlist CTA.
6. **"30 football quiz questions for your group chat or pub quiz night"** ("football quiz night questions"); ties to Lobbies + pub outreach; first post to deep-link a /challenges pack.
7. **"Gameweek 1 guide" — launch week**; the Week-1 hub; re-point earlier closers at it.
8. **"The hardest football questions on YourScore — and the % who get them right"**; quiz telemetry; second data-PR piece.
9. **"Premier League records everyone gets wrong"**; supports the 9 Records packs, each section links its pack.
10. **"Which era had the best PL players? 20 years of ratings, charted"**; third dataset piece + Reddit distribution.
Cluster logic: 1/2/6/8/9 = quiz cluster around the 50-questions post; 4/10 = dataset/38-0 cluster; 3/5/7 = launch runway with 7 as hub. Every post: waitlist block, one deep-link, byline, calendar entry.
