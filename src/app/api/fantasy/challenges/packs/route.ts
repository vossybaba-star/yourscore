/** GET /api/fantasy/challenges/packs?game=duel&opponent=<uuid> — the pack
 *  picker for ChallengePrepSheet's Quiz Duel step. Quiz Battle and Gameday
 *  Quiz reuse the challenger's OWN quiz_attempts (an existing scorecard IS
 *  the pack list, per challenges.ts's createScorecardChallenge) — a duel has
 *  no such source, since the whole point is a pack NEITHER side has played,
 *  so this exists purely to answer "which published packs qualify". Not the
 *  cached /api/quiz/packs route: that one is anonymous/edge-cached and can't
 *  exclude the caller's own attempts.
 *
 * `opponent`, when given, also excludes packs THEY'VE attempted — a stricter
 * filter than createChallenge's own validation needs (which only 400s on the
 * pair once a pack is picked), offered here purely so the sheet doesn't hand
 * someone a pack that's going to bounce. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { HttpError } from "@/lib/fantasy/server";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const PACK_LIMIT = 24;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export async function GET(req: NextRequest) {
  const game = req.nextUrl.searchParams.get("game");
  const opponentId = req.nextUrl.searchParams.get("opponent");

  return withFantasyUser("challenges-packs", async (db, userId) => {
    if (game !== "duel") throw new HttpError(400, "unsupported game");

    const attemptedBy = opponentId ? [userId, opponentId] : [userId];
    const { data: attempts } = await db.from("quiz_attempts")
      .select("pack_id").in("user_id", attemptedBy);
    const excludeIds = new Set(((attempts ?? []) as Row[]).map((a) => a.pack_id));

    // Past DUELS never wrote quiz_attempts, but a pack either player has
    // duelled on is just as burned (both saw its answers on the compare
    // screen) — createDuelChallenge rejects these server-side; excluding
    // them here keeps the picker from offering a pack that will bounce.
    const { data: duelPlays } = await db.from("h2h_duel_attempts")
      .select("h2h_id").in("user_id", attemptedBy);
    const duelH2hIds = Array.from(new Set(((duelPlays ?? []) as Row[]).map((d) => d.h2h_id)));
    if (duelH2hIds.length) {
      const { data: duelRows } = await db.from("h2h_challenges")
        .select("quiz_pack_id").in("id", duelH2hIds);
      for (const r of (duelRows ?? []) as Row[]) if (r.quiz_pack_id) excludeIds.add(r.quiz_pack_id);
    }

    // Overfetch a little past the target limit so excluding already-played
    // packs doesn't starve the list down to a handful — cheap either way,
    // this is a small table scan against `status` + an order, not a join.
    const { data: packs } = await db.from("quiz_packs")
      .select("id, name, metadata, question_count")
      .eq("status", "published")
      .order("featured", { ascending: false })
      .order("play_count", { ascending: false })
      .limit(PACK_LIMIT + excludeIds.size);

    const list = ((packs ?? []) as Row[])
      .filter((p) => !excludeIds.has(p.id))
      .slice(0, PACK_LIMIT)
      .map((p) => ({
        packId: p.id as string,
        name: (p.name as string) ?? "Quiz",
        cover: p.metadata?.cover_image ?? null,
        total: (p.question_count as number | null) ?? 0,
      }));

    return { packs: list };
  });
}
