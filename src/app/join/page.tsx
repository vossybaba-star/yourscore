/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { FlagImage } from "@/components/ui/FlagImage";
import { prefetchTeamImages } from "@/lib/teamImages";

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  tournament: string;
  status: string;
  home_score: number;
  away_score: number;
}

function groupByDate(matches: Match[]): { label: string; matches: Match[] }[] {
  const groups: Record<string, Match[]> = {};
  for (const m of matches) {
    const d = new Date(m.match_date);
    const isLive = m.status === "live";
    const key = isLive
      ? "__live__"
      : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  const result: { label: string; matches: Match[] }[] = [];
  if (groups["__live__"]) result.push({ label: "Live now", matches: groups["__live__"] });
  for (const [key, ms] of Object.entries(groups)) {
    if (key !== "__live__") result.push({ label: key, matches: ms });
  }
  return result;
}

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6v3.5L2 11h12l-1.5-1.5V6c0-2.485-2.015-4.5-4.5-4.5z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
        fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.25 : 0} />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function JerseyImg({ src, alt, size = 52 }: { src?: string; alt: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!src || err) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={size} height={size}
      className="object-contain flex-shrink-0 drop-shadow-lg"
      style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))" }}
      onError={() => setErr(true)} loading="lazy" />
  );
}


