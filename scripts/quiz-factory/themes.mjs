/**
 * Theme selection for the weekly pack batch.
 *
 * The founder's brief: "themed, something to do with what's happening in football or in
 * the world. It doesn't have to be current; it just has to be relevant."
 *
 * So a theme comes from one of three places, in priority order:
 *   1. CALENDAR  — pegged to a real date (season opener, deadline day, a derby weekend).
 *                  These are the strongest: they land on the day the thing is happening.
 *   2. NEWS      — proposed by Claude from the last week of football news.
 *   3. EVERGREEN — a standing backlog. Always available, never rots. The floor that
 *                  guarantees we can always ship, even in an international break.
 *
 * Themes already used (quiz_packs.theme) are excluded so we don't repeat ourselves.
 */

import { callClaude, parseJson, MODELS, WEB_SEARCH_TOOL } from "../lib/anthropic.mjs";

/**
 * SOURCE COVERAGE — the thing that drives cost.
 *
 * Our SportMonks subscription is Premier League only, seasons 2000/01 → present (27 seasons:
 * players, results, final tables, top scorers, squads). A theme whose questions can be answered
 * entirely from that is verifiable by a DATA LOOKUP — essentially free. A theme that reaches
 * outside it (World Cup, Champions League, other leagues, pre-2000 PL) needs web-search
 * fact-checking, which is where the money goes (~$3–4/pack vs ~$0.60).
 *
 * So every theme carries a `coverage`:
 *   "sportmonks" 🟢  — PL, 2000/01 onwards. Cheap.
 *   "web"        🟡  — anything else. Costs more.
 * The founder sees this tag on the shortlist and picks with the trade-off in view.
 */
export const COVERAGE = {
  sportmonks: { tag: "🟢", label: "SportMonks (PL since 2000)", estUsd: 0.6 },
  web: { tag: "🟡", label: "needs web sources", estUsd: 3.5 },
};
export const estCost = (coverage) => (COVERAGE[coverage] ?? COVERAGE.web).estUsd;

/**
 * Calendar pegs. `on` is a UK date; the theme is offered when the release date falls
 * within `window` days of it. Add rows freely — this is meant to be edited.
 */
export const CALENDAR = [
  { on: "2026-08-21", window: 4, theme: "Opening Day", angle: "Famous Premier League opening-weekend moments", coverage: "sportmonks" },
  { on: "2026-09-01", window: 3, theme: "Deadline Day", angle: "Transfer deadline day drama and record fees", coverage: "web" },
  { on: "2026-12-26", window: 2, theme: "Boxing Day Football", angle: "Boxing Day Premier League fixtures through the years", coverage: "sportmonks" },
  { on: "2026-05-25", window: 5, theme: "Cup Final Day", angle: "FA Cup finals: winners, scorers, upsets", coverage: "web" },
];

/**
 * Evergreen backlog — the floor. These never go stale because they are about fixed history.
 * Deliberately broad: a fan of any club should find several of these appealing.
 */
export const EVERGREEN = [
  { theme: "PL Golden Boots", angle: "Premier League top scorers season by season", coverage: "sportmonks" },
  { theme: "Champions League Finals", angle: "Finals, winners, scorers, shocks", coverage: "web" },
  { theme: "One-Club Legends", angle: "Players who spent a whole career at one club", coverage: "web" },
  { theme: "Record Transfers", angle: "The biggest fees ever paid, and who they were for", coverage: "web" },
  { theme: "Great Comebacks", angle: "Matches won from a losing position", coverage: "web" },
  { theme: "PL Title Races", angle: "Who won the Premier League each season, and by how much", coverage: "sportmonks" },
  { theme: "Derby Days", angle: "The great rivalries and their defining matches", coverage: "web" },
  { theme: "World Cup Classics", angle: "Famous World Cup matches, goals and winners", coverage: "web" },
  { theme: "The Invincibles", angle: "Arsenal's unbeaten 2003/04 and other PL unbeaten runs", coverage: "sportmonks" },
  { theme: "Goalkeeping Greats", angle: "The best keepers, their saves and clean-sheet records", coverage: "web" },
  { theme: "Wonder Goals", angle: "The most famous individual goals ever scored", coverage: "web" },
  { theme: "PL Survival Sunday", angle: "Final-day Premier League relegation escapes", coverage: "sportmonks" },
];

