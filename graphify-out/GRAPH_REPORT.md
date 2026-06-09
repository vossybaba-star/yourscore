# Graph Report - yourscore  (2026-06-09)

## Corpus Check
- 228 files · ~965,488 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1381 nodes · 2728 edges · 112 communities (93 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7da1ec02`
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
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
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
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 116|Community 116]]

## God Nodes (most connected - your core abstractions)
1. `useUser()` - 48 edges
2. `createDraftDb()` - 45 edges
3. `rateLimitDistributed()` - 38 edges
4. `createServiceClient()` - 37 edges
5. `createClient()` - 32 edges
6. `slotsFor()` - 27 edges
7. `BottomNav()` - 26 edges
8. `seededRng()` - 24 edges
9. `GridBackground()` - 20 edges
10. `PlacedPlayer` - 20 edges

## Surprising Connections (you probably didn't know these)
- `SpinSheet()` --calls--> `slotsFor()`  [INFERRED]
  src/app/38-0/live/match/[id]/page.tsx → src/lib/draft/formations.ts
- `LeaguePage()` --calls--> `useUser()`  [INFERRED]
  src/app/league/[id]/page.tsx → src/hooks/useUser.ts
- `CreateLeagueInner()` --calls--> `useUser()`  [INFERRED]
  src/app/league/new/page.tsx → src/hooks/useUser.ts
- `MatchPage()` --calls--> `useUser()`  [INFERRED]
  src/app/match/[id]/page.tsx → src/hooks/useUser.ts
- `RoomPage()` --calls--> `useUser()`  [INFERRED]
  src/app/play/[roomId]/page.tsx → src/hooks/useUser.ts

## Import Cycles
- None detected.

## Communities (112 total, 19 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.15
Nodes (13): AnswerRecord, ChallengeAFriendButtonProps, ChallengePage(), LeaderEntry, LeaderRow, Letter, LETTERS, Phase (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (18): ALLOWED_ERAS, BankQuestion, buildDiffLabel(), buildEraLabel(), Difficulty, EntityType, Era, fetchByDifficulty() (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (17): AnswerButtons(), AnswerButtonsProps, LETTERS, AnswerRecord, H2HChallenge, H2HPage(), Letter, LETTERS (+9 more)

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
Cohesion: 0.07
Nodes (62): aggregate(), assistWeight(), botOf(), buildReport(), goalWeight(), LIVE_CONFIG, LivePhase, MatchSim (+54 more)

### Community 11 - "Community 11"
Cohesion: 0.36
Nodes (6): REDIRECT(), BackButton(), AvatarCircle(), PublicProfile, PublicProfilePage(), RecentAttempt

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (15): AuthProviders(), FAQS, STEPS, groupByDate(), Match, PlayPage(), GlobalPlayer, LeagueCard (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (14): android, backgroundColor, appId, appName, ios, backgroundColor, contentInset, packageClassList (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (27): Dashboard(), fetchUpcomingMatches(), LEAGUE_PLAYERS, LeagueTab, LiveMatch, metadata, PALETTES, RootPage() (+19 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (38): ActiveTab, Challenge, ClubCard(), END_OF_SEASON_EMOJI, ParsedChallenge, ParsedQuestion, parseQuizText(), QuizPack (+30 more)

### Community 17 - "Community 17"
Cohesion: 0.25
Nodes (6): Entry, store, genId(), GET(), KEYS, POST()

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (6): accuracy(), getMemberBadges(), League, LeagueMember, LeaguePage(), MemberRow

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (12): background_color, categories, description, display, icons, lang, name, orientation (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.31
Nodes (13): GET(), isFirstSignIn(), getResend(), buildFooterUrls(), renderEmail(), sendFirstLeagueCreatedEmail(), sendFirstMemberJoinsEmail(), sendFirstQuizEmail() (+5 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (18): AcceptChallenge(), Board, Incoming, LeagueBoard(), Member, DraftHeader(), TABS, useUser() (+10 more)

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (10): bebasNeue, dmSans, viewport, authCallbackUrl(), closeOAuthBrowser(), exchangeCodeFromDeepLink(), isNative(), platform() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (10): App Store 4.2 mitigation, Apple Developer Program, Architecture, Bundle / package identifiers, Commands, Mobile Wrap — Capacitor, OAuth flow on native, Push notifications (+2 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (32): CountdownTimer(), CountdownTimerProps, accuracy(), fmtSpeed(), Leaderboard(), LeaderboardCard(), LeaderboardCardProps, LeaderboardEntry (+24 more)

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (12): DraftChallengeRow, DraftDatabase, DraftLeagueMemberRow, DraftLeagueRow, DraftLiveQueueRow, DraftMatchRow, DraftSavedTeamRow, DraftShareRow (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.34
Nodes (12): expired(), POST(), flipReport(), applyTeamStreak(), creditResult(), resolveH2H(), applyTeamResult(), creditWin() (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (5): FAKE_IDS, PACK_IDS, randInt(), recentDate(), sb

### Community 28 - "Community 28"
Cohesion: 0.05
Nodes (102): DraftHome(), Info, FORMATION_NOTE, FORMATION_SLOTS, GK, slotsFor(), bestOpenSlot(), breakdown() (+94 more)

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

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (27): POST(), POST(), DELETE(), PATCH(), leagueLiveStateFor(), createDraftDb(), genJoinCode(), SquadInput (+19 more)

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
Cohesion: 0.33
Nodes (5): After changing the product, Debugging errors — CHECK SENTRY FIRST, Quick facts (see YOURSCORE.md for detail), READ THIS FIRST, YourScore — Project Instructions

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
Cohesion: 0.33
Nodes (4): LiveSide, TERMINAL, useLiveMatch, DraftLiveMatchRow

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (4): QUICK_ACTIONS, STAT_CARDS, StatKey, STATS

### Community 52 - "Community 52"
Cohesion: 0.50
Nodes (3): info, author, version

### Community 53 - "Community 53"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (6): generateCode(), MODE_LIMITS, POST(), VALID_COUNTS, VALID_DIFFICULTIES, VALID_MODES

### Community 83 - "Community 83"
Cohesion: 0.19
Nodes (19): POST(), calculateBasePoints(), calculateComebackBonus(), calculatePerfectRoundBonus(), calculatePoints(), calculateStreakBonus(), DIFFICULTY_MULT, getDifficultyMultiplier() (+11 more)

### Community 84 - "Community 84"
Cohesion: 0.10
Nodes (15): EmailMode, OAuthButton(), Provider, SignInWithGoogle(), JoinLeagueInner(), JoinLeaguePage(), LeagueTablePreview(), TableMember (+7 more)

### Community 85 - "Community 85"
Cohesion: 0.09
Nodes (12): HalfSim, PlayerRating, Side, bestOf(), halftimeView(), LiveMatchScreen(), PHASE_GUIDE, ReportView (+4 more)

### Community 86 - "Community 86"
Cohesion: 0.13
Nodes (31): attackRating(), attackShare(), defenceRating(), HomeSide, linesFallback(), MATCH_CONFIG, matchLambdas(), poisson() (+23 more)

### Community 87 - "Community 87"
Cohesion: 0.10
Nodes (20): 10. Testing, 11. Out of scope (this spec), 1. Goal, 2. Architecture (approved: Approach A), 38-0 Live Multiplayer — Design Spec, 3. Phase state machine, 4. Goals & penalties model, 5. Data model (+12 more)

### Community 89 - "Community 89"
Cohesion: 0.16
Nodes (15): POST(), requireAdmin(), CompleteBody, POST(), QuizResult, POST(), client, POST() (+7 more)

### Community 90 - "Community 90"
Cohesion: 0.12
Nodes (15): bucketMap, buckets, byId, clubs, CSV, __dirname, header, normalize() (+7 more)

### Community 91 - "Community 91"
Cohesion: 0.46
Nodes (7): getMatch(), hasReport(), isLive(), Match, MatchDetail, generateMetadata(), MatchPage()

### Community 92 - "Community 92"
Cohesion: 0.15
Nodes (13): config, middleware(), updateSession(), CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema (+5 more)

### Community 93 - "Community 93"
Cohesion: 0.13
Nodes (12): CANON, cClub, cLeague, cName, cOvr, cPos, __dirname, header (+4 more)

### Community 96 - "Community 96"
Cohesion: 0.15
Nodes (12): Activation — DONE (applied to the live Supabase project), Cloud layer — BUILT, dormant until the migration is applied, Code map, Custom leagues — BUILT (dormant until migration), fails soft, Data, Draft XI — build status, Friend challenges + shareable results — BUILT (dormant until migration), Live H2H multiplayer — BUILT (live, simultaneous two-half match) (+4 more)

### Community 98 - "Community 98"
Cohesion: 0.18
Nodes (10): COUNTS, DIFFICULTIES, Difficulty, MODES, NewGameContent(), NewGamePage(), POPULAR_ENTITIES, QuestionSource (+2 more)

### Community 100 - "Community 100"
Cohesion: 0.18
Nodes (10): 38-0 Live Multiplayer — Implementation Plan, Phase 0 — Migration & types, Phase 1 — Engine additions (pure, unit-tested), Phase 2 — Match lifecycle backend, Phase 3 — Matchmaking, Phase 4 — Realtime client + match UI, Phase 5 — Standings & leaderboard (draws + points), Phase 6 — Bot disguise & edge handling (+2 more)

### Community 101 - "Community 101"
Cohesion: 0.20
Nodes (9): buckets, clubs, counts, buckets, csvAdded, players, generatedAt, players (+1 more)

### Community 102 - "Community 102"
Cohesion: 0.44
Nodes (7): generateMetadata(), ogUrl(), one(), ordinal(), SeasonSharePage(), SP, SaveTeamButton()

### Community 103 - "Community 103"
Cohesion: 0.70
Nodes (4): createFriendMatch(), dismissChallenge(), leaveQueue(), POST()

### Community 104 - "Community 104"
Cohesion: 0.52
Nodes (6): KEYS, loadPayload(), ogUrl(), ordinal(), SeasonShortSharePage(), generateMetadata()

### Community 105 - "Community 105"
Cohesion: 0.47
Nodes (5): COMMIT, main(), PACKS, upsertPack(), validate()

### Community 106 - "Community 106"
Cohesion: 0.40
Nodes (4): CHIP, GET(), Line, ordinal()

### Community 115 - "Community 115"
Cohesion: 0.48
Nodes (5): HANDLES, hash01(), seedLeaderboardRows(), SeedRow, GET()

### Community 116 - "Community 116"
Cohesion: 0.29
Nodes (7): GoalEvent, MatchReport, liveOgQuery(), LiveShareInput, scorerSummary(), fulltimeView(), ResultPanel()

## Knowledge Gaps
- **575 isolated node(s):** `version`, `configurations`, `extends`, `project_number`, `project_id` (+570 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useUser()` connect `Community 21` to `Community 98`, `Community 11`, `Community 13`, `Community 15`, `Community 16`, `Community 18`, `Community 84`, `Community 24`, `Community 28`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `BottomNav()` connect `Community 21` to `Community 11`, `Community 13`, `Community 15`, `Community 16`, `Community 18`, `Community 84`, `Community 24`, `Community 28`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `createClient()` connect `Community 36` to `Community 1`, `Community 103`, `Community 11`, `Community 15`, `Community 81`, `Community 83`, `Community 20`, `Community 21`, `Community 89`, `Community 26`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `useUser()` (e.g. with `AcceptChallenge()` and `LeagueBoard()`) actually correct?**
  _`useUser()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `createDraftDb()` (e.g. with `DELETE()` and `PATCH()`) actually correct?**
  _`createDraftDb()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `rateLimitDistributed()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`rateLimitDistributed()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `createServiceClient()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`createServiceClient()` has 3 INFERRED edges - model-reasoned connections that need verification._