export default function PlayPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const isGuest = !userLoading && !user;
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [activePlayerCounts, setActivePlayerCounts] = useState<Record<string, number>>({});
  const [myInterests, setMyInterests] = useState<Set<string>>(new Set());
  const [myNotifications, setMyNotifications] = useState<Set<string>>(new Set());
  const [toggling, setToggling] = useState<string | null>(null);
  const [notifToggling, setNotifToggling] = useState<string | null>(null);
  const [teamImages, setTeamImages] = useState<Record<string, string>>({});

  useEffect(() => {
    if (userLoading) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setLoading(false); return; }
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      const now = new Date().toISOString();

      const { data } = await (sb as any)
        .from("matches")
        .select("id, home_team, away_team, match_date, tournament, status, home_score, away_score")
        .or(`status.eq.live,and(status.eq.upcoming,match_date.gte.${now})`)
        .order("match_date", { ascending: true })
        .limit(30);

      const matchList: Match[] = data ?? [];
      setMatches(matchList);

      // Prefetch jersey images for all teams
      if (matchList.length > 0) {
        const allTeams = matchList.flatMap(m => [m.home_team, m.away_team]);
        prefetchTeamImages(allTeams).then(setTeamImages);

        const ids = matchList.map(m => m.id);
        const [iRes, sRes, myRes, myNotifRes] = await Promise.all([
          (sb as any).from("match_interests").select("match_id").in("match_id", ids),
          (sb as any).from("match_scores").select("match_id, user_id").in("match_id", ids),
          user
            ? (sb as any).from("match_interests").select("match_id").eq("user_id", user.id).in("match_id", ids)
            : Promise.resolve({ data: [] }),
          user
            ? (sb as any).from("match_notifications").select("match_id").eq("user_id", user.id).in("match_id", ids)
            : Promise.resolve({ data: [] }),
        ]);

        const iMap: Record<string, number> = {};
        for (const i of (iRes.data ?? [])) iMap[i.match_id] = (iMap[i.match_id] ?? 0) + 1;
        setParticipantCounts(iMap);

        const pMap: Record<string, Set<string>> = {};
        for (const s of (sRes.data ?? [])) {
          if (!pMap[s.match_id]) pMap[s.match_id] = new Set();
          pMap[s.match_id].add(s.user_id);
        }
        const pCounts: Record<string, number> = {};
        for (const [k, v] of Object.entries(pMap)) pCounts[k] = (v as Set<string>).size;
        setActivePlayerCounts(pCounts);

        const myIds: string[] = (myRes.data ?? []).map((i: any) => i.match_id as string);
        setMyInterests(new Set<string>(myIds));

        const myNotifIds: string[] = (myNotifRes.data ?? []).map((i: any) => i.match_id as string);
        setMyNotifications(new Set<string>(myNotifIds));
      }
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, userLoading]);

  const toggleInterest = async (e: React.MouseEvent, matchId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { router.push("/auth/sign-in"); return; }
    if (toggling) return;
    setToggling(matchId);
    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient() as any;
    const was = myInterests.has(matchId);
    if (was) {
      await sb.from("match_interests").delete().eq("match_id", matchId).eq("user_id", user.id);
      setMyInterests(p => { const s = new Set<string>(Array.from(p)); s.delete(matchId); return s; });
      setParticipantCounts(p => ({ ...p, [matchId]: Math.max(0, (p[matchId] ?? 1) - 1) }));
    } else {
      await sb.from("match_interests").insert({ match_id: matchId, user_id: user.id });
      setMyInterests(p => new Set<string>(Array.from(p).concat(matchId)));
      setParticipantCounts(p => ({ ...p, [matchId]: (p[matchId] ?? 0) + 1 }));
    }
    setToggling(null);
  };

  const toggleNotification = async (e: React.MouseEvent, matchId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { router.push("/auth/sign-in"); return; }
    if (notifToggling) return;
    setNotifToggling(matchId);
    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient() as any;
    const was = myNotifications.has(matchId);
    if (was) {
      await sb.from("match_notifications").delete().eq("match_id", matchId).eq("user_id", user.id);
      setMyNotifications(p => { const s = new Set<string>(Array.from(p)); s.delete(matchId); return s; });
    } else {
      await sb.from("match_notifications").insert({ match_id: matchId, user_id: user.id });
      setMyNotifications(p => new Set<string>(Array.from(p).concat(matchId)));
    }
    setNotifToggling(null);
  };

  const liveCount = matches.filter(m => m.status === "live").length;
  const activePlayers = Object.values(activePlayerCounts).reduce((a, b) => a + b, 0);
  const totalInterested = Object.values(participantCounts).reduce((a, b) => a + b, 0);
  const grouped = groupByDate(matches);

  // My Schedule: upcoming matches the user has committed to
  const mySchedule = matches.filter(m =>
    m.status !== "live" && myInterests.has(m.id)
  ).sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime());

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)",
        backgroundSize: "40px 40px",
      }} />
      <div className="fixed top-0 left-0 w-[400px] h-[400px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 0% 0%, rgba(0,255,135,0.06) 0%, transparent 60%)" }} />

      {/* Header */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl text-white tracking-wider">Matches</h1>
              <p className="font-body text-xs mt-1" style={{ color: "#8888aa" }}>
                {liveCount > 0
                  ? `${liveCount} match${liveCount > 1 ? "es" : ""} live now`
                  : totalInterested > 0
                    ? `${totalInterested} players locked in for upcoming games`
                    : "Pick a match · answer questions · earn points"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {liveCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-shrink-0"
                  style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.25)" }}>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff87" }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#00ff87" }} />
                  </span>
                  <span className="font-body text-xs font-bold" style={{ color: "#00ff87" }}>
                    {activePlayers > 0 ? `${activePlayers} playing` : "LIVE"}
                  </span>
                </div>
              )}
              {user ? (
                <Link href="/profile" className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm transition-opacity hover:opacity-80 flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #1a2f4a, #2a1a4a)", color: "#a78bfa", border: "1.5px solid rgba(167,139,250,0.25)" }}>
                  {(user.email?.[0] ?? "?").toUpperCase()}
                </Link>
              ) : (
                <Link href="/auth/sign-in"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-body text-sm font-bold flex-shrink-0 transition-opacity hover:opacity-90"
                  style={{ background: "#00ff87", color: "#0a0a0f" }}>
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-4 space-y-6 pb-4">

        {loading && (
          <div className="flex items-center justify-center py-20"><Spinner size={28} /></div>
        )}

        {!loading && matches.length === 0 && (
          <div className="rounded-2xl p-10 text-center"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-4xl mb-3">⚽</p>
            <p className="font-display text-2xl text-white mb-2">No live games right now</p>
            <p className="font-body text-sm mb-6" style={{ color: "#8888aa" }}>
              Games go live on match day. World Cup kicks off June 11.
            </p>
            <Link href="/league/new"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-body font-bold text-sm"
              style={{ background: "#a78bfa", color: "#0a0a0f" }}>
              Set up your league →
            </Link>
          </div>
        )}

        {/* ── Guest sign-in banner ─────────────────────────────────────────────── */}
        {!loading && isGuest && (
          <div className="rounded-2xl px-5 py-5 flex items-center gap-4"
            style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.18)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,255,135,0.12)", border: "1px solid rgba(0,255,135,0.25)" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 9.5L9 4l6 5.5V15.5a.75.75 0 0 1-.75.75H3.75A.75.75 0 0 1 3 15.5z" stroke="#00ff87" strokeWidth="1.4" strokeLinejoin="round"/>
                <path d="M6.5 16.25v-5.5h5v5.5" stroke="#00ff87" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-bold text-white">Sign in to join live matches</p>
              <p className="font-body text-xs mt-0.5" style={{ color: "#8888aa" }}>Answer questions · earn points · climb the league</p>
            </div>
            <Link href="/auth/sign-in"
              className="flex-shrink-0 px-4 py-2 rounded-xl font-body text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: "#00ff87", color: "#0a0a0f" }}>
              Sign in
            </Link>
          </div>
        )}

        {/* ── My Schedule ──────────────────────────────────────────────────────── */}
        {!loading && mySchedule.length > 0 && user && (
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1.5" y="2" width="10" height="9.5" rx="1.5" stroke="#a78bfa" strokeWidth="1.3"/>
                <path d="M1.5 5h10" stroke="#a78bfa" strokeWidth="1.3"/>
                <path d="M4.5 1v2M8.5 1v2" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M4 7.5h1.5M7 7.5h2" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <p className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: "#a78bfa" }}>
                My schedule
              </p>
              <span className="font-body text-xs px-1.5 py-0.5 rounded-full tabular-nums"
                style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa" }}>
                {mySchedule.length}
              </span>
            </div>

            {/* Horizontal scroll */}
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {mySchedule.map(m => {
                const d = new Date(m.match_date);
                const dayStr = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                const notified = myNotifications.has(m.id);

                return (
                  <Link key={m.id} href={`/match/${m.id}`}
                    className="flex-shrink-0 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
                    style={{
                      width: 168,
                      background: "linear-gradient(160deg, rgba(167,139,250,0.08) 0%, #12121e 70%)",
                      border: "1px solid rgba(167,139,250,0.2)",
                    }}>
                    {/* Jersey preview */}
                    <div className="flex items-end justify-center gap-0 pt-3 pb-1 relative overflow-hidden"
                      style={{ minHeight: 72, background: "rgba(0,0,0,0.2)" }}>
                      {(teamImages[m.home_team] || teamImages[m.away_team]) ? (
                        <>
                          {teamImages[m.home_team] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={teamImages[m.home_team]} alt={m.home_team} width={52} height={52}
                              className="object-contain relative z-10"
                              style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.6))" }}
                              loading="lazy" />
                          )}
                          {teamImages[m.away_team] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={teamImages[m.away_team]} alt={m.away_team} width={52} height={52}
                              className="object-contain relative z-10 -ml-3"
                              style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.6))" }}
                              loading="lazy" />
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2 pb-2">
                          <FlagImage team={m.home_team} size={28} />
                          <FlagImage team={m.away_team} size={28} />
                        </div>
                      )}
                    </div>

                    <div className="px-3 py-2.5">
                      <p className="font-body text-xs font-bold text-white leading-tight truncate">
                        {m.home_team} <span style={{ color: "#555577" }}>vs</span> {m.away_team}
                      </p>
                      <p className="font-body text-xs mt-0.5" style={{ color: "#8888aa" }}>
                        {dayStr} · {timeStr}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="flex h-1.5 w-1.5 rounded-full" style={{ background: "#00ff87" }} />
                        <span className="font-body text-xs" style={{ color: "#00ff87" }}>Playing</span>
                        {notified && (
                          <>
                            <span style={{ color: "#333355" }}>·</span>
                            <span className="font-body text-xs" style={{ color: "#a78bfa" }}>🔔</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Match groups ─────────────────────────────────────────────────────── */}
        {!loading && grouped.map(({ label, matches: ms }) => {
          const isLiveSection = label === "Live now";
          return (
            <div key={label}>
              <div className="flex items-center gap-3 mb-3 px-1">
                {isLiveSection && (
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff87" }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "#00ff87" }} />
                  </span>
                )}
                <p className="font-body text-xs font-bold uppercase tracking-widest"
                  style={{ color: isLiveSection ? "#00ff87" : "#555577" }}>
                  {label}
                </p>
                {isLiveSection && activePlayers > 0 && (
                  <span className="font-body text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(0,255,135,0.08)", color: "#00ff87" }}>
                    {activePlayers} active
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {ms.map((m) => {
                  const isLive = m.status === "live";
                  const interested = myInterests.has(m.id);
                  const notified = myNotifications.has(m.id);
                  const intCount = participantCounts[m.id] ?? 0;
                  const activeCount = activePlayerCounts[m.id] ?? 0;
                  const timeStr = new Date(m.match_date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                  const homeJersey = teamImages[m.home_team];
                  const awayJersey = teamImages[m.away_team];

                  if (isLive) {
                    return (
                      <Link key={m.id} href={`/match/${m.id}`}
                        className="block rounded-2xl overflow-hidden active:scale-[0.99] transition-transform"
                        style={{
                          background: "linear-gradient(160deg, rgba(0,255,135,0.08) 0%, rgba(10,10,15,1) 65%)",
                          border: "1px solid rgba(0,255,135,0.3)",
                          boxShadow: "0 0 50px rgba(0,255,135,0.07), inset 0 1px 0 rgba(0,255,135,0.1)",
                        }}>
                        {/* Top bar */}
                        <div className="flex items-center justify-between px-5 pt-4 pb-1">
                          <span className="font-body text-xs" style={{ color: "#8888aa" }}>{m.tournament}</span>
                          <div className="flex items-center gap-2">
                            {activeCount > 0 && (
                              <span className="font-body text-xs font-semibold" style={{ color: "#00ff87" }}>
                                {activeCount} playing
                              </span>
                            )}
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                              style={{ background: "rgba(0,255,135,0.12)", border: "1px solid rgba(0,255,135,0.25)" }}>
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff87" }} />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#00ff87" }} />
                              </span>
                              <span className="font-body text-xs font-bold" style={{ color: "#00ff87" }}>LIVE</span>
                            </div>
                          </div>
                        </div>

                        {/* Teams + jerseys */}
                        <div className="flex items-center justify-between px-5 pt-3 pb-2 gap-2">
                          {/* Home */}
                          <div className="flex flex-col items-center gap-2 flex-1">
                            {homeJersey
                              ? <JerseyImg src={homeJersey} alt={m.home_team} size={64} />
                              : <FlagImage team={m.home_team} size={56} />}
                            <p className="font-body text-sm font-semibold text-white text-center">{m.home_team}</p>
                          </div>
                          {/* Score */}
                          <div className="flex-shrink-0 text-center px-2">
                            <p className="font-display text-5xl text-white tabular-nums leading-none">
                              {m.home_score}
                              <span style={{ color: "rgba(255,255,255,0.2)" }}>–</span>
                              {m.away_score}
                            </p>
                            <div className="flex items-center justify-center gap-1.5 mt-1.5">
                              <FlagImage team={m.home_team} size={16} />
                              <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>vs</span>
                              <FlagImage team={m.away_team} size={16} />
                            </div>
                          </div>
                          {/* Away */}
                          <div className="flex flex-col items-center gap-2 flex-1">
                            {awayJersey
                              ? <JerseyImg src={awayJersey} alt={m.away_team} size={64} />
                              : <FlagImage team={m.away_team} size={56} />}
                            <p className="font-body text-sm font-semibold text-white text-center">{m.away_team}</p>
                          </div>
                        </div>

                        {/* Action bar */}
                        <div className="flex gap-2 px-4 pb-4">
                          {isGuest ? (
                            <Link href="/auth/sign-in"
                              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-body font-bold text-sm"
                              style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.25)" }}>
                              Sign in to join →
                            </Link>
                          ) : (
                            <>
                              <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-body font-bold text-sm"
                                style={{ background: "#00ff87", color: "#0a0a0f" }}>
                                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                  <path d="M3 1.5l9 5-9 5z" fill="currentColor" />
                                </svg>
                                Join game now
                              </div>
                              <button
                                onClick={(e) => toggleNotification(e, m.id)}
                                disabled={notifToggling === m.id}
                                className="flex items-center justify-center w-11 rounded-xl transition-all disabled:opacity-60"
                                style={{
                                  background: notified ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.06)",
                                  border: `1px solid ${notified ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.1)"}`,
                                  color: notified ? "#a78bfa" : "#555577",
                                }}>
                                {notifToggling === m.id
                                  ? <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "currentColor" }} />
                                  : <BellIcon active={notified} />}
                              </button>
                            </>
                          )}
                        </div>
                      </Link>
                    );
                  }

                  // ── Upcoming card ──────────────────────────────────────────────
                  return (
                    <Link key={m.id} href={`/match/${m.id}`}
                      className="block rounded-2xl overflow-hidden transition-all active:scale-[0.99]"
                      style={{
                        background: interested ? "rgba(0,255,135,0.03)" : "#12121e",
                        border: `1px solid ${interested ? "rgba(0,255,135,0.22)" : "rgba(255,255,255,0.07)"}`,
                      }}>

                      {/* Jersey strip — shown if images available */}
                      {(homeJersey || awayJersey) && (
                        <div className="flex items-center justify-between px-4 pt-3 pb-1">
                          <div className="flex items-center gap-2">
                            {homeJersey && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={homeJersey} alt={m.home_team} width={40} height={40}
                                className="object-contain" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
                                loading="lazy" />
                            )}
                            {awayJersey && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={awayJersey} alt={m.away_team} width={40} height={40}
                                className="object-contain -ml-1" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
                                loading="lazy" />
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-body text-xs font-bold" style={{ color: "#aaaacc" }}>{timeStr}</span>
                            <span style={{ color: "rgba(255,255,255,0.12)" }}>·</span>
                            <span className="font-body text-xs truncate max-w-[120px]" style={{ color: "#555577" }}>{m.tournament}</span>
                          </div>
                        </div>
                      )}

                      <div className="px-4 pt-3 pb-3">
                        {/* Meta row — only if no jersey strip */}
                        {!homeJersey && !awayJersey && (
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-body text-xs font-bold" style={{ color: "#aaaacc" }}>{timeStr}</span>
                              <span style={{ color: "rgba(255,255,255,0.12)" }}>·</span>
                              <span className="font-body text-xs truncate max-w-[150px]" style={{ color: "#555577" }}>{m.tournament}</span>
                            </div>
                          </div>
                        )}

                        {/* Players count */}
                        {intCount > 0 && (
                          <div className="flex items-center gap-1.5 mb-2">
                            {interested && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: "#00ff87" }} />}
                            <span className="font-body text-xs font-semibold"
                              style={{ color: interested ? "#00ff87" : "#555577" }}>
                              {intCount} {intCount === 1 ? "player" : "players"} joining
                            </span>
                          </div>
                        )}

                        {/* Teams */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <FlagImage team={m.home_team} size={32} />
                            <p className="font-body text-base font-bold text-white truncate">{m.home_team}</p>
                          </div>
                          <span className="font-body text-xs font-bold flex-shrink-0" style={{ color: "#333355" }}>vs</span>
                          <div className="flex items-center gap-2.5 flex-1 min-w-0 flex-row-reverse">
                            <FlagImage team={m.away_team} size={32} />
                            <p className="font-body text-base font-bold text-white truncate text-right">{m.away_team}</p>
                          </div>
                        </div>
                      </div>

                      {/* Action bar */}
                      <div className="flex gap-2 px-4 pb-4">
                        {isGuest ? (
                          <Link href="/auth/sign-in"
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-body text-sm font-bold"
                            style={{ background: "rgba(255,255,255,0.04)", color: "#8888aa", border: "1px solid rgba(255,255,255,0.08)" }}>
                            Sign in to play →
                          </Link>
                        ) : (
                          <>
                            <button
                              onClick={(e) => toggleInterest(e, m.id)}
                              disabled={toggling === m.id}
                              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-body text-sm font-bold transition-all disabled:opacity-60"
                              style={{
                                background: interested ? "rgba(0,255,135,0.12)" : "rgba(255,255,255,0.05)",
                                color: interested ? "#00ff87" : "#aaaacc",
                                border: `1px solid ${interested ? "rgba(0,255,135,0.3)" : "rgba(255,255,255,0.08)"}`,
                              }}>
                              {toggling === m.id ? (
                                <div className="w-4 h-4 rounded-full border-2 animate-spin"
                                  style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "currentColor" }} />
                              ) : interested ? (
                                <>
                                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                    <path d="M2 6.5l3.5 3.5 5.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  I&apos;m playing
                                </>
                              ) : (
                                <>
                                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                    <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  </svg>
                                  I&apos;m playing
                                </>
                              )}
                            </button>
                            <button
                              onClick={(e) => toggleNotification(e, m.id)}
                              disabled={notifToggling === m.id}
                              className="flex items-center justify-center w-11 rounded-xl transition-all disabled:opacity-60"
                              style={{
                                background: notified ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.04)",
                                border: `1px solid ${notified ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.07)"}`,
                                color: notified ? "#a78bfa" : "#555577",
                              }}>
                              {notifToggling === m.id
                                ? <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "currentColor" }} />
                                : <BellIcon active={notified} />}
                            </button>
                          </>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <BottomNav />
    </main>
  );
}
