/**
 * Club-targeted news pushes — who a story belongs to, and what a fan is told.
 *
 * Pure: no DB, no network, so the matching and the copy can be tested directly.
 *
 * ── Why this is selective rather than "every club story" ──────────────────
 * Measured on a live pull: Arsenal produced 47 stories in a day, Chelsea 31,
 * Liverpool 22. Pushing each one is roughly fifty notifications a day for one
 * fanbase, which is an uninstall rather than a feature. Only stories that
 * MULTIPLE desks are running get pushed, and each fanbase is capped per day.
 *
 * The same measurement is why the cap can be low without starving anyone: at a
 * two-desk bar the whole league produced 23 stories in a day and the busiest
 * single fanbase saw 5.
 */

/**
 * `club_supporters.club` → the words a headline actually uses.
 *
 * The stored values are formal ("AFC Bournemouth", "Tottenham Hotspur") and no
 * desk writes them that way, so a naive equality match finds nothing. Terms are
 * lowercase and matched against a lowercased headline.
 *
 * Deliberately NOT reusing PL_CLUB_TERMS from ./news: that list is one flat
 * array for tagging a story as club-related at all, and here we need to know
 * WHICH club, keyed by the exact string the supporters table stores.
 */
export const CLUB_TERMS: Record<string, string[]> = {
  "Arsenal": ["arsenal", "gunners"],
  "Aston Villa": ["aston villa", "villa"],
  "AFC Bournemouth": ["bournemouth", "cherries"],
  "Brentford": ["brentford"],
  "Brighton & Hove Albion": ["brighton"],
  "Burnley": ["burnley"],
  "Chelsea": ["chelsea"],
  "Crystal Palace": ["crystal palace", "palace"],
  "Everton": ["everton"],
  "Fulham": ["fulham"],
  "Leeds United": ["leeds"],
  "Liverpool": ["liverpool"],
  "Manchester City": ["manchester city", "man city"],
  "Manchester United": ["manchester united", "man united", "man utd"],
  "Newcastle United": ["newcastle", "magpies"],
  "Nottingham Forest": ["nottingham forest", "forest"],
  "Sunderland": ["sunderland"],
  "Tottenham Hotspur": ["tottenham", "spurs"],
  "West Ham United": ["west ham"],
  "Wolverhampton Wanderers": ["wolves", "wolverhampton"],
};

/** What a fan is called on their own lock screen. "Brighton & Hove Albion news"
 *  is nobody's idea of a notification. */
const DISPLAY: Record<string, string> = {
  "AFC Bournemouth": "Bournemouth",
  "Brighton & Hove Albion": "Brighton",
  "Leeds United": "Leeds",
  "Manchester City": "Man City",
  "Manchester United": "Man Utd",
  "Newcastle United": "Newcastle",
  "Nottingham Forest": "Forest",
  "Tottenham Hotspur": "Spurs",
  "West Ham United": "West Ham",
  "Wolverhampton Wanderers": "Wolves",
};

export const clubDisplay = (club: string): string => DISPLAY[club] ?? club;

/**
 * Which clubs a headline is about.
 *
 * HEADLINE ONLY, never the standfirst. A Chelsea story whose body mentions a
 * rival would otherwise push that rival's fans a story that turns out not to be
 * about their club, and a notification that misleads is worse than one that
 * never arrives. Measured cost of the strictness: 159 of 182 items still carry a
 * club in the headline alone.
 *
 * A transfer names two clubs and both fanbases hear about it — that is correct,
 * it IS both clubs' news. 30 of 182 items on a live pull named more than one.
 */
export function clubsInHeadline(title: string): string[] {
  const t = title.toLowerCase();
  return Object.entries(CLUB_TERMS)
    .filter(([, terms]) => terms.some((term) => t.includes(term)))
    .map(([club]) => club);
}

/**
 * Lock-screen copy. The club leads so a fan knows instantly why this arrived;
 * the headline is the body because that is the part they are deciding on.
 */
export function clubPushCopy(club: string, headline: string): { title: string; body: string } {
  return { title: `${clubDisplay(club)} news`, body: headline };
}

/**
 * Is this the same running story as one we already pushed, wearing a new
 * headline?
 *
 * A transfer saga generates a fresh article every few hours with a different id,
 * so id-based dedupe alone would push "Arsenal agree fee for Guimaraes", then
 * "Why are Arsenal signing Guimaraes?", then "Guimaraes to Arsenal: what it
 * means" as three separate stories. Shared entities catch what shared ids
 * cannot.
 *
 * Two is the threshold because one shared name is just the club: every Arsenal
 * story shares "Arsenal" with every other Arsenal story.
 */
export function isSameSaga(a: Set<string>, b: Set<string>, minOverlap = 2): boolean {
  let shared = 0;
  a.forEach((e) => { if (b.has(e)) shared++; });
  return shared >= minOverlap;
}

/** Per (club, story). One key does both jobs: notifyUsers dedupes a user against
 *  it, and counting distinct keys for a club today gives the daily cap. */
export const clubNewsKey = (club: string, storyId: string): string =>
  `club-news:${club}:${storyId}`;
