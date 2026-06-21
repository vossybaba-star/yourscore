/**
 * quiz-launch.mjs — shared helpers for the daily WC quiz launch flow.
 *
 * One source of truth for the bits every launch step needs from a daily-quiz
 * JSON (content/daily-quizzes/*.json):
 *   - slugify()         slug ⇄ pack-name resolution (MUST match src/lib/utils.ts)
 *   - loadQuiz()        read + sanity-check a quiz JSON file
 *   - titleParts()      the card title + which word is the mint accent
 *   - extractNations()  the flag row — nations the quiz is actually about
 *   - shortDescription() a 1–2 sentence blurb for the email card
 *   - deriveDay()       the series "Day N" counter (DB-backed, override-able)
 *   - urls()            canonical share-image + challenge URLs
 *
 * Used by compose-image-prompt.mjs, compose-tweet.mjs and send-wc-quiz-daily.mjs
 * so the title, flags and links are identical across the image, the tweet and
 * the email. No DB access except deriveDay() (which needs Supabase).
 */

import { readFileSync } from "node:fs";

// ── Brand constants ──────────────────────────────────────────────────────────
export const ACCENT_HEX = "#00ff87"; // YourScore mint
export const SERIES = "wc2026";
export const STORAGE_BASE = "https://auth.yourscore.app/storage/v1/object/public/quiz-share";
export const SITE = "https://yourscore.app";

// slugify — MUST stay in lockstep with src/lib/utils.ts and the other scripts.
export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");

