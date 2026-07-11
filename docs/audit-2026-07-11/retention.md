# Retention, Engagement & Lifecycle — Audit Findings

**Context:** WC ends Jul 19 (8 days from audit date). Daily-habit architecture: (1) WC Mastermind daily run + push, (2) WC daily quiz (£100 board), (3) daily debate, (4) day-streak + week dots on Home. Worst-first; the first four detonate on or around Jul 19–20.

### P0 — On Jul 20 every default surface points at a dead tournament; nothing is date-aware
- 38-0 hardcodes WC as the landing tab: `useState<DraftTab>("wc")` — src/app/38-0/page.tsx:45
- Versus hero: "World Cup Mastermind — top the board, win £100" — src/lib/versus/registry.ts:48
- Quiz tab's Leaderboards tab is ONLY the wc2026 daily board — src/app/play/page.tsx:487-561,987-1048
- Both "official" Leagues Discover cards are WC boards — src/app/api/leagues/discover/route.ts:51-57
- Season board window freezes at WC_SEASON_END = "2026-07-19" — src/lib/draft/wc.ts:27-28 (duplicated wc-og/route.tsx:23-24, wc-server.ts:498). Ranked runs are NOT gated by the window — from Jul 20 "Today's Run" still plays but counts toward nothing visible.
- No season-end mechanic: wc.ts:26 promises "a champion is crowned" but no crowning code, countdown, or wrap moment exists.
- Logged-out landing shows "THE CUP IS LIVE" forever once diff <= 0 — MarketingLanding.tsx:71; "World Cup 2026 · June 11" hero at :759.
**Fix:** Season 1 finale → Season 2 before Jul 19: crown the champion (emails/lifecycle/10-tournament-wrap.html exists, unwired), flip default tab, swap hero + Discover cards, replace hardcoded window with a seasons table.

### P0 — The app's ONLY daily push dies silently (or lies) after the WC
Sole scheduled push = hourly wc-mastermind cron (vercel.json:8), no-ops "no-pack-today" with no alerting unless a published pack with metadata {daily, date:today, series:wc2026} exists (api/cron/wc-mastermind/route.ts:59-72). Pack supply = WC-match-recap quizzes (content/daily-quizzes/, latest 2026-07-02) generated + published by LaunchAgents on the founder's Mac (scripts/launch-daily.sh:4-11), Telegram-gated. After Jul 19 the recap premise has no matches; if publishing stops the channel silently zeroes. Push copy hardcoded "World Cup Mastermind Daily is live 🧠" (route.ts:103).
**Fix:** decide the post-WC daily now (engine is tournament-agnostic — "Daily Mastermind" on PL/La Liga history); move pack check + copy off wc2026; dead-man's-switch alert on two consecutive no-pack runs.

### P0 — The pushed daily habit doesn't feed the streak it's meant to build
Home streak/week-dots derive only from quiz_attempts + draft_matches (src/app/page.tsx:102-133,176-205). WC Mastermind runs write draft_wc_runs only (zero inserts to either table); debate votes write debate_votes. A faithful daily-push player sees "START A STREAK — one game today does it" (Dashboard.tsx:183-186).
**Fix:** add WC-run days (and debate-vote days) to playedSet — two-line query addition — before Jul 19.

### P1 — No streak protection: breaks silently, can't be repaired, nothing warns you
Streak computed read-time on Home only — never stored, so no server job can see it. No at-risk push, no freeze/repair token, no milestones; dayStreak exists in exactly 2 files. Bugs: 38-0 contribution capped at last 12 matches with NO date floor (page.tsx:108) — 12 matches today wipes prior streak days from that source; quiz window is 45 days (page.tsx:131) silently capping streaks.
**Fix:** materialize (profiles.day_streak on play), evening streak-saver push (notifyUsers + active_hour_utc plumbing idle 23h/day), fix the caps.

### P1 — One dismissal permanently kills all push opt-in asks; the code's "backup" claim is false
PushPrePrompt fires at first sign-in before any gameplay value (PushPrePrompt.tsx:10-16). Its comment claims NotifyOptInCard is a backup for "Maybe later" — but later() calls markPushPrompted() (:67-70) writing the SAME PUSH_PROMPTED_KEY NotifyOptInCard bails on (NotifyOptInCard.tsx:38). "Maybe later" = never asked again anywhere. This design already forced a v1→v2 key bump (onboarding.ts:13-18).
**Fix:** own key for contextual cards (QUIZ_NOTIFY_KEY exists, unused by NotifyOptInCard) or 7-day cooldown; fire pre-prompt after first WIN.

### P1 — Push stack reaches only native users; the web majority gets nothing
notify.ts:9-11: "Native only today… web push once the service-worker + VAPID path is built." NotifyOptInCard guards isNative(). Edge Function supports APNs+FCM (send-push/index.ts:100-101) but no web registration path. Web is the primary live product — streak savers, revenge pushes, challenges, the daily drop miss most users.
**Fix:** web push = single highest-leverage retention build for post-WC.

