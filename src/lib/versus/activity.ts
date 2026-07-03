import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";

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
  trending: { packId: string; name: string; cover: string | null; attempts: number } | null;
  /** Busiest player of the last 24h (community-highlights carousel). Real. */
  mostActive: { userId: string; name: string; avatarUrl: string | null; plays: number } | null;
  /** Recent finished matches across both games — the community-highlights feed.
   *  Real results only (bot-vs-QA noise excluded); newest first. */
  feed: VersusFeedItem[];
}

export interface VersusFeedItem {
  game: "quiz" | "38-0";
  when: string;
  /** Quiz items carry the pack so the CTA can start a match on the same quiz. */
  packId: string | null;
  packName: string | null;
  /** a = winner (or home side on a draw), b = the beaten side. */
  a: { id: string | null; name: string; avatarUrl: string | null; score: number };
  b: { id: string | null; name: string; avatarUrl: string | null; score: number };
  /** Quiz only: side b was a real player's replayed run (shadow match). */
  shadow: boolean;
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

  const [h2hToday, roomsToday, openLobbies, attempts, queue38, queueQuiz, feedRooms, feedMatches] = await Promise.all([
    db.from("h2h_challenges").select("id", { count: "exact", head: true }).gte("created_at", today),
    db.from("rooms").select("id", { count: "exact", head: true }).eq("status", "completed").gte("created_at", today),
    db.from("rooms").select("id", { count: "exact", head: true }).eq("status", "lobby").eq("room_mode", "open").gte("created_at", hoursAgoIso(3)),
    db.from("quiz_attempts").select("user_id, pack_id").gte("completed_at", since24h).limit(2000),
    db.from("draft_live_queue").select("user_id", { count: "exact", head: true }),
    db.from("quiz_queue").select("user_id", { count: "exact", head: true }).gte("enqueued_at", hoursAgoIso(0.05)),
    db.from("rooms").select("id, created_at, pack_id, shadow, created_by")
      .eq("status", "completed").eq("room_mode", "h2h").gte("created_at", hoursAgoIso(48))
      .order("created_at", { ascending: false }).limit(14),
    db.from("draft_live_matches").select("p1_id, p2_id, p1_name, p2_name, h1_p1, h1_p2, h2_p1, h2_p2, resolved_at")
      .not("resolved_at", "is", null).gte("resolved_at", hoursAgoIso(48))
      .order("resolved_at", { ascending: false }).limit(10),
  ]);

  // Trending = the pack with the most attempts in 24h; active = distinct
  // players; mostActive = the busiest human of the last 24h (bots excluded).
  const botIds = new Set([QUIZ_BOT_ID, process.env.HEALTH_BOT_USER_ID ?? ""].filter(Boolean));
  const byPack = new Map<string, number>();
  const byUser = new Map<string, number>();
  const users = new Set<string>();
  for (const a of attempts.data ?? []) {
    users.add(a.user_id);
    byPack.set(a.pack_id, (byPack.get(a.pack_id) ?? 0) + 1);
    if (!botIds.has(a.user_id)) byUser.set(a.user_id, (byUser.get(a.user_id) ?? 0) + 1);
  }

  let trending: VersusActivity["trending"] = null;
  const top = Array.from(byPack.entries()).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) {
    const { data: pack } = await db.from("quiz_packs").select("name, metadata").eq("id", top[0]).maybeSingle();
    const meta = (pack?.metadata ?? null) as { cover_image?: string } | null;
    if (pack) trending = { packId: top[0], name: pack.name, cover: meta?.cover_image ?? null, attempts: top[1] };
  }

  let mostActive: VersusActivity["mostActive"] = null;
  const busiest = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] >= 2) {
    const { data: p } = await db.from("profiles").select("display_name, avatar_url").eq("id", busiest[0]).maybeSingle();
    if (p) mostActive = { userId: busiest[0], name: p.display_name ?? "Player", avatarUrl: p.avatar_url, plays: busiest[1] };
  }

  const feed = await buildFeed(
    db, botIds,
    (feedRooms.data ?? []) as FeedRoomRow[],
    (feedMatches.data ?? []) as FeedMatchRow[],
  );

  const realLooking = (queue38.count ?? 0) + (queueQuiz.count ?? 0);
  return {
    // TODO(real-presence): floor by a seeded baseline until presence exists.
    lookingForMatch: Math.max(realLooking, dailyBaseline("looking", 24, 68)),
    battlesToday: (h2hToday.count ?? 0) + (roomsToday.count ?? 0),
    activeToday: users.size,
    openLobbies: openLobbies.count ?? 0,
    trending,
    mostActive,
    feed,
  };
}

// ── The results feed behind Community Highlights ──────────────────────────────

