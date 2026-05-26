# Store Listings — YourScore

Copy-paste content for App Store Connect and Google Play Console. Character limits are noted next to each field. Update the World Cup framing post-tournament.

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
The 2026 World Cup starts soon. Get your league set up before kick-off — answer live questions during every match and see who really knows football.
```

### Keywords (100 char max — comma-separated, no spaces after commas, never the app name)
```
football,soccer,quiz,trivia,worldcup,premier,league,fantasy,prediction,live,sports,fan
```

### Description (4000 char max)
```
YourScore turns watching football with your friends into a live, structured competition.

Answer questions about the match as it unfolds — who just scored, what formation is the manager using, how many goals has this player scored this season. Faster correct answers earn more points. A streak multiplier rewards you for getting three or more right in a row.

WATCH WITH FRIENDS
Create a private room for any match. Share a six-character code or link by WhatsApp, iMessage, or whatever group chat you already use. Everyone joins instantly — no faff, no friction.

LEAGUES THAT LAST A SEASON
Your scores roll up into persistent leagues. Track your group's accuracy, streaks, and total points across every match. One league for your mates, another for the office, another for the football WhatsApp.

LIVE QUESTIONS
During the match, questions fire one by one with a 45-second timer. Tap an answer. Watch the leaderboard update in real time on every phone.

CHALLENGES — PLAY ANYTIME
Season-review quiz packs for every Premier League and Championship club. 20 questions per team. Self-paced, no timer, instantly playable.

HEAD-TO-HEAD
Pick a friend, pick a team, take turns answering. First to break the other's streak wins.

BUILT FOR THE 2026 WORLD CUP
The fixture list covers the full group stage. Set up your league before June 11 and you're ready to play from kick-off.

FREE TO PLAY
No subscriptions, no paywalls, no ads in the live game. Sign in with Apple, Google, or email — guests can join rooms and watch leaderboards but need an account to score points.

WHAT YOU NEED
A phone. Friends. A football match. We do the rest.
```

### What's New in This Version (4000 char max, for each update)
```
First release.

Sign in with Apple, Google, Facebook, or email.
Join rooms by code. Create persistent leagues with your friends.
Season-review challenges for every Premier League and Championship club.
Head-to-head quizzes for two players.
Live push notifications when a question fires in a room you're in.
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
> YourScore is a live football quiz app. It is more than a webview wrapper of a website:
>
> 1. Native push notifications (APNs) deliver in-match question alerts. The web version cannot do this.
> 2. Deep-linked OAuth via custom URL scheme returns directly to the app without leaving the system browser.
> 3. The full match-day experience requires the native push pipeline; the web PWA is a degraded preview.
>
> Test account (provided in the test credentials field): testuser@yourscore.app / [PASSWORD].
> No special hardware needed. Test on any iPhone — Sign in → Browse Challenges → start any quiz to verify the gameplay flow.

---

## Google Play Console

### App title (50 char max)
```
YourScore: Live Football Quiz
```

### Short description (80 char max)
```
Live football quizzes with your mates. Leagues, rooms, season challenges.
```

### Full description (4000 char max)
```
YourScore turns watching football into a live competition with your friends.

WATCH TOGETHER, COMPETE TOGETHER
Create a private room for any match. Share the six-character code with your group on WhatsApp or anywhere else. Everyone joins instantly. Questions fire during the game — tap to answer in 45 seconds or less. Speed and accuracy stack up on the leaderboard.

PERSISTENT LEAGUES
Your scores from every match roll into season-long leagues. Track total points, accuracy, win streaks, and games played for each player in your group.

SEASON CHALLENGES
Quiz packs for every Premier League and Championship club — 20 questions per team, no timer, play anytime. See where you rank on the global leaderboard.

HEAD-TO-HEAD
Pick a friend and a team. Take turns. Break the other player's streak to win.

BUILT FOR THE 2026 WORLD CUP
Group-stage fixtures loaded. Get your league set up before June 11.

FREE, NO ADS IN THE GAME
Sign in with Google or email. Guests can join rooms and watch the leaderboard without an account; signed-in users earn points.

REQUIRES
A phone. A football match. Friends.
```

### Tags (Play Store auto-suggests)
Suggest: sports, soccer, football, quiz, trivia, multiplayer, leaderboard

### Category
- App category: **Sports**

### Content rating
Run the IARC questionnaire — should yield **Everyone** or **Everyone 10+** depending on the gambling/competition phrasing answers (no real-money gambling = clean).

### Privacy Policy URL
```
https://yourscore.app/privacy
```

### Target audience
Ages 13+ (matches Supabase Auth ToS minimum age).

### Data safety form (Play Console)
- Collects: email, user ID, app interactions
- Shared: none
- Encrypted in transit: yes
- Users can request deletion: yes (link to support email)

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
