/**
 * World Cup 2026 — verified group draw (for the 38-0 "World Cup Run" mode).
 *
 * Source: ESPN feed via the football-data skill (season `world-cup-2026`), pulled
 * 2026-06-09. 48 nations, 12 groups of 4. Crest URLs are ESPN's country logos.
 *
 * The group draw is real/fixed. The KNOCKOUT bracket (Round of 32 → Final) is NOT
 * templated here: the 48-team format's "8 best third-placed" slotting is result-
 * dependent, and this is a solo run, so a run's knockout opponents are produced by a
 * seeded bracket simulation over this same 48-nation field (see src/lib/draft/wc.ts).
 * What this module guarantees is REAL: your group, your 3 real group opponents, and
 * the set of nations that can appear in the bracket.
 */

export type WCNation = {
  nation: string; // canonical display name; MUST match the `nationality` strings in the player pool for PLAYABLE nations
  abbr: string;   // 3-letter code
  crest: string;  // flag/crest image URL
};

export type WCGroup = {
  group: string;       // "A".."L"
  teams: WCNation[];   // 4 nations
};

/** The real WC 2026 stage path (48-team format). */
export const WC_STAGES = ["group", "r32", "r16", "qf", "sf", "final"] as const;
export type WCStage = (typeof WC_STAGES)[number];

export const WC_STAGE_LABEL: Record<WCStage, string> = {
  group: "Group Stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-Final",
  sf: "Semi-Final",
  final: "Final",
};