type FeedRoomRow = {
  id: string; created_at: string; pack_id: string | null; created_by: string | null;
  shadow: { userId?: string; name?: string; avatarUrl?: string | null } | null;
};
type FeedMatchRow = {
  p1_id: string | null; p2_id: string | null; p1_name: string | null; p2_name: string | null;
  h1_p1: number | null; h1_p2: number | null; h2_p1: number | null; h2_p2: number | null;
  resolved_at: string | null;
};

/** Recent real results, both games, newest first. Quiz Battles come from
 *  completed h2h Lobbies (CPU-only rooms are skipped; shadow rooms show the
 *  run owner's persona — that IS a real player's result). 38-0 comes from
 *  resolved live matches, using the names the match itself displayed. */
async function buildFeed(
  db: ReturnType<typeof createServiceClient>, botIds: Set<string>,
  rooms: FeedRoomRow[], matches: FeedMatchRow[],
): Promise<VersusFeedItem[]> {
  const items: VersusFeedItem[] = [];

  // Quiz Battles — scores + human names for the recent completed h2h rooms.
  const roomIds = rooms.map((r) => r.id);
  const { data: scores } = roomIds.length
    ? await db.from("room_scores").select("room_id, user_id, total_score").in("room_id", roomIds)
    : { data: [] as { room_id: string; user_id: string; total_score: number }[] };
  const byRoom = new Map<string, { user_id: string; total_score: number }[]>();
  const humanIds = new Set<string>();
  for (const s of scores ?? []) {
    if (!s.room_id || !s.user_id) continue;
    const list = byRoom.get(s.room_id) ?? [];
    list.push({ user_id: s.user_id, total_score: s.total_score ?? 0 });
    byRoom.set(s.room_id, list);
    if (!botIds.has(s.user_id) && s.user_id !== QUIZ_BOT_ID) humanIds.add(s.user_id);
  }
  const packIds = Array.from(new Set(rooms.map((r) => r.pack_id).filter(Boolean))) as string[];
  const [{ data: profs }, { data: packs }] = await Promise.all([
    humanIds.size
      ? db.from("profiles").select("id, display_name, avatar_url").in("id", Array.from(humanIds))
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] }),
    packIds.length
      ? db.from("quiz_packs").select("id, name").in("id", packIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const profById = new Map((profs ?? []).map((p) => [p.id, p]));
  const packById = new Map((packs ?? []).map((p) => [p.id, p.name]));

  for (const r of rooms) {
    const rows = byRoom.get(r.id) ?? [];
    if (rows.length < 2) continue;
    // QA/health-bot rooms are noise, never highlights.
    if (rows.some((s) => botIds.has(s.user_id)) || (r.created_by && botIds.has(r.created_by))) continue;
    if (r.shadow?.userId && botIds.has(r.shadow.userId)) continue;

    const sides: VersusFeedItem["a"][] = [];
    let shadow = false;
    for (const s of rows.slice(0, 2)) {
      if (s.user_id === QUIZ_BOT_ID) {
        if (!r.shadow?.name) { sides.length = 0; break; } // pure CPU seat — skip the room
        shadow = true;
        sides.push({ id: r.shadow.userId ?? null, name: r.shadow.name, avatarUrl: r.shadow.avatarUrl ?? null, score: s.total_score });
      } else {
        const p = profById.get(s.user_id);
        sides.push({ id: s.user_id, name: p?.display_name ?? "Player", avatarUrl: p?.avatar_url ?? null, score: s.total_score });
      }
    }
    if (sides.length < 2) continue;
    sides.sort((x, y) => y.score - x.score);
    items.push({
      game: "quiz", when: r.created_at, packId: r.pack_id,
      packName: r.pack_id ? packById.get(r.pack_id) ?? null : null,
      a: sides[0], b: sides[1], shadow,
    });
  }

  // 38-0 — resolved live matches, with the names the match displayed.
  for (const m of matches) {
    if (!m.resolved_at || !m.p1_name || !m.p2_name) continue;
    if ((m.p1_id && botIds.has(m.p1_id)) || (m.p2_id && botIds.has(m.p2_id))) continue;
    const g1 = (m.h1_p1 ?? 0) + (m.h2_p1 ?? 0);
    const g2 = (m.h1_p2 ?? 0) + (m.h2_p2 ?? 0);
    const p1 = { id: m.p1_id, name: m.p1_name, avatarUrl: null, score: g1 };
    const p2 = { id: m.p2_id, name: m.p2_name, avatarUrl: null, score: g2 };
    const [a, b] = g2 > g1 ? [p2, p1] : [p1, p2];
    items.push({ game: "38-0", when: m.resolved_at, packId: null, packName: null, a, b, shadow: false });
  }

  return items.sort((x, y) => y.when.localeCompare(x.when)).slice(0, 8);
}
