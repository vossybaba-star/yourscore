import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserBounded } from "@/lib/supabase/bounded";
import { MarketingLanding } from "@/components/home/MarketingLanding";
import { resolveTodaysGame, type TodaysGame } from "@/lib/daily-game";
import { loadAttempt } from "@/lib/games/perfect10";
import {
  dayStreak as computeDayStreak,
  playedDays,
  streakCutoff as libStreakCutoff,
  ukDay,
} from "@/lib/streak";
import {
  Dashboard,
  type DashboardData,
  type LeaguePosition,
  type PlayNextInfo,
  type RivalryInfo,
  type RecommendedPack,
} from "@/components/home/Dashboard";

// Did the signed-in player already finish today's featured game? Only quiz
// and Perfect 10 persist a per-day, per-player record to check against —
// Higher or Lower / Guess the Player have no day-locked content (their
// existing routes serve a fresh random round each time), so there's nothing
// to compare "today's" attempt to; they're treated as never-done here.
async function resolveTodaysCompletion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  game: TodaysGame
): Promise<{ done: boolean; score: number | null } | null> {
  if (game.gameType === "quiz" && game.packId) {
    const { data } = await supabase
      .from("quiz_attempts")
      .select("score, completed_at")
      .eq("user_id", userId)
      .eq("pack_id", game.packId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.completed_at) {
      const day = new Date(data.completed_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      if (day === game.day) return { done: true, score: Number(data.score ?? 0) };
    }
    return { done: false, score: null };
  }
  if (game.gameType === "perfect-10") {
    // `game.listId` is the list the Perfect 10 route will actually serve —
    // today's if one was released, otherwise the newest one (releases are
    // batched). Resolving it here off `game.day` alone used to come up empty on
    // every non-release day, so a finished run never showed as done.
    if (!game.listId) return { done: false, score: null };
    const attempt = await loadAttempt(game.listId, userId);
    if (attempt?.done) return { done: true, score: attempt.score };
    return { done: false, score: null };
  }
  return { done: false, score: null };
}

export const metadata: Metadata = {
  title: "YourScore | The Home of Football Gaming",
  description:
    "For fans who actually know their football. Fantasy XI, daily quizzes, head-to-head battles and private leagues — all in one place. Free on web and iOS.",
  openGraph: {
    title: "YourScore | The Home of Football Gaming",
    description:
      "For fans who actually know their football. Fantasy XI, daily quizzes, head-to-head battles and private leagues — all in one place. Free on web and iOS.",
    type: "website",
    siteName: "YourScore",
    images: [{ url: "https://yourscore.app/api/og/home", width: 1200, height: 630, alt: "YourScore · 38-0" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "YourScore | The Home of Football Gaming",
    description:
      "For fans who actually know their football. Fantasy XI, daily quizzes, head-to-head battles and private leagues — all in one place. Free on web and iOS.",
    images: ["https://yourscore.app/api/og/home"],
  },
};


// Live per-user data on every render — don't let Vercel's data cache pin any
// of the supabase GETs (constant-key service reads go permanently stale).
export const fetchCache = "force-no-store";

// Home / dashboard. Server Component: reads the session from cookies (refreshed by
// middleware) and fetches all server-fetchable data in parallel before render —
// no client waterfall. Interactive pieces (countdown ticker, mobile menu, league
// tab toggle, hero card animation) live in the client islands under
// src/components/home/.
export default async function RootPage({
  searchParams,
}: {
  searchParams: { code?: string; next?: string };
}) {
  // Magic-link / OAuth code lands here — forward to the callback route
  // (previously done client-side via window.location.replace).
  if (searchParams?.code) {
    const next = searchParams.next ?? "/";
    redirect(
      `/auth/callback?code=${encodeURIComponent(searchParams.code)}&next=${encodeURIComponent(next)}`
    );
  }

  const supabase = await createClient();
  const user = await getUserBounded(supabase);

  // Today's Game — one hero, same for every visitor on this London calendar
  // day. Both `daily_games` and published `quiz_packs` are public-read, so
  // this resolves identically whether or not `user` is set below.
  const todaysGame = await resolveTodaysGame(supabase);

  // ── Logged-out: marketing landing ──────────────────────────────────────────
  if (!user) {
    return <MarketingLanding matches={[]} todaysGame={todaysGame} />;
  }

  // ── Logged-in: dashboard ───────────────────────────────────────────────────
  const userId = user.id;
  // Several of these tables/RPCs aren't in the generated types — one untyped
  // handle keeps the query call-sites clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Stale lobbies are hidden in the /play list after 3h — match that here.
  const lobbyCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  // One window for every streak source, shared with /profile. NOTE: this caps
  // the visible day streak at ~45 — raise STREAK_WINDOW_DAYS to change it.
  const streakCutoff = libStreakCutoff();

  const [
    { data: profile },
    { data: rankRows },
    { data: standingRows },
    { data: recentMatches },
    { data: wcRunRows },
    { count: openLobbiesCount },
    { data: attemptDays },
    { data: h2hRows },
    { data: packPool },
    { data: wcRunDays },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, total_score").eq("id", userId).single(),
    // Unified rank (two-track) — same RPC the profile uses; gives rank + chase gap.
    sb.rpc("get_yourscore_rank", { p_user_id: userId }),
    supabase.rpc("get_my_league_standings", { p_user_id: userId, p_limit: 20 }),
    // 38-0 play days (45d) — feeds the day streak + week dots. Was limit(12)
    // with NO date floor: a busy day's 12 matches silently wiped every earlier
    // streak day from this source.
    sb
      .from("draft_matches")
      .select("winner_id, played_at")
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .gte("played_at", streakCutoff)
      .order("played_at", { ascending: false })
      .limit(500),
    // An active World Cup run becomes the top "Play next" suggestion.
    sb
      .from("draft_wc_runs")
      .select("nation, stage, group_points, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1),
    // Open public lobbies still fresh enough to join.
    sb
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("type", "player")
      .eq("status", "lobby")
      .eq("room_mode", "open")
      .gte("created_at", lobbyCutoff),
    // Quiz play days (45d) — feeds the day streak + this-week dots. 38-0 play
    // days come from recentMatches above; both sets are merged below.
    sb
      .from("quiz_attempts")
      .select("completed_at, pack_id")
      .eq("user_id", userId)
      .gte("completed_at", streakCutoff)
      .order("completed_at", { ascending: false })
      .limit(500),
    // H2H challenges: an unfinished one becomes the rivalry card (real expiry
    // countdown); the completed ones build the head-to-head record fallback.
    sb
      .from("h2h_challenges")
      .select("id, challenger_id, challenger_name, opponent_id, invited_user_id, challenger_score, opponent_score, quiz_pack_id, quiz_pack_name, status, expires_at, created_at")
      // invited_user_id covers direct invites the invitee hasn't played yet
      // (opponent_id only fills once they play their turn).
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId},invited_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(40),
    // Pool for the behaviour-based rail: published packs, newest first; the
    // user's already-played packs are filtered out below.
    sb
      .from("quiz_packs")
      .select("id, name, question_count, metadata, featured, created_at")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(40),
    // WC Mastermind/Run days (45d) — the pushed daily habit writes ONLY
    // draft_wc_runs, so without this a faithful daily player read "START A
    // STREAK" every morning.
    sb
      .from("draft_wc_runs")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", streakCutoff)
      .limit(500),
  ]);

  // ── Rank (from get_yourscore_rank) ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankRow: any = (rankRows ?? [])[0] ?? null;
  const overallScore: number = rankRow?.overall_score ?? profile?.total_score ?? 0;
  const overallRank: number | null = rankRow?.overall_rank ?? null;
  const aheadName: string | null = rankRow?.ahead_name ?? null;
  const aheadGap: number | null =
    rankRow?.ahead_points != null ? Math.max(1, rankRow.ahead_points - overallScore) : null;

  // ── Day streak + this-week dots (UK days, quiz + 38-0 activity) ─────────────
  // Streak maths lives in @/lib/streak so /profile counts days the same way.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: any[] = recentMatches ?? [];
  const playedSet = playedDays([
    ...((attemptDays ?? []) as { completed_at: string | null }[]).map((a) => a.completed_at),
    ...matches.map((m) => m.played_at),
    ...((wcRunDays ?? []) as { created_at: string | null }[]).map((r) => r.created_at),
  ]);
  const todayKey = ukDay(new Date().toISOString());
  const dayStreak = computeDayStreak(playedSet);
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const todayIdx = WEEKDAYS.indexOf(
    new Date().toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" })
  );
  const weekDots = WEEKDAYS.map((label, i) => {
    const ts = Date.parse(`${todayKey}T12:00:00Z`) + (i - todayIdx) * 86_400_000;
    const key = new Date(ts).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    return { label: label[0], played: playedSet.has(key), isToday: i === todayIdx, isFuture: i > todayIdx };
  });

  // ── Rivalry: live h2h challenge first (real expiry), else all-time record ───
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h2h: any[] = h2hRows ?? [];
  const now = Date.now();
  const liveH2h = h2h.find(
    (c) =>
      !["completed", "expired", "declined"].includes(c.status) &&
      (!c.expires_at || Date.parse(c.expires_at) > now)
  );
  let rivalry: RivalryInfo | null = null;
  if (liveH2h) {
    const iAmChallenger = liveH2h.challenger_id === userId;
    const oppId: string | null = iAmChallenger
      ? liveH2h.opponent_id ?? liveH2h.invited_user_id
      : liveH2h.challenger_id;
    let oppName = iAmChallenger ? "Your rival" : String(liveH2h.challenger_name ?? "Your rival");
    if (iAmChallenger && oppId) {
      const { data: p } = await supabase.from("profiles").select("display_name").eq("id", oppId).maybeSingle();
      if (p?.display_name) oppName = p.display_name;
    }
    rivalry = {
      live: true,
      opponentId: oppId,
      opponentName: oppName,
      myScore: iAmChallenger ? liveH2h.challenger_score ?? null : liveH2h.opponent_score ?? null,
      theirScore: iAmChallenger ? liveH2h.opponent_score ?? null : liveH2h.challenger_score ?? null,
      expiresAt: liveH2h.expires_at ?? null,
      packName: liveH2h.quiz_pack_name ?? null,
    };
  } else {
    // Most-played opponent across completed challenges → head-to-head record.
    const byOpp = new Map<string, { name: string; wins: number; losses: number; games: number }>();
    for (const c of h2h) {
      if (c.status !== "completed" || c.opponent_score == null) continue;
      const iAmChallenger = c.challenger_id === userId;
      const oppId = iAmChallenger ? c.opponent_id : c.challenger_id;
      if (!oppId) continue;
      const mine = iAmChallenger ? c.challenger_score : c.opponent_score;
      const theirs = iAmChallenger ? c.opponent_score : c.challenger_score;
      const rec = byOpp.get(oppId) ?? { name: iAmChallenger ? "" : String(c.challenger_name ?? ""), wins: 0, losses: 0, games: 0 };
      rec.games++;
      if (mine > theirs) rec.wins++;
      else if (theirs > mine) rec.losses++;
      byOpp.set(oppId, rec);
    }
    const top = Array.from(byOpp.entries()).sort((a, b) => b[1].games - a[1].games)[0];
    if (top) {
      let name = top[1].name;
      if (!name) {
        const { data: p } = await supabase.from("profiles").select("display_name").eq("id", top[0]).maybeSingle();
        name = p?.display_name ?? "Your rival";
      }
      rivalry = {
        live: false,
        opponentId: top[0],
        opponentName: name,
        myScore: top[1].wins,
        theirScore: top[1].losses,
        expiresAt: null,
        packName: null,
      };
    }
  }

  // ── Behaviour-based rail: packs they haven't played yet ─────────────────────
  const attemptedPackIds = new Set((attemptDays ?? []).map((a: { pack_id: string }) => a.pack_id));
  const played38 = matches.length > 0;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const recommended: RecommendedPack[] = ((packPool as any) ?? [])
    .filter((p: any) => !attemptedPackIds.has(p.id))
    .slice(0, 6)
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name),
      questionCount: Number(p.question_count ?? 10),
      cover: p.metadata?.cover_image ? String(p.metadata.cover_image) : null,
    }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ── Active World Cup run ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wcRow: any = (wcRunRows ?? [])[0] ?? null;
  const STAGE_LABEL: Record<string, string> = {
    group: "Group stage", r32: "Round of 32", r16: "Round of 16", qf: "Quarter-final", sf: "Semi-final", final: "Final",
  };
  const wcRun = wcRow
    ? { nation: String(wcRow.nation), stage: STAGE_LABEL[wcRow.stage] ?? "Group stage", groupPoints: Number(wcRow.group_points ?? 0) }
    : null;

  const openLobbies = openLobbiesCount ?? 0;

  // ── "Play next" — pick the single most relevant action by live state ────────
  // No generic quiz fallback here anymore — Today's Game is the hero now, so
  // when there's no run to resume and no lobby to join, playNext is simply null.
  // Mastermind runs are deliberately NOT resurfaced here (founder, Jul 23):
  // no "resume your run" prompt anywhere on home. The Mastermind mode tile is
  // the only way back in.
  let playNext: PlayNextInfo | null = null;
  if (openLobbies > 0) {
    playNext = { kind: "lobby", href: "/play", title: "Join a lobby", sub: `${openLobbies} open right now — jump in` };
  }

  // ── Today's Game completion — score + share, not a replay nudge ─────────────
  const todaysGameCompletion = await resolveTodaysCompletion(supabase, userId, todaysGame);

  // ── Leagues: my position + gap to the spot above, per league ────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byLeague = new Map<string, { id: string; name: string; members: { uid: string; name: string; score: number }[] }>();
  for (const r of standingRows ?? []) {
    let lg = byLeague.get(r.league_id);
    if (!lg) {
      lg = { id: r.league_id, name: r.league_name, members: [] };
      byLeague.set(r.league_id, lg);
    }
    lg.members.push({ uid: r.user_id ?? "", name: r.display_name ?? "Player", score: r.total_score ?? 0 });
  }
  const leagues: LeaguePosition[] = [];
  for (const lg of Array.from(byLeague.values())) {
    const sorted = [...lg.members].sort((a, b) => b.score - a.score);
    const idx = sorted.findIndex((m) => m.uid === userId);
    if (idx === -1) continue;
    const me = sorted[idx];
    const above = idx > 0 ? sorted[idx - 1] : null;
    leagues.push({
      id: lg.id,
      name: lg.name,
      myPos: idx + 1,
      total: sorted.length,
      myScore: me.score,
      gapAbove: above ? Math.max(0, above.score - me.score) : null,
      aboveName: above ? above.name : null,
    });
  }
  // Surface leagues where the race is tightest (smallest gap) first.
  leagues.sort((a, b) => (a.gapAbove ?? -1) - (b.gapAbove ?? -1));

  const data: DashboardData = {
    userId,
    displayName: profile?.display_name ?? "",
    rank: { overall: overallRank, score: overallScore, knowledge: rankRow?.knowledge_score ?? 0, match: rankRow?.match_score ?? 0, aheadName, aheadGap },
    dayStreak,
    weekDots,
    rivalry,
    recommended,
    played38,
    wcRun,
    playNext,
    openLobbies,
    leagues,
    todaysGame,
    todaysGameCompletion,
  };

  return <Dashboard data={data} />;
}
