import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Discover public leagues — both game types in one list. A league appears here
// only when its creator flipped it public (is_public, migration 64); featured
// ones (curated) lead. Join codes are included by design: public = joinable.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export interface PublicLeague {
  id: string;
  name: string;
  description: string | null;
  game: "quiz" | "38-0";
  featured: boolean;
  members: number;
  memberAvatars: { id: string; name: string; avatarUrl: string | null }[];
  creator: string | null;
  joinCode: string;
  /** "league" = joinable via code (default). "board" = an official ranked mode
   *  surfaced as a league — the card VIEWs its board instead of joining. */
  kind?: "league" | "board";
  href?: string;
}

/** The WC Mastermind ranked mode IS a league — surface it in Discover with its
 *  REAL player count and top faces. Playing a daily ranked run is the "join". */
async function wcMastermindCard(db: ReturnType<typeof createServiceClient>): Promise<PublicLeague | null> {
  try {
    const { WC_SEASON_START, WC_SEASON_END } = await import("@/lib/draft/wc");
    // RPC not in the generated types (same cast as the wc leaderboard route).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any).rpc("get_wc_daily_leaderboard", {
      p_start: WC_SEASON_START, p_end: WC_SEASON_END, p_limit: 100000,
    });
    const rows = (data ?? []) as { user_id: string; display_name: string; avatar_url: string | null }[];
    if (rows.length === 0) return null;
    return {
      id: "wc-mastermind-board",
      name: "World Cup Mastermind League",
      description: "The official ranked league. One Mastermind run a day — quiz answers power your draft, results go straight on the table.",
      game: "38-0", featured: true, joinCode: "",
      members: rows.length,
      // avatarUrl deliberately null: some ranked players carry external avatar
      // URLs that fail to load here — the seeded monogram never breaks.
      memberAvatars: rows.slice(0, 4).map((r) => ({ id: r.user_id, name: r.display_name, avatarUrl: null })),
      creator: "YourScore",
      kind: "board", href: "/38-0/wc/board",
    };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  try {
    const db = createServiceClient();
    const [quiz, draft, mastermind] = await Promise.all([
      db.from("leagues").select("id, name, code, description, created_by, featured").eq("is_public", true)
        .order("featured", { ascending: false }).order("created_at", { ascending: false }).limit(20),
      db.from("draft_leagues").select("id, name, join_code, owner_id, featured").eq("is_public", true)
        .order("featured", { ascending: false }).order("created_at", { ascending: false }).limit(20),
      wcMastermindCard(db),
    ]);

    type Base = Omit<PublicLeague, "members" | "memberAvatars" | "creator"> & { creatorId: string | null };
    let all: Base[] = [
      ...(quiz.data ?? []).map((l) => ({ id: l.id, name: l.name, description: l.description, game: "quiz" as const, featured: !!l.featured, joinCode: l.code, creatorId: l.created_by })),
      ...(draft.data ?? []).map((l) => ({ id: l.id, name: l.name, description: null, game: "38-0" as const, featured: !!l.featured, joinCode: l.join_code, creatorId: l.owner_id })),
    ];
    if (q) all = all.filter((l) => l.name.toLowerCase().includes(q));
    const official = mastermind && (!q || mastermind.name.toLowerCase().includes(q)) ? [mastermind] : [];
    if (all.length === 0) return NextResponse.json({ leagues: official }, { headers: CACHE_HEADERS });

    // Member counts + a few faces per league, batched (public slice is small).
    const quizIds = all.filter((l) => l.game === "quiz").map((l) => l.id);
    const draftIds = all.filter((l) => l.game === "38-0").map((l) => l.id);
    const [qm, dm] = await Promise.all([
      quizIds.length ? db.from("league_members").select("league_id, user_id").in("league_id", quizIds).limit(2000) : Promise.resolve({ data: [] as { league_id: string; user_id: string }[] }),
      draftIds.length ? db.from("draft_league_members").select("league_id, user_id").in("league_id", draftIds).limit(2000) : Promise.resolve({ data: [] as { league_id: string; user_id: string }[] }),
    ]);
    const membersByLeague = new Map<string, string[]>();
    for (const m of [...(qm.data ?? []), ...(dm.data ?? [])]) {
      const arr = membersByLeague.get(m.league_id) ?? [];
      arr.push(m.user_id);
      membersByLeague.set(m.league_id, arr);
    }

    const faceIds = new Set<string>();
    for (const l of all) {
      for (const uid of (membersByLeague.get(l.id) ?? []).slice(0, 4)) faceIds.add(uid);
      if (l.creatorId) faceIds.add(l.creatorId);
    }
    const { data: profiles } = faceIds.size
      ? await db.from("profiles").select("id, display_name, avatar_url").in("id", Array.from(faceIds))
      : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    const leagues: PublicLeague[] = all.map((l) => {
      const memberIds = membersByLeague.get(l.id) ?? [];
      return {
        id: l.id, name: l.name, description: l.description, game: l.game,
        featured: l.featured, joinCode: l.joinCode,
        members: memberIds.length,
        memberAvatars: memberIds.slice(0, 4).map((uid) => {
          const p = profileById.get(uid);
          return { id: uid, name: p?.display_name ?? "Player", avatarUrl: p?.avatar_url ?? null };
        }),
        creator: l.creatorId ? (profileById.get(l.creatorId)?.display_name ?? null) : null,
      };
    }).sort((a, b) => Number(b.featured) - Number(a.featured) || b.members - a.members);

    // The official board card leads regardless of member-count sorting.
    return NextResponse.json({ leagues: [...official, ...leagues] }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ leagues: [] });
  }
}
