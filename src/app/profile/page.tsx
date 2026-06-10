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
    { data: draftStanding },
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
    // 38-0 global standings (null league_id = global row)
    sb.from("draft_standings")
      .select("wins_all_time, draws_all_time, losses_all_time")
      .eq("user_id", userId)
      .is("league_id", null)
      .maybeSingle(),
  ]);

  const totalScore = profile?.total_score ?? 0;

  const { count } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .gt("total_score", totalScore);
  const globalRank = profile ? (count ?? 0) + 1 : null;

  // Compute stats from room_scores (cast to any — columns added via migration)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRoomScores: any[] = roomScoreRows ?? [];
  const totalAnswered = allRoomScores.reduce((s: number, r: any) => s + (r.total_answers ?? 0), 0);
  const totalCorrect = allRoomScores.reduce((s: number, r: any) => s + (r.correct_answers ?? 0), 0);
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null;
  const bestStreak = allRoomScores.reduce((max: number, r: any) => Math.max(max, r.current_streak ?? 0), 0);
  const wins = allRoomScores.filter((r: any) => r.rank === 1).length;
  const multiplayerGames = allRoomScores.length;

  const name = profile?.display_name || user.email?.split("@")[0] || "Player";
  const gamesPlayed = profile?.games_played ?? 0;
  const friendCount = (friendRows ?? []).length;

  // Separate score breakdowns
  const quizMpScore = allRoomScores.reduce((s: number, r: any) => s + (r.total_score ?? 0), 0);
  const draftRecord = draftStanding
    ? { w: draftStanding.wins_all_time ?? 0, d: draftStanding.draws_all_time ?? 0, l: draftStanding.losses_all_time ?? 0 }
    : null;

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

        {/* Global rank hero */}
        {globalRank !== null && (
          <div className="rounded-2xl px-5 py-4"
            style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.1), rgba(0,255,135,0.05))", border: "1px solid rgba(167,139,250,0.2)" }}>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1.5">Global ranking</p>
                <p className="font-display text-5xl leading-none" style={{ color: "#a78bfa" }}>#{globalRank}</p>
                <p className="font-body text-xs text-text-muted mt-1.5">{totalScore.toLocaleString()} total points</p>
              </div>
              <div className="text-right flex flex-col items-end gap-2">
                {wins > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                    style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.25)" }}>
                    <span>🏆</span>
                    <span className="font-body text-xs font-bold" style={{ color: "#ffd700" }}>{wins} wins</span>
                  </div>
                )}
                <ShareStatsButton rank={globalRank} score={totalScore} accuracy={accuracy} />
              </div>
            </div>
          </div>
        )}

        {/* Score breakdown — quiz vs 38-0 */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl px-4 py-4 bg-surface" style={{ border: "1px solid rgba(255,184,0,0.15)" }}>
            <p className="font-body text-xs uppercase tracking-widest mb-2" style={{ color: "#ffb800" }}>⚡ Quiz Score</p>
            <p className="font-display text-3xl leading-none text-white">{quizMpScore > 0 ? quizMpScore.toLocaleString() : "—"}</p>
            <p className="font-body text-xs text-text-muted mt-1.5">Quiz + multiplayer pts</p>
          </div>
          <Link href="/38-0/history" className="block rounded-2xl px-4 py-4 bg-surface transition-opacity hover:opacity-80" style={{ border: "1px solid rgba(0,255,135,0.15)" }}>
            <p className="font-body text-xs uppercase tracking-widest mb-2" style={{ color: "#00ff87" }}>⚽ 38-0 Record</p>
            {draftRecord ? (
              <>
                <p className="font-display text-3xl leading-none text-white">
                  {draftRecord.w}<span className="text-xl" style={{ color: "#555577" }}>-{draftRecord.d}-{draftRecord.l}</span>
                </p>
                <p className="font-body text-xs text-text-muted mt-1.5">W-D-L · View history →</p>
              </>
            ) : (
              <>
                <p className="font-display text-3xl leading-none" style={{ color: "#444466" }}>—</p>
                <p className="font-body text-xs text-text-muted mt-1.5">No 38-0 games yet</p>
              </>
            )}
          </Link>
        </div>

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
