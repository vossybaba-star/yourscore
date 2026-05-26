# YourScore — Product Overview

## What It Is

YourScore is a **live football quiz app** that lets friend groups compete against each other in real time while watching a match together. You answer questions about the game as it happens — who just scored, what formation does the manager use, how many goals has this player scored this season — and earn points for being correct and fast.

It is built around the social experience of watching football with people, whether in person or remotely. The game lives on your phone. No separate app download — it runs in the browser as a PWA.

---

## Core Concept

Most football fans already text each other while watching a game. YourScore turns that group chat energy into a structured competition. One person creates a room, shares a 6-character code, and everyone joins. When a question fires, everyone gets 45 seconds to answer. The leaderboard updates live. After the match, points roll up to a persistent league table.

---

## Primary User Flow

1. **Someone creates a league** — a persistent table for a fixed group of people. Points accumulate across all games played through the season.
2. **Before each match, they create a room** — one room per fixture. The room is linked to a match (e.g. "England vs France · World Cup").
3. **They share the room code** — via WhatsApp, iMessage, or a link. Friends tap the link and join instantly. No account required to join and watch; account required to answer and earn points.
4. **During the match, questions fire** — an admin sends live questions through the admin panel. Each question has a 45-second timer.
5. **Players answer on their phone** — the interface is one card, four options, a countdown ring. Tap to answer.
6. **Points are awarded** — based on difficulty and answer speed. Streak multipliers apply for consecutive correct answers.
7. **After the match** — the room closes and each player's score is added to the league table.

---

## Features

### Rooms
- Created per match, linked to a fixture from the match database
- Room types: **private** (invite-only) and **sponsored** (branded with sponsor name, logo, and prize description)
- States: `lobby` → `live` → `completed`
- Join via 6-character code or direct link
- WhatsApp channel integration — rooms can be connected to a WhatsApp channel for push sharing
- Max player cap (configurable per room)

### Leagues
- Persistent across all rooms and tournaments
- Invite via code (e.g. `TL9999`)
- League table shows: total score, accuracy %, current streak, games played
- Multiple leagues per user supported

### Live Questions
- Questions belong to a match, have difficulty (`easy` / `medium` / `hard`) and a category tag
- Admin fires questions in real time from the admin panel
- Players have 45 seconds to answer (countdown ring visible on-screen)
- Unanswered = 0 points, no penalty

### Scoring
| Condition | Points |
|---|---|
| Correct answer (easy) | 100 + speed bonus (up to 50) |
| Correct answer (medium) | 150 + speed bonus |
| Correct answer (hard) | 200 + speed bonus |
| Wrong answer | 0 |
| Timeout | 0 |
| Streak 3–4 correct | 1.5× multiplier |
| Streak 5+ correct | 2.0× multiplier |

Speed bonus scales linearly from 0 (answered at 45s) to 50 (answered instantly).

### Challenges (async quizzes)
- Season-review quizzes, one per club, not connected to live matches
- 20 questions per team, mix of easy/medium/hard
- Self-paced — no timer
- Accessible without signing in; sign-in required to appear on the challenge leaderboard
- Managed via `/admin/challenges` — paste raw quiz text, preview parsed questions, upload
- Current quizzes: Premier League 2025/26 (20 clubs) + Championship 2025/26

### Auth
- Sign in with: Google, Apple, Facebook, email magic link
- Guest access: can join rooms, watch questions, see leaderboard — cannot earn points
- Profile: username, display name, avatar, social handle

---

## Admin Panel (`/admin`)

Internal tool for managing all live content.

| Section | What it does |
|---|---|
| `/admin/matches` | Schedule fixtures, generate questions with AI, manage match status |
| `/admin/rooms` | View active rooms, fire live questions into rooms in real time |
| `/admin/questions` | Review and approve question bank |
| `/admin/challenges` | Upload season quiz packs (paste → parse → upload), manage existing challenges |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (Postgres + Auth + Realtime) |
| Styling | Tailwind CSS + inline styles |
| Hosting | Vercel |
| Package manager | pnpm |
| Auth | Supabase Auth (OAuth + magic link) |

Key design patterns:
- `"use client"` components for all interactive UI
- Supabase Realtime for live question delivery and leaderboard updates
- Module-level cache + in-flight deduplication for external API calls (TheSportsDB)
- Row Level Security on all tables — users can only read/write their own data

---

## Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User profiles — username, display name, avatar, total score |
| `matches` | Football fixtures — home/away team, date, tournament, status |
| `rooms` | Game rooms — linked to a match, code, type, sponsor info |
| `room_players` | Players in a room — links user to room |
| `questions` | Question bank — linked to match, difficulty, options, correct answer |
| `answers` | Player answers — linked to question, room, user, correct/incorrect |
| `leagues` | Persistent leagues — name, code, creator |
| `league_members` | League membership — links user to league with role |
| `challenges` | Season quiz packs — team, league, slug, question count |
| `challenge_questions` | Individual questions — linked to challenge, options, correct answer |
| `challenge_attempts` | User quiz attempts — score, answers, completed_at |

---

## Navigation Structure

### Marketing site (unauthenticated)
- `/` — Landing page with hero, countdown to World Cup 2026, how-it-works preview
- `/how-it-works` — Full feature walkthrough
- `/challenges` — Available quizzes (no sign-in required)
- `/join` — Browse open rooms / enter room code

### App (authenticated)
Bottom nav: **Home · Leagues · Play · Challenges · Profile**

- `/` — Dashboard (upcoming matches, active rooms, league standings)
- `/leagues` — League browser
- `/league/new` — Create a league
- `/league/[id]` — League detail + leaderboard
- `/join` — Join a room by code
- `/room/new` — Create a room
- `/room/[id]` — Live room (lobby, live questions, leaderboard)
- `/room/[id]/results` — Post-match results
- `/room/[id]/leaderboard` — Final standings
- `/match/[id]` — Match detail
- `/challenges` — Challenge list
- `/challenges/[slug]` — Quiz game flow
- `/profile` — User profile + stats
- `/settings` — Account settings

---

## Target Audience

Primary: football fans who watch matches in groups (physically together or in group chats) and want a fun, structured way to compete during the game.

Secondary: brands or pubs looking to sponsor rooms with prizes — the sponsored room type supports a sponsor name, logo URL, and prize description displayed to all players.

---

## Current Focus

The app is being built around **FIFA World Cup 2026** (June 11 – July 19, 2026). The fixture list covers the full group stage. The launch strategy is to get friend groups set up with leagues before the tournament starts so they are ready to play from day one.
