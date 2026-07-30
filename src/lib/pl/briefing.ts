/**
 * The Daily Briefing — the day's five biggest Premier League stories, as links.
 *
 * We publish NO new reporting. A briefing is: a compiled subhead ("Lacroix joins
 * Chelsea, Spurs target bomba signing and more"), one bullet per story, and the
 * five source articles with their own thumbnails and links. Every word we render
 * has to trace back to a headline or standfirst an outlet actually published —
 * see briefingBuild.ts, which enforces that mechanically rather than trusting a
 * prompt.
 *
 * This module is PURE (types + selection + the no-model fallback) so the ranking
 * can be tested on a cached pull and the page stays dumb.
 */

import { PL_CLUB_TERMS, type PlNewsItem } from "./news";

export interface BriefingStory {
  id: string;
  title: string;
  url: string;
  source: string;
  image: string | null;
  publishedAt: string;
  /**
   * Our one-line summary of THIS story, grounded in its own standfirst.
   *
   * Carries `**` around the parts worth scanning (the names and the thing that
   * happened). Stored WITH the markers rather than as pre-split segments so the
   * bullet stays one readable string everywhere else it's used — logs, the DB,
   * a share text — and only the page has to know about the emphasis.
   */
  bullet: string;
  /** How many separate desks ran this story — why it made the cut. */
  desks: number;
}

export interface PlBriefing {
  /** YYYY-MM-DD, London. One briefing a day. */
  date: string;
  /** The compiled line under "Daily Briefing". */
  subhead: string;
  stories: BriefingStory[];
  builtAt: string;
  /** `fallback` means the model call failed and we composed from the outlets'
   *  own words verbatim. Recorded so a silently degraded briefing is visible. */
  compiledBy: "model" | "fallback";
}

/** How many stories a briefing carries. The founder's call: five, biggest only. */
export const BRIEFING_SIZE = 5;

/**
 * Words that look like entities but carry no story identity. Without these,
 * every transfer piece clusters with every other transfer piece on "Transfer".
 */
const STOP_ENTITIES = new Set([
  "the", "a", "an", "premier", "league", "transfer", "news", "live", "latest",
  "report", "reports", "exclusive", "revealed", "why", "how", "what", "who",
  "sources", "update", "updates", "confirmed", "official", "deal", "done",
  "summer", "window", "season", "club", "boss", "manager", "star", "new",
  // Section furniture, not stories. "Football Daily" is a BBC podcast, and it
  // led a briefing on its first live run because "Football" and "Daily" read as
  // two perfectly good entities.
  "football", "daily", "briefing", "podcast", "watch", "listen", "gossip",
  "quiz", "highlights", "preview", "review", "column", "analysis", "explained",
]);

/**
 * The names a story is ABOUT. Club terms plus capitalised words, which in a
 * headline are people and places. Title only — pulling entities from the
 * standfirst too made unrelated stories share tokens and collapse into one
 * cluster.
 */
