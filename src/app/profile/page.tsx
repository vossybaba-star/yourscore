/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserBounded } from "@/lib/supabase/bounded";
import { GridBackground } from "@/components/ui/GridBackground";
import { BottomNav } from "@/components/ui/BottomNav";
import { ShareStatsButton } from "@/components/ui/ShareStatsButton";

function AvatarCircle({ name, size = 64, avatarUrl }: { name: string; size?: number; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name} className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, border: "2px solid rgba(255,255,255,0.1)" }} />
    );
  }
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "2px solid rgba(255,255,255,0.1)" }}>
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

function tierColor(tier: string | null): string {
  switch (tier) {
    case "Elite": return "#00ff87";
    case "Diamond": return "#a78bfa";
    case "Platinum": return "#67e8f9";
    case "Gold": return "#ffd700";
    case "Silver": return "#c0c0c0";
    default: return "#b08d57"; // Bronze / unranked
  }
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const user = await getUserBounded(supabase);

  if (!user) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-body text-text-muted">Sign in to see your profile.</p>
          <Link href="/auth/sign-in" className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-body font-bold text-sm text-green"
            style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.28)" }}>
            Sign in →
          </Link>
        </div>
      </main>
    );
  }

  const userId = user.id;

  // Fetch everything in parallel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [
    { data: profile },
    { data: roomScoreRows },
    { data: challengeRows },
    { data: friendRows },
    { data: rankRows },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, total_score, games_played, avatar_url").eq("id", userId).single(),
    // created_at/rank added via migration — bypass stale generated types
    sb.from("room_scores")
      .select("room_id, total_score, correct_answers, total_answers, current_streak, rank, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("challenge_attempts")
      .select("score, max_score, completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false })
      .limit(10),
    // status column added via migration — bypass stale generated types
    sb.from("friendships")
      .select("user_id, friend_id, status")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq("status", "accepted"),
    // Unified YourScore Rank (two-track: Match + Knowledge) — RPC normalizes + blends
    sb.rpc("get_yourscore_rank", { p_user_id: userId }),
  ]);

  const totalScore = profile?.total_score ?? 0;

  // Unified two-track rank (from get_yourscore_rank RPC)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rank: any = (rankRows ?? [])[0] ?? null;
  const tier: string | null = rank?.tier ?? null;
  const overallRank: number | null = rank?.overall_rank ?? null;
  const matchScore: number = rank?.match_score ?? 0;
  const knowledgeScore: number = rank?.knowledge_score ?? 0;
  const matchPct: number = Number(rank?.match_pct ?? 0);
  const knowledgePct: number = Number(rank?.knowledge_pct ?? 0);

  // Compute stats from room_scores (cast to any — columns added via migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRoomScores: any[] = roomScoreRows ?? [];
  const totalAnswered = allRoomScores.reduce((s: number, r: any) => s + (r.total_answers ?? 0), 0);
  const totalCorrect = allRoomScores.reduce((s: number, r: any) => s + (r.correct_answers ?? 0), 0);
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;
  const bestStreak = allRoomScores.reduce((max: number, r: any) => Math.max(max, r.current_streak ?? 0), 0);
  const multiplayerGames = allRoomScores.length;

  const name = profile?.display_name || user.email?.split("@")[0] || "Player";
  const gamesPlayed = profile?.games_played ?? 0;
  const friendCount = (friendRows ?? []).length;

  // Two visible tracks come from the unified-rank RPC.
  const draftRecord = rank && (rank.wins || rank.draws || rank.losses || matchScore)
    ? { w: rank.wins ?? 0, d: rank.draws ?? 0, l: rank.losses ?? 0 }
    : null;

  // Cross-sell nudge: push the player toward their weaker track (the 38-0 <-> quiz bridge).
  const lowTrack: "match" | "knowledge" = matchPct <= knowledgePct ? "match" : "knowledge";
  const showNudge = !!rank && (matchScore === 0 || knowledgeScore === 0 || Math.abs(matchPct - knowledgePct) > 0.25);

  // Recently played with: other users who were in my last 20 rooms
  const myRecentRoomIds: string[] = Array.from(new Set(
    allRoomScores.slice(0, 20).map((r: any) => r.room_id).filter(Boolean)
  ));
  let recentlyPlayedWith: { user_id: string; display_name: string }[] = [];
  if (myRecentRoomIds.length > 0) {
    const { data: coPlayers } = await sb
      .from("room_scores")
      .select("user_id, profiles(display_name)")
      .in("room_id", myRecentRoomIds)
      .neq("user_id", userId)
      .limit(20);
    const seen = new Set<string>();
    recentlyPlayedWith = (coPlayers ?? [])
      .filter((r: any) => { if (seen.has(r.user_id)) return false; seen.add(r.user_id); return true; })
      .map((r: any) => ({ user_id: r.user_id, display_name: r.profiles?.display_name ?? "Player" }))
      .slice(0, 6);
  }

  // Recent multiplayer games (last 5)
  const recentMultiplayer = allRoomScores.slice(0, 5);

  // Recent solo challenges (last 5)
  const recentSolo = (challengeRows ?? []).slice(0, 5);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />

      {/* Sticky header */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 py-4">
          <div className="flex items-center gap-4">
            <AvatarCircle name={name} size={56} avatarUrl={profile?.avatar_url} />
            <div className="flex-1 min-w-0">
              <p className="font-display text-2xl text-white tracking-wide truncate">{name.toUpperCase()}</p>
              <p className="font-body text-xs text-text-muted mt-0.5 truncate">{user.email}</p>
              {gamesPlayed > 0 && <p className="font-body text-xs text-text-muted">{gamesPlayed} games played</p>}
            </div>
            <Link href="/settings" aria-label="Edit profile"
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80 text-text-muted"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M10.5 2.5l2 2L5 12H3v-2L10.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-5">

        {/* YourScore Rank hero — unified, two visible tracks */}
        {rank && (
          <div className="rounded-2xl px-5 py-4"
            style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.1), rgba(0,255,135,0.05))", border: `1px solid ${tierColor(tier)}33` }}>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1.5">YourScore Rank</p>
                <p className="font-display text-4xl leading-none" style={{ color: tierColor(tier) }}>{tier ?? "Unranked"}</p>
                <p className="font-body text-xs text-text-muted mt-1.5">
                  {overallRank !== null ? `#${overallRank} overall` : "Play to get ranked"}
                  {totalScore > 0 ? ` · ${totalScore.toLocaleString()} pts` : ""}
                </p>
              </div>
              <ShareStatsButton rank={overallRank ?? 0} score={totalScore} accuracy={accuracy} />
            </div>

            {/* the two tracks that feed the rank */}
            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <div className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.15)" }}>
                <p className="font-body text-[10px] uppercase tracking-widest" style={{ color: "#ffb800" }}>🧠 Knowledge</p>
                <p className="font-display text-2xl text-white leading-none mt-1">{knowledgeScore > 0 ? knowledgeScore.toLocaleString() : "—"}</p>
                <p className="font-body text-[10px] text-text-muted mt-1">quizzes + solo · better than {Math.round(knowledgePct * 100)}%</p>
              </div>
              <Link href="/38-0/history" className="block rounded-xl px-3 py-2.5 transition-opacity hover:opacity-80" style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.15)" }}>
                <p className="font-body text-[10px] uppercase tracking-widest" style={{ color: "#00ff87" }}>⚽ Match</p>
                <p className="font-display text-2xl text-white leading-none mt-1">
                  {draftRecord ? <>{draftRecord.w}<span className="text-base" style={{ color: "#555577" }}>-{draftRecord.d}-{draftRecord.l}</span></> : "—"}
                </p>
                <p className="font-body text-[10px] text-text-muted mt-1">38-0 W-D-L · better than {Math.round(matchPct * 100)}%</p>
              </Link>
            </div>
          </div>
        )}

        {/* Cross-sell nudge — push the weaker track (38-0 <-> quiz bridge) */}
        {showNudge && (
          <Link href={lowTrack === "match" ? "/38-0" : "/play"}
            className="flex items-center justify-between px-4 py-3 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
            style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}>
            <p className="font-body text-sm text-white pr-3">
              {lowTrack === "match"
                ? "⚽ Your Match track is low — play 38-0 to climb your rank"
                : "🧠 Your Knowledge track is low — play a quiz to climb your rank"}
            </p>
            <span className="font-body text-xs font-bold flex-shrink-0" style={{ color: "#a78bfa" }}>Play →</span>
          </Link>
        )}

        {/* Quick stats grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Accuracy", value: accuracy !== null ? `${accuracy}%` : "—", color: accuracy !== null && accuracy >= 70 ? "#00ff87" : accuracy !== null && accuracy >= 50 ? "#ffb800" : "#ffffff", icon: "🎯" },
            { label: "Best streak", value: bestStreak > 0 ? `${bestStreak}🔥` : "—", color: "#ffb800", icon: "⚡" },
            { label: "MP games", value: multiplayerGames > 0 ? String(multiplayerGames) : "—", color: "#a78bfa", icon: "👥" },
            { label: "Friends", value: String(friendCount), color: "#00c9ff", icon: "🤝" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl px-4 py-4 bg-surface cursor-default" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg">{s.icon}</span>
              </div>
              <p className="font-display text-3xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="font-body text-xs text-text-muted mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* 38-0 Match History strip */}
        <Link href="/38-0/history"
          className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ background: "linear-gradient(135deg, rgba(0,255,135,0.08), rgba(0,255,135,0.04))", border: "1px solid rgba(0,255,135,0.2)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgba(0,255,135,0.12)" }}>📋</div>
            <div>
              <p className="font-body text-sm font-bold text-white">38-0 Match History</p>
              <p className="font-body text-xs text-text-muted">
                {draftRecord ? `${draftRecord.w}W ${draftRecord.d}D ${draftRecord.l}L · all head-to-heads` : "View all head-to-heads"}
              </p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#00ff87", flexShrink: 0 }}>
            <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>

        {/* Rankings strip */}
        <Link href="/leaderboard"
          className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.08), rgba(167,139,250,0.04))", border: "1px solid rgba(167,139,250,0.2)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgba(167,139,250,0.12)" }}>🏅</div>
            <div>
              <p className="font-body text-sm font-bold text-white">Rankings</p>
              <p className="font-body text-xs text-text-muted">Global + friends leaderboard</p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#a78bfa", flexShrink: 0 }}>
            <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>

        {/* Friends / social strip */}
        <Link href="/friends"
          className="flex items-center justify-between px-5 py-4 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ background: "linear-gradient(135deg, rgba(0,201,255,0.08), rgba(0,201,255,0.04))", border: "1px solid rgba(0,201,255,0.2)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgba(0,201,255,0.12)" }}>🤝</div>
            <div>
              <p className="font-body text-sm font-bold text-white">Friends</p>
              <p className="font-body text-xs text-text-muted">
                {friendCount > 0 ? `${friendCount} friend${friendCount !== 1 ? "s" : ""}` : "Add your mates"}
              </p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: "#00c9ff", flexShrink: 0 }}>
            <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>

        {/* Recently played with */}
        {recentlyPlayedWith.length > 0 && (
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recently played with</p>
            <div className="flex flex-wrap gap-2">
              {recentlyPlayedWith.map((p) => (
                <Link key={p.user_id} href="/friends"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:opacity-90"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>
                    {(p.display_name[0] ?? "?").toUpperCase()}
                  </div>
                  <span className="font-body text-sm text-white">{p.display_name}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent multiplayer games */}
        {recentMultiplayer.length > 0 && (
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent multiplayer</p>
            <div className="space-y-2">
              {recentMultiplayer.map((g: any, i: number) => {
                const acc = g.total_answers ? Math.round(((g.correct_answers ?? 0) / g.total_answers) * 100) : null;
                const dateStr = g.created_at ? new Date(g.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: g.rank === 1 ? "rgba(255,215,0,0.15)" : "rgba(255,255,255,0.05)" }}>
                        {g.rank === 1 ? "🥇" : g.rank === 2 ? "🥈" : g.rank === 3 ? "🥉" : `#${g.rank ?? "?"}`}
                      </div>
                      <div>
                        <p className="font-body text-sm font-semibold text-white">
                          {g.correct_answers ?? 0}/{g.total_answers ?? 0} correct
                          {acc !== null && <span className="ml-1.5 text-xs" style={{ color: acc >= 70 ? "#00ff87" : "#8888aa" }}>{acc}%</span>}
                        </p>
                        <p className="font-body text-xs text-text-muted">{dateStr}</p>
                      </div>
                    </div>
                    <p className="font-display text-lg" style={{ color: "#a78bfa" }}>{(g.total_score ?? 0).toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent solo challenges */}
        {recentSolo.length > 0 && (
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent solo challenges</p>
            <div className="space-y-2">
              {recentSolo.map((c, i) => {
                const pct = c.max_score ? Math.round(((c.score ?? 0) / c.max_score) * 100) : null;
                const dateStr = c.completed_at ? new Date(c.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: "rgba(255,184,0,0.12)" }}>🎯</div>
                      <div>
                        <p className="font-body text-sm font-semibold text-white">
                          Solo challenge
                          {pct !== null && <span className="ml-1.5 text-xs" style={{ color: pct >= 70 ? "#00ff87" : "#8888aa" }}>{pct}%</span>}
                        </p>
                        <p className="font-body text-xs text-text-muted">{dateStr}</p>
                      </div>
                    </div>
                    <p className="font-display text-lg text-amber">{(c.score ?? 0).toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {recentMultiplayer.length === 0 && recentSolo.length === 0 && (
          <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-3xl mb-3">⚽</p>
            <p className="font-body text-sm text-text-muted mb-3">No games yet — play your first game to see stats here.</p>
            <Link href="/play" className="font-body text-sm font-semibold text-green">Start playing →</Link>
          </div>
        )}

        {/* Settings */}
        <Link href="/settings" className="flex items-center justify-between px-5 py-4 rounded-2xl transition-opacity hover:opacity-80 bg-surface"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="font-body text-sm text-white">Settings</span>
          <span className="font-body text-xs text-text-muted">Edit name, sign out →</span>
        </Link>

      </div>
      <BottomNav />
    </main>
  );
}
