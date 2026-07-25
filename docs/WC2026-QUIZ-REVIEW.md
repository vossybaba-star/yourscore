# World Cup 2026 daily-quiz review + theme packs

**Date:** 2026-07-25 · **Branch:** `claude/world-cup-quiz-review-packs-8czwuy`

We ran a daily World Cup quiz through the tournament. This is a review of every
committed question, and a set of evergreen **theme packs** distilled from them so the
World Cup content lives on as a browsable back-catalogue rather than 22 dated dailies
nobody can find after the final.

## Scope reviewed

All **22 daily quiz files** in `content/daily-quizzes/`, **330 questions**, spanning
**11 June → 2 July 2026** (opening day through the Round of 32).

### ⚠️ Coverage gap — the reachable content stops at the quarter-finals
The tournament ran to the **19 July final**. The committed daily files
(`content/daily-quizzes/`) end on **2 July** (Round of 32). A further nine days of
knockout content — **Round of 16 through the quarter-final line-ups, 3–10 July** — survive
inside `src/data/draft/wc-quiz.json` (the Mastermind question bank, `generatedFrom` lists
them), and were reviewed here. But the **semi-finals and final (11–19 July) are nowhere in
the repo**, and there is **no `.env.local`/service-role key in this environment** to pull
them from the database. A "Road to the Final" / champions pack was therefore **skipped by
the founder** rather than built on invented results — it can be added once the 11–19 July
content is reachable.

## Quality verdict

Content quality is **high**. Spot-checks:

- **Real-world anchors all correct:** Klose's 16 men's WC goals, Marta's 17 overall,
  Just Fontaine's 13 in 1958, Roger Milla (oldest WC scorer, Cameroon '94), Tim Howard's
  16 saves vs Belgium (2014 R16), Pelé's three titles, Jairzinho scoring in every 1970
  match, Gary Lineker's England-record 10, the Pelé/Owen "scored at two WCs before 23" club.
- **Internal narrative is consistent** across the fictional 2026 run: Messi 16 (level with
  Klose, hat-trick v Algeria) → 18 (brace v Austria, past Klose and Marta); Mbappé → 16 on
  his 100th cap v Iraq, France all-time scorer past Giroud/Fontaine; the Golden Boot tallies
  (Messi 5 then joint-6 with Mbappé) add up match by match.

### Observations (not errors)
- **Heavy evergreen repetition across dailies, by design.** "48 teams", "hosts
  USA/Canada/Mexico", "reigning champions Argentina", "Brazil's five titles", "Pelé the only
  3-time winner", "final at MetLife" recur in most files — right for a low-friction daily,
  wrong for a themed pack. The theme packs **de-duplicate**: 0 repeated question texts within
  a pack and 0 across the 7 packs.
- **Two files share the date 2026-06-16** (`first-round-shocks`, `wild-matchday-four`) and
  **two are titled "Group Stage Finale"** (06-25, 06-27). Not bugs — just naming.
- **Answer-position convention.** The early dailies (11–18 Jun) store the correct answer in
  slot **A** for every question and rely on `scripts/lib/shuffle-options.mjs` to randomise
  positions at publish; the later dailies were pre-shuffled. The theme packs follow the
  early convention (answer in A) and the seeder shuffles deterministically by pack name — so
  a published pack never sits with the answer in slot A fifteen times.

No factual corrections were needed to the committed dailies.

## The theme packs

Seven evergreen 15-question packs in `content/wc-packs/`, each curated and de-duplicated
from the dailies (every pack lists its `curated_from` source files):

| Pack | Theme | Headline |
|---|---|---|
| Messi Rewrites the World Cup Record Book | `messi` | Passing Klose (18) and Marta (17) at his sixth WC |
| Record Book Rewritten: The Milestones of 2026 | `records` | Mbappé, Ronaldo at 41, Kane=Lineker, Tielemans' latest-ever goal |
| Shock Troops: The Upsets of World Cup 2026 | `upsets` | Cabo Verde hold Spain; Germany & Netherlands out on pens |
| Hosts With the Most: USA, Canada and Mexico | `hosts` | Canada's first knockout run, Mexico's perfect group |
| Opening Day Chaos: Kickoff, Mascots and Mayhem | `opening` | Three red cards, the mascots, Labubu, hidden sponsor names |
| Knockout Drama: The Round of 32 | `knockouts` | Kane's rescue, Belgium's comeback, Brazil edge Japan |
| Small Nations, Big Nights | `debutants` | Curaçao's debut, Eloy Room's 15 saves, Cape Verde in the last 32 |

Each pack keeps a spread of easy → expert questions and slug-safe names (no apostrophes,
no intra-word hyphens) so the `[slug]` challenge route resolves.

## Publishing

**Not yet live.** Publishing a pack is a write to `quiz_packs`, which needs the
service-role key — and this environment has **no `.env.local` and no injected secrets**, so
the packs cannot be seeded from here. They are validated and seed-ready; run the seeder from
somewhere the secret exists:

```bash
node scripts/seed-wc-packs.mjs            # DRY RUN — validates, previews, writes nothing
node scripts/seed-wc-packs.mjs --commit   # upsert all 7 into quiz_packs
```

The seeder mirrors `seed-daily-quiz.mjs`: upsert by name, `status=published`,
`source=system`, `rotation_active=true`, icon in `metadata.icon`, `metadata.wc_theme=<slug>`,
deterministic option shuffle, and metadata **merged** on re-publish so any attached
`cover_image` survives.

**Deliberately NOT tagged `series: "wc2026"`.** That tag routes a pack onto the World Cup
£100 leaderboard, which was a closed, dated competition; retro-adding evergreen packs would
distort a finished board. They land as ordinary published packs in the World Cup category.
Flip `SERIES` in the seeder to `"wc2026"` only if the founder wants them scored there.
Covers are the typographic fallback until art is approved (the contact-sheet-approval rule).
