# ACQUISITION & FIRST TOUCH — Audit Findings

**Method note:** live fetches to yourscore.app were blocked by the sandbox egress proxy; all findings verified against code at HEAD (deploys to prod from main).

## 1. Logged-out first impression

### P0 — Logged-out landing sells a product that doesn't match what's shipped, with month-stale World Cup copy
`src/components/home/MarketingLanding.tsx` is still the pre-launch league-signup page: **"Create your league before Jun 11 →"** (line 735), **"START YOUR LEAGUE — World Cup 2026 · June 11"** (758-759), "June 11 · Mexico City. The first match to earn points on" (731) — today is Jul 11, mid-tournament. Hero card depicts live-match watching ("England vs France · 67' · 2 watching", 189-190) and "See who's live in a match right now" (560) — Live-match Quiz is NOT live (gated on mobile launch). The "league" sold (points from picking matches, 580-601) isn't the shipped league model. **Fix:** rewrite landing around what's live NOW: 38-0/WC Mastermind daily, Quiz catalogue, daily debate, £25 giveaway. Kill every "before Jun 11" string today.

### P1 — Five competing CTAs; most dominant ("Create a league") is sign-in-gated and off-strategy
Nav: Sign In + Sign Up + solid-lime pulsing "Create a league" (MarketingLanding.tsx:286-297); hero adds "Draft your XI" (423), "Sign Up — Free", "Join a league", "Get the app" (433-454); "Create a league" repeats 4 more times (204, 571, 733, 764). But `/league/new` shows guests a "Sign in to create a league" wall (src/app/league/new/page.tsx:184-188), and the strategy hook is 38-0 anonymous play. **Fix:** one primary CTA — "Draft your XI" — everywhere; demote league creation; secondary = "Play a free quiz".

### P2 — Quiz, Debate, Leaderboard and Blog invisible on logged-out page
MarketingLanding.tsx has no link to /play (only guest BottomNav, BottomNav.tsx:63), none to /debate, /leaderboard, /blog — footer (786-790) links only how-it-works/challenges/league join+create/mailto. Daily debate is the best zero-friction guest hook and is unreachable from the front door. **Fix:** "Today's Debate" one-tap ballot module + quiz-pack rail on landing; Blog + Debate in footer.

### P2 — "Draft your XI" lands strangers on the World Cup tab, not a draft
Hero CTA → /38-0, default tab "wc" (src/app/38-0/page.tsx:47) — a hub with mode choice and (ranked) sign-in redirect (/38-0/wc/page.tsx:163-165). Tap count to first spin: 4-5; could be 2-3. **Fix:** deep-link `/38-0?tab=pl` or straight into a started draft, or make WC tab guest default the open WC Run.

### P3 — Landing scoring copy contradicts real scoring
MarketingLanding.tsx:649-652 promises "0-15s +200 pts … 3 in a row ×2"; actual is 100 × difficulty × speed-band +50 streak (src/lib/scoring.ts); challenge intro shows a third system (challenges/[slug]/page.tsx:868-871). **Fix:** one canonical explainer.

### P3 — Dead "Upcoming fixtures" machinery; menu links to empty page
src/app/page.tsx:66 always passes matches={[]}; mobile menu still links "Upcoming Matches" → /join (MarketingLanding.tsx:357). **Fix:** remove until Live-match Quiz ships.

## 2. Sign-up friction & guest→account conversion

### P1 — "SIGN UP & SAVE SCORE" does not save the score
Post-quiz guest CTA (challenges/[slug]/page.tsx:1242-1244) links to /auth/sign-in?next=/challenges/{slug}. Score is only persisted at completion IF userId was already set (page.tsx:676-690). Nothing stashes the run across the OAuth redirect; the new user lands on the pack intro, score gone, must replay — and intro warns "your first score counts on the leaderboard" (891). Highest-intent conversion moment; the promise is false. **Fix:** stash the answer log in localStorage before redirect; on return post to solo-complete (server grades raw answers, stays tamper-checked) — mirror the WC hub pattern (/38-0/wc/page.tsx:358-377).

### P1 — "SAVE YOUR TEAM" sign-up drops the user on the dashboard, not back at their team
Anonymous prompt after completing an XI links to bare /auth/sign-in with no ?next= (src/app/38-0/page.tsx:195-198); sign-in defaults to next || "/" (auth/sign-in/page.tsx:23). **Fix:** href="/auth/sign-in?next=/38-0/team" — one line.

