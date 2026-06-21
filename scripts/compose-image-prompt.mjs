/**
 * compose-image-prompt.mjs — turn a daily-quiz JSON into the exact prompt(s) we
 * hand to the YourScore image chat in ChatGPT.
 *
 * The image ENGINE is ChatGPT (its render quality beats ours); our job is to
 * remove drift by spelling out the title, the flag row (described VISUALLY, the
 * way the founder does — "Scotland's saltire", "the Stars and Stripes") and the
 * brand. ChatGPT reuses the logo, fonts, layout and stadium look from the
 * reference images already in that chat.
 *
 * Mirrors the founder's proven structure in that chat:
 *   message 1 → "Premium editorial sports key art …" (16:9 hero)
 *   message 2 → "Now the same in 1:1 (1080×1080)."   (square cover)
 *
 * Usage:
 *   node scripts/compose-image-prompt.mjs <quiz.json>            # prints both messages
 *   node scripts/compose-image-prompt.mjs <quiz.json> --json     # {title,nations,hero,square}
 *   node scripts/compose-image-prompt.mjs <quiz.json> --flags "Scotland,Mexico,USA,Brazil"
 */

import { loadQuiz, titleParts, extractNations, flagPhrase } from "./lib/quiz-launch.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const asJson = args.includes("--json");
const flagsFlag = (() => { const i = args.indexOf("--flags"); return i !== -1 ? args[i + 1] : null; })();

if (!file) { console.error("Usage: node scripts/compose-image-prompt.mjs <quiz.json> [--json] [--flags \"A,B,C\"]"); process.exit(1); }

const quiz = loadQuiz(file);
const { title } = titleParts(quiz);

// Flag row: explicit --flags override, else auto-extracted from the quiz.
const nations = flagsFlag
  ? flagsFlag.split(",").map((s) => s.trim()).filter(Boolean)
  : extractNations(quiz).map((n) => n.name);

// "A, B, C and D" — described visually for the model.
const flagPhrases = nations.map(flagPhrase);
const flagList = flagPhrases.length > 1
  ? `${flagPhrases.slice(0, -1).join(", ")} and ${flagPhrases[flagPhrases.length - 1]}`
  : (flagPhrases[0] || "the competing nations");

const hero = `Featured-page hero (16:9 / 1920×1080):

Premium editorial sports key art for a football quiz, "${quiz.name} — World Cup 2026." Cinematic packed stadium at dusk under blazing floodlights, a sea of fans waving the national flags of ${flagList}. Confetti and flares haze in the air, electric tournament atmosphere. Rich, sophisticated grade: deep navy night sky, warm gold floodlight glow, saturated flag colours as the accent. Centre pitch and centre-circle in sharp focus, shallow depth of field, clean negative space upper-left for the headline. High-end broadcast title-card feel, cinematic grain.

YourScore branded, exactly like the previous cards in this chat: the YourScore wordmark logo top-left, and the headline "${title}" set large in the upper-left in the established condensed style — render the final word in YourScore mint green and the rest in white — with a small "WORLD CUP 2026" line beneath it. Keep the logo, fonts and layout identical to the prior cards; only the headline and the flags change.`;

const square = `Now the same image in 1:1 square (1080×1080) — identical design, logo, headline and flags, just re-composed for the square crop.`;

if (asJson) {
  console.log(JSON.stringify({ title, nations, hero, square }, null, 2));
} else {
  console.log("───────── MESSAGE 1 (send first) ─────────\n");
  console.log(hero);
  console.log("\n───────── MESSAGE 2 (send after image 1 renders) ─────────\n");
  console.log(square);
}
