/**
 * Team badge images served from /public/badges/ (our own CDN via Vercel).
 * Images were downloaded from ESPN CDN and stored locally so they never
 * fail due to upstream CDN issues or missing IDs.
 *
 * Add a new badge: drop the PNG into public/badges/{slug}.png and add the
 * mapping below.
 */

// ── Name → local /badges/{slug}.png ──────────────────────────────────────
const BADGE_MAP: Record<string, string> = {
  // ── Premier League clubs (current + historic) ─────────────────────────
  "Arsenal":                    "/badges/arsenal.png",
  "Aston Villa":                "/badges/aston-villa.png",
  "Birmingham City":            "/badges/birmingham-city.png",
  "Blackburn Rovers":           "/badges/blackburn-rovers.png",
  "Blackpool":                  "/badges/blackpool.png",
  "Bolton Wanderers":           "/badges/bolton-wanderers.png",
  "Bournemouth":                "/badges/bournemouth.png",
  "Brentford":                  "/badges/brentford.png",
  "Brighton":                   "/badges/brighton.png",
  "Brighton & Hove Albion":     "/badges/brighton.png",
  "Burnley":                    "/badges/burnley.png",
  "Cardiff City":               "/badges/cardiff-city.png",
  "Charlton Athletic":          "/badges/charlton-athletic.png",
  "Chelsea":                    "/badges/chelsea.png",
  // Promoted for 2026/27 — official crest pulled from SportMonks (team 117).
  "Coventry City":              "/badges/coventry-city.png",
  "Crystal Palace":             "/badges/crystal-palace.png",
  "Derby County":               "/badges/derby-county.png",
  "Everton":                    "/badges/everton.png",
  "Fulham":                     "/badges/fulham.png",
  "Hull City":                  "/badges/hull-city.png",
  "Ipswich Town":               "/badges/ipswich-town.png",
  "Leeds United":               "/badges/leeds-united.png",
  "Leeds":                      "/badges/leeds-united.png",
  "Leicester City":             "/badges/leicester-city.png",
  "Liverpool":                  "/badges/liverpool.png",
  "Luton Town":                 "/badges/luton-town.png",
  "Manchester City":            "/badges/manchester-city.png",
  "Manchester United":          "/badges/manchester-united.png",
  "Middlesbrough":              "/badges/middlesbrough.png",
  "Newcastle United":           "/badges/newcastle-united.png",
  "Newcastle":                  "/badges/newcastle-united.png",
  "Norwich City":               "/badges/norwich-city.png",
  "Nottingham Forest":          "/badges/nottingham-forest.png",
  "Nott'm Forest":              "/badges/nottingham-forest.png",
  "Portsmouth":                 "/badges/portsmouth.png",
  "QPR":                        "/badges/qpr.png",
  "Reading":                    "/badges/reading.png",
  "Sheffield United":           "/badges/sheffield-united.png",
  "Southampton":                "/badges/southampton.png",
  "Stoke City":                 "/badges/stoke-city.png",
  "Sunderland":                 "/badges/sunderland.png",
  "Swansea City":               "/badges/swansea-city.png",
  "Tottenham Hotspur":          "/badges/tottenham-hotspur.png",
  "Watford":                    "/badges/watford.png",
  "West Brom":                  "/badges/west-bromwich-albion.png",
  "West Bromwich Albion":       "/badges/west-bromwich-albion.png",
  "West Ham United":            "/badges/west-ham-united.png",
  "West Ham":                   "/badges/west-ham-united.png",
  "Wigan Athletic":             "/badges/wigan-athletic.png",
  "Wolverhampton Wanderers":    "/badges/wolverhampton-wanderers.png",

  // ── Alternate name forms ──────────────────────────────────────────────
  "AFC Bournemouth":            "/badges/bournemouth.png",
  "Man City":                   "/badges/manchester-city.png",
  "Man United":                 "/badges/manchester-united.png",
  "Man Utd":                    "/badges/manchester-united.png",
  "Nottm Forest":               "/badges/nottingham-forest.png",
  "Sheffield Utd":              "/badges/sheffield-united.png",
  "Spurs":                      "/badges/tottenham-hotspur.png",
  "Wolves":                     "/badges/wolverhampton-wanderers.png",

  // ── National teams ────────────────────────────────────────────────────
  "Argentina":                  "/badges/argentina.png",
  "Australia":                  "/badges/australia.png",
  "Belgium":                    "/badges/belgium.png",
  "Brazil":                     "/badges/brazil.png",
  "Colombia":                   "/badges/colombia.png",
  "Croatia":                    "/badges/croatia.png",
  "Denmark":                    "/badges/denmark.png",
  "England":                    "/badges/england.png",
  "France":                     "/badges/france.png",
  "Germany":                    "/badges/germany.png",
  "Ghana":                      "/badges/ghana.png",
  "Italy":                      "/badges/italy.png",
  "Japan":                      "/badges/japan.png",
  "Mexico":                     "/badges/mexico.png",
  "Morocco":                    "/badges/morocco.png",
  "Netherlands":                "/badges/netherlands.png",
  "Nigeria":                    "/badges/nigeria.png",
  "Poland":                     "/badges/poland.png",
  "Portugal":                   "/badges/portugal.png",
  "Senegal":                    "/badges/senegal.png",
  "South Korea":                "/badges/south-korea.png",
  "Spain":                      "/badges/spain.png",
  "Switzerland":                "/badges/switzerland.png",
  "Uruguay":                    "/badges/uruguay.png",
  "USA":                        "/badges/usa.png",
};

// ── Public API ────────────────────────────────────────────────────────────

/** Returns a local /badges/ URL, or null if the team isn't in the map. */
export function getTeamBadgeUrlSync(teamName: string): string | null {
  return BADGE_MAP[teamName] ?? null;
}

/** Async wrapper — kept for call-site compatibility. */
export async function getTeamBadgeUrl(teamName: string): Promise<string | null> {
  return getTeamBadgeUrlSync(teamName);
}

// Longest names first, so "Aston Villa" wins over a shorter partial and
// "Newcastle United" is tried before "Newcastle".
const BADGE_KEYS_BY_LEN = Object.keys(BADGE_MAP).sort((a, b) => b.length - a.length);

/** A club crest for any club name/alias appearing as a WHOLE word in free text —
 *  so a headline like "Howe leaves Newcastle" can carry the Newcastle crest. Exact
 *  known names/aliases only (never a fuzzy guess), so a card never wears the wrong
 *  club. Null when no club is named. */
export function clubBadgeInText(text: string): string | null {
  const t = ` ${text.toLowerCase()} `;
  for (const k of BADGE_KEYS_BY_LEN) {
    const kl = k.toLowerCase();
    const idx = t.indexOf(kl);
    if (idx < 0) continue;
    const before = t[idx - 1] ?? " ";
    const after = t[idx + kl.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return BADGE_MAP[k];
  }
  return null;
}

/** Falls back to badge — we don't have separate jersey images. */
export async function getTeamJerseyUrl(teamName: string): Promise<string | null> {
  return getTeamBadgeUrl(teamName);
}

/** Batch-resolve badges for a list of team names. */
export async function prefetchTeamImages(teams: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const t of Array.from(new Set(teams))) {
    const url = getTeamBadgeUrlSync(t);
    if (url) map[t] = url;
  }
  return map;
}
