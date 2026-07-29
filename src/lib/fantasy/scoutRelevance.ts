/**
 * Scout Report relevance — one central feed, personalised only by a LABEL.
 *
 * The feed is the same document for everyone (see loadFeedDoc): we never write
 * per-user copy. What we CAN do honestly is tell a reader how a card touches
 * THEM — a doubt about a player they own reads differently from one about a
 * player they've never picked. So each rendered card gets one of three
 * relevance labels, derived client-side from the viewer's squad + shortlist:
 *
 *   "In your squad"     — the named player is in the current squad
 *   "On your shortlist" — the named player is on the shortlist
 *   "League update"     — everything else
 *
 * Matching is by NAME against the priced pool (the feed's own player references
 * are names — a doubt's `name`, a tip's `player` — not pool ids), then pool id →
 * squad/shortlist membership. Pure + framework-free so it stays testable and can
 * be reused anywhere; no server-only import, safe in a client component.
 */

export type Relevance = "squad" | "shortlist" | "league";

export interface PoolIdentity {
  id: number;
  name: string;
  club: string;
}

/** Strip accents + punctuation, lowercase, collapse whitespace. "Gabriel
 *  Magalhães" and "gabriel magalhaes" must match; "Man. City" and "Man City"
 *  must match. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function surname(normName: string): string {
  const toks = normName.split(" ").filter(Boolean);
  return toks[toks.length - 1] ?? "";
}

/** squad beats shortlist beats league — a player you both own AND shortlisted
 *  reads as "In your squad", the stronger fact. */
function stronger(a: Relevance, b: Relevance): Relevance {
  const rank: Record<Relevance, number> = { squad: 2, shortlist: 1, league: 0 };
  return rank[a] >= rank[b] ? a : b;
}

export interface RelevanceLookup {
  /** For a card that names a specific player (a doubt, a tip). */
  forName: (name: string) => Relevance;
  /** For a club-level card (a fixture swing) — relevant if you own / shortlisted
   *  anyone from that club. */
  forClub: (club: string) => Relevance;
  /** For a free-text editorial item (article / tweet). Conservative: only a
   *  whole-word surname of length ≥ 5 (or a full-name substring) counts, so a
   *  short common token can't mislabel an unrelated story. Defaults to league. */
  forText: (text: string) => Relevance;
  /** Whether any personalisation is possible yet (pool loaded). Until then every
   *  card is a plain "League update" and no squad/shortlist claim is made. */
  ready: boolean;
}

/** Build a lookup from the pool + the viewer's squad/shortlist id sets. When the
 *  pool hasn't loaded, returns a lookup that labels everything "league" (never a
 *  false squad/shortlist claim). */
export function buildRelevanceLookup(
  pool: PoolIdentity[] | null,
  squadIds: Iterable<number>,
  shortlistIds: Iterable<number>,
): RelevanceLookup {
  const squad = new Set(squadIds);
  const shortlist = new Set(shortlistIds);
  const relOf = (id: number): Relevance =>
    squad.has(id) ? "squad" : shortlist.has(id) ? "shortlist" : "league";

  if (!pool || pool.length === 0) {
    return {
      ready: false,
      forName: () => "league",
      forClub: () => "league",
      forText: () => "league",
    };
  }

  // Index players by full normalised name and by surname, carrying each id's
  // relevance so a match resolves straight to a label.
  const byFull = new Map<string, Relevance>();
  const bySurname = new Map<string, Relevance>();
  // Only squad/shortlist players are worth scanning free text for (a league
  // player in a text item just stays "League update" anyway).
  const watched: { surname: string; full: string; rel: Relevance }[] = [];

  for (const p of pool) {
    const full = norm(p.name);
    const sn = surname(full);
    const rel = relOf(p.id);
    byFull.set(full, stronger(byFull.get(full) ?? "league", rel));
    if (sn) bySurname.set(sn, stronger(bySurname.get(sn) ?? "league", rel));
    if (rel !== "league") watched.push({ surname: sn, full, rel });
  }

  const clubRel = new Map<string, Relevance>();
  for (const p of pool) {
    if (relOf(p.id) === "league") continue;
    const c = norm(p.club);
    clubRel.set(c, stronger(clubRel.get(c) ?? "league", relOf(p.id)));
  }

  return {
    ready: true,
    forName(name: string): Relevance {
      const n = norm(name);
      if (!n) return "league";
      const full = byFull.get(n);
      if (full) return full;
      // Fall back to surname of the feed name — doubt/tip names are full names,
      // but this catches "Saka" vs "Bukayo Saka" drift.
      return bySurname.get(surname(n)) ?? "league";
    },
    forClub(club: string): Relevance {
      return clubRel.get(norm(club)) ?? "league";
    },
    forText(text: string): Relevance {
      const t = ` ${norm(text)} `;
      let best: Relevance = "league";
      for (const w of watched) {
        const fullHit = w.full.includes(" ") && t.includes(` ${w.full} `);
        const surnameHit = w.surname.length >= 5 && t.includes(` ${w.surname} `);
        if (fullHit || surnameHit) best = stronger(best, w.rel);
        if (best === "squad") break;
      }
      return best;
    },
  };
}
