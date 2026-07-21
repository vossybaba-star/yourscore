import { withFantasyUser } from "../_lib";
import { HttpError } from "@/lib/fantasy/server";
import { enginePool } from "@/lib/fantasy/pool";

export const fetchCache = "force-no-store";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const genId = (len = 7) =>
  Array.from({ length: len }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

/**
 * POST — mint a short share link for YOUR latest scored gameweek.
 *
 * Server-authoritative: the payload is built from the entry row, never from the
 * client, so a share card can't claim a score that wasn't earned. Piggybacks on
 * draft_shares like the quiz cards do — one short-link table for everything.
 */
export async function POST() {
  return withFantasyUser("share", async (db, userId) => {
    // Latest scored gameweek — the thing you'd actually want to show off.
    const { data: entry } = await db.from("fantasy_entries")
      .select("gw, points, points_breakdown, captain_used")
      .eq("user_id", userId).not("scored_at", "is", null)
      .order("gw", { ascending: false }).limit(1).maybeSingle();
    if (!entry) throw new HttpError(409, "no scored gameweek to share yet", "no-result");

    const { data: prof } = await db.from("profiles")
      .select("display_name, username").eq("id", userId).maybeSingle();
    const nameOf = new Map(enginePool().map((p) => [p.id, p.name]));

    const breakdown = (entry.points_breakdown ?? []) as { id: number; points: number; captain: boolean }[];
    const cap = breakdown.find((b) => b.captain);
    const top = [...breakdown].sort((a, b) => b.points - a.points)[0];

    const payload: Record<string, string> = {
      fgw: String(entry.gw),
      fpts: String(entry.points ?? 0),
      fname: (prof?.display_name ?? prof?.username ?? "").slice(0, 24),
    };
    if (cap) payload.fcap = `${nameOf.get(cap.id) ?? ""}~${cap.points}`;
    if (top) payload.ftop = `${nameOf.get(top.id) ?? ""}~${top.points}`;

    for (let attempt = 0; attempt < 6; attempt++) {
      const id = genId();
      const { error } = await db.from("draft_shares").insert({ id, payload });
      if (!error) return { id, url: `/s/${id}` };
      if ((error as { code?: string }).code !== "23505") break;
    }
    throw new HttpError(500, "could not create link");
  });
}

// No GET: minting a row on GET would let link prefetchers create shares.
export const dynamic = "force-dynamic";
