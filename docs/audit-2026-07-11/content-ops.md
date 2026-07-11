# Content Marketing — Content Operations & In-Product Content

**Exec summary:** the daily-quiz pipeline is a genuinely well-engineered content operation (Telegram-gated, idempotent, self-healing, daily LLM QA reviewer), and email/tweet/OG craft is strong and on-brand. But the entire daily content engine is hardcoded to wc2026 and stops producing when the WC ends in 8 days with no replacement format anywhere in the repo; the daily quizzes — 22+ pieces of dated editorial with hand-approved art — are invisible to search; the highest-leverage content asset (per-question gameplay stats → "only 8% got this right") is capture-only with zero consumers; and content source files increasingly live only on the founder's Mac, not in git.

## 1. The daily quiz as a content product

**Genuinely strong ops:** launch-daily.mjs is mature (waits for the morning draft fixing the 29-Jun race; per-day idempotency lock; Telegram Gates 1/2a/2b/2c; edition roll; draft-pool rebuild with a staleness guard added after a 17-day silent freeze; segmented engaged-only broadcasts). Question quality high: 2026-07-02 pack has a clean difficulty ladder, varied categories, narrative `angle` field, and 9 cited sources with per-source claim summaries — better editorial hygiene than most sports publishers. The all-answers-"A" drafting pattern is safely handled (deterministic seeded shuffle at publish, seed-daily-quiz.mjs:38-88; health check guards the known shipped bug). Title/cover/tweet craft locked in quiz-launch.mjs.

**P0 — Post-WC content cliff: the daily engine has no life after Jul 19.**
SERIES = "wc2026" (quiz-launch.mjs:23; launch-daily.mjs:112 default); the tweet hardcodes "World Cup 26 Quiz Series 🏆" + "Top the board by the final to win £100" (quiz-launch.mjs:233-238); the email promises daily drops "for the duration of the tournament"; the edition roll + pool rebuild feed WC Mastermind specifically (whose cron no-ops silently without a pack). No post-WC series exists anywhere in scripts. The only forward signal is the blog's "fantasy launching mid-August" — a ~4-week daily-content vacuum exactly when WC-acquired users decide whether to stay. Debates seeded only through Aug 5.
**Fix this week:** define the post-WC daily format now and make `series` a parameter: a "Daily Football Quiz" keyed to summer content (transfer-window recaps map cleanly onto the recap-of-yesterday format, Euros/history, pre-season); a new season board/prize hook replacing the £100 line; a WC finale-week arc (best-of, hardest questions) to bridge. The pipeline needs almost no code change — the copy and brief do.

**P1 — The daily quiz is invisible outside the app/social push.**
Each daily lives at /challenges/<slug> with a proper OG card + canonical, but sitemap.ts lists only 10 static routes + blog posts — no pack URLs — and /challenges itself redirects to /play (challenges/page.tsx:4). 22+ dated searchable quiz pages with approved art earn zero organic discovery. Pack `description` is never set (seed-daily-quiz.mjs writes none) so meta falls back to generic "Can you ace this 15-question football quiz?" while each JSON carries a superb keyword-rich `angle` that never reaches the page.
**Fix:** packs into sitemap.ts; map quiz.angle → quiz_packs.description (one line); restore a real /challenges (or /play/archive) index — the archive is the library.

**P1 — Published content isn't in version control.**
Newest daily JSON in the repo is 2026-07-02, but the committed draft bundle contains questions through 2026-07-10 — launch-daily commits only the bundle pathspec (launch-daily.mjs:181). Nine days of packs exist only on the founder's Mac + the DB row. send-wc-quiz-series.mjs:61 references emails/lifecycle/15-wc-quiz-series.html which does not exist in the repo; seed-challenges.mjs:134-135 reads from /Users/zchukwumah/Downloads/*.txt.
**Fix:** launch-daily also commits content/daily-quizzes/<file>.json; move club-quiz .txt sources into content/.

## 2. The evergreen catalogue as a content library

Exists (from code; DB unreachable here): 20 PL club season-review packs + Southampton (seed-challenges.mjs); 3 hardcoded featured WC packs; 22+ daily WC packs (all type "records"), now under a dedicated World Cup tab (play/page.tsx:345; dailies removed from Featured per founder call 2026-07-11); user custom packs.

