/**
 * Competition/league badge images from TheSportsDB free API.
 * Used for All-Time Records packs on the challenges pages.
 */

const COMP_IDS: Record<string, string> = {
  // All-time records packs
  "Premier League Records": "4328",
  "Champions League Records": "4480",
  "World Cup Records": "4429",
  "Euro Championship Records": "4502", // UEFA European Championships (4481 was Europa League — wrong)
  // End of Season packs
  "The Relegation Roulette": "4328",   // Premier League badge
  "World Cup Countdown": "4429",        // World Cup badge
  "The Race for Europe": "4481",        // Europa League badge
};

// Local badges served from /public/badges/ — the same pattern as club crests
// (teamImages.ts), so surfaces that render on first paint (the signed-in home
// discovery rail) get the badge synchronously with no external call and no
// broken-image risk. Keyed by the pack-name's leading segment, e.g. the
// "Champions League Records" in "Champions League Records · All Time · Mixed".
const COMP_BADGE_MAP: Record<string, string> = {
  "Premier League Records": "/badges/premier-league.png",
  "Champions League Records": "/badges/champions-league.png",
  "World Cup Records": "/badges/world-cup.png",
  "Euro Championship Records": "/badges/euro-championship.png",
};

/** Local competition badge for a records-pack name segment, or null. */
export function getCompetitionBadgeUrlSync(name: string): string | null {
  return COMP_BADGE_MAP[name] ?? null;
}

const cache: Record<string, string | null> = {};
const inFlight: Record<string, Promise<string | null>> = {};

export async function getCompetitionBadgeUrl(packName: string): Promise<string | null> {
  const id = COMP_IDS[packName];
  if (!id) return null;
  if (id in cache) return cache[id];
  if (Object.prototype.hasOwnProperty.call(inFlight, id)) return inFlight[id];

  inFlight[id] = (async () => {
    try {
      const res = await fetch(
        `https://www.thesportsdb.com/api/v1/json/3/lookupleague.php?id=${id}`
      );
      const data = await res.json();
      const league = data?.leagues?.[0];
      const url: string | null = league?.strBadge ?? league?.strLogo ?? null;
      cache[id] = url;
      return url;
    } catch {
      cache[id] = null;
      return null;
    }
  })();

  return inFlight[id];
}
