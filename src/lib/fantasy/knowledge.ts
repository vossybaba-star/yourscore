import "server-only";
/**
 * The knowledge rating — the SEPARATE competition, climbing on round accuracy
 * alone (D:177-180). A brilliant round is never wasted on an unlucky football
 * weekend: it scores here whatever your team did. It is also the tiebreak on
 * the fantasy tables, and the counterweight to the cash-out's monthly tilt —
 * quiz prestige lives on this board, not in the fantasy points.
 *
 * Sum-on-read from fantasy_entries.round_correct (house rule: never materialise
 * a total — the same property that keeps the league tables rescore-safe).
 * A rolled-over week simply isn't a row here: you played or you didn't.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupGwsByMonth, monthKeyOf, monthLabel } from "./months";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export type KnowledgeCut = "week" | "month" | "season";

export interface KnowledgeRow {
  rank: number;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  correct: number;   // total right answers in the cut
  rounds: number;    // rounds played in the cut
  accuracy: number;  // 0-100, correct / (rounds × 11)
  isMe: boolean;
}

interface GwRow { gw: number; mode: string; status: string; deadline: string | null; window_start: string }

/** Which gameweeks belong to the cut. Live rows win outright (the gws[0] trap). */
async function cutGws(db: Db, cut: KnowledgeCut): Promise<{ gws: number[]; label: string }> {
  const { data } = await db.from("fantasy_gameweeks")
    .select("gw, mode, status, deadline, window_start").order("gw", { ascending: true });
  const all = (data ?? []) as GwRow[];
  const live = all.filter((g) => g.mode === "live");
  const rows = live.length ? live : all;
  if (!rows.length) return { gws: [], label: "" };
  const current = rows.find((g) => g.status !== "final") ?? rows[rows.length - 1];

  if (cut === "week") return { gws: [current.gw], label: `Gameweek ${current.gw}` };
  if (cut === "month") {
    const key = monthKeyOf(current);
    const byMonth = groupGwsByMonth(rows);
    return { gws: (byMonth.get(key) ?? []).slice().sort((a, b) => a - b), label: monthLabel(key) };
  }
  return { gws: rows.map((g) => g.gw), label: "Season" };
}

/**
 * The board. Ordering: most right answers, then ACCURACY (a 9/11 from two rounds
 * beats a 9/11 from five), then who got there first. Strict 1..n ranks (house
 * style — no shared ranks).
 */
export async function knowledgeBoard(
  db: Db, cut: KnowledgeCut, viewerId: string | null,
): Promise<{ cut: KnowledgeCut; label: string; rows: KnowledgeRow[] }> {
  const { gws, label } = await cutGws(db, cut);
  if (!gws.length) return { cut, label, rows: [] };

  const { data: entries } = await db.from("fantasy_entries")
    .select("user_id, round_correct, round_done_at")
    .in("gw", gws).not("round_done_at", "is", null).range(0, 9999);

  const agg = new Map<string, { correct: number; rounds: number; first: string }>();
  for (const e of (entries ?? []) as { user_id: string; round_correct: number; round_done_at: string }[]) {
    const a = agg.get(e.user_id) ?? { correct: 0, rounds: 0, first: e.round_done_at };
    a.correct += e.round_correct; a.rounds += 1;
    if (e.round_done_at < a.first) a.first = e.round_done_at;
    agg.set(e.user_id, a);
  }
  const ids = Array.from(agg.keys());
  if (!ids.length) return { cut, label, rows: [] };

  // Two-step profiles fetch — no FK from entries to profiles (the embedded-select trap).
  const { data: profs } = await db.from("profiles")
    .select("id, username, display_name, avatar_url").in("id", ids).range(0, 9999);
  const profOf = new Map(((profs ?? []) as { id: string; username: string | null; display_name: string | null; avatar_url: string | null }[])
    .map((p) => [p.id, p]));

  const rows = ids.map((id) => {
    const a = agg.get(id)!;
    const p = profOf.get(id);
    return {
      userId: id,
      username: p?.username ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      correct: a.correct, rounds: a.rounds,
      accuracy: Math.round((a.correct / (a.rounds * 11)) * 100),
      first: a.first,
      isMe: id === viewerId,
    };
  });
  rows.sort((x, y) => (y.correct - x.correct) || (y.accuracy - x.accuracy) || (x.first < y.first ? -1 : 1));
  return {
    cut, label,
    rows: rows.slice(0, 100).map((r, i) => ({
      rank: i + 1, userId: r.userId, username: r.username, displayName: r.displayName,
      avatarUrl: r.avatarUrl, correct: r.correct, rounds: r.rounds, accuracy: r.accuracy, isMe: r.isMe,
    })),
  };
}
