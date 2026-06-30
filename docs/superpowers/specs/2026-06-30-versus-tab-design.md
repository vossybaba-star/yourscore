# Versus tab — design spec

**Date:** 2026-06-30
**Status:** approved (design), pending implementation plan

## Summary

Replace the **Leagues** bottom-nav tab with a **Versus** tab: a single,
game-first hub for playing other people — friends *and* existing online
opponents — across every game YourScore offers. It organises the app by
**intent** ("I want to play my mates") rather than by game, and gives the
async **Your Turns** inbox (the retention hook) a top-level home instead of
burying it under the Quiz tab.

The tab is a *launcher and re-org*, not a new gameplay system. It surfaces
flows that already exist (quiz async 1v1 / groups / public lobbies, 38-0 live
matches) behind one front door. No new matchmaking is built in v1.

## Decisions locked in brainstorming

| Question | Decision |
|---|---|
| Name | **Versus** (the destination). "Multiplayer" stays the name of the live-lobby quiz *mode* — no collision. |
| Flow direction | **Game-first**: pick a game → then an opponent (friend or online). Game-first because a user may want to play random/online opponents, not only a named friend. |
| "Online" in v1 | **Reuse what exists** — public/open live quiz lobbies + open (anyone-with-link) challenges. No new matchmaking queue. |
| Games in v1 | **Quiz + 38-0** (both already have versus flows). |
| Tab contents | **Your Turns** inbox (top), **Friends**, **Groups**, **Leagues** (nested) — surfaced via a segmented sub-nav. |
| Quiz tab | Keeps a **"challenge a friend" shortcut** that funnels into the Versus quiz flow ("two doors, one engine"). The post-result challenge buttons also stay. |
| Architecture | **Approach C — thin config registry** (`VERSUS_GAMES`). Not a full match-flow abstraction; quiz-async and 38-0-live flows stay as they are underneath. |

## Navigation

- Versus takes the Leagues slot. Signed-in nav: **Home · Versus · Quiz · 38-0 · Profile** (still 5 tabs, no crowding).
- Icon: crossed swords (`ti-swords` / equivalent in the app's icon set).
- The pending-turns **badge moves from the Quiz tab to the Versus tab** and becomes the cross-game count (1v1 + group + any 38-0 invites the inbox tracks).
- `/leagues` content moves into the Leagues section of Versus. The `/leagues` route may redirect into `Versus → Leagues` (decide in plan; a redirect avoids dead links).

## Screen anatomy

A segmented sub-nav at the top of the tab: **Play / Friends / Groups / Leagues**, defaulting to **Play**.

### Play (default)
1. **Your turns** — the cross-game async inbox at the top. Quiz challenges and
   38-0 match invites render in one list; each row routes to the right place
   via the game's row renderer (see registry). This is the headline because
   it's the return hook.
2. **Start a versus** — the game picker: a card per game in `VERSUS_GAMES`
   (Quiz, 38-0). Tapping a card opens that game's opponent step.

### Friends
The existing `/friends` content (add / accept / invite), re-homed here.

### Groups
Group challenge boards (the Phase 2 `group_challenges` feature): list the
user's boards and surface "start a group".

### Leagues
The current `/leagues` content, nested as a section rather than its own tab —
standing results, not the headline.

## Game-first flow

Tapping a game card opens an **opponent step** scoped to that game:

- **Quiz** → challenge a friend (async 1v1) · start a group · find an open
  game (existing public live lobby) · share a link.
- **38-0** → play a friend (live match) · WC H2H.

Choosing a *friend* opens the friend picker; choosing *open / online* enters
the game's existing public-lobby / open-challenge flow. Nothing new is built —
these route into flows that already exist.

## Architecture — the versus registry (Approach C)

A single thin config list is the one place games are declared:

```ts
// src/lib/versus/registry.ts (illustrative shape)
interface VersusGame {
  id: "quiz" | "38-0";          // extend the union when a game is added
  label: string;                 // "Quiz", "38-0"
  icon: string;                  // icon name
  accent: string;                // brand accent (teal=quiz, lime=38-0)
  opponentModes: OpponentMode[]; // friend | group | open | link, per game
  startHref: (mode: OpponentMode) => string; // where the opponent step lives
  // how an inbox item for this game renders + where it routes:
  renderInboxRow: (item: InboxItem) => ReactNode;
}

export const VERSUS_GAMES: VersusGame[] = [ /* quiz, 38-0 */ ];
```

- The **game picker** maps over `VERSUS_GAMES`.
- The **Your Turns** inbox is the union of each game's items, each rendered by
  its own `renderInboxRow`. Quiz items come from the existing
  `useYourTurns` hook (1v1 + group); 38-0 items come from its live-match
  source (scope the exact query in the plan).
- Adding game #3 (e.g. 3v3) = **one new entry** + its row renderer. The
  quiz-async and 38-0-live match engines are *not* abstracted together — they
  genuinely differ, and forcing them under one interface now is premature.

## What moves vs. stays

- **Quiz tab (`/play`)**: keeps a "challenge a friend" shortcut that deep-links
  into the Versus quiz flow. The multiplayer sub-tab's *content* is now owned by
  Versus; the shortcut is the second door into the same engine. Post-result
  `ChallengeAFriendButton` / `GroupChallengeButton` stay where they are.
- **`/friends`**: content surfaces inside Versus → Friends. Route can redirect
  or remain as a deep-link target (decide in plan).
- **`/leagues`**: content surfaces inside Versus → Leagues; route redirects.
- **Badge**: moves from Quiz tab to Versus tab.

## Out of scope (v1)

- Matchmaking queue (auto-pairing random opponents) — the registry leaves room,
  but it's a separate subsystem for a later phase.
- New game modes (3v3, etc.) — registry-ready, not built.
- Group-play → creator/others push (already deferred in Phase 2).

## Success criteria

- A user who wants to "play a mate" has one obvious place to go, regardless of
  game.
- Your Turns is visible at the top level (one tap from anywhere), not buried.
- Friends, Groups, and Leagues are reachable from one tab instead of three
  scattered locations.
- Adding a future game to the Versus picker + inbox touches one config entry,
  not the tab's internals.
