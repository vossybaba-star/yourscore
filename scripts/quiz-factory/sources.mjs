/**
 * Source tiering.
 *
 * Facts-first only works if the facts are trustworthy. Under the old design a question could
 * "pass" verification citing a fan wiki or a blog — the verifier checked that A source existed,
 * never that it was worth anything. Now that questions are DERIVED from a fact sheet, a bad
 * fact poisons every question built from it (correlated failure), so the bar at gather time has
 * to be higher than the old per-question bar ever was.
 *
 *   TIER 1  governing bodies, competition organisers, official club sites, our own data feed.
 *           Primary sources — they ARE the record.
 *   TIER 2  major press and established reference. Reliable, but reporting on the record
 *           rather than being it.
 *   else    untrusted — treated as NO source. The fact is dropped.
 */

const TIER1 = [
  // Governing bodies & competition organisers
  "fifa.com", "uefa.com", "thefa.com", "premierleague.com", "efl.com",
  "conmebol.com", "concacaf.org",
  // Our own data feed
  "sportmonks.com",
];

// Official club domains. A club's own site is primary for its honours, records and history.
const TIER1_CLUB_DOMAINS = [
  "arsenal.com", "liverpoolfc.com", "mancity.com", "manutd.com", "chelseafc.com",
  "tottenhamhotspur.com", "newcastleunited.com", "avfc.co.uk", "wolves.co.uk",
  "brightonandhovealbion.com", "westhamunited.com", "cpfc.co.uk", "fulhamfc.com",
  "brentfordfc.com", "nottinghamforest.co.uk", "efc.com", "evertonfc.com",
  "bournemouthfc.co.uk", "afcb.co.uk", "leedsunited.com", "burnleyfootballclub.com",
  "sunderlandafc.com", "lcfc.com",
];

const TIER2 = [
  "bbc.co.uk", "bbc.com", "theguardian.com", "skysports.com", "reuters.com",
  "espn.com", "espn.co.uk", "telegraph.co.uk", "independent.co.uk", "thetimes.co.uk",
  "athletic.com", "nytimes.com", "apnews.com", "standard.co.uk", "mirror.co.uk",
  "rsssf.org", "rsssf.com",          // the statistical record-of-record for football
  "wikipedia.org",                    // strong for honours/records; corroborated by tier-1 where it matters
  "transfermarkt.com", "transfermarkt.co.uk", // the de-facto transfer reference
  "worldfootball.net", "11v11.com",
];

const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const matches = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** 1 | 2 | 0 (untrusted / unparseable). */
export function sourceTier(url) {
  const host = hostOf(url);
  if (!host) return 0;
  if (matches(host, TIER1) || matches(host, TIER1_CLUB_DOMAINS)) return 1;
  if (matches(host, TIER2)) return 2;
  return 0;
}

/** A fact is only allowed onto the sheet if its source is tier 1 or 2. */
export const isTrustedSource = (url) => sourceTier(url) > 0;

/** For prompts — tells the researcher where to look rather than hoping it picks well. */
export const TRUSTED_SOURCES_BRIEF = `Use ONLY these kinds of sources:
- PRIMARY (best): premierleague.com, uefa.com, thefa.com, fifa.com, or the club's own official website.
- ACCEPTABLE: BBC, The Guardian, Sky Sports, Reuters, ESPN, The Athletic, Wikipedia, RSSSF, Transfermarkt.
- NEVER: blogs, forums, fan sites, Reddit, YouTube, social media, betting sites, content farms.
A fact whose only source is outside the list above will be thrown away, so do not bother collecting it.`;
