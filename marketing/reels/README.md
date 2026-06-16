# 38-0 World Cup Daily — Reel screens

13 vertical 1080×1920 PNGs in `screens/`, one per beat of the voiceover. Drop them on
a timeline in order; each holds for its VO line. Regenerate with
`node scripts/reel-screens.mjs`.

| # | File | Voiceover line |
|---|------|----------------|
| 1 | `01-luck.png` | You've seen 38-0 go viral — but it's just luck of the draw. |
| 2 | `02-worldcup.png` | So we built a World Cup version, for real fans who know their stuff. |
| 3 | `03-howitworks.png` | Here's how it works. |
| 4 | `04-question.png` | Behind every draft is a question on the World Cup so far. |
| 5 | `05-correct.png` | Get it right — you get a stronger player. |
| 6 | `06-wrong.png` | Get it wrong — you end up with a mid pick. |
| 7 | `07-tournament.png` | Then you play the World Cup tournament. |
| 8 | `08-group.png` | First up is the group round. |
| 9 | `09-upgrade.png` | Before each knockout stage, you draft one new player (answer right to draft them). |
| 10 | `10-champions.png` | Go the whole tournament unbeaten — and you get the big 8-0-0. |
| 11 | `11-board.png` | Even if you don't, your points count on the World Cup Daily leaderboard. |
| 12 | `12-daily.png` | Only your first try counts — and every day it resets. |
| 13 | `13-endcard.png` | New squad every day. How far does your football brain get you? |

Built with satori + resvg (the same stack the app uses for share graphics); brand colours
and layouts mirror `/38-0/wc`.
