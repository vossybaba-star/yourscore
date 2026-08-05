import { NextRequest } from "next/server";
import { withFantasyUser } from "../../_lib";
import { syntheticActors } from "@/lib/fantasy/feed";

/**
 * Search users by username or display name — to find someone to follow,
 * invite to a league (founder, 3 Aug), or @mention in a post/comment (Social
 * Phase 3b, AC3). Self excluded, users without a handle excluded (a mention
 * needs a real @handle to insert), synthetic/health-check accounts excluded.
 * Signed-in + rate-limited via withFantasyUser.
 *
 * Prefix match (not substring) and an optional `limit` — the mention
 * composer calls `?limit=8` (AC3's cap); Discover's own search leaves it off
 * and gets the pre-existing 20.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withFantasyUser("users-search", async (db, userId) => {
    const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
    // Usernames are [a-z0-9_]; strip anything else so the pattern can't break
    // the filter or smuggle wildcards. display_name is freer text, so only
    // strip the characters that would break PostgREST's .or() filter syntax.
    const cleanUsername = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
    const cleanDisplay = raw.replace(/[,()%*]/g, "").slice(0, 30);
    if (cleanUsername.length < 2 && cleanDisplay.length < 2) return { users: [] };

    const limitParam = Number(req.nextUrl.searchParams.get("limit"));
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 20;

    let query = db
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .neq("id", userId)
      .not("username", "is", null);
    query = cleanUsername.length >= 2 && cleanDisplay.length >= 2
      ? query.or(`username.ilike.${cleanUsername}%,display_name.ilike.${cleanDisplay}%`)
      : cleanUsername.length >= 2
        ? query.ilike("username", `${cleanUsername}%`)
        : query.ilike("display_name", `${cleanDisplay}%`);

    const { data } = await query.order("username", { ascending: true }).limit(limit + 5); // headroom for the bot filter below

    const bots = syntheticActors();
    const users = (data ?? [])
      .filter((p: { id: string }) => !bots.has(p.id))
      .slice(0, limit)
      .map((p: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }) => ({
        userId: p.id,
        username: p.username,
        displayName: p.display_name ?? (p.username ? `@${p.username}` : "Player"),
        avatarUrl: p.avatar_url,
      }));
    return { users };
  });
}
