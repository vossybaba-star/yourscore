import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserBounded } from "@/lib/supabase/bounded";
import { MarketingLanding } from "@/components/home/MarketingLanding";
import {
  Dashboard,
  type DashboardData,
  type FeaturedPack,
  type LeaguePosition,
  type PlayNextInfo,
  type RivalryInfo,
  type RecommendedPack,
} from "@/components/home/Dashboard";

export const metadata: Metadata = {
  title: "YourScore — 38-0. Draft your best XI. Top your league.",
  description:
    "Draft your XI. Go head to head. Top your league. YourScore is the football knowledge game for you and your mates.",
  openGraph: {
    title: "YourScore — 38-0. Draft your best XI. Top your league.",
    description:
      "Draft your XI. Go head to head. Top your league. YourScore is the football knowledge game for you and your mates.",
    type: "website",
    siteName: "YourScore",
    images: [{ url: "https://yourscore.app/api/og/home", width: 1200, height: 630, alt: "YourScore · 38-0" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "YourScore — 38-0. Draft your best XI. Top your league.",
    description:
      "Draft your XI. Go head to head. Top your league. YourScore is the football knowledge game for you and your mates.",
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

  // ── Logged-out: marketing landing ──────────────────────────────────────────
  if (!user) {
    const orgSchema = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": "https://yourscore.app/#organization",
          name: "YourScore",
          url: "https://yourscore.app",
          logo: "https://yourscore.app/icon-192.png",
          sameAs: ["https://x.com/Yourscore_App_"],
        },
        {
          "@type": "WebSite",
          "@id": "https://yourscore.app/#website",
          url: "https://yourscore.app",
          name: "YourScore",
          publisher: { "@id": "https://yourscore.app/#organization" },
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: "https://yourscore.app/leaderboard?q={search_term_string}" },
            "query-input": "required name=search_term_string",
          },
        },
      ],
    };
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <MarketingLanding matches={[]} />
      </>
    );
  }

  // ── Logged-in: dashboard ───────────────────────────────────────────────────
  const userId = user.id;
  // Several of these tables/RPCs aren't in the generated types — one untyped
  // handle keeps the query call-sites clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Stale lobbies are hidden in the /play list after 3h — match that here.
  const lobbyCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const [
    { data: profile },
    { data: rankRows },
    { data: standingRows },
    { data: featuredRaw },
    { data: recentMatches },
    { data: wcRunRows },
    { count: openLobbiesCount },
    { data: attemptDays },
    { data: h2hRows },
    { data: packPool },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, total_score").eq("id", userId).single(),
    // Unified rank (two-track) — same RPC the profile uses; gives rank + chase gap.
    sb.rpc("get_yourscore_rank", { p_user_id: userId }),
    supabase.rpc("get_my_league_standings", { p_user_id: userId, p_limit: 20 }),
    sb
      .from("quiz_packs")
      .select("id, name, type, parameter, question_count, featured_order, metadata, created_at")
      .eq("featured", true)
      .eq("status", "published")
      .order("featured_order", { ascending: true })
      .limit(8),
    // Recent 38-0 results drive the form pips + win streak.
    sb
      .from("draft_matches")
      .select("winner_id, played_at")
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .order("played_at", { ascending: false })
      .limit(12),
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
      .gte("completed_at", new Date(Date.now() - 45 * 86_400_000).toISOString())
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
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featuredPacks: FeaturedPack[] = ((featuredRaw as any) ?? []).map((p: any) => ({
    id: String(p.id),
    name: String(p.name),
    type: String(p.type),
    parameter: String(p.parameter ?? ""),
    question_count: Number(p.question_count ?? 10),
    icon: p.metadata?.icon ? String(p.metadata.icon) : undefined,
    coverImage: p.metadata?.cover_image ? String(p.metadata.cover_image) : undefined,
    publishedAt: p.created_at ? String(p.created_at) : undefined,
    series: p.metadata?.series ? String(p.metadata.series) : undefined,
  }));

  // ── Rank (from get_yourscore_rank) ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankRow: any = (rankRows ?? [])[0] ?? null;
  const overallScore: number = rankRow?.overall_score ?? profile?.total_score ?? 0;
  const overallRank: number | null = rankRow?.overall_rank ?? null;
  const aheadName: string | null = rankRow?.ahead_name ?? null;
  const aheadGap: number | null =
    rankRow?.ahead_points != null ? Math.max(1, rankRow.ahead_points - overallScore) : null;

  // ── Day streak + this-week dots (UK days, quiz + 38-0 activity) ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: any[] = recentMatches ?? [];
  const ukDay = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const playedSet = new Set<string>();
  for (const a of attemptDays ?? []) if (a.completed_at) playedSet.add(ukDay(a.completed_at));
  for (const m of matches) if (m.played_at) playedSet.add(ukDay(m.played_at));

  const todayKey = ukDay(new Date().toISOString());
  // Walk back day by day (noon UTC cursor sidesteps DST edges). A streak is
  // alive if it includes today OR ended yesterday (today's game not played yet).
  let dayStreak = 0;
  {
    let cursor = Date.parse(`${todayKey}T12:00:00Z`);
    if (!playedSet.has(todayKey)) cursor -= 86_400_000;
    while (playedSet.has(new Date(cursor).toLocaleDateString("en-CA", { timeZone: "Europe/London" }))) {
      dayStreak++;
      cursor -= 86_400_000;
    }
  }
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
  let playNext: PlayNextInfo;
  if (wcRun) {
    // Sub is the stage only — never "<Nation> · <Stage>", which read as if the
    // player *represents* the nation. The run is theirs, not a country's.
    playNext = { kind: "wc", href: "/38-0/wc", title: "Resume your run", sub: `Pick up at the ${wcRun.stage}` };
  } else if (openLobbies > 0) {
    playNext = { kind: "lobby", href: "/play", title: "Join a lobby", sub: `${openLobbies} open right now — jump in` };
  } else {
    playNext = { kind: "quiz", href: "/play", title: "Jump into a quiz", sub: "Daily questions · climb your rank" };
  }

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
    featuredPacks,
  };

  return <Dashboard data={data} />;
}
