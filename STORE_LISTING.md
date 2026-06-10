# Store Listings — YourScore

Copy-paste content for App Store Connect and Google Play Console. Character limits are noted next to each field. Update the World Cup framing post-tournament.

**Single source of truth for product copy is `YOURSCORE.md`** — when revising this file, derive from there, not from past versions of this file. Vocabulary rules (per YOURSCORE.md §2, §14): use **Lobby** not Room, use **football knowledge** not IQ, use exact Lobby types **Private / Public / 1v1**, never reference Facebook sign-in.

---

## App Store Connect

### Name (30 char max)
```
YourScore: Live Football Quiz
```

### Subtitle (30 char max)
```
Watch · Predict · Compete
```

### Promotional Text (170 char max — editable without a new build)
```
World Cup kicks off June 11. Set up a Lobby with mates, play live during matches, and rank your football knowledge across every game of the tournament.
```

### Keywords (100 char max — comma-separated, no spaces after commas, never the app name)
```
football,soccer,quiz,trivia,worldcup,premier,championship,multiplayer,lobby,league,leaderboard,fan
```

### Description (4000 char max)
```
Rank your football knowledge against your mates — every match, any competition, any time.

YourScore is the football-knowledge competition app. Not predictions. Not fantasy lineups. What you actually know, scored under pressure, kept as a running ranking against your group.

FOUR WAYS TO PLAY

LIVE MATCH
Pick a real fixture and play along as it happens. Questions fire at moments during the actual game, scored live. Everyone on the leaderboard answers the same questions within the same window.

MULTIPLAYER LOBBIES
Spin up an on-demand game with your mates any time. Open a Lobby, pick its type, pick a Question source, share the 6-character code:
• Private — invite only, up to 8 players
• Public — anyone with the link, up to 20
• 1v1 — head-to-head, you vs one opponent

Question sources are pre-built Quiz packs (clubs, competitions, themes) or a category + difficulty filter you tune yourself.

SOLO CHALLENGES
Self-paced, single-player. Season-review packs for every Premier League and Championship club. The lowest-friction way to start playing.

38-0
Live Draft XI head-to-head. Pick your starting eleven, pin your reputation on it, and play live during a real match.

CUSTOM QUIZ BUILDER
Generate your own Quiz pack from a prompt, then use it as the question source in any Multiplayer Lobby.

LEAGUES
Group your friends into a League and compile everyone's results into shared tables. Every League has two boards — a Live board fed by Live-match points, and an Offline board fed by Multiplayer and Solo. Points don't mix. One league for the WhatsApp, another for the office, another for the family.

SCORING
Speed bands multiply your points by how fast you answer (Lightning ×2.0 down to Very Slow ×0.5). Streaks, comebacks, and perfect rounds bonus extra. Timeouts and rage-quits cost you.

BUILT FOR THE 2026 WORLD CUP
Group stage starts June 11. Set up your League now and you're ranking your mates from the opening fixture.

FREE
No subscriptions. No paywalls. No ads during the game. Sign in with Apple, Google, or email — guests can browse and play but need an account to earn ranked points and join Leagues.

WHO IT'S FOR
Football fans who actually watch matches. Group chats with arguments to settle. Anyone who's ever said "I know more football than you do."

WHAT YOU NEED
A phone. A football match. A few mates with opinions.
```

### What's New in This Version (4000 char max, for each update)
```
First release.

Sign in with Apple, Google, or email. Three ways to play:
• Live match — play along with a real fixture
• Multiplayer Lobbies — Private / Public / 1v1, share a 6-character code
• Solo challenge — Premier League and Championship season packs

Plus 38-0: pick your starting eleven and play live, head-to-head during a real match.

Build your own Quiz packs with the Custom Quiz Builder. Group friends into Leagues with separate Live and Offline boards.
```

### Category
- Primary: **Sports**
- Secondary: **Trivia** (Games subcategory)

### Age Rating
**4+** (no objectionable content). The questionnaire should answer "No" to all categories.

### Support URL
```
https://yourscore.app/support
```
(Create this page before submission — even a simple `mailto:` is fine.)

### Marketing URL
```
https://yourscore.app
```

### Privacy Policy URL
```
https://yourscore.app/privacy
```