### P1 — Lapsed-player winback has zero server automation; comeback email targets the wrong cohort
Only automated lifecycle email = /api/cron/comeback (daily 17:00) targeting signed-up-5–21-days-ago never-played users, once ever, 50/run (route.ts:9-11,22-25,79-83). A 30-game player who vanished is touched only by scripts/reengage.mjs — run from the founder's Mac. Templates 05 (pre-match), 07 (weekly digest), 08 (top-of-league) exist with no sender in src/lib/email/senders.ts.
**Fix:** port reengage cohort logic to a Vercel cron (email_log dedupe infra exists, mig 31); wire the weekly digest — the canonical WC-independent return trigger.

### P1 — Daily debates freeze on Aug 5 → "same debate every day, forever"
scripts/seed-debates.mjs SCHEDULE ends 2026-08-05. Runtime = today's row or most recent past (src/lib/debate.ts:32-41) — no wrap-around (YOURSCORE.md §9 "cycle wraps" is stale). Extending = human edits the script with laptop .env.local. No low-runway alert. (Jul 20–Aug 5 entries are already evergreen — content survives the WC; the pipeline doesn't.)
**Fix:** author 60+ evergreen rows now; fallback re-rotation of the historic bank by date-hash when the schedule runs dry.

### P1 — YourScore Rank is all-time-only: newcomers face an uncatchable ladder once the WC cohort locks in
YOURSCORE.md §6 self-diagnoses ("pure 38-0 volume… no seasonal reset"). RankRewardCard is genuinely good (per-session +pts/▲places, chase line — RankRewardCard.tsx:49-54,108-114) but the chase gap for a newcomer vs a WC-month grinder will be five figures with no intermediate goal.
**Fix:** Jul 20 = the free narrative moment for Season 2 with a season-scoped board (all-time as legacy tab); weekly Friends-scope digest ("#3 of your mates, 400 pts off Dan").

### P1 — League tables change silently: you never learn you've been overtaken
League rank delta computed client-side from localStorage on visit (league/[id]/page.tsx:241-251). No push/email for "X passed you" (no notifyUsers caller in any league route; template 08 unwired). Leagues are the strongest social-retention asset and their alert surface is pull-only.
**Fix:** daily league-movement cron over league_members → highest-signal social notification in the app.

### P2 — Comments and debate arguments never notify anyone
api/comments/route.ts has no notifyUsers/email call (same wc/comments). Replies to your argument or trash-talk on your run go unseen. **Fix:** reply/comment pushes reusing the shadow-loop dedupe rules.

### P2 — Push copy promises things the system doesn't deliver
QuizNotifyPrompt.tsx:26 sells "a ping when a fresh quiz lands or a mate beats your score" — fresh-quiz only exists for the WC daily; mate-beats only fires for h2h/shadow, not league/board overtakes. "Win £100" (registry.ts:48) and "WIN £25 TODAY" (38-0/season/page.tsx:289 et al.) hardcoded — false advertising the day promos end. **Fix:** sweep prize/daily copy behind one config flag in the Jul 19 cutover checklist.

### P2 — Friend requests are email-only
api/friends/route.ts:90,115 send emails; no notifyUsers call. Every other social event pushes. Friend-graph density = #1 long-term retention predictor. **Fix:** trivial with existing plumbing.

### P2 — Invited friends hit a sign-in wall before the payoff
38-0 challenge recipient: "Sign in to accept" (challenge/[code]/page.tsx:140-148); h2h has sign_in_needed (h2h/[id]/page.tsx:64,245,683). The debate flow got this right. **Fix:** guest-play the challenge, gate the recorded result/rematch.

### P2 — Empty-league experience is a static join code; no league lifecycle beyond one email
Zero state = "No members yet. Share the invite code!" (league/[id]/page.tsx:370). First-member email (09) wired — good — but no D+3 "still empty" WhatsApp-ready nudge, no weekly summary, no stale-league revival. Public discovery needed seeded fake banter leagues to not look dead — a signal liveness is already a problem. **Fix:** share-to-WhatsApp at creation; weekly league table email with the digest work.

### P3 — Send-time personalization depends on a manually run script
active_hour_utc inferred by scripts/compute-send-times.mjs (laptop, manual); unscanned users fall back to 19:00 UK (wc-mastermind/route.ts:27-30). **Fix:** weekly Vercel cron.

### Genuinely strong (keep and extend)
- Shadow-match revenge loop: rally bypass, 24h aggregation, "beats open the push, holds never do" (src/lib/versus/shadow.ts:339-447) — best retention mechanic in the codebase, fully WC-independent.
- notifyUsers infra (opt-in gating, per-key dedupe, log-before-send) is production-grade and badly underused — 6 push types vs the dozen obvious ones above.
- RankRewardCard delivers felt progress every session, never shows drops.
- Evergreen content skeleton exists (club season packs, Records tab, post-WC debates) — the gap is pipelines and defaults, not raw content.

**One-sentence summary:** the daily-habit machine is real but almost entirely WC-fueled and founder's-laptop-operated — priorities: (1) the Jul 19/20 cutover, (2) streak counts all hooks + defends itself, (3) winback + digest onto server crons.
