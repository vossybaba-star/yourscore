import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// Community-activity numbers for the Versus tab. ALL numbers the UI shows come
// from here (components never hardcode a figure). Two kinds:
//   • real     — counted from live tables (lobbies, battles, attempts).
//   • softened — where we lack a real signal (presence), a deterministic
//                daily-seeded baseline stands in. Every softened value is
//                marked TODO(real-presence) — replace when presence lands.

export interface VersusActivity {
  /** Players looking for a match right now. Real queues are tiny pre-launch, so
   *  this is floored by a seeded baseline. TODO(real-presence). */
  lookingForMatch: number;
  /** Quiz Battles played today (h2h challenges + completed multiplayer games). Real. */
  battlesToday: number;
  /** Distinct players who played anything today. Real. */
  activeToday: number;
  /** Open public Lobbies joinable right now. Real. */
  openLobbies: number;
  /** Most-attempted quiz of the last 24h. Real (null if nothing qualifies). */
  trending: { packId: string; name: string; attempts: number } | null;
}

export interface ReadyPlayer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  game: "quiz" | "38-0";
  status: "In lobby" | "Online";
  /** Present when the player is hosting an open Lobby — Play deep-joins it. */
  joinCode: string | null;
}

/** Deterministic per-day baseline in [lo, hi] — stable across refreshes so the
 *  number doesn't visibly jump. TODO(real-presence): delete once a real
 *  presence signal (heartbeats / realtime presence) exists. */
function dailyBaseline(salt: string, lo: number, hi: number): number {
  const day = new Date().toISOString().slice(0, 10);
  let h = 0;
  for (const ch of `${day}:${salt}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return lo + (h % (hi - lo + 1));
}

const dayStartIso = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export async function getVersusActivity(): Promise<VersusActivity> {
  const db = createServiceClient();
  const since24h = hoursAgoIso(24);
  const today = dayStartIso();

  const [h2hToday, roomsToday, openLobbies, attempts, queue38, queueQuiz] = await Promise.all([
    db.from("h2h_challenges").select("id", { count: "exact", head: true }).gte("created_at", today),
    db.from("rooms").select("id", { count: "exact", head: true }).eq("status", "completed").gte("created_at", today),
    db.from("rooms").select("id", { count: "exact", head: true }).eq("status", "lobby").eq("room_mode", "open").gte("created_at", hoursAgoIso(3)),
    db.from("quiz_attempts").select("user_id, pack_id").gte("completed_at", since24h).limit(2000),
    db.from("draft_live_queue").select("user_id", { count: "exact", head: true }),
    db.from("quiz_queue").select("user_id", { count: "exact", head: true }).gte("enqueued_at", hoursAgoIso(0.05)),
  ]);

  // Trending = the pack with the most attempts in 24h; active = distinct players.
  const byPack = new Map<string, number>();
  const users = new Set<string>();
  for (const a of attempts.data ?? []) {
    users.add(a.user_id);
    byPack.set(a.pack_id, (byPack.get(a.pack_id) ?? 0) + 1);
  }
  let trending: VersusActivity["trending"] = null;
  const top = Array.from(byPack.entries()).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) {
    const { data: pack } = await db.from("quiz_packs").select("name").eq("id", top[0]).maybeSingle();
    if (pack) trending = { packId: top[0], name: pack.name, attempts: top[1] };
  }

  const realLooking = (queue38.count ?? 0) + (queueQuiz.count ?? 0);
  return {
    // TODO(real-presence): floor by a seeded baseline until presence exists.
    lookingForMatch: Math.max(realLooking, dailyBaseline("looking", 24, 68)),
    battlesToday: (h2hToday.count ?? 0) + (roomsToday.count ?? 0),
    activeToday: users.size,
    openLobbies: openLobbies.count ?? 0,
    trending,
  };
}

/** Suggested opponents: real open-Lobby hosts first (deep-joinable), then
 *  recently-ranked players. These are suggestions, NOT friendships. */
export async function getReadyPlayers(): Promise<ReadyPlayer[]> {
  const db = createServiceClient();
  const out: ReadyPlayer[] = [];
  const seen = new Set<string>();

  // 1. Hosts of open public Lobbies (genuinely joinable right now).
  const { data: lobbies } = await db
    .from("rooms")
    .select("code, created_by")
    .eq("status", "lobby").eq("room_mode", "open")
    .gte("created_at", hoursAgoIso(3))
    .order("created_at", { ascending: false })
    .limit(6);
  const hostIds = Array.from(new Set((lobbies ?? []).map((l) => l.created_by).filter(Boolean))) as string[];
  if (hostIds.length) {
    const { data: profiles } = await db.from("profiles").select("id, display_name, avatar_url").in("id", hostIds);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    for (const l of lobbies ?? []) {
      const p = l.created_by ? byId.get(l.created_by) : null;
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ userId: p.id, name: p.display_name ?? "Player", avatarUrl: p.avatar_url, game: "quiz", status: "In lobby", joinCode: l.code });
    }
  }

  // 2. Fill with active ranked players (challengeable, not deep-joinable).
  type LbRow = { user_id: string; display_name: string; avatar_url: string | null; overall_score: number };
  const { data: lb } = await db.rpc("get_yourscore_leaderboard", { p_user_ids: undefined, p_limit: 30 });
  const candidates = ((lb ?? []) as LbRow[]).filter((r) => (r.overall_score ?? 0) > 0 && !seen.has(r.user_id)).slice(0, 12);
  // Real signal for preferred game: players holding an active 38-0 XI are 38-0 people.
  const { data: teams } = candidates.length
    ? await db.from("draft_teams").select("user_id").eq("status", "active").in("user_id", candidates.map((c) => c.user_id))
    : { data: [] as { user_id: string }[] };
  const has38 = new Set((teams ?? []).map((t) => t.user_id));
  for (const c of candidates.slice(0, 8)) {
    seen.add(c.user_id);
    out.push({
      userId: c.user_id, name: c.display_name, avatarUrl: c.avatar_url,
      game: has38.has(c.user_id) ? "38-0" : "quiz",
      // TODO(real-presence): "Online" is optimistic until a presence signal exists.
      status: "Online", joinCode: null,
    });
  }
  return out.slice(0, 10);
}
