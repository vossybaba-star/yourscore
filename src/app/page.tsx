import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserBounded } from "@/lib/supabase/bounded";
import { MarketingLanding } from "@/components/home/MarketingLanding";
import {
  Dashboard,
  type DashboardData,
  type FeaturedPack,
  type FormResult,
  type LeaguePosition,
  type PlayNextInfo,
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
    return <MarketingLanding matches={[]} />;
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
  }));

  // ── Rank (from get_yourscore_rank) ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankRow: any = (rankRows ?? [])[0] ?? null;
  const overallScore: number = rankRow?.overall_score ?? profile?.total_score ?? 0;
  const overallRank: number | null = rankRow?.overall_rank ?? null;
  const aheadName: string | null = rankRow?.ahead_name ?? null;
  const aheadGap: number | null =
    rankRow?.ahead_points != null ? Math.max(1, rankRow.ahead_points - overallScore) : null;

  // ── Momentum: form pips + win streak from recent 38-0 matches ───────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: any[] = recentMatches ?? [];
  const form: FormResult[] = matches.map((m) => ({
    kind: "38" as const,
    outcome: m.winner_id === userId ? ("W" as const) : ("L" as const),
  }));
  let streak = 0;
  for (const f of form) {
    if (f.outcome === "W") streak++;
    else break;
  }

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
    momentum: { form, streak },
    wcRun,
    playNext,
    openLobbies,
    leagues,
    featuredPacks,
  };

  return <Dashboard data={data} />;
}
