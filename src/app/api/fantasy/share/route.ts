import { withFantasyUser } from "../_lib";
import { HttpError } from "@/lib/fantasy/server";
import { enginePool, gwPrices } from "@/lib/fantasy/pool";
import { faceUrlById } from "@/lib/fantasy/faces";

export const fetchCache = "force-no-store";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const genId = (len = 7) =>
  Array.from({ length: len }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

/**
 * POST — mint a short share link.
 *
 * Two kinds, because for most of the year there is no score to show:
 *
 *   result — your latest scored gameweek. The thing you want to show off.
 *   squad  — the fifteen you picked. The ONLY thing that exists before a ball is
 *            kicked, and therefore the only growth loop available between signup
 *            and the first deadline. The feature shipped with just the first kind,
 *            so a manager who built a squad in July had nothing to send anyone
 *            for a month.
 *
 * Defaults to the result when one exists and falls back to the squad, so the
 * button never has to know which season it is. Server-authoritative either way:
 * the payload is built from our own rows, never from the client, so a card can't
 * claim a score or a squad that wasn't earned. Piggybacks on draft_shares like
 * the quiz cards do — one short-link table for everything.
 */
export async function POST(req: Request) {
  return withFantasyUser("share", async (db, userId) => {
    const body = await req.json().catch(() => ({}));
    const want = (body as { kind?: string }).kind;
    // Share ANY manager's squad from the feed — a squad is public (it's on their
    // profile and in the feed), so a share card of it is fine. When a target is
    // given we always mint the SQUAD card for THEM (never their scores).
    const target = (typeof (body as { userId?: string }).userId === "string" && (body as { userId: string }).userId) || userId;
    const squadOnly = want === "squad" || target !== userId;

    // Latest scored gameweek — the thing you'd actually want to show off.
    const { data: entry } = squadOnly ? { data: null } : await db.from("fantasy_entries")
      .select("gw, points, points_breakdown, captain_used")
      .eq("user_id", userId).not("scored_at", "is", null)
      .order("gw", { ascending: false }).limit(1).maybeSingle();

    const { data: prof } = await db.from("profiles")
      .select("display_name, username").eq("id", target).maybeSingle();
    const nameOf = new Map(enginePool().map((p) => [p.id, p.name]));
    const who = (prof?.display_name ?? prof?.username ?? "").slice(0, 24);

    const payload: Record<string, string> = {};

    if (!entry) {
      // ── the squad card ──────────────────────────────────────────────────
      const { data: squad } = await db.from("fantasy_squads")
        .select("picks, xi, captain, bank_tenths").eq("user_id", target).maybeSingle();
      if (!squad) throw new HttpError(409, "build a squad first", "no-squad");

      const pool = new Map(enginePool().map((p) => [p.id, p]));
      const posRank: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
      const xi = ((squad.xi ?? []) as number[])
        .map((id) => pool.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .sort((a, b) => (posRank[a.pos] ?? 9) - (posRank[b.pos] ?? 9));
      if (!xi.length) throw new HttpError(409, "build a squad first", "no-squad");

      const { data: gw } = await db.from("fantasy_gameweeks")
        .select("gw").eq("mode", "live").neq("status", "final")
        .order("gw", { ascending: true }).limit(1).maybeSingle();

      // The share card draws the REAL pitch (portraits + crests + price), so bake
      // each player's headshot and live price into the chunk. Live price off this
      // gameweek's snapshot, so the per-player prices agree with the "spent" total;
      // a player with no snapshot keeps his seed price. Shape: "POS~Name~Club~face~priceTenths".
      const priceOf = gw ? await gwPrices(db, gw.gw) : new Map<number, number>();
      payload.fsq = "1";
      payload.fxi = xi.map((p) => {
        const pt = priceOf.get(p.id) ?? p.priceTenths;
        return `${p.pos}~${p.name}~${p.club}~${faceUrlById(p.id) ?? ""}~${pt}`;
      }).join("|");
      payload.fcapn = nameOf.get(squad.captain) ?? "";
      payload.fval = String(1000 - (squad.bank_tenths ?? 0));
      if (gw) payload.fgw1 = String(gw.gw);
      if (who) payload.fname = who;
    } else {
      // ── the result card ─────────────────────────────────────────────────
      const breakdown = (entry.points_breakdown ?? []) as { id: number; points: number; captain: boolean }[];
      const cap = breakdown.find((b) => b.captain);
      const top = [...breakdown].sort((a, b) => b.points - a.points)[0];

      payload.fgw = String(entry.gw);
      payload.fpts = String(entry.points ?? 0);
      payload.fname = who;
      if (cap) payload.fcap = `${nameOf.get(cap.id) ?? ""}~${cap.points}`;
      if (top) payload.ftop = `${nameOf.get(top.id) ?? ""}~${top.points}`;
    }

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
