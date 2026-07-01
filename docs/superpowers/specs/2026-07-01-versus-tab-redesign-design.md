# Versus tab — redesign (rivalry-driven H2H hub)

**Status:** approved 2026-07-01 (brainstorm w/ founder, mockup-guided)
**Supersedes:** the image-led feed (`2026-06-30-versus-tab-design.md`) and the launcher-tile model.
**Source of truth for scope.** Mockups = `public/email/mockups` (founder-supplied).

## What Versus is
The head-to-head hub. Pick a game, challenge a friend (or a random), build a rivalry.
Two games only: **38-0** (draft-XI H2H) and **Quiz Battle** (1v1 quiz). Sub-tabs stay
**Play / Friends / Leagues**. Bottom-nav order: Home · Versus · Quiz · 38-0 · Profile.

## Decisions (from the brainstorm)
| Area | Decision |
|---|---|
| Games | 38-0 + Quiz Battle only. |
| 38-0 format | Live now (share a code / random queue); **async turn-based = v2**. |
| Challenge order | **Game/quiz first**, then opponent (not opponent-first). |
| Quiz Battle mechanic | **Both:** if you've already played that quiz → send **scorecard**; if not → **fresh same-questions battle** (both play the identical set, scores hidden until both finish, then a question-by-question reveal). |
| Points | **No ELO.** Record (W/L/win-rate/streak) + per-opponent rivalries only. |
| Opponents | Friends **and** random (friends first, random available/fallback). |
| Hub top | Resume (active-turn card) + Challenge someone, above the fold. |
| Friends tab | **Rivalries-first** (head-to-head + Challenge per friend); add/manage behind a `+`. |
| Add friends (v1) | Username search · friend code + invite link · share to apps. **Contacts import = "coming soon"** (needs native rebuild). Requests inbox always present. |
| Leagues tab | Today's compile-results leagues, embedded. **Fixture-based leagues = v2.** |
| Results | Result + **Rematch** + **shareable result card** (reuse OG-image infra). |
| Notifications | **Full async nudges:** challenged · opponent finished (your turn) · reminder before expiry. Opt-in gated via `notifyUsers`. |
| Expiry | **3 days**, reminder push before it lapses (was 7d). |
| Avatars | **Default generated avatars** (deterministic from id/name) so the hub is never empty; profile photos later. |
| Visual | Bolder hero/headers, **our tokens** (lime = 38-0, teal = Quiz, gold = wins) — not the mockup's purple. |

## Play hub (top → bottom)
1. **Bold hero** — VERSUS wordmark + tagline over match art · **Challenge someone** (primary) + **Join code**.
2. **Your turn** — resume card(s) for any match awaiting you (quiz + 38-0).
3. **Choose a game** — image tiles: 38-0 (lime) · Quiz Battle (teal).
4. **Active matches** — waiting on them / ready to reveal.
5. **Recent results** — with Rematch + share.
6. **Your record** — W / L / win-rate / streak.
7. **Your rivalries** — per-opponent head-to-head, challenge from the card.

Data: `useYourTurns` (matches) + `useVersusStats` (record + rivalries, aggregates
`h2h_challenges` + `draft_matches`). Both exist.

## Challenge flow (game-first)
`Challenge someone → pick game →`
- **Quiz Battle:** pick a quiz → pick opponent (friend or random) → if already played → send scorecard (`/api/h2h/from-attempt`); else → **fresh battle**: challenger plays the pack now, opponent plays the same pack, scores hidden until both done → reveal/comparison.
- **38-0:** `/versus/38-0` — create/share code or find random (live). Async = v2.

Entry shortcuts: a game tile pre-selects the game; a rivalry card pre-selects the opponent (`?to=<id>`).

## Fresh Quiz Battle (the main new build)
- A battle references a fixed **question set** (the quiz pack's questions; same order for both players) so it's a fair same-questions contest.
- **Scores hidden** until both players have completed. Until then: challenger sees "waiting for opponent"; opponent sees "you've been challenged".
- **Reveal**: question-by-question comparison (who got what, response times), final result, Rematch + share.
- Reuse solo quiz scoring (speed-scored). Build on `h2h_challenges` (add whatever columns the reveal needs; keep scorecard path working).

## Friends (rivalries-first)
Leads with rivalries ("You lead 6–4") + Challenge per friend. `+` opens add/manage:
username search · friend code + `/add/<id>` invite link · native share-to-apps · requests inbox.
Contacts import shows a "coming soon" affordance.

## Results & sharing
Every completed match → result screen with Rematch + a shareable card (portrait for stories,
wide for unfurls) via the existing OG-image + `/s/<id>` short-link infra.

## Notifications
Via `notifyUsers` (opt-in, deduped): (a) you've been challenged, (b) opponent finished — your
turn to reveal, (c) reminder before a challenge expires. Native push already wired.

## Avatars
Deterministic generated avatar from `id`/`display_name` (colour + monogram/pattern), used
wherever a player appears. `avatar_url` overrides when present.

## Build order
**v1 (ship progressively):** default avatars → bolder hub → fresh Quiz Battle (+ keep scorecard)
→ rivalries-first Friends + add methods → result share cards → async push nudges → 3-day expiry.
38-0 live challenge + embedded leagues already shipped.

**v2 (roadmap):** async turn-based 38-0 · contacts import (native rebuild) · fixture-based leagues.

## Out of scope / non-goals (v1)
Async 38-0, fixture leagues, contacts import, profile-photo upload, ELO/rating ladder.
