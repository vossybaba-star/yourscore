# Daily-card style references

`gen-quiz-images.mjs` conditions gpt-image-1 on the image(s) in this folder so every
day's card matches our established look **without a browser** (via the `/images/edits`
API). This replaces driving the ChatGPT chat in Chrome — same reference, no browser.

## What to put here

- **1–3 of the best prior World Cup card backgrounds.** More than ~4 dilutes the style.
- **Text-free art is strongly preferred.** Feed the clean background (e.g. a `*-bg-*.png`
  cache from a day you loved), *not* a finished card with the title baked in — otherwise
  the model may try to reproduce text. The YourScore logo + title are stamped on
  afterwards by the satori overlay, so the reference only needs the photographic art.
- PNG / JPG / WEBP. Files are picked in sorted filename order; name them `01-*.png`,
  `02-*.png` to control priority.

## How it's used

- Refs present → `POST /v1/images/edits` (gpt-image-1, `input_fidelity: low`): the model
  matches the colour grade / lighting / mood but invents a NEW composition each day.
- Refs absent → falls back to plain text-to-image. The script always works either way.
- `node scripts/gen-quiz-images.mjs --quiz <file> --no-ref` forces text-to-image for a day.

## Where to get good source art

Past clean backgrounds were cached during generation at `/tmp/<slug>-bg-share.png` /
`-cover.png`, and finished cards live in Supabase storage `quiz-share/<slug>-*.png`.
Pick the founder's favourites, strip/avoid text, drop them here.
