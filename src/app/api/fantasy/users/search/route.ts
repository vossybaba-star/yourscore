import { NextRequest } from "next/server";
import { withFantasyUser } from "../../_lib";

/**
 * Search users by username — to find someone to follow or invite to a league
 * (founder, 3 Aug). Username-only match (the searchable handle), self excluded,
 * users without a handle excluded. Signed-in + rate-limited via withFantasyUser.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withFantasyUser("users-search", async (db, userId) => {
    // Usernames are [a-z0-9_]; strip anything else so the pattern can't break the
    // filter or smuggle wildcards.
    const raw = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const clean = raw.replace(/[^a-z0-9_]/g, "").slice(0, 30);
    if (clean.length < 2) return { users: [] };

    const { data } = await db
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .ilike("username", `%${clean}%`)
      .neq("id", userId)
      .not("username", "is", null)
      .order("username", { ascending: true })
      .limit(20);

    const users = (data ?? []).map((p: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }) => ({
      userId: p.id,
      username: p.username,
      displayName: p.display_name ?? (p.username ? `@${p.username}` : "Player"),
      avatarUrl: p.avatar_url,
    }));
    return { users };
  });
}
