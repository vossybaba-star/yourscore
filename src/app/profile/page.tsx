/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserBounded } from "@/lib/supabase/bounded";
import { Button } from "@/components/ui/Button";
import { GridBackground } from "@/components/ui/GridBackground";
import { BottomNav } from "@/components/ui/BottomNav";
import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { AVATAR_FRAME } from "@/components/profile/PlayerCard";
import { computeAttributes, computeOvr, computeArchetype } from "@/lib/playerCard";
import { LadderHero, type LadderRow } from "@/components/profile/LadderHero";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { MedalShelf } from "@/components/profile/MedalShelf";
import { PointsBreakdown } from "@/components/profile/PointsBreakdown";
import { RecentGames } from "@/components/profile/RecentGames";
import { dayStreak, playedDays, streakCutoff } from "@/lib/streak";
import { allMedals } from "@/lib/medals";

// The card sits beside the rank block, not above it — at full 300px stacked, the
// hero alone ate most of a phone screen.
const CARD_W = 148;

export default async function ProfilePage() {
  const supabase = await createClient();
  const user = await getUserBounded(supabase);

  if (!user) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-body text-text-muted">Sign in to see your profile.</p>
          <Button href="/auth/sign-in" variant="ghost" size="md">
            Sign in →
          </Button>
        </div>
      </main>
    );
  }

  const userId = user.id;
  // Several of these columns/RPCs post-date the generated types.
  const sb = supabase as any;
  const since = streakCutoff();

  const [
    { data: profile },
    { data: rankRows },
    { data: ladderRows },
    { data: accuracyRows },
    { data: seasonBestRows },
    { data: wcBestRows },
    { data: quizBestRows },
    { data: roomScoreRows },
    { data: friendRows },
    { count: pendingFriendCount },
    { data: clubRows },
    { data: speedRows },
    { count: quizAttemptCount },
    { count: wcRunCount },
    { count: wcTitleCount },
    { count: seasonCount },
    { count: lobbyCount },
    { count: matchCount },
    { data: quizDays },
    { data: matchDays },
    { data: wcDays },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, total_score, avatar_url").eq("id", userId).single(),
    // Unified YourScore Rank. Reads profiles + challenge_attempts + draft_standings only.
    sb.rpc("get_yourscore_rank", { p_user_id: userId }),
    // The two players above, you, and the one below (migration 82).
    sb.rpc("get_yourscore_ladder", { p_user_id: userId }),
    // True lifetime accuracy across every quiz surface that stores a graded
    // answer — not just lobbies (migration 82).
    sb.rpc("get_profile_accuracy", { p_user_id: userId }),
    sb.from("draft_season_records")
      .select("wins, draws, losses, points, invincible")
      .eq("user_id", userId)
      .order("wins", { ascending: false })
      .order("points", { ascending: false })
      .limit(1),
    // Wins are an aggregate over draft_wc_matches, so this has to be an RPC —
    // ordering client-side would mean pulling every run (migration 82).
    sb.rpc("get_best_wc_run", { p_user_id: userId }),
    // Questions right, not points — score carries speed bonuses max_score
    // doesn't, so ordering by score renders bests like "5950/4800".
    sb.rpc("get_best_quiz", { p_user_id: userId }),
    // NOTE: room_scores has updated_at, NOT created_at. Ordering by created_at
    // here silently errored the whole query, which is why accuracy and this
    // list rendered empty for every user until 2026-07-17.
    sb.from("room_scores")
      .select("room_id, total_score, correct_answers, total_answers, rank, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5),
    sb.from("friendships")
      .select("user_id, friend_id, status")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq("status", "accepted"),
    sb.from("friendships")
      .select("id", { count: "exact", head: true })
      .eq("friend_id", userId)
      .eq("status", "pending"),
    sb.from("club_supporters").select("club").eq("user_id", userId).limit(1),
    // PAC comes from real answer times; the graded answers array already carries
    // elapsed_ms per question, so no extra column is needed.
    sb.from("quiz_attempts").select("answers").eq("user_id", userId).limit(50),
    sb.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("draft_wc_runs").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("draft_wc_runs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "champion"),
    sb.from("draft_season_records").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("room_scores").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("draft_matches")
      .select("id", { count: "exact", head: true })
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`),
    // Streak sources — all three capped to the same window as the home page.
    sb.from("quiz_attempts").select("completed_at").eq("user_id", userId).gte("completed_at", since).limit(500),
    sb.from("draft_matches")
      .select("played_at")
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .gte("played_at", since)
      .limit(500),
    sb.from("draft_wc_runs").select("created_at").eq("user_id", userId).gte("created_at", since).limit(500),
  ]);

  const name = profile?.display_name || user.email?.split("@")[0] || "Player";
  const friendCount = (friendRows ?? []).length;
  const pendingFriends = pendingFriendCount ?? 0;

  const rank: any = (rankRows ?? [])[0] ?? null;
  const overallRank: number | null = rank?.overall_rank ?? null;
  const overallScore: number = rank?.overall_score ?? 0;
  const matchScore: number = rank?.match_score ?? 0;
  const knowledgeScore: number = rank?.knowledge_score ?? 0;

  const acc: any = (accuracyRows ?? [])[0] ?? null;
  const answered = Number(acc?.total ?? 0);
  const correct = Number(acc?.correct ?? 0);
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : null;

  const streak = dayStreak(
    playedDays([
      ...((quizDays ?? []) as any[]).map((r) => r.completed_at),
      ...((matchDays ?? []) as any[]).map((r) => r.played_at),
      ...((wcDays ?? []) as any[]).map((r) => r.created_at),
    ])
  );

  // ── Player card ───────────────────────────────────────────────────────────
  // Six attributes, none of them game-specific, so a new game raises the card
  // instead of needing its own slot on the page.
  const club: string | null = ((clubRows ?? []) as any[])[0]?.club ?? null;
  const answerMs: number[] = [];
  let fastCorrectMs: number | null = null;
  for (const r of (speedRows ?? []) as any[]) {
    if (Array.isArray(r.answers)) {
      for (const a of r.answers) {
        if (typeof a?.elapsed_ms !== "number") continue;
        answerMs.push(a.elapsed_ms);
        // Quickdraw only counts a CORRECT answer — guessing fast isn't a skill.
        if (a?.correct && (fastCorrectMs === null || a.elapsed_ms < fastCorrectMs)) fastCorrectMs = a.elapsed_ms;
      }
    }
  }
  const gameTypeCounts = [quizAttemptCount ?? 0, wcRunCount ?? 0, seasonCount ?? 0, lobbyCount ?? 0, matchCount ?? 0];
  const attributes = computeAttributes({
    accuracy: answered > 0 ? correct / answered : null,
    answered,
    avgAnswerMs: answerMs.length ? answerMs.reduce((s2, n) => s2 + n, 0) / answerMs.length : null,
    wins: rank?.wins ?? 0,
    draws: rank?.draws ?? 0,
    losses: rank?.losses ?? 0,
    dayStreak: streak,
    gameTypesPlayed: gameTypeCounts.filter((c) => c > 0).length,
    gameTypesTotal: gameTypeCounts.length,
    friends: friendCount,
    socialGames: (lobbyCount ?? 0) + (matchCount ?? 0),
  });
  const ovr = computeOvr(attributes);

  const seasonBest: any = (seasonBestRows ?? [])[0] ?? null;
  const wcRow: any = (wcBestRows ?? [])[0] ?? null;
  const wcBest = wcRow
    ? { nation: wcRow.nation, champion: wcRow.champion, wins: Number(wcRow.wins), games: Number(wcRow.games) }
    : null;
  const quizRow: any = (quizBestRows ?? [])[0] ?? null;
  const quizBest = quizRow?.total
    ? { correct: Number(quizRow.correct ?? 0), total: Number(quizRow.total), title: quizRow.title ?? null }
    : null;

  // Medals: rarity is the pride, the gaps are the pull. Thresholds are
  // calibrated against the real player distribution — see lib/medals.ts.
  const daysPlayed = playedDays([
    ...((quizDays ?? []) as any[]).map((r: any) => r.completed_at),
    ...((matchDays ?? []) as any[]).map((r: any) => r.played_at),
    ...((wcDays ?? []) as any[]).map((r: any) => r.created_at),
  ]).size;
  const medals = allMedals({
    playedAnything: gameTypeCounts.some((c) => c > 0),
    matchWins: rank?.wins ?? 0,
    bestSeasonWins: seasonBest?.wins ?? 0,
    invincibleSeason: !!seasonBest?.invincible,
    wcTitles: wcTitleCount ?? 0,
    wcFlawless: !!wcBest && wcBest.wins === 8 && wcBest.games === 8,
    answered,
    lifetimeAccuracy: answered > 0 ? correct / answered : null,
    perfectQuiz: !!quizBest && quizBest.correct === quizBest.total,
    fastCorrectMs,
    daysPlayed,
    gameTypesPlayed: gameTypeCounts.filter((c) => c > 0).length,
  });
  const cabinetFootnote = seasonBest && !seasonBest.invincible
    ? `Best season ${seasonBest.wins}-${seasonBest.draws}-${seasonBest.losses} · ${38 - seasonBest.wins} wins short of Invincible`
    : null;

  // Half the player base sits on 0 pts, where the "gap" to the player above
  // rounds to a meaningless 1 pt. Show them a first rung, not a fake race.
  const ladder = ((ladderRows ?? []) as LadderRow[]).map((r) => ({ ...r, overall_score: Number(r.overall_score) }));
  const showLadder = overallRank !== null && overallScore > 0 && ladder.length > 0;

  const counted = [
    { label: "38-0 matches", points: matchScore, accent: "#aeea00", href: "/38-0/history" },
    { label: "Quiz lobbies", points: knowledgeScore, accent: "#00d8c0", href: "/play" },
  ].filter((r) => r.points > 0);

  // Every one of these persists a result and a personal best, and earns nothing
  // toward Rank. Listed only once the player has actually played them.
  const uncounted = [
    { label: "Daily quiz", detail: `${quizAttemptCount ?? 0} played`, href: "/play", n: quizAttemptCount ?? 0 },
    { label: "World Cup", detail: `${wcRunCount ?? 0} runs`, href: "/38-0/wc", n: wcRunCount ?? 0 },
    { label: "38-0 seasons", detail: `${seasonCount ?? 0} played`, href: "/38-0", n: seasonCount ?? 0 },
  ].filter((r) => r.n > 0);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />
      <div
        className="fixed top-0 right-0 w-[400px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 0%, rgba(174,234,0,0.07) 0%, transparent 60%)" }}
      />

      <div
        className="sticky top-0 z-30 pt-safe"
        style={{
          background: "rgba(10,10,15,0.92)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="max-w-lg mx-auto px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-display text-2xl text-white tracking-wide truncate">{name.toUpperCase()}</p>
              <p className="font-body text-xs text-text-muted mt-0.5 truncate">{user.email}</p>
            </div>
            <Link
              href="/settings"
              aria-label="Edit profile"
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80 text-text-muted"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path
                  d="M10.5 2.5l2 2L5 12H3v-2L10.5 2.5z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-5">
        {/* Card right, standing left — see ProfileHero. The avatar picker is a
            transparent tap target over the card's avatar circle, because the
            card itself is an SVG and can't hold a button. */}
        <div className="relative" data-tour="rank">
          <ProfileHero
            userId={user.id}
            name={name}
            avatarUrl={profile?.avatar_url ?? null}
            ovr={ovr}
            archetype={computeArchetype(attributes)}
            club={club}
            attributes={attributes}
            overallRank={overallRank}
            overallScore={overallScore}
            accuracy={accuracy}
            dayStreak={streak}
            cardWidth={CARD_W}
          />
          <div className="absolute" style={{ right: 0, top: 0, width: CARD_W, aspectRatio: "300 / 420" }}>
            <div className="absolute" style={AVATAR_FRAME}>
              <AvatarPicker userId={user.id} name={name} initialAvatarUrl={profile?.avatar_url ?? null} overlay />
            </div>
          </div>
        </div>

        {/* Unranked players get their CTA in the hero — no second block. */}
        {showLadder && (
          <LadderHero
            rows={ladder}
            overallRank={overallRank!}
            overallScore={overallScore}
            accuracy={accuracy}
            compact
          />
        )}

        <MedalShelf medals={medals} footnote={cabinetFootnote} />

        {counted.length > 0 && <PointsBreakdown counted={counted} uncounted={uncounted} />}

        <RecentGames games={(roomScoreRows ?? []) as any[]} />

        <Link
          href="/leaderboard"
          className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
          style={{
            background: "linear-gradient(135deg, rgba(174,234,0,0.08), rgba(174,234,0,0.04))",
            border: "1px solid rgba(174,234,0,0.2)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgba(174,234,0,0.12)" }}
            >
              🏅
            </div>
            <div>
              <p className="font-body text-sm font-bold text-white">Rankings</p>
              <p className="font-body text-xs text-text-muted">Global + friends leaderboard</p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#aeea00", flexShrink: 0 }}>
            <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <Link
          href="/friends"
          className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
          style={{
            background:
              pendingFriends > 0
                ? "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(0,201,255,0.04))"
                : "linear-gradient(135deg, rgba(0,201,255,0.08), rgba(0,201,255,0.04))",
            border: pendingFriends > 0 ? "1px solid rgba(239,68,68,0.35)" : "1px solid rgba(0,201,255,0.2)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                style={{ background: pendingFriends > 0 ? "rgba(239,68,68,0.15)" : "rgba(0,201,255,0.12)" }}
              >
                🤝
              </div>
              {pendingFriends > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: "16px",
                    textAlign: "center",
                    padding: "0 4px",
                    fontFamily: "var(--font-body, sans-serif)",
                    border: "1.5px solid #0a0a0f",
                  }}
                >
                  {pendingFriends > 9 ? "9+" : pendingFriends}
                </span>
              )}
            </div>
            <div>
              <p className="font-body text-sm font-bold text-white">Friends</p>
              <p
                className="font-body text-xs"
                style={{ color: pendingFriends > 0 ? "#ef4444" : "var(--color-text-muted, #8a948f)" }}
              >
                {pendingFriends > 0
                  ? `${pendingFriends} pending request${pendingFriends !== 1 ? "s" : ""}`
                  : friendCount > 0
                    ? `${friendCount} friend${friendCount !== 1 ? "s" : ""}`
                    : "Add your friends"}
              </p>
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ color: pendingFriends > 0 ? "#ef4444" : "#00c9ff", flexShrink: 0 }}
          >
            <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <Link
          href="/settings"
          className="flex items-center justify-between px-5 py-4 rounded-2xl transition-opacity hover:opacity-80 bg-surface"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <span className="font-body text-sm text-white">Settings</span>
          <span className="font-body text-xs text-text-muted">Edit name, sign out →</span>
        </Link>
      </div>
      <BottomNav />
    </main>
  );
}