export const WC2026_GROUPS: WCGroup[] = [
  { group: "A", teams: [
    { nation: "Czechia", abbr: "CZE", crest: "https://a.espncdn.com/i/teamlogos/countries/500/cze.png" },
    { nation: "Mexico", abbr: "MEX", crest: "https://a.espncdn.com/i/teamlogos/countries/500/mex.png" },
    { nation: "South Africa", abbr: "RSA", crest: "https://a.espncdn.com/i/teamlogos/countries/500/rsa.png" },
    { nation: "South Korea", abbr: "KOR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/kors.png" },
  ] },
  { group: "B", teams: [
    { nation: "Bosnia-Herzegovina", abbr: "BIH", crest: "https://a.espncdn.com/i/teamlogos/countries/500/bih.png" },
    { nation: "Canada", abbr: "CAN", crest: "https://a.espncdn.com/i/teamlogos/countries/500/can.png" },
    { nation: "Qatar", abbr: "QAT", crest: "https://a.espncdn.com/i/teamlogos/countries/500/qat.png" },
    { nation: "Switzerland", abbr: "SUI", crest: "https://a.espncdn.com/i/teamlogos/countries/500/sui.png" },
  ] },
  { group: "C", teams: [
    { nation: "Brazil", abbr: "BRA", crest: "https://a.espncdn.com/i/teamlogos/countries/500/bra.png" },
    { nation: "Haiti", abbr: "HAI", crest: "https://a.espncdn.com/i/teamlogos/countries/500/hai.png" },
    { nation: "Morocco", abbr: "MAR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/mar.png" },
    { nation: "Scotland", abbr: "SCO", crest: "https://a.espncdn.com/i/teamlogos/countries/500/sco.png" },
  ] },
  { group: "D", teams: [
    { nation: "Australia", abbr: "AUS", crest: "https://a.espncdn.com/i/teamlogos/countries/500/aus.png" },
    { nation: "Paraguay", abbr: "PAR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/par.png" },
    { nation: "Türkiye", abbr: "TUR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/tur.png" },
    { nation: "United States", abbr: "USA", crest: "https://a.espncdn.com/i/teamlogos/countries/500/usa.png" },
  ] },
  { group: "E", teams: [
    { nation: "Curaçao", abbr: "CUW", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/11678.png" },
    { nation: "Ecuador", abbr: "ECU", crest: "https://a.espncdn.com/i/teamlogos/countries/500/ecu.png" },
    { nation: "Germany", abbr: "GER", crest: "https://a.espncdn.com/i/teamlogos/countries/500/ger.png" },
    { nation: "Ivory Coast", abbr: "CIV", crest: "https://a.espncdn.com/i/teamlogos/countries/500/civ.png" },
  ] },
  { group: "F", teams: [
    { nation: "Japan", abbr: "JPN", crest: "https://a.espncdn.com/i/teamlogos/countries/500/jpn.png" },
    { nation: "Netherlands", abbr: "NED", crest: "https://a.espncdn.com/i/teamlogos/countries/500/ned.png" },
    { nation: "Sweden", abbr: "SWE", crest: "https://a.espncdn.com/i/teamlogos/countries/500/swe.png" },
    { nation: "Tunisia", abbr: "TUN", crest: "https://a.espncdn.com/i/teamlogos/countries/500/tun.png" },
  ] },
  { group: "G", teams: [
    { nation: "Belgium", abbr: "BEL", crest: "https://a.espncdn.com/i/teamlogos/countries/500/bel.png" },
    { nation: "Egypt", abbr: "EGY", crest: "https://a.espncdn.com/i/teamlogos/countries/500/egy.png" },
    { nation: "Iran", abbr: "IRN", crest: "https://a.espncdn.com/i/teamlogos/countries/500/irn.png" },
    { nation: "New Zealand", abbr: "NZL", crest: "https://a.espncdn.com/i/teamlogos/countries/500/nzl.png" },
  ] },
  { group: "H", teams: [
    { nation: "Cape Verde", abbr: "CPV", crest: "https://a.espncdn.com/i/teamlogos/countries/500/cpv.png" },
    { nation: "Saudi Arabia", abbr: "KSA", crest: "https://a.espncdn.com/i/teamlogos/countries/500/ksa.png" },
    { nation: "Spain", abbr: "ESP", crest: "https://a.espncdn.com/i/teamlogos/countries/500/esp.png" },
    { nation: "Uruguay", abbr: "URU", crest: "https://a.espncdn.com/i/teamlogos/countries/500/uru.png" },
  ] },
  { group: "I", teams: [
    { nation: "France", abbr: "FRA", crest: "https://a.espncdn.com/i/teamlogos/countries/500/fra.png" },
    { nation: "Iraq", abbr: "IRQ", crest: "https://a.espncdn.com/i/teamlogos/countries/500/irq.png" },
    { nation: "Norway", abbr: "NOR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/nor.png" },
    { nation: "Senegal", abbr: "SEN", crest: "https://a.espncdn.com/i/teamlogos/countries/500/sen.png" },
  ] },
  { group: "J", teams: [
    { nation: "Algeria", abbr: "ALG", crest: "https://a.espncdn.com/i/teamlogos/countries/500/alg.png" },
    { nation: "Argentina", abbr: "ARG", crest: "https://a.espncdn.com/i/teamlogos/countries/500/arg.png" },
    { nation: "Austria", abbr: "AUT", crest: "https://a.espncdn.com/i/teamlogos/countries/500/aut.png" },
    { nation: "Jordan", abbr: "JOR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/jor.png" },
  ] },
  { group: "K", teams: [
    { nation: "Colombia", abbr: "COL", crest: "https://a.espncdn.com/i/teamlogos/countries/500/col.png" },
    { nation: "Congo DR", abbr: "COD", crest: "https://a.espncdn.com/i/teamlogos/countries/500/rdc.png" },
    { nation: "Portugal", abbr: "POR", crest: "https://a.espncdn.com/i/teamlogos/countries/500/por.png" },
    { nation: "Uzbekistan", abbr: "UZB", crest: "https://a.espncdn.com/i/teamlogos/countries/500/uzb.png" },
  ] },
  { group: "L", teams: [
    { nation: "Croatia", abbr: "CRO", crest: "https://a.espncdn.com/i/teamlogos/countries/500/cro.png" },
    { nation: "England", abbr: "ENG", crest: "https://a.espncdn.com/i/teamlogos/countries/500/eng.png" },
    { nation: "Ghana", abbr: "GHA", crest: "https://a.espncdn.com/i/teamlogos/countries/500/gha.png" },
    { nation: "Panama", abbr: "PAN", crest: "https://a.espncdn.com/i/teamlogos/countries/500/pan.png" },
  ] },
];

const NATION_INDEX = new Map<string, WCNation>(
  WC2026_GROUPS.flatMap((g) => g.teams).map((t) => [t.nation, t])
);
const GROUP_OF = new Map<string, string>(
  WC2026_GROUPS.flatMap((g) => g.teams.map((t) => [t.nation, g.group] as const))
);

/** Every nation in the tournament (the bracket-opponent universe). */
export function allWCNations(): WCNation[] {
  return WC2026_GROUPS.flatMap((g) => g.teams);
}

export function wcNation(nation: string): WCNation | undefined {
  return NATION_INDEX.get(nation);
}

/** The group letter a nation is in, or undefined. */
export function groupOf(nation: string): string | undefined {
  return GROUP_OF.get(nation);
}

/** A nation's 3 real group opponents. */
export function groupOpponents(nation: string): WCNation[] {
  const letter = GROUP_OF.get(nation);
  if (!letter) return [];
  const g = WC2026_GROUPS.find((x) => x.group === letter)!;
  return g.teams.filter((t) => t.nation !== nation);
}