### P2 — 1v1 (/h2h/[id]) and group (/g/[id]) challenge links demand an account before any play
/g/[id]: "Sign in to play →" (g/[id]/page.tsx:105); /h2h/[id] has sign_in_needed state (h2h/[id]/page.tsx:64,245,683). Same quizzes are guest-playable at /challenges/[slug]. Strongest word-of-mouth surfaces front-load the wall. **Fix:** let the recipient play as guest, show the head-to-head result, gate recording/rematch behind sign-up.

### P2 — Sign-in page copy wastes the conversion moment
One generic screen for every entry: "Sign in or sign up — … Free forever." (sign-in/page.tsx:52-54). No team preview, no score, no "save your 2,340 pts". **Fix:** read `next` (already parsed, 16-20) and render a contextual header per source.

## 3. SEO & discoverability

### P1 — Flagship routes /38-0 and /play have no route metadata at all
Both are "use client" pages with no layout.tsx metadata; they inherit the root generic "YourScore — Football Knowledge Game" (layout.tsx:44-65) despite sitemap priority 0.9 (sitemap.ts:11-12). Pasted /38-0 links unfurl with the generic home card. **Fix:** per-route layout.tsx with title/description/canonical/OG. Same for /how-it-works and /leaderboard.

### P2 — Quiz pack landing pages missing from the sitemap
/challenges/[slug] has per-pack titles/canonicals (challenges/[slug]/layout.tsx:64-78) — real long-tail surface — but sitemap.ts lists only 10 static routes + blog. **Fix:** enumerate published evergreen quiz_packs slugs in sitemap.ts + a crawlable server-rendered pack index.

### P2 — Blog is an orphan: zero internal links from the site
grep '"/blog' finds no inbound link outside blog routes — not in landing footer, dashboard, or how-it-works. **Fix:** footer link site-wide + "From the blog" blocks; interlink posts → packs.

### P3 — No sitewide Organization/WebSite JSON-LD; two competing taglines
ld+json only in blog/[slug]. Home: "The Home of Football Gaming" (page.tsx:17) vs root layout "Football Knowledge Game" (layout.tsx:44). **Fix:** Organization + WebSite JSON-LD in root layout; pick one tagline.

## 4. Share / viral loops (recipient's view)

### P1 — 1v1 challenge links (/h2h/{id}) unfurl with the generic site card
Share URL is ${origin}/h2h/${challengeId} (challenges/[slug]/page.tsx:119), but /h2h/[id] is a pure client page with no generateMetadata/layout — "beat me" tweets unfurl generic. Same /g/[id]. Contrast the personalised cards on /debate, /s/[id], /38-0/wc/share. **Fix:** server layout.tsx with generateMetadata reading the challenge row + personalised /api/og/* card. Highest-volume share URL.

### P2 — Debate page's follow-on CTA sends guests into a sign-in wall
/debate guest landing works (anonymous ?pick= auto-vote, debate/page.tsx:35-40), but the only onward CTA is "Prove it in a Quiz Battle →" → /versus (65-67) where guests hit "Sign in →" (versus/page.tsx:260). **Fix:** point guests at a playable surface (/play or featured pack).

### P3 — Season scorecard (/s/[id]) next action restarts from the hub
Description says "Beat my score" (s/[id]/page.tsx:91) but both CTAs are plain href="/38-0" (126, 265) — recipients land on the WC-default hub with no link to the score to beat. **Fix:** deep-link pre-configured draft + carry target record ("Beat 31W-4D-3L").

## 5. App-store funnel

### P2 — Universal links cover only auth + h2h/g
public/.well-known/apple-app-site-association lists only /auth/callback*, /auth/reset-password*, /h2h/*, /g/*. Debate shares, /challenges/*, /s/*, WC share, league joins all open Safari even with the app installed. **Fix:** extend AASA to /challenges/*, /s/*, /debate*, /league/join*, /l/* (mirror in Android assetlinks when Play ships).

### P3 — No apple-itunes-app Smart App Banner; custom banner shows every new session including first touch
No itunes-app meta; AppStoreBanner renders sitewide for Apple visitors, dismissed per-session only (AppStoreBanner.tsx:20,49-51) — first-time viral visitors get an app upsell before playing anything; returns every session. **Fix:** suppress on first visit / share-landing routes until after first game; persist dismissal in localStorage; consider native Smart App Banner meta.

## Top 3
1. **Rebuild the logged-out landing** (P0) — selling last month's product with expired dates during the marketing moment.
2. **Make "Sign up & save score" actually save the score** (P1).
3. **Personalised OG for /h2h/* + guest play on challenge links** (P1/P2) — the beat-my-score loop underperforms at both unfurl and landing.