**P2 — Coverage gaps + ageing:** the system-authored library is one season-review snapshot + World Cup. Nothing for club history/legends (the 38-0 audience's exact interest), eras (90s/2000s nostalgia — the highest-engagement football category on social), competitions (CL, Euros, La Liga despite it being a live 38-0 competition), or players. After Jul 19 the Records tab is 3 packs. Season-review packs read stale the moment 2026/27 kicks off (mid-Aug); no rollover pipeline. Pack metadata is internal (type/parameter as filter keys), not marketable — a pack is a row, not a piece of content.
**Fix:** treat the catalogue as an editorial calendar: 8-12 evergreen packs against fan-interest categories (club legends × top-6, "Premier League 90s", "CL finals", Messi/Ronaldo career) — the daily pipeline's JSON format + seed script already support this with zero code; description + difficulty framing on every pack; retitle/retire 2025/26 packs at season start and make end-of-season packs a repeatable product.

## 3. Question quality ops

**Exists (good, internal):** dedupe-questions.mjs (exact + near-dupe sweep with synonym folding, report-only borderline, best-copy retention — above-average tooling); daily LLM QA (health/checks/gamer-review.mjs — Claude as football-mad harsh QA against today's pack + screenshots, fingerprinted alerts); deterministic checks (recycled packs, shuffle regressions, repeats); per-question source citations in every daily JSON; audit-wc2026-integrity.mjs bot/timing forensics before paying the £100.

**P1 — No user-facing wrong-answer report path.** No report button, no question_reports table, no dispute queue (grep report|flag|dispute → unrelated hits only). For a product whose brand line is "Your football knowledge. Ranked." and which pays cash on quiz results, a user who knows they were graded wrongly has no recourse but silence or a public complaint on X. **Fix:** one-tap "Something wrong with this question?" on the answer reveal → table → existing Telegram health channel. Marketing bonus: "every question sourced and player-auditable" is a differentiating trust claim — the sources are already in the JSONs, unexposed.

## 4. Question Guru / hardest-question stats — the unbuilt flagship format

**P1 — Capture complete; production zero.** Migration 76 (draft_wc_runs.quiz_answers, written by api/draft/wc/route.ts:101) exists explicitly "so the content pipeline (Question Guru, hard-question stats) can mine Mastermind players". A second older source also idles: questions.times_answered/times_correct (mig 02, kept current by record_quiz_results, mig 33). **Grep for consumers (guru|hardest|quiz_answers across src/ + scripts/): none.**
This is the highest-leverage gap in the content audit: "Only 8% of 2,100 players got yesterday's hardest question" is self-refreshing daily content, inherently shareable, proof-of-scale, and free — data + tweet/Telegram/broadcast infra all exist. The WC window (peak pool) closes Jul 19.
**Fix (before the final):** ~100-line scripts/hardest-question.mjs — aggregate yesterday's quiz_answers (grouping is deterministic per the migration comment), pick min-%-correct, render a card via the existing OG pipeline, optional evening Gate in launch-daily. Same aggregate feeds: a "Hardest of the tournament" finale post, a stats module in the daily email, and later an in-app Question Guru board. Fold times_correct/answered into the daily email ("yesterday's average: X/15").

## 5. Email as content

**Inventory:** 14 app-wired lifecycle templates (senders.ts); campaigns 11-14 exist with matching one-shot senders (sent); **15-wc-quiz-series.html referenced but absent from the repo**; winbacks 24-26 wired via reengage.mjs; **built but never wired: 05 pre-match, 06 post-match recap, 07 weekly digest, 08 top-of-league, 10 tournament wrap.**

**Copy quality: high.** Voice consistent and on-brand ("STILL 0–0. You signed up, then life happened. Fair." is excellent winback copy); locked vocabulary respected throughout; pause/unsubscribe in every footer.

**P2 — Emails are nudges, not content.** Every live email is a CTA wrapper; none carries a stat, debate, or question teaser worth opening on its own. 07-weekly-digest — the only stats-carrying template ("{{week_score}} points, {{week_p4p}}% accuracy…") — is unwired; the daily email teases only the quiz title. **Fix:** wire the weekly digest (post-WC it's the natural home for hardest-question + the day's debate — the flagship content email); put one actual question (no answer) in the daily email — the cheapest open-to-click improvement available.

## 6. The player database as content

**Exists:** src/data/draft/player-seasons.json — **10,051 player-seasons** (PL + LaLiga, 90 nations), e.g. {"name":"Cristiano Ronaldo","club":"Real Madrid CF","season":"2017/18","overall":94}. Consumed only by the draft engine server-side.

**P2 — A unique data asset with zero public surface.** No route, page, or sitemap entry for any actual footballer (/players/[id] is the *user* profile page). The indexable estate is 10 static routes + 5 blog posts — while "Cristiano Ronaldo FIFA ratings by season", "best PL strikers 2008/09", "highest-rated La Liga XI" are exactly what the 38-0 audience searches, and robots.ts deliberately welcomes AI crawlers with almost nothing to cite.
**Fix (post-WC quarter):** programmatic SEO from data already shipped: /legends/[player-slug] (rating trajectory + "Draft them in 38-0" CTA — ~2,000-3,000 unique players), /legends/[club]/[season] squad pages, editorial index pages ("every 90+ rated PL season"). Static-generate at build from the JSON; add to sitemap. The single biggest untapped acquisition surface in the repo, fully evergreen, feeding the flagship game directly.

## Priority table

| # | Sev | Finding | Cost |
|---|-----|---------|------|
| 1 | P0 | Daily engine hardcoded wc2026, ends Jul 19; no successor; ~4-week gap to fantasy launch | Editorial decision + copy edits |
| 2 | P1 | Question-stats capture has zero consumers — hardest-question format unbuilt at peak pool | ~1 script + a gate, before Jul 19 |
| 3 | P1 | Dailies not in sitemap; /challenges redirects away; descriptions never populated from angle | Hours |
| 4 | P1 | No wrong-answer report path (trust risk in a prize-paying knowledge product) | Small table + button + Telegram hook |
| 5 | P1 | Content not in git (daily JSONs post-07-02, template 15, Downloads .txt) — single-machine bus factor | Pathspec commits; move sources |
| 6 | P2 | Evergreen catalogue thin; season packs age out mid-Aug; metadata unmarketable | Editorial batch, existing pipeline |
| 7 | P2 | Emails pure nudges; weekly digest unwired; daily email teases no question | Wire 07; add 1 question |
| 8 | P2 | 10,051-row ratings dataset has no public surface — biggest untapped programmatic-SEO asset | Static-gen from existing JSON (post-WC) |
