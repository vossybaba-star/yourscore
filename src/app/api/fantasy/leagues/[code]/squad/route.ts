import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { HttpError } from "@/lib/fantasy/server";
import { loadProfileTeams } from "@/lib/fantasy/profileTeams";

/**
 * GET /api/fantasy/leagues/[code]/squad?user=<uuid> — the CURRENT gameweek's
 * squad for a league-mate (or yourself), for CompareSquadsSheet (Phase 1B).
 *
 * Deliberately separate from viewRun/[code]/run: that route answers "what did
 * their QUIZ round say" (gated until it's locked, post-deadline — the answers
 * would help you cheat if seen early). A picked SQUAD isn't that kind of
 * secret — profileTeams.ts's own doc note is explicit that a submitted team is
 * public immediately (founder, 30 Jul) — so this route only checks the two
 * of you share a league (banter/compare is league-scoped), never a deadline.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const target = req.nextUrl.searchParams.get("user") ?? "";
  return withFantasyUser("league-squad", async (db, userId) => {
    if (!/^[0-9a-f-]{36}$/.test(target)) throw new HttpError(400, "bad user id");
    if (userId !== target) {
      const { data: league } = await db.from("fantasy_leagues")
        .select("id").eq("join_code", params.code.toUpperCase()).maybeSingle();
      if (!league) throw new HttpError(404, "league not found");
      const { data: both } = await db.from("fantasy_league_members")
        .select("user_id").eq("league_id", league.id).in("user_id", [userId, target]);
      if ((both ?? []).length < 2) throw new HttpError(403, "not in this league");
    }
    const { teams, players } = await loadProfileTeams(db, target);
    const team = teams.find((t) => t.current) ?? teams[0] ?? null;
    return { team, players };
  });
}