export function entitiesOf(title: string): Set<string> {
  const out = new Set<string>();
  const lower = title.toLowerCase();
  for (const c of PL_CLUB_TERMS) if (lower.includes(c)) out.add(c);
  for (const w of title.match(/\b[A-Z][a-zA-Z'’-]{2,}\b/g) ?? []) {
    const lw = w.toLowerCase();
    if (!STOP_ENTITIES.has(lw)) out.add(lw);
  }
  return out;
}

interface Cluster {
  items: PlNewsItem[];
  /**
   * The SEED item's names, and they never grow.
   *
   * Growing them by union looked obviously right and was the bug that made the
   * first live briefing lead on a podcast: each absorbed item widened the set,
   * the cluster became a magnet that shared two names with almost anything, and
   * one cluster swallowed eight desks' worth of unrelated stories. Matching
   * against a fixed seed keeps "same story" meaning the same thing on the
   * fortieth item as on the second.
   */
  entities: Set<string>;
}

/**
 * Group the pull into stories.
 *
 * Two items are the same story when they share at least two names — one is too
 * loose ("Chelsea" alone joins every Chelsea story of the day). This is what
 * makes "biggest" measurable: a story five desks ran is bigger than one that a
 * single desk ran, and we have no traffic or engagement signal to ask instead.
 */
export function clusterStories(items: PlNewsItem[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const item of items) {
    const ents = entitiesOf(item.title);
    // Fewer than two names and we cannot tell what it is about, so it can never
    // corroborate anything. It stands alone and ranks last, which is where a
    // headline like "Football Daily" belongs.
    if (ents.size < 2) {
      clusters.push({ items: [item], entities: ents });
      continue;
    }
    const entList = Array.from(ents);
    const hit = clusters.find(
      (c) => c.entities.size >= 2 && entList.filter((e) => c.entities.has(e)).length >= 2,
    );
    if (hit) hit.items.push(item);
    else clusters.push({ items: [item], entities: ents });
  }
  return clusters;
}

/** Desks we'd rather quote when several ran the same story. Not a quality
 *  ranking of the outlets — just a stable, predictable tiebreak. */
const DESK_ORDER = [
  "BBC Sport", "Guardian Football", "The Standard", "Sky Sports",
  "FootballLondon", "Football365", "Sports Mole", "SPORTbible", "Sport Witness",
];

/**
 * Not a discrete news story: columns, newsletters and rolling live blogs.
 *
 * A big story drags all three along behind it, and because they cite every club
 * involved they cluster with the news and can win the lead slot off it. Three
 * separate pieces took the top of a briefing this way before this existed:
 * a Guardian stats column, the "Football Daily" newsletter, and a FootballLondon
 * transfer live blog — none of which is a thing that happened today.
 *
 * A live blog is the worst of the three. Its headline is rewritten through the
 * day, so a bullet written from it is stale within the hour and the link a
 * reader taps tomorrow points at something else entirely.
 */
const NOT_A_STORY_RE = new RegExp([
  // A PIPE anywhere brands a newsletter or column ("Football Daily | Thought
  // leader Eddie Howe runs out of ideas"). News headlines never carry one.
  "\\|",
  // Rolling coverage.
  "\\blive\\b", "\\blatest:", "\\bas it happened\\b", "\\brecap\\b", "\\bfollow\\b",
  // Comment and explainer.
  "\\bthe stats behind\\b", "\\bwhat it means\\b", "\\bexplained\\b", "\\banalysis\\b",
  "\\bopinion\\b", "\\bcolumn\\b", "\\bverdict\\b", "\\brated\\b", "\\branked\\b",
  "\\bwhy .* (should|must|need)\\b",
  // Roundups. These are the most damaging of the lot: a rumour round-up names
  // eight clubs, so it shares two names with almost every story of the day.
  "\\brank(ing|ed)\\b", "\\bround-?up\\b", "\\brumours?\\b", "\\bgossip\\b",
  "\\ball (the )?(done )?deals\\b", "\\bevery\\b", "\\bwho are\\b", "\\bbest \\w+ for\\b",
].join("|"), "i");

/** The item to link for a cluster: news over analysis, then one that actually
 *  has a picture and a standfirst, since the page shows both. */
function representative(items: PlNewsItem[]): PlNewsItem {
  return [...items].sort((a, b) => {
    // A real story first. Everything else is a tiebreak within that.
    const notStory = (i: PlNewsItem) => (NOT_A_STORY_RE.test(i.title) ? 1 : 0);
    if (notStory(a) !== notStory(b)) return notStory(a) - notStory(b);
    const score = (i: PlNewsItem) => (i.image ? 2 : 0) + (i.summary ? 1 : 0);
    if (score(b) !== score(a)) return score(b) - score(a);
    const rank = (i: PlNewsItem) => {
      const r = DESK_ORDER.indexOf(i.source);
      return r === -1 ? DESK_ORDER.length : r;
    };
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  })[0];
}

/**
 * The day's biggest stories, most-covered first.
 *
 * `now` is passed in so the recency tiebreak is deterministic and testable.
 * Items are assumed to be one day's pull (the caller windows them).
 */
export function selectStories(
  items: PlNewsItem[],
  now: number,
  size = BRIEFING_SIZE,
): { item: PlNewsItem; desks: number }[] {
  // Drop roundups, columns and live blogs BEFORE clustering, not after.
  //
  // Filtering them at the representative step only fixed which article we
  // linked; it left them inflating the desk count. A rumour round-up names
  // eight clubs, so it joins whatever cluster it meets and lends it a desk it
  // never really had — which is how a phantom six-desk cluster kept beating a
  // genuine four-desk transfer story to the lead slot. Corroboration only means
  // something when the things corroborating are themselves stories.
  const real = items.filter((i) => !NOT_A_STORY_RE.test(i.title));
  // Unless that empties the pull — a thin briefing beats no briefing.
  const pool = real.length >= size ? real : items;

  const scored = clusterStories(pool)
    .map((c) => {
      const desks = new Set(c.items.map((i) => i.source)).size;
      const newest = Math.max(...c.items.map((i) => new Date(i.publishedAt).getTime()));
      return { item: representative(c.items), desks, newest };
    })
    // More desks wins. Within the same coverage, the fresher story wins — a
    // briefing that leads on this morning's news reads as today's.
    .sort((a, b) => (b.desks - a.desks) || (b.newest - a.newest));

  void now;
  return scored.slice(0, size).map(({ item, desks }) => ({ item, desks }));
}

/**
 * The briefing composed with NO model: each bullet is the outlet's own
 * standfirst, and the subhead is the leading clause of each headline.
 *
 * Used when the model call fails or its output can't be grounded. It reads
 * flatter, and that is the correct trade — a briefing that quotes the desks
 * verbatim is always publishable, an invented one never is.
 */
export function fallbackBriefing(
  picked: { item: PlNewsItem; desks: number }[],
  date: string,
  builtAt: string,
): PlBriefing {
  return {
    date,
    subhead: fallbackSubhead(picked.map((p) => p.item.title)),
    stories: picked.map(({ item, desks }) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      image: item.image,
      publishedAt: item.publishedAt,
      // The outlet's own words, untouched apart from marking the names — no
      // model ran, so nothing here is ours except the emphasis.
      bullet: autoBold(item.summary ?? item.title),
      desks,
    })),
    builtAt,
    compiledBy: "fallback",
  };
}

