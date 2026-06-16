# 38-0 penalty shootout → 2D sprite scene (from the purchased players)

## Context
The 3D R3F shootout looked good but hit the StudioOchi asset's ceiling: it ships a
single baked "showcase" clip (jog/idle loops) — no real kick, dive, or catch — so the
keeper "kicked" instead of diving and the taker never struck the ball. Live 3D also
brought WebGL context-loss fragility on mobile.

**Decision (user):** go 2D, but **reuse the purchased players** by pre-rendering them
into flat PNG sprites. Spike (`/38-0/sprites`, dev-only) confirmed:
- players render cleanly on a transparent background;
- the rig has standard bones (`thighR`, `shinR`, `upper_armL`, `spine002`, …), so we can
  **pose** a true strike (leg through ball) and a true reach (arms overhead → rotate to a
  hands-first dive) — neither exists in the baked clip;
- `canvas.toDataURL` exports each pose.

So the money isn't wasted: the 2D game is built from the bought models, and posing gives
us the exact frames the clip lacked.

**Unchanged:** ALL game logic — `pens.ts`, 9-zone aim, power meter, every mode
(quick/ranked/challenge/live/WC), scoring, the soft-lock watchdog. Only the render layer
swaps from a live `<Canvas>` to 2D sprites.

## Player model (user's role rule)
Fixed positions, no swapping: the **taker always stands at the spot** (facing the goal),
the **keeper always stands in the goal** (facing out). A floating **"YOU" marker** hops to
whichever player is the human this turn — above the taker when shooting, above the keeper
when saving. Taker kit = green, keeper kit = purple (distinct; the marker, not colour,
signals control).

## Sprites — baked once into `public/sprites/` (transparent PNG, 2× retina)
Rendered from the spike by driving `window.__sprite` (pose + camera + kit), then
`png()` → saved to disk. Camera: near-front, slight 3/4 for the taker so the strike leg
reads in profile.
- **taker (green):** `idle`, `runup`, `strike`. (follow-through optional)
- **keeper (purple):** `ready`, `reach` (one pose; CSS-rotated/mirrored for dive
  left/right and tilted for high/low), `catch` (centre).
- **backdrop:** one pre-rendered PNG of the existing 3D stadium/goal with no players
  (keeps the look users liked) — or a lighter CSS goal if the render is too heavy.

## New component `PenaltyScene2D.tsx`
Same prop surface as `PenaltyScene3D` so `PenaltyShootout` is a one-line swap:
`{ aim, play, onPlayed, reduced, defending }` + the scene owns the "YOU" marker from
`defending`. Pure DOM/CSS, no three/R3F.
- Layered absolutely-positioned `<img>` sprites over the backdrop, sized to the 9/12 stage.
- **Keeper:** shows `ready`; on a play, swaps to `reach` and CSS-transforms
  (translate to the dive column + rotate toward horizontal; `catch` for a centre save).
- **Taker:** shows `idle`/`runup`; swaps to `strike` at contact (t≈0.26), timed to ball launch.
- **Ball:** a small sprite/`<div>`; flies spot→zone via GPU-composited `transform`
  (reuses the existing flight timing); net ripple / shake on outcome.
- **YOU marker:** a small lime chip + arrow, absolutely positioned above taker (shooting)
  or keeper (defending). Driven by `defending`.
- `onPlayed` fires on the ball-flight `transitionend`; the controller watchdog still
  guarantees advance.
- `prefers-reduced-motion`: instant frame swaps, no flight tween.

## Wiring & cleanup
- `PenaltyShootout.tsx`: swap `<PenaltyScene3D>` → `<PenaltyScene2D>` (same props). Keep
  the HUD, aim grid, power meter, watchdog, sfx exactly as-is.
- After 2D verified: delete `PenaltyScene3D.tsx`, the `/38-0/sprites` spike page, and
  remove `three`, `@react-three/fiber`, `@react-three/drei`,
  `@react-three/postprocessing`, `@types/three`, `@gltf-transform/cli`,
  `transpilePackages` — a large bundle + dependency win.

## Verify
- Spike-bake every sprite; eyeball each before wiring.
- Play through quick-match draw → shoot/strike/save → dive → result, all on the 2D scene;
  confirm the "YOU" marker tracks the role and the button-reappear + watchdog still hold.
- tsc, `bash scripts/draft/run-tests.sh` (96 tests, unaffected), `next build`.
- Mobile width + reduced motion. Server modes (ranked/live/WC) unchanged — still gated on
  migration 35.

## Risk
- Pose authoring is iterative (a few tune passes per sprite) — bounded, done in the spike.
- Backdrop fidelity: if the pre-rendered stadium feels flat in 2D, fall back to a designed
  CSS goal. Single tuning surface.
