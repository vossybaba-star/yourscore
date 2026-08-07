# Gaming UX Simplification — Audit + Architecture (2026-08-07)

Optimisation target: **time to first fun** (see brief). Evidence: guest walk of prod at 390px
(screenshots in session scratchpad) + full code map.

## Measured problems (guest, iPhone viewport)

- `/play` first viewport contains **zero playable objects**: Solo/Leaderboards toggle +
  GameSwitcher + 5 sub-tabs + status chip + full-height Versus ad banner. First game card is
  ~1.5 screens down. Taps to gameplay: 2 (featured) to 5 (club → club page → topic → intro → start).
- **Flash on every sub-tab switch**: `ClubCard`/`RecordsCard`/`EndOfSeasonCard` resolve badges
  through a fake-async lookup (`getTeamBadgeUrl` = async wrapper over a sync map) via
  `useState(null)` + effect → cards paint with fallback initials, then swap. Confirmed visually.
- **CTA babel**: PLAY / PLAY → / PLAY NOW → / OPEN → / OPEN CLUB → / START · 20 QS / DRAFT YOUR XI →
  / FIND A RIVAL → across surfaces that all mean "play".
- Quiz intro is a content page: full-screen cover, chips, description, speed-scoring explainer,
  START below the fold, 10-row leaderboard below that.
- `/38-0` stacks 5 nav layers before its CTA. `/versus` is close to right but buried behind the
  GamesNav toggle; its top is an account banner + welcome hero (two promos before actions).
- No `loading.tsx` on any gaming route → dark/blank flashes on route changes.
- 12 card implementations, 5 entry screens, 5 results screens, 3 diverging game lists.

## KEEP

- GamesNav / GameSwitcher (founder ruling 2026-07-18: all games under one Play tab).
- Quiz in-game shell (timer + progress + no bottom nav) — the best screen in the product.
- `?solo=` URL mirroring for back-retrace (founder: "users prefer to work their way back").
- Results order on quiz (PLAY ANOTHER lead, founder-set 2026-07-22).
- Versus action cards (Find an Opponent / Challenge Friend / Join Code).
- Edge-cached `/api/quiz/packs` fetch pattern.

## SIMPLIFY

- `/play` default view → curated **Play home** (Today's Game hero, Quick Play ×4, Play With
  People ×3, More Games). Catalogue (Featured/World Cup/Club/Records/Build) remains, one tap away.
- Quiz intro: PLAY above the fold; speed-scoring explainer collapses behind "How scoring works".
- Header chips ("45 GAMES", "New this week") dropped from the default view.

## MERGE

- Quick Play card = one `MiniGameCard` component fed by the canonical `GAMES` list
  (GameSwitcher) — kills the third and fourth divergent game lists over time.
- ClubCard/RecordsCard/EndOfSeasonCard stay for now (catalogue only) but share the sync badge fix;
  full merge into one `PackCard` is a follow-up.

## REMOVE

- Versus mega-banner on /play (replaced by Play With People section ON the home view —
  supersedes the 2026-08-02 banner call; same job, above the fold, no ad).
- Dead components: `versus/LiveLobbies.tsx`, `challenges/GroupChallengeButton.tsx` (zero imports).
- Stale `MASTERMIND · WC quiz` mode tile on signed-in home (points at finished World Cup) →
  Perfect 10.

## REBUILD (this branch)

- Play home (new default `soloTab === "home"`).
- `loading.tsx` for `/play`, `/versus`, `/38-0` (bg-matched shells, no spinner).
- Flash fixes: sync badge lookups; `versus/quiz` no longer blanks its list while auth resolves.

## Deferred (follow-ups, in order of value)

1. Split the four 50–73KB single-client-component game files (intro can't paint until
   results code parses).
2. One `GameEntry` + `ResultShell` migration for Perfect 10 / HL / GTP (they are already
   near-identical hand-copies).
3. 38-0 landing diet (5 nav layers → hero + PLAY + My Scores + Leaderboard).
4. Exit-affordance consistency in-game (4 models today).
5. league Games tab work lives on unmerged branches — out of scope here.
