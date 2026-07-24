import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";

// "Beat someone's score" — quizzes worth walking into versus on, for one user.
// A pack qualifies when OTHER people have real, replayable runs on it (the same
// bar the shadow pool uses: positive score, an answers log ≥3 entries) and the
// user has never attempted it — so the match is guaranteed to fill AND fair
// (they haven't seen the questions). Ranked by recent activity.

// Keep in lockstep with shadow.ts EXCLUDED_RUNNERS (not exported there).
const QA_ACCOUNT_IDS = [
  "cf78de0e-da93-4fb8-b3cd-8865ae0a0814", // hc
  "aa6542bc-ea1d-480c-9070-4a6b79c87381", // hc2
];
const excludedRunners = () =>
  new Set([QUIZ_BOT_ID, ...QA_ACCOUNT_IDS, process.env.HEALTH_BOT_USER_ID ?? ""].filter(Boolean));

export interface RecommendedQuiz {
  packId: string;
  name: string;
  cover: string | null;
  /** The score to chase — the pack's top runner. */
  top: { userId: string; name: string; avatarUrl: string | null; score: number };
  /** Distinct players beyond the top runner. */
  others: number;
  median: number;
  /** Up to 3 recent player faces (top runner first). */
  faces: { userId: string; name: string; avatarUrl: string | null }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export async function getRecommendedQuizzes(db: Db, forUserId: string, limit = 3): Promise<RecommendedQuiz[]> {
  const exclude = excludedRunners();
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const [{ data: mine }, { data: attempts }] = await Promise.all([
    db.from("quiz_attempts").select("pack_id").eq("user_id", forUserId),
    db.from("quiz_attempts")
      .select("pack_id, user_id, score, completed_at, answers")
      .gte("completed_at", since).gt("score", 0)
      .order("completed_at", { ascending: false }).limit(2000),
  ]);
  const minePacks = new Set((mine ?? []).map((a) => a.pack_id));

  // Group replayable runs by pack (same replay bar as the shadow pool).
  interface Run { user_id: string; score: number; at: string }
  const byPack = new Map<string, Run[]>();
  for (const a of attempts ?? []) {
    if (!a.pack_id || minePacks.has(a.pack_id)) continue;
    if (exclude.has(a.user_id) || a.user_id === forUserId) continue;
    if (!Array.isArray(a.answers) || a.answers.length < 3) continue;
    const list = byPack.get(a.pack_id) ?? [];
    list.push({ user_id: a.user_id, score: a.score ?? 0, at: a.completed_at });
    byPack.set(a.pack_id, list);
  }
  if (byPack.size === 0) return [];

  // Rank packs by recent volume, then keep only live ones.
  const ranked = Array.from(byPack.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, limit * 4);
  const { data: packs } = await db.from("quiz_packs")
    .select("id, name, metadata")
    .in("id", ranked.map(([id]) => id))
    .eq("status", "published").eq("rotation_active", true);
  const packById = new Map((packs ?? []).map((p) => [p.id, p]));

  const picks = ranked.filter(([id]) => packById.has(id)).slice(0, limit);
  const userIds = new Set<string>();
  for (const [, runs] of picks) {
    const best = [...runs].sort((x, y) => y.score - x.score)[0];
    userIds.add(best.user_id);
    for (const r of runs.slice(0, 3)) userIds.add(r.user_id);
  }
  const { data: profs } = userIds.size
    ? await db.from("profiles").select("id, display_name, avatar_url").in("id", Array.from(userIds))
    : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
  const profById = new Map((profs ?? []).map((p) => [p.id, p]));
  const face = (id: string) => {
    const p = profById.get(id);
    return { userId: id, name: p?.display_name ?? "Player", avatarUrl: p?.avatar_url ?? null };
  };

  return picks.map(([packId, runs]) => {
    const pack = packById.get(packId)!;
    const meta = (pack.metadata ?? null) as { cover_image?: string } | null;
    const sorted = [...runs].sort((x, y) => y.score - x.score);
    const best = sorted[0];
    const players = new Set(runs.map((r) => r.user_id));
    const faceIds = [best.user_id, ...runs.map((r) => r.user_id).filter((u) => u !== best.user_id)].slice(0, 3);
    return {
      packId,
      name: pack.name,
      cover: meta?.cover_image ?? null,
      top: { ...face(best.user_id), score: best.score },
      others: players.size - 1,
      median: sorted[Math.floor(sorted.length / 2)].score,
      faces: faceIds.map(face),
    };
  });
}
