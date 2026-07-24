import "server-only";
/**
 * Decision context for the pick surfaces — the next fixtures, and who might not
 * play.
 *
 * The audit's sharpest finding was that a squad is picked on price alone: the
 * client only ever received `{ id, name, club, clubId, pos, price }`, so there
 * was no fixture, no opponent, no availability anywhere a player is chosen. Both
 * facts already exist in the codebase and neither was wired to the screens that
 * need them:
 *
 *   - the fixture ticker (`doc.fixtures.runs`) knows each club's next opponents
 *     and how hard they are, and lives on a tab under "News & insights"
 *   - the predicted-XI diff (`doc.teamNews.doubts`) is the only availability
 *     signal we have — there is no injuries endpoint on the current SportMonks
 *     plan — and it is rendered as prose on the feed
 *
 * This is shared, per-gameweek data with nothing per-user in it, so it caches at
 * the edge like the pool does. Doubts are keyed by SportMonks id in the doc and
 * by pool id here: the mapping needs the pool's baked `smId`, which never leaves
 * the server.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clubKey } from "./clubKey";
import { fantasyPool } from "./pool";
import type { Difficulty, NewsClubRun, NewsDoc, NewsDoubt } from "./news";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** How many gameweeks ahead a pick surface shows. Three is enough to spot a
 *  double or a rough run without turning a player row into a table. */
export const FIXTURE_LOOKAHEAD = 3;

export interface ContextFixture {
  gw: number;
  opp: string;
  oppShort: string;
  home: boolean;
  difficulty: Difficulty;
}

export interface FantasyContext {
  gw: number;
  /** clubId → its next fixtures, soonest first. A club with a blank gameweek
   *  simply has fewer entries, which is the signal itself. */
  fixtures: Record<number, ContextFixture[]>;
  /** pool id → why this player is a doubt. Absent = no known concern, which is
   *  NOT the same as "fit" — see the caveat the UI has to carry. */
  doubts: Record<number, string>;
  /** When the underlying team-news snapshot was taken, so the UI can be honest
   *  about how old a doubt is. */
  teamNewsAt: string | null;
}

/**
 * TWO ID SPACES, and they overlap — which is the whole reason this function
 * exists instead of a one-line join.
 *
 * `NewsClubRun.clubId` is the SportMonks participant id (Arsenal 19, Chelsea 18,
 * Spurs 6). The pool's `clubId` is the FPL team id (Arsenal 1, Chelsea 6, Spurs
 * 19). Both are small integers in roughly the same range, so keying one by the
 * other does not fail — it silently succeeds with the WRONG club. Chelsea (FPL 6)
 * picked up Tottenham's fixtures (SM 6), Liverpool (FPL 14) picked up Manchester
 * United's, and three clubs showed nothing at all. Wrong fixtures on a transfer
 * screen are worse than none.
 *
 * So the join is by NAME, through a normaliser, and it is ALL-OR-NOTHING: if any
 * club fails to map, we return no fixtures rather than a partly-wrong set. A
 * blank ticker is a visible absence; a wrong one is invisible misinformation.
 * Promotion changes three or four clubs a year, so this will fail loudly on the
 * one day a year it needs a look.
 */
export async function fantasyContext(db: Db): Promise<FantasyContext> {
  // Explicit revalidate: a service-role GET has a constant cache key and gets
  // pinned in Next's data cache forever without it (the house gotcha).
  const { data } = await db
    .from("fantasy_news_feed").select("doc")
    .order("gw", { ascending: false }).limit(1).maybeSingle();
  const doc = (data?.doc ?? null) as NewsDoc | null;
  if (!doc) return { gw: 0, fixtures: {}, doubts: {}, teamNewsAt: null };

  // SportMonks club name → its fixture run.
  const runByKey = new Map<string, NewsClubRun>();
  for (const run of (doc.fixtures?.runs ?? []) as NewsClubRun[]) {
    runByKey.set(clubKey(run.club), run);
  }

  // Every club the pool actually contains has to resolve, or nobody gets fixtures.
  const poolClubs = new Map<number, string>();
  for (const p of fantasyPool().players) poolClubs.set(p.clubId, p.club);

  const fixtures: Record<number, ContextFixture[]> = {};
  const unmapped: string[] = [];
  for (const [clubId, clubName] of Array.from(poolClubs)) {
    const run = runByKey.get(clubKey(clubName));
    if (!run) { unmapped.push(clubName); continue; }
    const cells = [...(run.cells ?? [])]
      .sort((a, b) => a.gw - b.gw)
      .slice(0, FIXTURE_LOOKAHEAD)
      .map((c) => ({
        gw: c.gw, opp: c.opponent, oppShort: c.oppShort,
        home: c.home, difficulty: c.difficulty,
      }));
    if (cells.length) fixtures[clubId] = cells;
  }
  if (unmapped.length) {
    // Loud, and empty. Half a ticker is indistinguishable from a correct one.
    console.error(`[fantasy-context] no fixture run for: ${unmapped.join(", ")} — serving no fixtures`);
    return { gw: doc.gw, fixtures: {}, doubts: {}, teamNewsAt: doc.teamNews?.updatedAt ?? null };
  }

  // Doubts arrive keyed by SportMonks id; the client speaks pool ids.
  const bySmId = new Map(fantasyPool().players.map((p) => [p.smId, p.id]));
  const doubts: Record<number, string> = {};
  for (const d of (doc.teamNews?.doubts ?? []) as NewsDoubt[]) {
    const poolId = bySmId.get(d.smId);
    if (poolId !== undefined) doubts[poolId] = d.reason;
  }

  return {
    gw: doc.gw,
    fixtures,
    doubts,
    teamNewsAt: doc.teamNews?.updatedAt ?? null,
  };
}
