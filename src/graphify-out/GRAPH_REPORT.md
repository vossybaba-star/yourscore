# Graph Report - src  (2026-06-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 307 nodes · 462 edges · 24 communities (19 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `19bd36eb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_League Join & FAQ Pages|League Join & FAQ Pages]]
- [[_COMMUNITY_Quiz API & Rate Limiting|Quiz API & Rate Limiting]]
- [[_COMMUNITY_Root Layout & Auth UI|Root Layout & Auth UI]]
- [[_COMMUNITY_Live Quiz Game UI|Live Quiz Game UI]]
- [[_COMMUNITY_Competition Badges & Challenge|Competition Badges & Challenge]]
- [[_COMMUNITY_Club Cards & Quiz Packs|Club Cards & Quiz Packs]]
- [[_COMMUNITY_Head-to-Head Challenge Page|Head-to-Head Challenge Page]]
- [[_COMMUNITY_Dashboard & League Standings|Dashboard & League Standings]]
- [[_COMMUNITY_Question Bank Generation|Question Bank Generation]]
- [[_COMMUNITY_Live Stats Fire Panel|Live Stats Fire Panel]]
- [[_COMMUNITY_Admin Challenges Parser|Admin Challenges Parser]]
- [[_COMMUNITY_WhatsApp Question Alerts|WhatsApp Question Alerts]]
- [[_COMMUNITY_Admin Questions Panel|Admin Questions Panel]]
- [[_COMMUNITY_Match Rooms & Codes|Match Rooms & Codes]]
- [[_COMMUNITY_Admin Matches Panel|Admin Matches Panel]]
- [[_COMMUNITY_Admin Rooms Panel|Admin Rooms Panel]]
- [[_COMMUNITY_Admin Dashboard|Admin Dashboard]]
- [[_COMMUNITY_Support & FAQ Page|Support & FAQ Page]]
- [[_COMMUNITY_Admin Layout Nav|Admin Layout Nav]]
- [[_COMMUNITY_Privacy Policy Page|Privacy Policy Page]]
- [[_COMMUNITY_Terms Page|Terms Page]]

