/**
 * Closest rivals per club (founder 8 Aug: Today's Quiz should feature quizzes
 * about the user's team AND its closest rivals). Keys + values use the FULL club
 * names as stored on the profile / used in quiz-pack names (verified against
 * teamImages.ts). Kept to the ONE or TWO fiercest rivalries so a recommendation
 * stays tight. rivalsOf() is substring-tolerant so "Leeds" still resolves to
 * "Leeds United" either way.
 */
const RIVALS: Record<string, string[]> = {
  Arsenal: ["Tottenham Hotspur", "Chelsea"],
  "Tottenham Hotspur": ["Arsenal", "Chelsea", "West Ham United"],
  Chelsea: ["Tottenham Hotspur", "Arsenal", "Fulham"],
  "Manchester United": ["Manchester City", "Liverpool", "Leeds United"],
  "Manchester City": ["Manchester United"],
  Liverpool: ["Manchester United", "Everton"],
  Everton: ["Liverpool"],
  "Newcastle United": ["Sunderland"],
  Sunderland: ["Newcastle United"],
  "Aston Villa": ["Wolves", "Birmingham City"],
  Wolves: ["Aston Villa", "West Bromwich Albion"],
  "West Ham United": ["Tottenham Hotspur", "Chelsea"],
  "Leeds United": ["Manchester United"],
  "Crystal Palace": ["Brighton & Hove Albion"],
  "Brighton & Hove Albion": ["Crystal Palace"],
  "Nottingham Forest": ["Leicester City", "Derby County"],
  "Leicester City": ["Nottingham Forest"],
  Fulham: ["Chelsea", "Brentford"],
  Brentford: ["Fulham"],
  Bournemouth: ["Southampton"],
  Burnley: ["Blackburn Rovers"],
};

/** A club's fiercest rivals (empty if we have no mapping). Substring-tolerant on
 *  the key so "Leeds" ↔ "Leeds United" and "Brighton" ↔ "Brighton & Hove Albion"
 *  both resolve, whichever form the profile stored. */
export function rivalsOf(club: string | null | undefined): string[] {
  if (!club) return [];
  const c = club.trim().toLowerCase();
  if (!c) return [];
  const key = Object.keys(RIVALS).find((k) => {
    const a = k.toLowerCase();
    return a === c || a.includes(c) || c.includes(a);
  });
  return key ? RIVALS[key] : [];
}
