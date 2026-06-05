# Graph Report - yourscore  (2026-06-05)

## Corpus Check
- 141 files · ~713,717 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 817 nodes · 1185 edges · 81 communities (65 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `14b29891`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 92|Community 92]]

## God Nodes (most connected - your core abstractions)
1. `useUser()` - 31 edges
2. `createServiceClient()` - 31 edges
3. `YourScore — Master Definition (Single Source of Truth)` - 16 edges
4. `GridBackground()` - 15 edges
5. `createClient()` - 15 edges
6. `createClient()` - 15 edges
7. `compilerOptions` - 15 edges
8. `BottomNav()` - 14 edges
9. `Spinner()` - 14 edges
10. `App Store Connect` - 14 edges

## Surprising Connections (you probably didn't know these)
- `MatchPage()` --calls--> `useUser()`  [INFERRED]
  src/app/match/[id]/page.tsx → src/hooks/useUser.ts
- `RoomPage()` --calls--> `useUser()`  [INFERRED]
  src/app/play/[roomId]/page.tsx → src/hooks/useUser.ts
- `POST()` --calls--> `rateLimitDistributed()`  [INFERRED]
  src/app/api/quiz/start/route.ts → src/lib/ratelimit.ts
- `POST()` --calls--> `createServiceClient()`  [INFERRED]
  src/app/api/quiz/start/route.ts → src/lib/supabase/service.ts
- `POST()` --calls--> `createServiceClient()`  [EXTRACTED]
  src/app/api/room/join/route.ts → src/lib/supabase/service.ts

## Import Cycles
- None detected.

