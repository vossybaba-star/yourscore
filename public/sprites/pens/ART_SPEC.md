# Penalty shootout — art spec (drop your generated PNGs here)

The 2D shootout composites these files as full-frame layers, stacked back-to-front:
**bg → keeper → ball(CSS) → taker**. Replace the placeholder PNGs in this folder
(`public/sprites/pens/`) with your generated art using the EXACT filenames below.

## Frame + perspective (important — all layers must match)
- **Portrait, 3:4** (e.g. 1080×1440). The in-game stage is portrait.
- **Behind-the-taker view, facing the goal**: near pitch at the bottom, goal at the
  upper third, **crowd/stadium behind the goal**, sky/floodlights up top.
- Every file is rendered/drawn from the SAME camera so they line up when stacked.
- Keep the goal mouth roughly in the box **x: 31%–69%, y: 34%–47%** of the frame
  (that's where the aim/dive 9-grid + ball flight are mapped — tweakable in
  `PenaltyScene2D.tsx` constants `GOAL` if your art differs).

## Files
| file | what | bg | view |
|---|---|---|---|
| `bg.png` | stadium + pitch + goal + net, **no players, no ball** | opaque | the scene |
| `taker_idle.png` | the penalty taker standing at the spot | **transparent** | from BEHIND (back to camera), lower-centre/foreground |
| `taker_kick.png` | same taker mid-strike (leg through) | **transparent** | from behind |
| `keeper_ready.png` | goalkeeper ready stance in the goal | **transparent** | FRONT (facing the camera), in the goal mouth, smaller |
| `keeper_dive_l.png` | keeper diving to his left | **transparent** | front |
| `keeper_dive_r.png` | keeper diving to his right | **transparent** | front |
| `keeper_catch.png` | keeper ready/jumping centrally (arms up) | **transparent** | front |

Notes:
- Transparent PNGs: only the player, everything else alpha=0.
- Taker = your team colour (e.g. lime), keeper = opponent colour (e.g. purple) —
  but the "YOU" marker (drawn in-app) shows who you control, so colours are free.
- The keeper layer is auto-translated to the exact 9-grid cell on a dive, so the 3
  dive frames (left/right/centre) + the translate cover all 9 spots.
- Style: SNES-but-better — clean, vibrant, "cartoony but real" (your reference).

Once dropped in, reload `/38-0/match/pens?demo` — no code changes needed.

## Generation prompts (locked style, Jun 16 2026)

Style reference = the flat composite `ChatGPT Image Jun 16, 2026, 08_15_47 AM.png`
(BLUE UNITED vs RED UNITED, behind-the-taker, crowd behind the goal). **Attach that image
to every prompt** so the style/camera/scale stay identical. Each layer is the SAME 4:3
frame with the subject in the SAME spot, everything else transparent → they stack
pixel-aligned.

**bg.png** — "Recreate the EXACT same image (same style, stadium, crowd, ad boards, goal,
net, pitch, lighting, camera) but completely EMPTY: no keeper, no taker, no ball, no top
scoreboard bar, no bottom AIM/POWER meter. Just empty stadium + empty goal+net + pitch with
the penalty spot. Same 4:3."

**keeper_ready / keeper_dive_l / keeper_dive_r / keeper_catch** — "Output ONLY the
goalkeeper (same yellow kit, same size/position in the goal mouth) on a fully transparent
background, same 4:3 canvas, nothing else. Pose: READY arms slightly out / diving to HIS
LEFT (screen-right) / diving to HIS RIGHT (screen-left) / jumping straight UP arms raised."

**taker_idle / taker_kick** — "Output ONLY the #10 taker (blue shirt/white shorts, from
BEHIND, same size/position at the spot) on a fully transparent background, same 4:3 canvas,
nothing else. Pose: standing idle / mid-kick right leg swung through."

If transparency is unclean, generate the subject on solid magenta (#FF00FF) and key it out.
