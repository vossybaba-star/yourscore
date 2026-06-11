import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// World Cup 2026 series leaderboard.
//
// Aggregates scores from all quiz_packs where metadata->>'series' = 'wc2026'.
// Players are ranked by total score (sum across all series quizzes).
// No opt-in: any attempt on a tagged pack counts automatically.

export const revalidate = 60; // cache 60s on the CDN

export interface WC2026LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  totalScore: number;
  quizCount: number;
  totalCorrect: number;
}

export async function GET() {
  try {
    const db = createServiceClient();

    // 1. Get all pack IDs in the wc2026 series.
    const { data: packs, error: packErr } = await db
      .from("quiz_packs")
      .select("id")
      .eq("status", "published")
      .filter("metadata->>series", "eq", "wc2026");

    if (packErr) throw packErr;
    const packIds = (packs ?? []).map((p) => p.id);

    if (packIds.length === 0) {
      return NextResponse.json({ rows: [], packCount: 0, playerCount: 0 });
    }

    // 2. Aggregate attempts: sum score per user across all series packs.
    const { data: attempts, error: attErr } = await db
      .from("quiz_attempts")
      .select("user_id, score, correct_count")
      .in("pack_id", packIds);

    if (attErr) throw attErr;

    // 3. Aggregate client-side (avoids needing a DB function).
    const byUser = new Map<string, { totalScore: number; quizCount: number; totalCorrect: number }>();
    for (const a of attempts ?? []) {
      const existing = byUser.get(a.user_id) ?? { totalScore: 0, quizCount: 0, totalCorrect: 0 };
      byUser.set(a.user_id, {
        totalScore: existing.totalScore + (a.score ?? 0),
        quizCount: existing.quizCount + 1,
        totalCorrect: existing.totalCorrect + (a.correct_count ?? 0),
      });
    }

    if (byUser.size === 0) {
      return NextResponse.json({ rows: [], packCount: packIds.length, playerCount: 0 });
    }

    // 4. Fetch display names for all users in the board.
    const userIds = Array.from(byUser.keys());
    const { data: profiles } = await db
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

    // 5. Sort and rank.
    const sorted = Array.from(byUser.entries())
      .map(([userId, stats]) => ({
        userId,
        displayName: nameMap.get(userId) ?? "Anonymous",
        ...stats,
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    const rows: WC2026LeaderboardRow[] = sorted.slice(0, 50).map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName: r.displayName,
      totalScore: r.totalScore,
      quizCount: r.quizCount,
      totalCorrect: r.totalCorrect,
    }));

    return NextResponse.json({ rows, packCount: packIds.length, playerCount: byUser.size });
  } catch (e) {
    console.error("[wc2026 leaderboard]", e);
    return NextResponse.json({ error: "Failed to load leaderboard" }, { status: 500 });
  }
}
