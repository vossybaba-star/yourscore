import "server-only";
/**
 * Managers to follow — with a REASON, not just a list of usernames (founder, 2
 * Aug). For each candidate we work out why the viewer would care: shared picks,
 * a headline player in common, or a freshly-picked squad. The best few come back
 * with their squad as a board so the discover page reads as activity, not a
 * directory. Each carries their captain's-club crest (no stored favourite club).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientPool } from "./pool";
import { pitchName, type BoardPlayer } from "./board";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface DiscoverBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain: number | null; vice: number | null }
export interface DiscoverManager {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Captain's club — the crest beside them. */
  club: string | null;
  /** Why follow: "3 of your players", "Also picked Haaland", "Just picked their squad". */
  reason: string;
  /** How many of the viewer's XI they also own — drives ranking + the top tiles. */
  shared: number;
  /** Public follow graph counts. */
  followers: number;
  following: number;
  /** Their squad as a board, so a suggestion can render as an activity tile. */
  board: DiscoverBoard | null;
  /** Disclosure flag (Trust sprint 1) — true for a synthetic community
   *  account (`profiles.source === "bot"`). Drives the "YourScore community
   *  account" label — never a hardcoded id list. */
  isCommunity: boolean;
}

export async function fantasyDiscover(db: Db, userId: string, limit = 16): Promise<DiscoverManager[]> {
  const [{ data: follows }, { data: mySquad }] = await Promise.all([
    db.from("user_follows").select("followee_id").eq("follower_id", userId),
    db.from("fantasy_squads").select("xi, captain").eq("user_id", userId).maybeSingle(),
  ]);
  const followed = new Set(((follows ?? []) as { followee_id: string }[]).map((f) => f.followee_id));
  followed.add(userId);
  const myXi = new Set<number>(mySquad && Array.isArray((mySquad as { xi?: number[] }).xi) ? (mySquad as { xi: number[] }).xi : []);
  const myCap = (mySquad as { captain?: number | null } | null)?.captain ?? null;

  // Every manager with a squad, minus me and the people I already follow.
  const { data: squads } = await db.from("fantasy_squads")
    .select("user_id, xi, bench, captain, vice, created_at").range(0, 999);
  const rows = ((squads ?? []) as { user_id: string; xi: number[]; bench: number[] | null; captain: number | null; vice: number | null; created_at: string }[])
    .filter((s) => !followed.has(s.user_id) && Array.isArray(s.xi) && s.xi.length > 0);
  if (!rows.length) return [];

  const ids = rows.map((s) => s.user_id);
  const [{ data: profs }, { data: followerRows }, { data: followingRows }] = await Promise.all([
    db.from("profiles").select("id, display_name, username, avatar_url, source").in("id", ids),
    db.from("user_follows").select("followee_id").in("followee_id", ids),
    db.from("user_follows").select("follower_id").in("follower_id", ids),
  ]);
  const profById = new Map<string, { display_name: string | null; username: string | null; avatar_url: string | null; source: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => profById.set(p.id, p));
  const followerCount = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (followerRows ?? []).forEach((r: any) => followerCount.set(r.followee_id, (followerCount.get(r.followee_id) ?? 0) + 1));
  const followingCount = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (followingRows ?? []).forEach((r: any) => followingCount.set(r.follower_id, (followingCount.get(r.follower_id) ?? 0) + 1));

  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));
  const markerOf = (id: number): BoardPlayer => {
    const p = poolById.get(id);
    return { id, name: p?.name ?? `#${id}`, label: pitchName(p?.name ?? `#${id}`), pos: (p?.pos ?? "MID") as BoardPlayer["pos"], club: p?.club, avatarUrl: p?.avatarUrl ?? null };
  };

  const myCapName = myCap != null ? (poolById.get(myCap)?.name ?? null) : null;
  const managers: DiscoverManager[] = rows.map((s) => {
    const shareIds = s.xi.filter((id) => myXi.has(id));
    const shared = shareIds.length;
    // Name a shared player that VARIES per manager, so the hooks read as
    // considered rather than "3 of your players" over and over.
    const hash = s.user_id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const named = shared ? (poolById.get(shareIds[hash % shared])?.name ?? null) : null;
    const capMatch = myCap != null && s.captain === myCap;
    const reason = shared >= 2 && named ? `You both picked ${named}${shared > 2 ? ` +${shared - 1} more` : ""}`
      : shared === 1 && named ? `Also picked ${named}`
      : capMatch && myCapName ? `Captaining ${myCapName} too`
      : "Just picked their squad";
    const prof = profById.get(s.user_id);
    const bench = Array.isArray(s.bench) ? s.bench : [];
    return {
      userId: s.user_id,
      username: prof?.username ?? null,
      displayName: prof?.display_name ?? "A manager",
      avatarUrl: prof?.avatar_url ?? null,
      club: s.captain != null ? (poolById.get(s.captain)?.club ?? null) : null,
      reason, shared,
      followers: followerCount.get(s.user_id) ?? 0,
      following: followingCount.get(s.user_id) ?? 0,
      board: { players: [...s.xi, ...bench].map(markerOf), xi: s.xi, bench, captain: s.captain, vice: s.vice },
      isCommunity: prof?.source === "bot",
    };
  });

  // Most relevant first: shared picks, then a real squad to show, then name.
  managers.sort((a, b) => b.shared - a.shared || (b.board ? 1 : 0) - (a.board ? 1 : 0) || a.displayName.localeCompare(b.displayName));
  return managers.slice(0, limit);
}
