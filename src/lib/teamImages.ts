/**
 * Team badge images via ESPN public CDN.
 * TheSportsDB free tier (key=3) is broken — returns Arsenal for every query.
 * ESPN CDN: https://a.espncdn.com/i/teamlogos/soccer/500/{id}.png
 *
 * IDs sourced from the ESPN Soccer API (eng.1 league).
 */

// ── ESPN team ID map ──────────────────────────────────────────────────────
// Keys are the exact names stored in quiz_packs.name (and matches tables).
const ESPN_IDS: Record<string, string> = {
  // Premier League clubs (2025/26 packs)
  "Arsenal": "359",
  "Aston Villa": "362",
  "Bournemouth": "349",
  "Brentford": "337",
  "Brighton": "331",
  "Burnley": "379",
  "Chelsea": "363",
  "Crystal Palace": "384",
  "Everton": "368",
  "Fulham": "370",
  "Leeds United": "357",
  "Liverpool": "364",
  "Manchester City": "382",
  "Manchester United": "360",
  "Newcastle United": "361",
  "Nottingham Forest": "393",
  "Sunderland": "366",
  "Tottenham Hotspur": "367",
  "West Ham United": "371",
  "Wolverhampton Wanderers": "380",
  // Alternate name forms used in the matches/rooms tables
  "Man City": "382",
  "Man United": "360",
  "Man Utd": "360",
  "Spurs": "367",
  "Wolves": "380",
  "Brighton & Hove Albion": "331",
  "AFC Bournemouth": "349",
  "Nottm Forest": "393",
};

function espnBadgeUrl(id: string): string {
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
}

// ── Sync helper (no fetch needed — IDs are hardcoded) ────────────────────

export function getTeamBadgeUrlSync(teamName: string): string | null {
  const id = ESPN_IDS[teamName];
  return id ? espnBadgeUrl(id) : null;
}

// ── Async wrapper (matches old API so existing call-sites work unchanged) ─

export async function getTeamBadgeUrl(teamName: string): Promise<string | null> {
  return getTeamBadgeUrlSync(teamName);
}

// ── Jersey URL (falls back to badge — ESPN doesn't have kit images) ───────

export async function getTeamJerseyUrl(teamName: string): Promise<string | null> {
  return getTeamBadgeUrl(teamName);
}

/** Batch-fetch badges for all teams in a list */
export async function prefetchTeamImages(teams: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const t of Array.from(new Set(teams))) {
    const url = getTeamBadgeUrlSync(t);
    if (url) map[t] = url;
  }
  return map;
}
