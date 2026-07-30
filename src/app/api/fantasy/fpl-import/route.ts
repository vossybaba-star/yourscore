/** Import an existing FPL squad by team ID. Read-only + stateless: we fetch
 *  from the public FPL API, map it onto our pool, and hand the shape back —
 *  nothing here touches the DB or writes a squad. That happens later, through
 *  the normal squad route, when the user confirms.
 *
 *  Privacy: FPL's entry payload carries player_first_name/player_last_name.
 *  We never read, log, or return them — only the TEAM name (entry.name),
 *  which is what a manager chose to call his side. */
import { NextRequest } from "next/server";
import { withFantasyUser } from "../_lib";
import { HttpError } from "@/lib/fantasy/server";
import { enginePool } from "@/lib/fantasy/pool";
import { mapFplPicks, parseTeamId, type FplPick } from "@/lib/fantasy/fplImport";
import { fetchFplBootstrapCached } from "@/lib/gates/fpl";

export const fetchCache = "force-no-store";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FPL_TIMEOUT_MS = 8000;
const POS_BY_TYPE: Record<number, string> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

interface FplEntry { name: string; current_event: number | null }
interface FplPicksResponse { picks: FplPick[] }

/** A network failure (timeout, DNS, refused) becomes the same 502 as a bad
 *  HTTP status — the user never sees the difference, both mean "try later". */
async function fplFetch(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FPL_TIMEOUT_MS),
      headers: { "User-Agent": UA },
    });
  } catch {
    throw new HttpError(502, "could not reach FPL, try again shortly");
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | null;
  if (body === null) throw new HttpError(502, "could not reach FPL, try again shortly");
  return body;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("fpl-import", async () => {
    const teamId = parseTeamId(String((body as { teamId?: unknown })?.teamId ?? ""));
    if (teamId === null) throw new HttpError(400, "that team ID does not look right");

    const entryRes = await fplFetch(`https://fantasy.premierleague.com/api/entry/${teamId}/`);
    if (entryRes.status === 404) throw new HttpError(404, "no FPL team with that ID");
    if (!entryRes.ok) throw new HttpError(502, "could not reach FPL, try again shortly");
    const entry = await readJson<FplEntry>(entryRes);

    if (entry.current_event == null)
      return { ready: false as const, teamName: entry.name, reason: "preseason" as const };

    const picksRes = await fplFetch(
      `https://fantasy.premierleague.com/api/entry/${teamId}/event/${entry.current_event}/picks/`);
    // Squads stay private until the deadline passes — FPL 404s the picks endpoint
    // for a gameweek that hasn't locked yet, even though the entry itself exists.
    if (picksRes.status === 404)
      return { ready: false as const, teamName: entry.name, reason: "locked" as const };
    if (!picksRes.ok) throw new HttpError(502, "could not reach FPL, try again shortly");
    const picksBody = await readJson<FplPicksResponse>(picksRes);

    const poolIds = new Set(enginePool().map((p) => p.id));
    const { pickIds, missingIds, selection } = mapFplPicks(picksBody.picks ?? [], poolIds);

    // Naming a miss needs the whole-league bootstrap feed, so it's only fetched
    // when there's actually a gap to explain — most imports never pay for it.
    // fetchFplBootstrapCached() already carries its own 6-hour edge cache and
    // degrades to null on failure (src/lib/gates/fpl.ts), so a bootstrap outage
    // never blocks the import — the gap just loses its label.
    let missing: { name: string; pos: string; club: string }[] = [];
    if (missingIds.length) {
      const bootstrap = await fetchFplBootstrapCached();
      const elementById = new Map((bootstrap?.elements ?? []).map((e) => [e.id, e]));
      const teamById = new Map((bootstrap?.teams ?? []).map((t) => [t.id, t]));
      missing = missingIds.map((id) => {
        const el = elementById.get(id);
        return {
          name: el?.web_name ?? `#${id}`,
          pos: el ? POS_BY_TYPE[el.element_type] ?? "?" : "?",
          club: el ? teamById.get(el.team)?.short_name ?? "?" : "?",
        };
      });
    }

    return {
      ready: true as const,
      teamName: entry.name,
      event: entry.current_event,
      pickIds,
      selection,
      missing,
    };
  });
}