// ────────────────────────────────────────────────────── bullet emphasis

/** At most this many bold runs in a bullet. Emphasis works by contrast, so a
 *  sentence with five bold phrases is a sentence with none. */
const MAX_BOLD_RUNS = 3;

/** The bullet with its `**` markers removed — what gets grounded, shared, and
 *  read by anything that isn't the page. */
export function plainBullet(bullet: string): string {
  return bullet.replace(/\*\*/g, "");
}

/**
 * Drop emphasis past the cap, keeping the earliest runs.
 *
 * The prompt asks for two or three and the model returned four on its first run
 * with emphasis enabled. Same lesson as the subhead length: if it matters, check
 * it here rather than hope the instruction held. Later runs are unwrapped
 * because a bullet's first names are the ones a scanning reader needs.
 */
export function capBold(bullet: string, max = MAX_BOLD_RUNS): string {
  const parts = bullet.split(/\*\*/);
  if (parts.length <= max * 2) return bullet;
  let runs = 0;
  return parts
    .map((part, i) => {
      if (i % 2 === 0) return part;      // outside a marked run
      runs++;
      return runs <= max ? `**${part}**` : part;
    })
    .join("");
}

/** A bullet split for rendering. Pure, so the page never parses markup itself
 *  and we never hand a string to dangerouslySetInnerHTML. */
export function bulletSegments(bullet: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  // Split on the marker pairs; odd indexes are the emphasised runs.
  bullet.split(/\*\*/).forEach((part, i) => {
    if (part) out.push({ text: part, bold: i % 2 === 1 });
  });
  return out.length ? out : [{ text: bullet, bold: false }];
}

/**
 * Mark the names in a bullet that arrived without emphasis.
 *
 * Used for the fallback path, where the bullet is an outlet's standfirst
 * verbatim and there is no model output to carry markers. Bolds runs of
 * capitalised words (people and clubs, which is what a reader scans for) and
 * stops after MAX_BOLD_RUNS. Deliberately dumber than the model's version: it
 * cannot know that "second chance" is the point of a sentence, only that
 * "Harvey Elliott" and "Liverpool" are the names in it.
 */
export function autoBold(text: string): string {
  let runs = 0;
  return text.replace(/\b[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)*(?:'s|’s)?/g, (m) => {
    // A sentence-initial capital is grammar, not a name.
    if (text.startsWith(m) && !m.includes(" ")) return m;
    if (runs >= MAX_BOLD_RUNS) return m;
    runs++;
    return `**${m}**`;
  });
}

/** The subhead's ceiling. It is the biggest type on the tile, so past this it
 *  runs to three lines and stops reading as a headline. */
export const SUBHEAD_MAX = 74;

/**
 * Trim a subhead to whole hooks.
 *
 * The model is told to stay under the limit and does not reliably obey it (its
 * first live run came back at 90 characters), so this enforces it. Cutting at a
 * comma keeps every hook it does show intact — a subhead truncated mid-name
 * reads as broken in a way a shorter one never does.
 */
export function tidySubhead(raw: string): string {
  const body = raw.trim().replace(/[,\s]*and more\.?$/i, "").replace(/[.,\s]+$/, "");
  const hooks = body.split(/\s*,\s*/).filter(Boolean);
  const kept: string[] = [];
  for (const h of hooks) {
    const next = [...kept, h].join(", ");
    // +9 for the " and more" we always append.
    if (kept.length && next.length + 9 > SUBHEAD_MAX) break;
    kept.push(h);
  }
  if (kept.length === 0) return body || "The day's biggest Premier League stories";
  return `${kept.join(", ")} and more`;
}

/** "Lacroix joins Chelsea, Spurs target bomba signing and more" — built by
 *  taking each headline's leading clause and joining the first three. */
export function fallbackSubhead(titles: string[]): string {
  const clauses = titles
    // Headlines are written as "hook - detail" or "hook: detail"; the part
    // before the break is the bit a reader scans.
    .map((t) => t.split(/\s+[-–—:|]\s+/)[0].trim())
    .filter(Boolean);
  if (clauses.length === 0) return "The day's biggest Premier League stories";

  // NEVER cut a clause mid-sentence. An earlier version sliced at 46 characters
  // and shipped "Newcastle captain Guimaraes expected to join and more" to every
  // opted-in user — the truncation ate "Arsenal" and turned a headline into a
  // fragment. Whole clauses only; tidySubhead drops the ones that don't fit.
  const short = clauses.filter((c) => c.length <= 52);
  const hooks = (short.length ? short : [clauses[0]]).slice(0, 3);
  return tidySubhead(hooks.join(", "));
}
