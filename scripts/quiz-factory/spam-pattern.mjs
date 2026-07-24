/**
 * Detect BULK-GENERATED fabrications by their structural signature. Free — no API, no data.
 *
 * The old generator sprayed one fact across every season it could name. The bank is full of it:
 *
 *   "How many PL goals did Ollie Watkins score for Aston Villa in 2001-02?"  → 16
 *   "…in 2002-03?" → 16   "…in 2003-04?" → 16   "…in 2004-05?" → 16   "…in 2017-18?" → 16
 *
 * Watkins was six in 2001-02, and Villa weren't even in the division in 2017-18. The real tally
 * (16, in 2023-24) got stamped onto every season. Same for Haaland (27), João Pedro (15), Igor
 * Thiago (22) — a player's genuine figure, replicated across a decade he wasn't there for.
 *
 * Why this matters: the SportMonks sweep CANNOT catch these. It disproves a claim by comparing
 * it to that season's top scorer, and the worst offenders sit in exactly the seasons with no
 * top-scorer data (pre-2005/06). But the pattern itself is damning and costs nothing to see:
 * one subject + one identical answer + many different seasons = generated spam, not knowledge.
 *
 * Deliberately conservative. A player CAN legitimately score the same number twice (Henry got
 * 24 in 2001-02 and 2004-05), so the threshold is 3+ seasons, and only the season differs.
 */

/** Capitalised multi-word run — the question's subject. "Ollie Watkins", "João Pedro". */
const NAME_RE = /\b([A-ZÀ-Þ][\p{L}'’-]+(?:\s+(?:de|da|dos|van|von|der)\s+)?(?:\s+[A-ZÀ-Þ][\p{L}'’-]+)+)/gu;

// Words that start a sentence or name a club — never the subject we're keying on.
const NOT_A_PERSON = new Set([
  "Premier League", "Champions League", "Europa League", "Manchester City", "Manchester United",
  "Aston Villa", "Nottingham Forest", "Crystal Palace", "West Ham", "Leeds United", "Norwich City",
  "Leicester City", "Newcastle United", "Tottenham Hotspur", "Sheffield United", "Hull City",
  "Wigan Athletic", "Blackburn Rovers", "Bolton Wanderers", "Charlton Athletic", "Derby County",
  "Ipswich Town", "Stoke City", "Swansea City", "Cardiff City", "Birmingham City", "Wolverhampton Wanderers",
  "Brighton Hove", "West Bromwich Albion", "Queens Park", "Bradford City", "Coventry City",
  "Blackpool Football", "Burnley Football", "Watford Football", "Reading Football",
]);

/** The season a question is about — the thing that's supposed to vary. */
export const seasonOf = (q) => {
  const m = String(q).match(/\b((?:19|20)\d{2})\s*[-/–]\s*(\d{2})\b/);
  return m ? `${m[1]}-${m[2]}` : null;
};

/** The person a question is about, or null. */
export function subjectOf(question) {
  const q = String(question ?? "");
  for (const m of q.matchAll(NAME_RE)) {
    const name = m[1].trim();
    if (NOT_A_PERSON.has(name)) continue;
    if (/^(How|What|Which|Who|When|Where|In|The|Premier|During)\b/.test(name)) continue;
    if (name.split(/\s+/).length < 2) continue;
    return name;
  }
  return null;
}

/** Normalized answer text, so "16" and "16 goals" group together. */
const answerText = (q) => String((q.options ?? {})[q.answer] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Is the answer a COUNT? Only numeric answers carry the spam signature.
 *
 * A repeated non-numeric answer is usually just true: "Which club was Thierry Henry at when he
 * won the Golden Boot in 2003-04 / 2004-05 / 2005-06?" answers "Arsenal" every time because he
 * played for Arsenal. Same for Kane→Spurs, Salah→Liverpool. Flagging those was wrong.
 *
 * But a player scoring EXACTLY the same number in three-plus different seasons essentially
 * never happens — that's one real tally stamped across a decade.
 */
const isCount = (q) => /^\d{1,3}$/.test(String((q.options ?? {})[q.answer] ?? "").trim());

/** Is the subject just the club the question is already about? Then it isn't a person. */
const subjectIsTheClub = (subject, entity) => {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
  const [a, b] = [norm(subject), norm(entity)];
  return a === b || a.includes(b) || b.includes(a);
};

/**
 * Find bulk-generated groups.
 * A group = same entity + same PERSON + same NUMERIC answer, across `minSeasons`+ different seasons.
 * Returns [{ entity, subject, answer, seasons, ids, questions }], worst first.
 */
export function findSpamGroups(rows, { minSeasons = 3 } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const subject = subjectOf(r.question);
    const season = seasonOf(r.question);
    if (!subject || !season) continue;      // needs a subject AND a season to be this pattern
    if (!isCount(r)) continue;              // only a repeated COUNT is suspicious
    if (subjectIsTheClub(subject, r.entity)) continue; // "West Ham got 42 pts" — a club, not a person
    const key = `${r.entity}||${subject}||${answerText(r)}`;
    const g = groups.get(key) ?? { entity: r.entity, subject, answer: (r.options ?? {})[r.answer], seasons: new Set(), ids: [], questions: [] };
    g.seasons.add(season);
    g.ids.push(r.id);
    g.questions.push(r.question);
    groups.set(key, g);
  }

  return [...groups.values()]
    .filter((g) => g.seasons.size >= minSeasons)
    .map((g) => ({ ...g, seasons: [...g.seasons].sort() }))
    .sort((a, b) => b.seasons.length - a.seasons.length);
}