### Privacy Nutrition Labels (App Store Privacy)
Data linked to user identity (declared via Apple's questionnaire):
- **Identifiers** — User ID (for account)
- **Usage Data** — Product Interaction (analytics via Vercel Analytics)
- **Contact Info** — Email Address (for sign-in)
- **User Content** — quiz answers (the gameplay data)
- **Diagnostics** — Crash Data (if integrating Sentry/etc later)

Data NOT collected: location, contacts, browsing history, financial info, health, sensitive info.

### Required Reviewer Notes (Build Submission → App Review Info)
```
YourScore is a football-knowledge competition app — not a predictions app, not fantasy football. Players are scored on what they actually know, with a real-time speed multiplier.

The app is a native iOS shell around https://yourscore.app via Capacitor, with native push notifications (APNs) for in-match question alerts, deep-linked OAuth (yourscore://), branded splash + icon, and full safe-area support. It is more than a thin webview wrapper.

Four ways to play, all signed-in:

1) Live match — Matches tab → pick a real fixture → play along as it happens; questions fire during the actual game.

2) Multiplayer Lobby — Play tab → Multiplayer sub-tab → Create Lobby. Pick type (Private / Public / 1v1), pick a Question source (a Quiz pack or category + difficulty filter), share the 6-character code. Joiners enter the code, group up, the game starts with a live leaderboard.

3) Solo challenge — Play tab → Solo sub-tab → pick a club or competition pack and play a self-paced quiz against the global leaderboard.

4) 38-0 — top-nav tab. Live Draft XI head-to-head. Pick your starting eleven, play live during a real match, head-to-head leaderboard.

A Custom Quiz Builder under Play lets users generate their own Quiz packs (AI-assisted) for use as a Multiplayer Question source.

To evaluate, sign in with the test account:
  Email:    apple-review@yourscore.app
  Password: Reviewerbf4cb1d2!1A

Or tap Continue with Apple / Google for the OAuth flow.

Cleanest demo path after sign-in:
  • Play tab → Solo → pick "Arsenal Are Champions" → play through to see the question + scoring engine.
  • Play tab → Multiplayer → Create Lobby (Private) → start the Game to see the synced live leaderboard.
  • 38-0 tab → see Draft XI head-to-head.

Tested on iPhone 17 Pro simulator and iPhone 17 Pro Max physical device. No special hardware needed.
```

---

## Google Play Console

### App title (50 char max)
```
YourScore: Live Football Quiz
```

### Short description (80 char max)
```
Rank your football knowledge against your mates. Lobbies, leagues, 38-0.
```

### Full description (4000 char max)
```
Rank your football knowledge against your mates — every match, any competition, any time.

YourScore is the football-knowledge competition app. Not predictions. Not fantasy lineups. What you actually know, scored under pressure, kept as a running ranking against your group.

FOUR WAYS TO PLAY

LIVE MATCH
Pick a real fixture and play along as it happens. Questions fire at moments during the actual game, scored live. Everyone on the leaderboard answers the same questions within the same window.

MULTIPLAYER LOBBIES
Spin up an on-demand game with your mates any time. Open a Lobby, pick its type, pick a Question source, share the 6-character code:
• Private — invite only, up to 8 players
• Public — anyone with the link, up to 20
• 1v1 — head-to-head, you vs one opponent

Question sources are pre-built Quiz packs (clubs, competitions, themes) or a category + difficulty filter you tune yourself.

SOLO CHALLENGES
Self-paced, single-player. Season-review packs for every Premier League and Championship club. The lowest-friction way to start playing.

38-0
Live Draft XI head-to-head. Pick your starting eleven, pin your reputation on it, and play live during a real match.

CUSTOM QUIZ BUILDER
Generate your own Quiz pack from a prompt, then use it as the question source in any Multiplayer Lobby.

LEAGUES
Group your friends into a League and compile everyone's results into shared tables. Every League has two boards — a Live board fed by Live-match points, and an Offline board fed by Multiplayer and Solo. Points don't mix. One league for the WhatsApp, another for the office, another for the family.

SCORING
Speed bands multiply your points by how fast you answer (Lightning ×2.0 down to Very Slow ×0.5). Streaks, comebacks, and perfect rounds bonus extra. Timeouts and rage-quits cost you.

BUILT FOR THE 2026 WORLD CUP
Group stage starts June 11. Set up your League now and you're ranking your mates from the opening fixture.

FREE
No subscriptions. No paywalls. No ads during the game. Sign in with Google or email — guests can browse and play but need an account to earn ranked points and join Leagues.

WHO IT'S FOR
Football fans who actually watch matches. Group chats with arguments to settle. Anyone who's ever said "I know more football than you do."

WHAT YOU NEED
A phone. A football match. A few mates with opinions.
```

### Tags (Play Store auto-suggests)
Suggest: sports, soccer, football, quiz, trivia, multiplayer, leaderboard, lobby, league

### Category
- App category: **Sports**

### Content rating
Run the IARC questionnaire — should yield **Everyone**. Answer No to all gambling/violence/sexuality categories (no real-money wagering, no UGC moderation surface beyond quiz answers).

### Privacy Policy URL
```
https://yourscore.app/privacy
```

### Target audience
Ages 13+ (matches Supabase Auth ToS minimum age).

### Data safety form (Play Console)
- Collects: email, user ID, app interactions (gameplay answers, scores)
- Shared: none with third parties for advertising/marketing
- Encrypted in transit: yes (HTTPS only)
- Encrypted at rest: yes (Supabase Postgres)
- Users can request deletion: yes — via Profile → Delete account, or by emailing support@yourscore.app
- Account creation required for ranked points + Leagues; browsing/Solo play available as guest

### App signing — Play App Signing
Upload key SHA-1: `7C:B8:A8:81:D9:50:34:0F:6A:81:80:A8:8A:66:38:8F:21:60:CD:1B`
Upload key SHA-256: `59:7C:B1:B5:32:5C:45:85:8F:8A:E5:5A:99:FB:D7:4F:C6:C3:39:D8:83:70:D1:DA:C1:03:43:55:8A:B2:E0:C2`
Keystore lives at `~/Documents/keys/yourscore-release.keystore` (back up to 1Password — Google never re-signs).

### Internal Testing access list
- vossybaba@gmail.com (developer)
- apple-review@yourscore.app (review test account, password `Reviewerbf4cb1d2!1A`)

### Reviewer-style notes (Play Console requires test instructions for sign-in apps)
```
YourScore is a football-knowledge competition app. Demo flow after sign-in:
1. Bottom nav → Play → Multiplayer sub-tab → Create Game. Pick type (Private/Public/1v1), pick a Quiz pack, share the 6-character code OR
2. Bottom nav → Play → Solo sub-tab → pick a club pack and play through.
3. Bottom nav → 38-0 → Premier League XI → pick a formation → Draft XI live head-to-head.

Sign in with the test account or Continue with Google:
  Email:    apple-review@yourscore.app
  Password: Reviewerbf4cb1d2!1A
```

### Feature graphic (1024 x 500 px)
Asset to design: dark background, "YourScore" wordmark left-aligned, screenshot of a live leaderboard or question card on the right. Brand colours: bg #0a0a14, accent #00ff87.

---

## Screenshot Plan

Five screens per platform. Use the iPhone 17 Pro simulator at 6.5" (iOS) and a Pixel 8 Pro emulator at 1080×2400 (Android). All on light/dark consistent state — pick dark since brand is dark.

1. **Hero** — landing page with "YOUR FOOTBALL KNOWLEDGE. RANKED." headline, Create a League CTA visible.
2. **Live question** — answering a question card with the 45s countdown ring partially elapsed. Best taken during a test room.
3. **Leaderboard mid-match** — your name highlighted, top 5 visible, streak indicators.
4. **Challenges grid** — multiple PL club badges, captioned "Pick a team. Take the quiz."
5. **League table** — populated league with 6+ members, "Premier League · 8 games played" header.

For App Store, also export a **6.7" iPhone 15 Pro Max** size and a **12.9" iPad Pro** size (Apple requires both even if you don't ship iPad — they auto-scale).

For Play Store, also export a **7" tablet** and a **10" tablet** size.

---

## App Icon

Current: wordmark on black at 1024×1024 (assets/logo.png). Will appear small on home screen.

Post-launch improvement (not blocking submission): swap to a square "Y" or "YS" mark for better legibility, while keeping the wordmark for splash + marketing. Spawn that as a separate task after WC.

---

## Pre-submission checklist

- [ ] Apple Developer account approved
- [ ] App Store Connect: create App entry with bundle ID `app.yourscore.app`
- [ ] Generate iOS distribution certificate + provisioning profile in Xcode
- [ ] Archive build via Xcode → Product → Archive
- [ ] Upload via Organizer → Distribute App → App Store Connect
- [ ] Submit for TestFlight first; smoke-test with internal testers
- [ ] Fill in all metadata above + screenshots
- [ ] Submit for App Review
- [ ] Google Play Console: create app, fill in metadata, upload signed AAB
- [ ] Both stores: respond to reviewer questions within 24 hours
