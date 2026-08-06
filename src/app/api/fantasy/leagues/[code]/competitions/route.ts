/** GET  /api/fantasy/leagues/[code]/competitions — active + recent league
 *  competitions (competitionsForLeague). Member-only (resolved internally,
 *  same as leagueGamesOverview/leagueChat).
 *  POST /api/fantasy/leagues/[code]/competitions — league-owner-only admin
 *  create. Rate-limited on top of withFantasyUser's own per-op cap, same
 *  pattern as /api/fantasy/challenges' create route (a competition, like a
 *  challenge, reaches every other league member — not just the caller). */
import { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { competitionsForLeague, createCompetition, resolveLeagueByCode } from "@/lib/fantasy/competitions";
import { competitionFormat } from "@/lib/fantasy/competitionFormats";
import { HttpError } from "@/lib/fantasy/server";
import { rateLimitDistributed } from "@/lib/ratelimit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("competitions-list", (db, userId) => competitionsForLeague(db, userId, params.code));
}

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("competitions-create", async (db, userId) => {
    const { ok } = await rateLimitDistributed(`competition-create:${userId}`, 5, 3_600_000);
    if (!ok) throw new HttpError(429, "Easy, friend. Give it a moment before the next competition.");

    const league = await resolveLeagueByCode(db, params.code, userId);

    const format = typeof body.format === "string" ? body.format : "";
    const fmt = competitionFormat(format);
    if (!fmt || !fmt.supported) throw new HttpError(400, "That competition format isn't available yet");

    const packId = typeof body.packId === "string" ? body.packId : null;
    const targetScore = typeof body.targetScore === "number" ? body.targetScore : null;
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 140) : fmt.name;

    const now = Date.now();
    const opensAt = typeof body.opensAt === "string" ? body.opensAt : new Date(now).toISOString();
    const closesAt = typeof body.closesAt === "string" ? body.closesAt : new Date(now + DEFAULT_WINDOW_MS).toISOString();

    return createCompetition(db, {
      leagueId: league.id, source: "admin", createdBy: userId, format: fmt.id,
      packId, targetScore, title, opensAt, closesAt,
    });
  });
}