## Communities (81 total, 16 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.17
Nodes (9): LeaderboardEntry, DB, MODE_COLOR, MODE_LABEL, Player, QRCode, QuestionEvent, Room (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.19
Nodes (15): POST(), calculateBasePoints(), calculateComebackBonus(), calculatePerfectRoundBonus(), calculatePoints(), calculateStreakBonus(), DIFFICULTY_MULT, getDifficultyMultiplier() (+7 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (30): AnswerButtons(), AnswerButtonsProps, LETTERS, AnswerRecord, H2HChallenge, H2HPage(), Letter, LETTERS (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (36): dependencies, @anthropic-ai/sdk, @capacitor/android, @capacitor/app, @capacitor/browser, @capacitor/core, @capacitor/ios, @capacitor/push-notifications (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (33): 1. Leagues, 1. Short-form video (TikTok, Instagram Reels, YouTube Shorts), 1. United Kingdom, 2. Football communities (Reddit, Discord, Twitter/X), 2. Nigeria and Ghana, 2. Rooms, 3. Challenges, 3. USA (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (29): Age Rating, App Icon, App Store Connect, App title (50 char max), Category, Category, Content rating, Data safety form (Play Console) (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (25): 01 · Welcome, 02 · First quiz completed, 03 · First league created, 04 · League invite received, 05 · Pre-match nudge, 06 · Post-match recap, 07 · Weekly digest, 08 · First time topping a league (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (23): 10. Roadmap (near-term, in rough order), 11. Admin Panel (`/admin`), 12. Tech Stack, 13. Navigation Canon, 14. Discontinued / Shelved — DO NOT reference as current, 15. Maintenance Rule, 1. The One-Liner, 2. Glossary — Locked Terms (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (13): Any, AppDelegate, Bool, NSUserActivity, __dirname, sql, UIApplication, UIApplicationDelegate (+5 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (19): Admin Panel (`/admin`), App (authenticated), Auth, Challenges (async quizzes), Core Concept, Current Focus, Database Tables, Features (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (44): AuthProviders(), EmailMode, Provider, REDIRECT(), SignInWithGoogle(), JoinLeagueInner(), TableMember, useUser() (+36 more)

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (8): CountdownTimer(), CountdownTimerProps, ActiveQuestion, LABELS, LETTERS, QuestionCard(), QuestionCardProps, RevealState

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (14): MODE_LIMITS, POST(), Difficulty, createClient(), CompositeTypes, Constants, Database, DatabaseWithoutInternals (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (14): android, backgroundColor, appId, appName, ios, backgroundColor, contentInset, packageClassList (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (10): Dashboard(), LEAGUE_PLAYERS, LeagueTab, LiveMatch, PALETTES, RootPage(), StandingRow, UpcomingFixturesSection() (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (6): accuracy(), fmtSpeed(), LeaderboardCard(), LeaderboardCardProps, LeaderboardProps, PlayerStatsModal()

### Community 17 - "Community 17"
Cohesion: 0.40
Nodes (3): FLAG_CODES, FlagImage(), FlagImageProps

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (12): background_color, categories, description, display, icons, lang, name, orientation (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.27
Nodes (14): GET(), isFirstSignIn(), getResend(), buildFooterUrls(), renderEmail(), sendFirstLeagueCreatedEmail(), sendFirstMemberJoinsEmail(), sendFirstQuizEmail() (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.16
Nodes (12): bebasNeue, dmSans, viewport, OAuthButton(), authCallbackUrl(), closeOAuthBrowser(), exchangeCodeFromDeepLink(), isNative() (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (10): App Store 4.2 mitigation, Apple Developer Program, Architecture, Bundle / package identifiers, Commands, Mobile Wrap — Capacitor, OAuth flow on native, Push notifications (+2 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (8): Leaderboard(), LeaderboardRow, MatchData, MatchPage(), cache, COUNTRY_STAR, getPlayerCutoutUrl(), inFlight

### Community 25 - "Community 25"
Cohesion: 0.32
Nodes (8): POST(), requireAdmin(), POST(), client, POST(), Difficulty, GET(), createServiceClient()

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (12): ALLOWED_ERAS, BankQuestion, buildDiffLabel(), buildEraLabel(), Difficulty, EntityType, Era, fetchByDifficulty() (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (5): FAKE_IDS, PACK_IDS, randInt(), recentDate(), sb

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (9): CAROUSEL 1 — Sat May 23, CAROUSEL 2 — Tue May 26, CAROUSEL 3 — Thu May 28, CAROUSEL 4 — Tue June 2, CAROUSEL 5 — Mon June 8, CAROUSEL POSTS — 2-SLIDE QUIZ FORMAT, Format Rules, Gemini Prompt — Carousel (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (6): DIFF_COLOR, LABELS, LETTERS, LiveStats, MOCK_QUESTIONS, Question

### Community 31 - "Community 31"
Cohesion: 0.25
Nodes (8): Arsenal — Champions 2025/26 ✅, Bruno Fernandes — The Record, Final Day GW38 Fixtures (all kick off 16:00 BST, May 24), Final Day Table — Heading into GW38, Golden Boot Race, Relegation — Final Day Decider ⏳, VERIFIED SEASON FACTS, World Cup 2026 ✅

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (8): PHASE 1: FINAL DAY BUILD-UP (May 22–24), POST 1 — Fri May 22 — FIRST EVER POST, POST 2 — Fri May 22 — Story, POST 3 — Sat May 23, POST 4 — Sat May 23, POST 5 — Sat May 23 — Story, POST 6 — Sun May 24 — Morning (post around 11am–1pm), POST 7 — Sun May 24 — Evening (after 6pm, results known)

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (8): PHASE 2: SEASON WRAP (May 25–31), POST 10 — Wed May 27, POST 11 — Thu May 28, POST 12 — Fri May 29, POST 13 — Sat May 30, POST 14 — Sun May 31, POST 8 — Mon May 25, POST 9 — Tue May 26

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (8): PHASE 3: WORLD CUP COUNTDOWN (June 1–11), POST 15 — Mon June 1, POST 16 — Wed June 3, POST 17 — Fri June 5, POST 18 — Sun June 7, POST 19 — Tue June 9, POST 20 — Wed June 10, POST 21 — Thu June 11 — WORLD CUP DAY 1

### Community 35 - "Community 35"
Cohesion: 0.29
Nodes (6): client, configuration_version, project_info, project_id, project_number, storage_bucket

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (5): DIFF_COLOR, LABELS, LETTERS, MOCK_QUESTIONS, Question

### Community 38 - "Community 38"
Cohesion: 0.48
Nodes (6): apnsJwt(), fcmAccessToken(), importPkcs8(), Payload, sendAPNs(), sendFCM()

### Community 39 - "Community 39"
Cohesion: 0.47
Nodes (4): parseFile(), parseLetter(), seed(), supabase

### Community 40 - "Community 40"
Cohesion: 0.40
Nodes (4): images, info, author, version

### Community 41 - "Community 41"
Cohesion: 0.40
Nodes (4): After changing the product, Quick facts (see YOURSCORE.md for detail), READ THIS FIRST, YourScore — Project Instructions

### Community 42 - "Community 42"
Cohesion: 0.40
Nodes (3): Match, MOCK_MATCHES, STATUS_COLOR

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (3): MOCK_ROOMS, Room, STATUS_COLOR

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (4): BRAND CONTEXT (brief — Gemini gets the visual from the screenshot), CONTENT CALENDAR — POST BY POST, HOW TO USE THIS BRIEF WITH GEMINI, YourScore — Social Media Content Brief

### Community 45 - "Community 45"
Cohesion: 0.40
Nodes (5): Fill in after Final Day (May 24), Gemini prompt template, Hashtag sets, NOTES FOR EXECUTION, Posting cadence (solo, no budget)

### Community 46 - "Community 46"
Cohesion: 0.40
Nodes (4): images, info, author, version

### Community 47 - "Community 47"
Cohesion: 0.40
Nodes (4): name, organization_id, organization_slug, ref

### Community 48 - "Community 48"
Cohesion: 0.06
Nodes (32): ActiveTab, Challenge, ClubCard(), END_OF_SEASON_EMOJI, ParsedChallenge, ParsedQuestion, parseQuizText(), QuizPack (+24 more)

### Community 52 - "Community 52"
Cohesion: 0.50
Nodes (3): info, author, version

### Community 53 - "Community 53"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 88 - "Community 88"
Cohesion: 0.28
Nodes (6): CompleteBody, POST(), QuizResult, Entry, rateLimitDistributed(), store

### Community 89 - "Community 89"
Cohesion: 0.33
Nodes (6): generateCode(), MODE_LIMITS, POST(), VALID_COUNTS, VALID_DIFFICULTIES, VALID_MODES

### Community 90 - "Community 90"
Cohesion: 0.32
Nodes (6): shuffle(), Difficulty, POST(), BankQuestion, fetchQuestions(), StartBody

### Community 92 - "Community 92"
Cohesion: 0.60
Nodes (3): config, middleware(), updateSession()

## Knowledge Gaps
- **424 isolated node(s):** `version`, `configurations`, `extends`, `project_number`, `project_id` (+419 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useUser()` connect `Community 10` to `Community 24`, `Community 0`, `Community 48`, `Community 15`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `createClient()` connect `Community 10` to `Community 48`, `Community 2`, `Community 22`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `Database` connect `Community 13` to `Community 0`, `Community 10`, `Community 24`, `Community 25`, `Community 92`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `useUser()` (e.g. with `LeaguePage()` and `MatchPage()`) actually correct?**
  _`useUser()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `createServiceClient()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`createServiceClient()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `version`, `configurations`, `extends` to the rest of the system?**
  _424 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07435897435897436 - nodes in this community are weakly interconnected._