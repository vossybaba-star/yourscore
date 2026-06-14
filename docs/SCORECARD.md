# 38-0 Scorecard — Design System (memory)

Single source of truth for the **38-0 scorecard** redesign. "38-0" = the Draft XI
competitive team-builder game inside YourScore; a **scorecard** = the result screen a
player sees after a game, and the web page a follower lands on when that result is shared.

## What was done
Unified **all 38-0 scorecards** onto one premium "rare-tier digital collectible" design
(obsidian glass housing, metallic foil scoreline, holographic sweep, drifting embers,
"MATCHDAY 38" watermark, grain, registration marks, authenticity strip). The *detail*
differs per mode (head-to-head vs solo season) but the *chrome is identical*. Shared links
open a real **web page**, not a PNG — the PNG only exists as the unavoidable in-feed OG
thumbnail; clicking the link lands on the live card page.

Merged to `main` as `973a2c1` (PR #14). Branch: `claude/38-0-scorecard-design-j80btc`.

## Shared component system
`src/components/draft/Scorecard.tsx` is the design system. Exports:
- **Primitives:** `Foil`, `Holo`, `Crest`, `SectionLabel`, `Metric`, `useCountUp`
- **Shell:** `ScorecardShell` — glass housing + metallic frame + grain + watermark +
  embers + registration marks + eyebrow (`FULL TIME · headline · YOURSCORE`) + authenticity strip
- **Views:** `ScorecardView` (renders `ScorecardData`), `Scorecard` (LocalMatch adapter)
- **Constants:** `SC_WIN` / `SC_DRAW` / `SC_LOSS`, `FOIL`
- **Types:** `ScorecardData`, `ScorecardSide`, `ScorecardStat`, `ScorecardGoal`, `ScorecardPotm`
- **Helpers:** `statsFromReport`, `goalsFromReport`, `potmFromReport`

`ScorecardData` sections (stats, goalEvents, potm, squads) are **optional** so leaner
sources (e.g. shared-link params) degrade gracefully — same design, less detail.

`src/components/draft/SeasonScorecard.tsx` = solo-season variant built on `ScorecardShell`:
W-D-L hero (foil), league finish vs projection, season metrics (GF/GA/GD), awards grid,
top contributors. `fk` mapping: invincible→draw(gold), top4→win, ≤12→draw, else→loss.

## Where each scorecard lives
- `src/app/38-0/match/result/page.tsx` — anonymous quick-match result (`<Scorecard>`); has
  `shareUrl()` → `https://yourscore.app/38-0/card?<liveOgQuery(...)>`.
- `src/app/38-0/match/[id]/page.tsx` — server; live → `<ScorecardView>`, non-live → inline `<ScorecardShell>`.
- `src/app/38-0/card/page.tsx` — **public unfurl page** for a shared quick match; renders
  `<ScorecardView>` from URL params (anonymous matches have no DB record).
- `src/app/38-0/live/match/[id]/page.tsx` — `ResultPanel` uses `<ScorecardView>`. Note:
  `const report = sim ? buildReport(sim) : null; const meReport = report ? (view.meP1 ? report : flipReport(report)) : null;`
- `src/app/38-0/season/page.tsx` — in-app season result via `<SeasonScorecard>`.
- `src/app/38-0/season/share/page.tsx` — public season unfurl via `<SeasonScorecard>`.

## Kept unchanged
World Cup run screen `src/app/38-0/wc/run/[id]` — left as-is per product owner.

## Brand tokens / fonts
bg `#0a0a0f`, ink `#020204`, green `#00ff87`, amber `#ffb800`, red `#ff4757`, gold `#ffd700`.
Fonts: Bebas Neue (display), DM Sans (body), **DM Mono (data — added this work)**.
- `src/app/layout.tsx`: `DM_Mono` (`--font-dm-mono`, weights 400/500)
- `tailwind.config.ts`: `mono: ["var(--font-dm-mono)", ...]`
- `src/app/globals.css`: `@keyframes foilSheen/scHolo/scDrift`, utils `.animate-foil/.sc-holo/.sc-particle`,
  all disabled under `@media (prefers-reduced-motion: reduce)`.

## CSS techniques
`background-clip:text` metallic foil · `mask-composite` frame ring ·
`mix-blend-mode:color-dodge` holographic sweep · `backdrop-filter:blur` glass ·
SVG feTurbulence grain · fixed-position embers (SSR-safe — **no Math.random**, avoids
hydration mismatch).

## Constraints
- **OG/Satori** (`/api/draft/live-og`, `/api/draft/season-og`) are static images — cannot
  render glass/foil/holographic. They stay as the in-feed thumbnail only; share `wide=1`
  for landscape so socials don't crop the hero stats.
- Static HTML preview of the card: `docs/superpowers/previews/38-0-scorecard-preview.html`.
- `next build` exits 1 on **pre-existing** unrelated Supabase-env prerender errors
  (`/admin/challenges`, `/friends`) — not caused by this work.
