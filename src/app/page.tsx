import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MarketingLanding, type LiveMatch } from "@/components/home/MarketingLanding";
import { Dashboard, type DashboardData, type LeagueTab, type FeaturedPack } from "@/components/home/Dashboard";

export const metadata: Metadata = {
  title: "YourScore — Your football knowledge. Ranked.",
  description:
    "Start a league with your mates and answer live questions during every match. Your football knowledge, ranked — points stack across every game, all season long.",
  openGraph: {
    title: "YourScore — Your football knowledge. Ranked.",
    description:
      "Start a league with your mates and answer live questions during every match. Points stack across every game, all season long.",
    type: "website",
    siteName: "YourScore",
    images: [{ url: "https://yourscore.app/api/og/home", width: 1200, height: 630, alt: "YourScore · 38-0" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "YourScore — Your football knowledge. Ranked.",
    description:
      "Start a league with your mates and answer live questions during every match. Points stack across every game, all season long.",
    images: ["https://yourscore.app/api/og/home"],
  },
};

/** Upcoming/live matches — user-independent, fetched server-side for both states. */
async function fetchUpcomingMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  limit = 8
): Promise<LiveMatch[]> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("matches")
    .select("id, home_team, away_team, match_date, tournament, status, home_score, away_score")
    .or(`status.eq.live,and(status.eq.upcoming,match_date.gte.${now})`)
    .order("match_date", { ascending: true })
    .limit(limit);
  return (data as unknown as LiveMatch[]) ?? [];
}

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Logged-out: marketing landing ──────────────────────────────────────────
  if (!user) {
    const matches = await fetchUpcomingMatches(supabase, 8);
    return <MarketingLanding matches={matches} />;
  }

  // ── Logged-in: dashboard ───────────────────────────────────────────────────
  const userId = user.id;

  const [{ data: profile }, matches, { data: standingRows }, { data: featuredRaw }] = await Promise.all([
    supabase.from("profiles").select("display_name, total_score").eq("id", userId).single(),
    fetchUpcomingMatches(supabase, 8),
    supabase.rpc("get_my_league_standings", { p_user_id: userId, p_limit: 20 }),
    // featured/featured_order added via migration — bypass stale generated types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("quiz_packs")
      .select("id, name, type, parameter, question_count, featured_order, metadata")
      .eq("featured", true)
      .eq("status", "published")
      .order("featured_order", { ascending: true })
      .limit(8),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featuredPacks: FeaturedPack[] = ((featuredRaw as any) ?? []).map((p: any) => ({
    id: String(p.id),
    name: String(p.name),
    type: String(p.type),
    parameter: String(p.parameter ?? ""),
    question_count: Number(p.question_count ?? 10),
    icon: p.metadata?.icon ? String(p.metadata.icon) : undefined,
  }));

  const totalScore = profile?.total_score ?? null;

  // Global rank depends on the user's score, so it runs after the profile fetch.
  let globalRank: number | null = null;
  if (totalScore !== null) {
    const { count } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gt("total_score", totalScore);
    globalRank = (count ?? 0) + 1;
  }

  // Group the flat RPC rows into per-league tabs (mirrors the old client logic).
  const byLeague = new Map<string, LeagueTab>();
  for (const r of standingRows ?? []) {
    let tab = byLeague.get(r.league_id);
    if (!tab) {
      tab = { id: r.league_id, name: r.league_name, members: [] };
      byLeague.set(r.league_id, tab);
    }
    tab.members.push({
      user_id: r.user_id ?? "",
      display_name: r.display_name ?? "Player",
      total_score: r.total_score ?? 0,
      is_me: r.user_id === userId,
    });
  }
  const leagues = Array.from(byLeague.values()).filter((l) => l.members.length > 0);

  const data: DashboardData = {
    userId,
    displayName: profile?.display_name ?? "",
    totalScore,
    globalRank,
    leagues,
    matches,
    featuredPacks,
  };

  return <Dashboard data={data} />;
}
