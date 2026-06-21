/**
 * compose-tweet.mjs — turn a daily-quiz JSON into the announce tweet.
 *
 * Thin CLI over composeTweet() in lib/quiz-launch.mjs (shared with post-tweet.mjs
 * so the preview equals what gets posted). Voice: knowledgeable football — leads
 * with the theme, names the streak + £100 hook, ends with the challenge link.
 * The share-card image is attached separately at post time.
 *
 * Usage:
 *   node scripts/compose-tweet.mjs <quiz.json>            # prints the tweet
 *   node scripts/compose-tweet.mjs <quiz.json> --json     # {text, url, length}
 *   node scripts/compose-tweet.mjs <quiz.json> --no-tag   # omit #WorldCup2026
 */

import { loadQuiz, composeTweet } from "./lib/quiz-launch.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const asJson = args.includes("--json");
const noTag = args.includes("--no-tag");

if (!file) { console.error("Usage: node scripts/compose-tweet.mjs <quiz.json> [--json] [--no-tag]"); process.exit(1); }

const { text, length, url } = composeTweet(loadQuiz(file), { tag: noTag ? "" : "#WorldCup2026" });

if (asJson) {
  console.log(JSON.stringify({ text, url, length }, null, 2));
} else {
  console.log(text);
  console.error(`\n[${length}/280 chars]`);
}