const NEWS_SYSTEM = `You propose themes for a football quiz pack. Reply with ONLY a JSON array:

[{ "theme": "short punchy title, max 4 words", "angle": "one sentence on what the 15 questions would cover", "coverage": "sportmonks" | "web" }]

Rules:
- The theme must be something a football fan would recognise from the last week or two of football news, OR an anniversary/moment that is relevant right now.
- The QUESTIONS will be about established, verifiable football fact — not breaking news. So the theme is the hook, and the questions must be answerable from settled fact. A theme like "This week's results" is USELESS because those facts change and cannot be verified later. A theme like "Derby Week" or "Title-Race Deciders" is good: topical hook, timeless questions.
- Do not propose a theme that requires knowing today's league table, today's squad, or this week's scores.
- COVERAGE — classify honestly, it decides our fact-checking cost:
    "sportmonks" = every question can be answered purely from PREMIER LEAGUE data, seasons 2000/01 to now (results, final tables, top scorers, squads, appearances). Cheap for us to verify.
    "web" = the theme needs anything else — World Cup, Champions League, other leagues, or Premier League before 2000. More expensive for us.
  When in doubt, mark it "web".`;

/** Ask Claude for topical-but-timeless themes, grounded in the week's football news. */
export async function proposeNewsThemes(count = 3) {
  // News themes are a BONUS — evergreen is the guaranteed floor. So a failure here (API
  // blip, model refusal, unparseable reply) must degrade to "no news themes", never sink
  // the whole batch. The try/catch wraps the call itself for that reason.
  try {
    const resp = await callClaude({
      model: MODELS.cheap,
      system: NEWS_SYSTEM,
      messages: [{
        role: "user",
        content: `Search for the main football stories of the past week. Then propose ${count} quiz pack themes that use those stories as a hook but whose questions can be answered from settled football fact. Classify each theme's coverage honestly.`,
      }],
      tools: [WEB_SEARCH_TOOL],
      maxTokens: 2000,
      stage: "themes",
    });
    const arr = parseJson(resp);
    return Array.isArray(arr)
      ? arr
          .filter((t) => t?.theme && t?.angle)
          .map((t) => ({ ...t, coverage: t.coverage === "sportmonks" ? "sportmonks" : "web" }))
      : [];
  } catch (e) {
    console.warn(`   (news themes unavailable: ${e.message.slice(0, 80)} — using evergreen)`);
    return [];
  }
}

const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

/** Calendar themes whose window contains any of the given release dates. */
export function calendarThemesFor(dates) {
  const hits = [];
  for (const peg of CALENDAR) {
    const d = dates.find((date) => daysBetween(date, peg.on) <= peg.window);
    if (d) hits.push({ ...peg, pinnedTo: d });
  }
  return hits;
}

/**
 * Pick `count` themes for a batch: calendar first, then news, topped up from evergreen.
 * `used` = themes already in quiz_packs.theme, excluded case-insensitively.
 */
export async function pickThemes({ count, dates, used = [], skipNews = false } = {}) {
  const taken = new Set(used.map((t) => String(t).toLowerCase().trim()));
  const out = [];
  const add = (t, source) => {
    const key = String(t.theme).toLowerCase().trim();
    if (taken.has(key) || out.length >= count) return;
    taken.add(key);
    out.push({ coverage: "web", ...t, source });
  };

  calendarThemesFor(dates).forEach((t) => add(t, "calendar"));

  if (!skipNews && out.length < count) {
    (await proposeNewsThemes(count - out.length)).forEach((t) => add(t, "news"));
  }

  // Evergreen is the floor — it guarantees a batch even if the news call returns nothing.
  for (const t of EVERGREEN) add(t, "evergreen");

  return out.slice(0, count);
}
