import { NextRequest } from "next/server";
import { withFantasyUser } from "../../_lib";
import { syntheticActors } from "@/lib/fantasy/feed";
import { blockedActorIds } from "@/lib/social/safety";

/**
 * Search users by username or display name — to find someone to follow,
 * invite to a league (founder, 3 Aug), or @mention in a post/comment (Social
 * Phase 3b, AC3). Self excluded, users without a handle excluded (a mention
 * needs a real @handle to insert), synthetic/health-check accounts excluded,
 * and (Phase 1A) a blocked account — either direction — excluded from BOTH
 * modes: a block is the "never appears, anywhere" rule, unlike a mute (which
 * only ever hides feed/chat CONTENT, never search/autocomplete surfaces —
 * see blockedActorIds' own comment in lib/social/safety.ts). Signed-in +
 * rate-limited via withFantasyUser.
 *
 * Match mode is caller-gated (shared-surface rule): Discover keeps its
 * pre-existing SUBSTRING match untouched; the mention composer passes
 * `mode=mention` for prefix matching (an @handle is typed left to right) and
 * additionally ranks a followed account ahead of everyone else (Phase 1A) —
 * alphabetical within each group, since the query itself is already
 * username-ordered, a stable partition keeps that order inside both halves.
 * Optional `limit` — mentions pass 8, Discover keeps the pre-existing 20.
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
    // Prefix for mentions, substring for Discover (its long-standing behaviour).
    const prefix = req.nextUrl.searchParams.get("mode") === "mention";
    const uPat = prefix ? `${cleanUsername}%` : `%${cleanUsername}%`;
    const dPat = prefix ? `${cleanDisplay}%` : `%${cleanDisplay}%`;
    query = cleanUsername.length >= 2 && cleanDisplay.length >= 2
      ? query.or(`username.ilike.${uPat},display_name.ilike.${dPat}`)
      : cleanUsername.length >= 2
        ? query.ilike("username", uPat)
        : query.ilike("display_name", dPat);

    // Headroom for the bot/block filters below — and in mention mode, enough
    // window for the followed-first partition to actually SEE a followed
    // account whose username sorts late (a `limit + 5` window would rank
    // followed-first only among the alphabetically earliest matches).
    const { data } = await query.order("username", { ascending: true }).limit(prefix ? limit + 40 : limit + 5);

    const bots = syntheticActors();
    const blocked = await blockedActorIds(db, userId);
    type Row = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };
    let candidates = (data ?? []).filter((p: Row) => !bots.has(p.id) && !blocked.has(p.id));

    if (prefix) {
      // Rank followed users first (AC4) — one extra query, alphabetical
      // within each group (candidates already come back username-ordered
      // from the query above, so a stable partition preserves that order on
      // both sides of the split).
      const { data: followRows } = await db.from("user_follows").select("followee_id").eq("follower_id", userId);
      const followed = new Set(((followRows ?? []) as { followee_id: string }[]).map((f) => f.followee_id));
      candidates = [...candidates.filter((p: Row) => followed.has(p.id)), ...candidates.filter((p: Row) => !followed.has(p.id))];
    }

    const users = candidates
      .slice(0, limit)
      .map((p: Row) => ({
        userId: p.id,
        username: p.username,
        displayName: p.display_name ?? (p.username ? `@${p.username}` : "Player"),
        avatarUrl: p.avatar_url,
      }));
    return { users };
  });
}
