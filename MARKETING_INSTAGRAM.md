# Instagram Posts — generator

On-brand Instagram posts, **code-rendered** with `next/og` (the same engine as our
share cards). Because they're drawn from the real brand system — not an AI image
model — they're always pixel-sharp, always on-brand, and never carry an
"AI-generated" look.

**The brand is the real one, not an approximation:**

- **Type** — **Bebas Neue** (the condensed caps of the logo / all display headers)
  over **DM Sans** body, loaded from the actual TTFs (`src/lib/og/fonts/`).
- **Wordmark** — the real logo asset (`logo-mark.png`, inlined), not text.
- **Colour rule** (from `tailwind.config.ts`): **lime `#aeea00` = 38-0 / actions ·
  teal `#00d8c0` = Quiz / knowledge · gold `#ffc233` = wins only**, on the app's
  `#080d0a` pitch→ink background. Each preset uses the right accent automatically.

**Design law:** the *information* is always the dominant layer. Hero imagery (the
gold trophy, pitch lines, grid) renders as a dimmed full-bleed backdrop that
sets the mood but never out-shouts the words and the number we're communicating.

## See them / download them

Run the app, then open the gallery:

```
/marketing/instagram
```

Every preset is shown at all three Instagram sizes. Click any one to open the
full-res PNG, then right-click → **Save image** to post. (The page is `noindex`
and not in app nav — it's a marketing tool.)

## The route

```
/api/og/instagram?template=<preset>&size=<size>
```

It returns a PNG. Open it in a browser and save, or `curl -o post.png "<url>"`.

### Sizes (`size`)

| value      | dimensions  | use                                   |
|------------|-------------|---------------------------------------|
| `portrait` | 1080 × 1350 | feed 4:5 — biggest feed footprint (default) |
| `square`   | 1080 × 1080 | feed 1:1                              |
| `story`    | 1080 × 1920 | Stories / Reels cover 9:16            |

### Presets (`template`)

| value    | post                          | accent | backdrop |
|----------|-------------------------------|--------|----------|
| `wc`     | World Cup Mastermind (launch) | gold   | trophy   |
| `380`    | 38-0 — the flagship           | lime   | pitch    |
| `quiz`   | Quiz — "knowledge. Ranked."   | teal   | grid     |
| `rank`   | YourScore Rank                | gold   | grid     |
| `league` | Start a league                | lime   | pitch    |
| `stat`   | Pure info-first (a big stat)  | gold   | trophy   |

All copy is drawn from `YOURSCORE.md`, so the messaging matches the live product.

## Overriding copy

Any line can be overridden per-request — handy for a one-off post without touching
code. URL-encode the values.

| param                  | what it sets                                              |
|------------------------|----------------------------------------------------------|
| `badge`                | the pill top-right (e.g. `World Cup 2026`)               |
| `supra`                | small eyebrow above the hero                              |
| `hero`                 | the big headline. Wrap **one** `{token}` to colour it with the accent, e.g. `GO {38-0}` |
| `sub`                  | the supporting line                                      |
| `p1` `p2` `p3`         | the three support pills                                  |
| `cta`                  | the footer button                                        |
| `url`                  | the footer handle (default `yourscore.app`)             |
| `accent`               | `lime` · `teal` · `gold` (overrides the preset)         |
| `backdrop`             | `trophy` · `pitch` · `grid` · `none`                    |

### Examples

A topical World Cup post in story size:

```
/api/og/instagram?template=wc&size=story
```

A custom info-first stat post (`%` must be encoded as `%25`):

```
/api/og/instagram?template=stat&size=portrait
  &supra=You%20need&hero=%7B89.5%2B%7D
  &sub=The%20Strength%20rating%20an%20elite%20XI%20needs%20for%20a%20real%20shot%20at%2038-0.
  &badge=Elite
```

A knockout-stage announcement reusing the WC look:

```
/api/og/instagram?template=wc
  &supra=Group%20stage%20done&hero=Into%20the%20%7Bknockouts%7D
  &sub=One%20question%20decides%20a%20draw.%20Win%20or%20you%27re%20out.
  &cta=Play%20today%E2%80%99s%20run%20%E2%86%92
```

## Where it lives

- `src/lib/og/igBrand.tsx` — the brand system as reusable Satori primitives
  (palette, wordmark, kicker, hero, pills, footer, accent bar, and the code-drawn
  trophy / pitch / grid backdrops).
- `src/lib/og/fonts.ts` + `src/lib/og/fonts/*.ttf` — Bebas Neue + DM Sans, handed
  to `ImageResponse`.
- `src/app/api/og/instagram/route.tsx` — the route + presets.
- `src/app/marketing/instagram/page.tsx` — the preview/download gallery.

To add a preset, add an entry to `PRESETS` in the route. To adjust the look for
**all** posts, edit `igBrand.tsx` — every post inherits it.
