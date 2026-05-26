/**
 * Player cutout images from TheSportsDB free API (key=3).
 * NOTE: the search endpoint returns "player" (not "players") as the top-level key.
 * Module-level cache + in-flight deduplication — mirrors teamImages.ts pattern.
 */

const cache: Record<string, string | null> = {};
const inFlight: Record<string, Promise<string | null>> = {};

export async function getPlayerCutoutUrl(searchName: string): Promise<string | null> {
  if (searchName in cache) return cache[searchName];
  if (Object.prototype.hasOwnProperty.call(inFlight, searchName)) return inFlight[searchName];

  inFlight[searchName] = (async () => {
    try {
      const res = await fetch(
        `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(searchName)}`
      );
      const data = await res.json();
      const p = data.player?.[0];
      const url: string | null = p?.strCutout ?? p?.strThumb ?? null;
      cache[searchName] = url;
      return url;
    } catch {
      cache[searchName] = null;
      return null;
    }
  })();

  return inFlight[searchName];
}

/**
 * Map of national team name → TheSportsDB player search string.
 * Used to auto-pick a star player for a given match team.
 */
export const COUNTRY_STAR: Record<string, string> = {
  France:         "Kylian Mbappe",
  England:        "Jude Bellingham",
  Brazil:         "Vinicius Junior",
  Argentina:      "Lionel Messi",
  Norway:         "Erling Haaland",
  Portugal:       "Cristiano Ronaldo",
  Germany:        "Jamal Musiala",
  Spain:          "Pedri",
  Netherlands:    "Virgil van Dijk",
  USA:            "Christian Pulisic",
  Mexico:         "Hirving Lozano",
  Morocco:        "Achraf Hakimi",
  Senegal:        "Sadio Mane",
  "South Korea":  "Son Heung-min",
  Japan:          "Takumi Minamino",
  Colombia:       "Luis Diaz",
  Uruguay:        "Darwin Nunez",
  Croatia:        "Luka Modric",
  Belgium:        "Kevin De Bruyne",
  Italy:          "Federico Chiesa",
  Switzerland:    "Granit Xhaka",
  Denmark:        "Christian Eriksen",
  Poland:         "Robert Lewandowski",
  Serbia:         "Aleksandar Mitrovic",
  Ukraine:        "Mykhailo Mudryk",
  Australia:      "Mathew Leckie",
  Canada:         "Alphonso Davies",
  Ecuador:        "Enner Valencia",
  "Costa Rica":   "Keylor Navas",
  Panama:         "Ismael Diaz",
  "Saudi Arabia": "Salem Al-Dawsari",
  Iran:           "Mehdi Taremi",
  Ghana:          "Mohammed Kudus",
  Cameroon:       "Andre Onana",
  Tunisia:        "Wahbi Khazri",
  Nigeria:        "Victor Osimhen",
};
