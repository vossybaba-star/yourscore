/**
 * Club display names — what a fan actually calls their club.
 *
 * SportMonks returns the legal name ("Brighton & Hove Albion", "Tottenham
 * Hotspur"), which is right for a league table and wrong everywhere a name has
 * to fit — a crest tile is ~95px wide. These are the terrace names: Spurs,
 * Forest, Villa, Man Utd. Same voice as the rest of the app.
 *
 * Pure and data-free so it can be unit-tested and used on either side.
 * Unmapped clubs (promoted sides, a rename) fall through to the SportMonks name
 * with a trailing FC/AFC trimmed — never a blank tile.
 */

const SHORT: Record<string, string> = {
  "AFC Bournemouth": "Bournemouth",
  "Aston Villa": "Villa",
  "Brighton & Hove Albion": "Brighton",
  "Coventry City": "Coventry",
  "Crystal Palace": "Palace",
  "Hull City": "Hull",
  "Ipswich Town": "Ipswich",
  "Leeds United": "Leeds",
  "Leicester City": "Leicester",
  "Manchester City": "Man City",
  "Manchester United": "Man Utd",
  "Newcastle United": "Newcastle",
  "Norwich City": "Norwich",
  "Nottingham Forest": "Forest",
  "Sheffield United": "Sheff Utd",
  "Tottenham Hotspur": "Spurs",
  "West Ham United": "West Ham",
  "Wolverhampton Wanderers": "Wolves",
};

/** "Tottenham Hotspur" → "Spurs". Falls back to the given name, FC/AFC trimmed. */
export function shortClubName(club: string): string {
  return SHORT[club] ?? club.replace(/^AFC\s+/, "").replace(/\s+(FC|AFC)$/, "");
}
