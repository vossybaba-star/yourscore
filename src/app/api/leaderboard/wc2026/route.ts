import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// World Cup 2026 series leaderboard (the £100-prize board).
//
// Aggregates scores from every quiz_pack where metadata->>'series' = 'wc2026'.
// On top of the raw score, players earn a DAILY STREAK MULTIPLIER: completing a
// daily quiz within 24h of its release extends a streak, and each consecutive
// on-time day boosts that day's score by +10% (capped at +50%). Missing a day's
// window resets the streak. The multiplier rewards knowledge AND consistency, so
// the prize can't be won on streak alone.
//
// Everything is derived from existing data (pack metadata.date + attempt
// completed_at) — no schema change.

export const revalidate = 60; // cache 60s on the CDN

// A daily quiz "belongs to" a target CALENDAR DAY (metadata.date). On-time =
// completed any time up to the END of that UK calendar day (midnight). Because
// the quiz is posted the night before, early players get the leftover evening
// PLUS the full next day (~27-30h), but everyone shares the same midnight
// deadline. Miss it → streak breaks.
//
// UK is BST (UTC+1) for the whole 2026 tournament (Jun–Jul), so the end of
// London calendar day D is D 23:00 UTC (= D+1 00:00 London).
const STREAK_STEP = 0.1; // +10% per consecutive on-time day
const STREAK_MAX_STEPS = 5; // cap multiplier at +50%

function dayEndUtc(dateStr: string): number {
  return Date.parse(`${dateStr}T23:00:00Z`);
}
// Multiplier for a given (consecutive) streak length, streak >= 1.
function streakMultiplier(streak: number): number {
  return 1 + STREAK_STEP * Math.min(streak, STREAK_MAX_STEPS);
}

export interface WC2026LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  totalScore: number; // streak-boosted total
  baseScore: number; // raw sum, before streak bonus
  bonusPoints: number; // points added by the streak multiplier
  streak: number; // current live on-time streak
  quizCount: number;
  totalCorrect: number;
}

interface PackInfo {
  id: string;
  deadline: number | null; // on-time cutoff (UK day-end); null = not a dated daily pack
}

export async function GET() {
  try {
    const db = createServiceClient();

    // 1. Series packs + their metadata (need the release date for streaks).
    const { data: packs, error: packErr } = await db
      .from("quiz_packs")
      .select("id, metadata")
      .eq("status", "published")
      .filter("metadata->>series", "eq", "wc2026");
    if (packErr) throw packErr;

    const packList: PackInfo[] = (packs ?? []).map((p) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (p.metadata ?? {}) as any;
      const isDaily = m?.daily === true && typeof m?.date === "string";
      return { id: p.id as string, deadline: isDaily ? dayEndUtc(m.date) : null };
    });
    const packIds = packList.map((p) => p.id);
    if (packIds.length === 0) {
      return NextResponse.json({ rows: [], packCount: 0, playerCount: 0 });
    }
    // Dated daily packs, oldest → newest (streaks run in calendar-day order).
    const dailyPacks = packList
      .filter((p): p is { id: string; deadline: number } => p.deadline !== null)
      .sort((a, b) => a.deadline - b.deadline);
    const nonDailyPackIds = packList.filter((p) => p.deadline === null).map((p) => p.id);

    // 2. All attempts on series packs (with completion time for on-time checks).
    const { data: attempts, error: attErr } = await db
      .from("quiz_attempts")
      .select("user_id, pack_id, score, correct_count, completed_at")
      .in("pack_id", packIds);
    if (attErr) throw attErr;

    // 3. Index best attempt per (user, pack).
    type Att = { score: number; correct: number; completed: number };
    const byUserPack = new Map<string, Map<string, Att>>();
    for (const a of attempts ?? []) {
      let m = byUserPack.get(a.user_id);
      if (!m) { m = new Map(); byUserPack.set(a.user_id, m); }
      const prev = m.get(a.pack_id);
      const score = a.score ?? 0;
      if (!prev || score > prev.score) {
        m.set(a.pack_id, {
          score,
          correct: a.correct_count ?? 0,
          completed: a.completed_at ? Date.parse(a.completed_at) : 0,
        });
      }
    }
    if (byUserPack.size === 0) {
      return NextResponse.json({ rows: [], packCount: packIds.length, playerCount: 0 });
    }

    const now = Date.now();

    // 4. Per-user score + streak.
    const computed = Array.from(byUserPack.entries()).map(([userId, packMap]) => {
      let base = 0, boosted = 0, totalCorrect = 0, quizCount = 0;

      // Non-daily series packs: flat, no multiplier.
      for (const pid of nonDailyPackIds) {
        const at = packMap.get(pid);
        if (at) { base += at.score; boosted += at.score; totalCorrect += at.correct; quizCount++; }
      }

      // Daily packs in calendar-day order: apply streak.
      let streak = 0;
      for (const dp of dailyPacks) {
        const at = packMap.get(dp.id);
        if (at) {
          quizCount++; totalCorrect += at.correct; base += at.score;
          // On-time = completed before the target day's UK midnight deadline.
          // (Can't be played before it's posted, so no early bound is needed.)
          const onTime = at.completed > 0 && at.completed <= dp.deadline;
          if (onTime) {
            streak += 1;
            boosted += at.score * streakMultiplier(streak);
          } else {
            boosted += at.score; // late: base only, streak breaks
            streak = 0;
          }
        } else if (now > dp.deadline) {
          streak = 0; // missed and the day has ended → streak broken
        }
        // deadline not reached yet & not played → streak pending (unchanged)
      }

      return {
        userId,
        baseScore: Math.round(base),
        totalScore: Math.round(boosted),
        bonusPoints: Math.round(boosted - base),
        streak,
        quizCount,
        totalCorrect,
      };
    });

    // 5. Names.
    const userIds = computed.map((c) => c.userId);
    const { data: profiles } = await db
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

    // 6. Sort by boosted total, rank, top 50.
    const rows: WC2026LeaderboardRow[] = computed
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 50)
      .map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        displayName: nameMap.get(r.userId) ?? "Anonymous",
        totalScore: r.totalScore,
        baseScore: r.baseScore,
        bonusPoints: r.bonusPoints,
        streak: r.streak,
        quizCount: r.quizCount,
        totalCorrect: r.totalCorrect,
      }));

    return NextResponse.json({ rows, packCount: packIds.length, playerCount: computed.length });
  } catch (e) {
    console.error("[wc2026 leaderboard]", e);
    return NextResponse.json({ error: "Failed to load leaderboard" }, { status: 500 });
  }
}