// ── WC2026 nations ───────────────────────────────────────────────────────────
// The full 48-nation field (mirrors src/data/draft/wc2026.ts), each with the
// emoji flag (for human-facing summaries) and the alternate spellings we scan
// for in quiz text. `name` is the canonical label used in the image prompt.
// aliases are matched case-insensitively on word boundaries.
export const NATIONS = [
  { name: "Algeria", flag: "🇩🇿", aliases: ["Algeria"] },
  { name: "Argentina", flag: "🇦🇷", aliases: ["Argentina"] },
  { name: "Australia", flag: "🇦🇺", aliases: ["Australia", "Socceroos"] },
  { name: "Austria", flag: "🇦🇹", aliases: ["Austria"] },
  { name: "Belgium", flag: "🇧🇪", aliases: ["Belgium"] },
  { name: "Bosnia-Herzegovina", flag: "🇧🇦", aliases: ["Bosnia and Herzegovina", "Bosnia-Herzegovina", "Bosnia"] },
  { name: "Brazil", flag: "🇧🇷", aliases: ["Brazil", "Brazilian"] },
  { name: "Canada", flag: "🇨🇦", aliases: ["Canada"] },
  { name: "Ivory Coast", flag: "🇨🇮", aliases: ["Ivory Coast", "Cote d'Ivoire", "Côte d'Ivoire"] },
  { name: "Congo DR", flag: "🇨🇩", aliases: ["Congo DR", "DR Congo", "Democratic Republic of Congo"] },
  { name: "Colombia", flag: "🇨🇴", aliases: ["Colombia"] },
  { name: "Cape Verde", flag: "🇨🇻", aliases: ["Cape Verde", "Cabo Verde"] },
  { name: "Croatia", flag: "🇭🇷", aliases: ["Croatia"] },
  { name: "Curacao", flag: "🇨🇼", aliases: ["Curacao", "Curaçao"] },
  { name: "Czechia", flag: "🇨🇿", aliases: ["Czechia", "Czech Republic"] },
  { name: "Ecuador", flag: "🇪🇨", aliases: ["Ecuador"] },
  { name: "Egypt", flag: "🇪🇬", aliases: ["Egypt"] },
  { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", aliases: ["England"] },
  { name: "Spain", flag: "🇪🇸", aliases: ["Spain"] },
  { name: "France", flag: "🇫🇷", aliases: ["France"] },
  { name: "Germany", flag: "🇩🇪", aliases: ["Germany"] },
  { name: "Ghana", flag: "🇬🇭", aliases: ["Ghana"] },
  { name: "Haiti", flag: "🇭🇹", aliases: ["Haiti"] },
  { name: "Iran", flag: "🇮🇷", aliases: ["Iran"] },
  { name: "Iraq", flag: "🇮🇶", aliases: ["Iraq"] },
  { name: "Jordan", flag: "🇯🇴", aliases: ["Jordan"] },
  { name: "Japan", flag: "🇯🇵", aliases: ["Japan"] },
  { name: "South Korea", flag: "🇰🇷", aliases: ["South Korea", "Korea Republic", "Korea"] },
  { name: "Saudi Arabia", flag: "🇸🇦", aliases: ["Saudi Arabia"] },
  { name: "Morocco", flag: "🇲🇦", aliases: ["Morocco"] },
  { name: "Mexico", flag: "🇲🇽", aliases: ["Mexico"] },
  { name: "Netherlands", flag: "🇳🇱", aliases: ["Netherlands", "Holland"] },
  { name: "Norway", flag: "🇳🇴", aliases: ["Norway"] },
  { name: "New Zealand", flag: "🇳🇿", aliases: ["New Zealand"] },
  { name: "Panama", flag: "🇵🇦", aliases: ["Panama"] },
  { name: "Paraguay", flag: "🇵🇾", aliases: ["Paraguay"] },
  { name: "Portugal", flag: "🇵🇹", aliases: ["Portugal"] },
  { name: "Qatar", flag: "🇶🇦", aliases: ["Qatar"] },
  { name: "South Africa", flag: "🇿🇦", aliases: ["South Africa"] },
  { name: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", aliases: ["Scotland", "Scottish"] },
  { name: "Senegal", flag: "🇸🇳", aliases: ["Senegal"] },
  { name: "Switzerland", flag: "🇨🇭", aliases: ["Switzerland", "Swiss"] },
  { name: "Sweden", flag: "🇸🇪", aliases: ["Sweden"] },
  { name: "Tunisia", flag: "🇹🇳", aliases: ["Tunisia"] },
  { name: "Turkiye", flag: "🇹🇷", aliases: ["Turkiye", "Türkiye", "Turkey"] },
  { name: "Uruguay", flag: "🇺🇾", aliases: ["Uruguay"] },
  { name: "United States", flag: "🇺🇸", aliases: ["United States", "USA", "USMNT", "U.S."] },
  { name: "Uzbekistan", flag: "🇺🇿", aliases: ["Uzbekistan"] },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Visual flag descriptions for the image prompt — describing a flag by its look
// (as the founder does: "Scotland's saltire", "the Stars and Stripes") renders
// far more reliably than naming the country. Falls back to "<name>'s flag".
export const FLAG_DESC = {
  "Scotland": "Scotland's blue-and-white saltire",
  "England": "England's red-on-white St George's cross",
  "Mexico": "Mexico's green-white-red tricolour",
  "United States": "the Stars and Stripes",
  "Brazil": "Brazil's yellow and green",
  "Morocco": "Morocco's red flag with the green star",
  "Australia": "Australia's blue flag with gold accents",
  "Argentina": "Argentina's sky-blue and white",
  "France": "France's blue-white-red tricolour",
  "Germany": "Germany's black-red-gold",
  "Spain": "Spain's red and gold",
  "Portugal": "Portugal's green and red",
  "Netherlands": "the Netherlands' red-white-blue",
  "Belgium": "Belgium's black-yellow-red",
  "Croatia": "Croatia's red-and-white checkerboard",
  "Japan": "Japan's white flag with the red sun",
  "South Korea": "South Korea's white flag with the red-and-blue taeguk",
  "Canada": "Canada's red maple leaf",
  "Qatar": "Qatar's maroon-and-white serrated flag",
  "Switzerland": "Switzerland's white cross on red",
  "Senegal": "Senegal's green-yellow-red with the star",
  "Uruguay": "Uruguay's blue-and-white stripes",
  "Paraguay": "Paraguay's red-white-blue",
  "Saudi Arabia": "Saudi Arabia's green flag",
  "Turkiye": "Turkiye's red flag with the crescent and star",
};
export const flagPhrase = (name) => FLAG_DESC[name] || `${name}'s flag`;

// ── Quiz loading ─────────────────────────────────────────────────────────────
export function loadQuiz(file) {
  const quiz = JSON.parse(readFileSync(file, "utf8"));
  if (!quiz.name) throw new Error(`${file}: missing "name"`);
  if (!Array.isArray(quiz.questions)) throw new Error(`${file}: missing "questions" array`);
  return quiz;
}

// All searchable text in a quiz, with the headline fields weighted heavier so
// the flag row tracks what the day is actually ABOUT, not incidental mentions.
function weightedText(quiz) {
  const segs = [];
  const push = (t, w) => { if (t) for (let i = 0; i < w; i++) segs.push(String(t)); };
  push(quiz.name, 3);
  push(quiz.parameter, 2);
  push(quiz.angle, 3);
  for (const q of quiz.questions ?? []) {
    push(q.question, 2);
    for (const opt of Object.values(q.options ?? {})) push(opt, 1);
  }
  return segs.join("  \n  ");
}

/**
 * The flag row: nations the quiz is genuinely about, most-prominent first.
 * @param {object} quiz
 * @param {{max?:number, min?:number}} opts
 * @returns {{name:string, flag:string, count:number}[]}
 */
export function extractNations(quiz, { max = 6, min = 4 } = {}) {
  const text = weightedText(quiz);
  const firstAt = (re) => { const m = re.exec(text); return m ? m.index : Infinity; };
  const scored = NATIONS.map((nat) => {
    const re = new RegExp(`\\b(?:${nat.aliases.map(escapeRe).join("|")})\\b`, "gi");
    const count = (text.match(re) || []).length;
    return { name: nat.name, flag: nat.flag, count, first: firstAt(re) };
  }).filter((n) => n.count > 0);

  scored.sort((a, b) => b.count - a.count || a.first - b.first);

  const top = scored.slice(0, Math.max(max, min));
  return top.slice(0, max);
}

// ── Title + accent ───────────────────────────────────────────────────────────
/**
 * The card title and the single word rendered in mint (the accent), matching
 * the established look (last word of the title is the accent). A quiz JSON may
 * override with `accent_word`.
 */
export function titleParts(quiz) {
  const title = String(quiz.name).trim();
  const upper = title.toUpperCase();
  const words = upper.split(/\s+/);
  const accent = (quiz.accent_word && quiz.accent_word.toUpperCase()) || words[words.length - 1];
  return { title: upper, accent, words };
}

// ── Email blurb ──────────────────────────────────────────────────────────────
/** A tight 1–2 sentence description for the email quiz card. */
export function shortDescription(quiz, max = 180) {
  const raw = (quiz.email_desc || quiz.angle || `Today's World Cup 2026 quiz: ${quiz.name}.`).trim();
  if (raw.length <= max) return raw;
  const cut = raw.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

// ── URLs ─────────────────────────────────────────────────────────────────────
export function urls(quiz) {
  const slug = slugify(quiz.name);
  return {
    slug,
    challenge: `${SITE}/challenges/${slug}`,
    shareImage: `${STORAGE_BASE}/${slug}.png`,
    coverImage: `${STORAGE_BASE}/${slug}-cover.png`,
  };
}

// ── Tweet ────────────────────────────────────────────────────────────────────
const TWEET_MAX = 280;
const TCO_LEN = 23; // X normalises every URL to 23 chars

/**
 * The announce tweet for a quiz: hook + streak/£100 + challenge link, trimmed to
 * fit 280 (URL counts as 23). Shared by compose-tweet.mjs and post-tweet.mjs so
 * the preview and the posted text are identical.
 */
// Strip dashes used as separators (em/en dash, " -- ", " - ") but KEEP intra-word
// hyphens like "36-year". Never leaves a double hyphen in the output.
export function deDash(s) {
  return String(s)
    .replace(/\s*[—–]+\s*/g, ", ")   // em/en dash → comma
    .replace(/\s-{1,2}\s/g, ", ")     // " - " or " -- " → comma
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}

/**
 * The announce tweet: bullet-point style, each content line ENDING with an emoji,
 * blank-line spacing, NEVER a dash separator. Trimmed to fit 280 (URL = 23).
 */
export function composeTweet(quiz, { tag = "#WorldCup2026" } = {}) {
  const { challenge } = urls(quiz);

  // Short news hook: text up to the first colon of the angle, de-dashed, capped.
  let hook = deDash((quiz.angle || quiz.parameter || quiz.name).split(":")[0]);
  const capHook = (n) => { if (hook.length > n) hook = hook.slice(0, n - 1).replace(/[\s,]+\S*$/, "") + "…"; };
  capHook(95);

  const build = () => [
    `World Cup 26 Quiz Series 🏆`,
    ``,
    `Today's quiz: ${quiz.name} 🌍`,
    ...(hook ? [`${hook} ⚽`] : []),
    `15 questions for fans who watched 🧠`,
    `Top the board by the final to win £100 🏆`,
    ``,
    `Play now 👉 ${challenge}`,
    tag ? `\n${tag}` : "",
  ].join("\n");

  const len = (t) => [...t].length - challenge.length + TCO_LEN;
  let text = build();
  // If long, tighten the hook progressively, then drop it entirely as a last resort.
  for (const n of [80, 65, 50, 0]) { if (len(text) <= TWEET_MAX) break; if (n === 0) hook = ""; else capHook(n); text = build(); }
  return { text, length: len(text), url: challenge };
}

// ── Day counter ──────────────────────────────────────────────────────────────
/**
 * Series "Day N" = this quiz's position among published daily quizzes ordered by
 * date (robust to calendar gaps). Needs a Supabase service client. Falls back to
 * null if it can't be resolved — callers should require an explicit --day then.
 */
export async function deriveDay(supabase, quiz) {
  try {
    const { data, error } = await supabase
      .from("quiz_packs")
      .select("name, metadata")
      .eq("status", "published")
      .eq("featured", true);
    if (error || !data) return null;
    const daily = data
      .filter((p) => p.metadata?.daily && (p.metadata?.series || SERIES) === (quiz.series || SERIES))
      .map((p) => ({ slug: slugify(p.name), date: p.metadata?.date || "" }))
      .filter((p) => p.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const slug = slugify(quiz.name);
    const idx = daily.findIndex((p) => p.slug === slug);
    // If this quiz isn't published yet, it's the next day after the latest known.
    if (idx === -1) {
      const future = daily.filter((p) => p.date <= (quiz.date || "9999")).length;
      return future + 1;
    }
    return idx + 1;
  } catch {
    return null;
  }
}