## God Nodes (most connected - your core abstractions)
1. `useUser()` - 22 edges
2. `createServiceClient()` - 17 edges
3. `createClient()` - 12 edges
4. `Spinner()` - 10 edges
5. `getTeamBadgeUrl()` - 8 edges
6. `POST()` - 7 edges
7. `isNative()` - 7 edges
8. `createClient()` - 6 edges
9. `sendQuestionAlert()` - 6 edges
10. `POST()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `MatchPage()` --calls--> `useUser()`  [INFERRED]
  app/match/[id]/page.tsx → hooks/useUser.ts
- `LeaguePage()` --calls--> `useUser()`  [INFERRED]
  app/league/[id]/page.tsx → hooks/useUser.ts
- `CreateLeagueInner()` --calls--> `useUser()`  [EXTRACTED]
  app/league/new/page.tsx → hooks/useUser.ts
- `RootPage()` --calls--> `useUser()`  [EXTRACTED]
  app/page.tsx → hooks/useUser.ts
- `POST()` --calls--> `createServiceClient()`  [EXTRACTED]
  app/api/admin/approve-question/route.ts → lib/supabase/service.ts

## Import Cycles
- None detected.

## Communities (24 total, 5 thin omitted)

### Community 0 - "League Join & FAQ Pages"
Cohesion: 0.06
Nodes (24): AuthProviders(), JoinLeagueInner(), TableMember, useUser(), FAQS, STEPS, accuracy(), getMemberBadges() (+16 more)

### Community 1 - "Quiz API & Rate Limiting"
Cohesion: 0.10
Nodes (23): POST(), POST(), CompleteBody, POST(), QuizResult, POST(), sendNotifications(), client (+15 more)

### Community 2 - "Root Layout & Auth UI"
Cohesion: 0.09
Nodes (19): bebasNeue, dmSans, metadata, viewport, OAuthButton(), Provider, SignInWithGoogle(), authCallbackUrl() (+11 more)

### Community 3 - "Live Quiz Game UI"
Cohesion: 0.09
Nodes (14): CountdownTimerProps, LeaderboardEntry, LeaderboardProps, ActiveQuestion, LABELS, LETTERS, QuestionCardProps, RevealState (+6 more)

### Community 4 - "Competition Badges & Challenge"
Cohesion: 0.09
Nodes (19): cache, COMP_IDS, getCompetitionBadgeUrl(), inFlight, AnswerRecord, ChallengePage(), DIFF_BG, DIFF_COLOR (+11 more)

### Community 5 - "Club Cards & Quiz Packs"
Cohesion: 0.13
Nodes (18): slugify(), ActiveTab, ClubCard(), END_OF_SEASON_EMOJI, EndOfSeasonCard(), QuizPack, RECORDS_EMOJI, RecordsCard() (+10 more)

### Community 6 - "Head-to-Head Challenge Page"
Cohesion: 0.14
Nodes (12): AnswerRecord, DIFF_BG, DIFF_COLOR, H2HChallenge, H2HPage(), Letter, LETTER_COLORS, LETTERS (+4 more)

### Community 7 - "Dashboard & League Standings"
Cohesion: 0.15
Nodes (10): Dashboard(), LEAGUE_PLAYERS, LeagueTab, LiveMatch, PALETTES, RootPage(), StandingRow, UpcomingFixturesSection() (+2 more)

### Community 8 - "Question Bank Generation"
Cohesion: 0.23
Nodes (12): BankQuestion, buildDiffLabel(), buildEraLabel(), Difficulty, EntityType, Era, fetchByDifficulty(), GenerateCustomBody (+4 more)

### Community 9 - "Live Stats Fire Panel"
Cohesion: 0.25
Nodes (6): DIFF_COLOR, LABELS, LETTERS, LiveStats, MOCK_QUESTIONS, Question

### Community 10 - "Admin Challenges Parser"
Cohesion: 0.33
Nodes (5): slugify(), Challenge, ParsedChallenge, ParsedQuestion, parseQuizText()

### Community 11 - "WhatsApp Question Alerts"
Cohesion: 0.48
Nodes (5): normaliseNumber(), QuestionNotificationPayload, sendQuestionAlert(), sendQuestionAlertTemplate(), POST()

### Community 12 - "Admin Questions Panel"
Cohesion: 0.29
Nodes (5): DIFF_COLOR, LABELS, LETTERS, MOCK_QUESTIONS, Question

### Community 13 - "Match Rooms & Codes"
Cohesion: 0.33
Nodes (3): FLAG_MAP, Match, MOCK_MATCHES

### Community 14 - "Admin Matches Panel"
Cohesion: 0.40
Nodes (3): Match, MOCK_MATCHES, STATUS_COLOR

### Community 15 - "Admin Rooms Panel"
Cohesion: 0.40
Nodes (3): MOCK_ROOMS, Room, STATUS_COLOR

## Knowledge Gaps
- **111 isolated node(s):** `ParsedQuestion`, `ParsedChallenge`, `Question`, `LiveStats`, `DIFF_COLOR` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Database` connect `Root Layout & Auth UI` to `Quiz API & Rate Limiting`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `createClient()` connect `Root Layout & Auth UI` to `League Join & FAQ Pages`, `Competition Badges & Challenge`, `Club Cards & Quiz Packs`, `Head-to-Head Challenge Page`, `Admin Challenges Parser`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `useUser()` connect `League Join & FAQ Pages` to `Root Layout & Auth UI`, `Live Quiz Game UI`, `Dashboard & League Standings`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `useUser()` (e.g. with `LeaguePage()` and `MatchPage()`) actually correct?**
  _`useUser()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ParsedQuestion`, `ParsedChallenge`, `Question` to the rest of the system?**
  _111 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `League Join & FAQ Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.06386066763425254 - nodes in this community are weakly interconnected._
- **Should `Quiz API & Rate Limiting` be split into smaller, more focused modules?**
  _Cohesion score 0.10317460317460317 - nodes in this community are weakly interconnected._