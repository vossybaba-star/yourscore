"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { useUser } from "@/hooks/useUser";
import { Spinner } from "@/components/ui/Spinner";

interface RoomData {
  id: string;
  name: string;
  code: string;
  status: "lobby" | "live" | "completed";
  created_by: string | null;
  match: { home_team: string; away_team: string; match_date: string; flag_home: string; flag_away: string } | null;
  player_count: number;
  creator_name: string;
}

function MatchCountdown({ matchDate }: { matchDate: string }) {
  const [diff, setDiff] = useState(new Date(matchDate).getTime() - Date.now());

  useEffect(() => {
    const iv = setInterval(() => setDiff(new Date(matchDate).getTime() - Date.now()), 1000);
    return () => clearInterval(iv);
  }, [matchDate]);

  if (diff <= 0) return <span style={{ color: "#00ff87" }} className="font-body text-xs font-semibold">LIVE NOW</span>;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 48) {
    const d = Math.floor(h / 24);
    return <span className="font-body text-xs text-text-muted">in {d} days</span>;
  }
  if (h > 0) return <span className="font-body text-xs text-amber font-semibold">Match in {h}h {m}m</span>;
  return <span className="font-body text-xs font-semibold" style={{ color: "#ff4757" }}>Kicks off in {m}m</span>;
}

export default function JoinRoomPage({ params }: { params: { code: string } }) {
  return <Suspense fallback={<div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>}><JoinRoomInner params={params} /></Suspense>;
}

function JoinRoomInner({ params }: { params: { code: string } }) {
  const { user, loading: authLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [whatsapp, setWhatsapp] = useState("");
  const [wantNotifs, setWantNotifs] = useState(true);
  const [joining, setJoining] = useState(false);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [roomLoading, setRoomLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const challengerName = searchParams.get("from");
  const challengerScore = searchParams.get("score");
  const isChallenge = !!(challengerName && challengerScore);

  // Fetch room by code
  useEffect(() => {
    const code = params.code.toUpperCase();
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // Dev fallback
      setRoom({
        id: "mock-room-id", name: "The Lads' Room", code,
        status: "lobby", created_by: null,
        match: { home_team: "England", away_team: "France", match_date: "2026-06-15T19:00:00Z", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", flag_away: "🇫🇷" },
        player_count: 7, creator_name: "Zach",
      });
      setRoomLoading(false);
      return;
    }
    import("@/lib/supabase/client").then(({ createClient }) => {
      const sb = createClient();
      sb.from("rooms")
        .select("id, name, code, status, created_by, match_id, matches(home_team, away_team, match_date), profiles!rooms_created_by_fkey(display_name)")
        .eq("code", code)
        .single()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(async ({ data, error }) => {
          if (error || !data) { setNotFound(true); setRoomLoading(false); return; }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = data as any;
          // Get player count
          const { count } = await sb.from("room_members").select("*", { count: "exact", head: true }).eq("room_id", d.id);
          const FLAG_MAP: Record<string, string> = {
            England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", France: "🇫🇷", Brazil: "🇧🇷", Argentina: "🇦🇷", Germany: "🇩🇪",
            Spain: "🇪🇸", Portugal: "🇵🇹", Netherlands: "🇳🇱", USA: "🇺🇸", Mexico: "🇲🇽", Italy: "🇮🇹", Morocco: "🇲🇦",
          };
          setRoom({
            id: d.id, name: d.name, code: d.code, status: d.status,
            created_by: d.created_by,
            match: d.matches ? {
              home_team: d.matches.home_team, away_team: d.matches.away_team,
              match_date: d.matches.match_date,
              flag_home: FLAG_MAP[d.matches.home_team] ?? "🏳️",
              flag_away: FLAG_MAP[d.matches.away_team] ?? "🏳️",
            } : null,
            player_count: count ?? 0,
            creator_name: d.profiles?.display_name ?? "Host",
          });
          setRoomLoading(false);
        });
    });
  }, [params.code]);

  async function handleJoin() {
    if (!user || !room) return;
    setJoining(true);

    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      // Upsert room_members (idempotent)
      await sb.from("room_members").upsert({
        room_id: room.id,
        user_id: user.id,
        whatsapp_number: wantNotifs && whatsapp ? whatsapp : null,
        notification_consent: wantNotifs && !!whatsapp,
      }, { onConflict: "room_id,user_id", ignoreDuplicates: false });
    }

    router.push(`/room/${room.id}`);
  }

  if (authLoading || roomLoading) {
    return (
      <div className="min-h-dvh bg-bg flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (notFound) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-display text-4xl text-white">ROOM NOT FOUND</p>
          <p className="font-body text-text-muted">Code <strong className="text-white">{params.code.toUpperCase()}</strong> doesn&apos;t match any room.</p>
          <Link href="/join" className="inline-block font-body text-sm font-semibold mt-2" style={{ color: "#00ff87" }}>← Try another code</Link>
        </div>
      </main>
    );
  }

  if (!room) return null;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-lg mx-auto">
        <Link href="/" className="font-display text-2xl text-white tracking-wider hover:opacity-80 transition-opacity">YOURSCORE</Link>
      </nav>

      <div className="relative z-10 max-w-lg mx-auto px-6 py-4">
        {/* Challenge banner */}
        {isChallenge && (
          <div className="rounded-2xl px-5 py-4 mb-4 flex items-center gap-3" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.2)" }}>
            <span className="text-xl">👀</span>
            <div>
              <p className="font-body text-sm font-semibold text-white">
                {challengerName} scored{" "}
                <span className="font-display text-base" style={{ color: "#ffb800" }}>{Number(challengerScore).toLocaleString()} pts</span>
              </p>
              <p className="font-body text-xs text-text-muted mt-0.5">Think you can beat them? Prove it.</p>
            </div>
          </div>
        )}

        {/* Room card */}
        <div className="rounded-2xl overflow-hidden mb-5" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="px-5 pt-5 pb-4" style={{ background: "#12121e" }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-1">
                  {isChallenge ? `${challengerName} invited you to` : `${room.creator_name} invited you to`}
                </p>
                <h1 className="font-display text-4xl text-white leading-none">{room.name}</h1>
              </div>
              <span className="font-display text-2xl" style={{ color: "#00ff87" }}>{room.code}</span>
            </div>

            {room.match && (
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl mb-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span>{room.match.flag_home}</span>
                <span className="font-body text-sm font-medium text-white">{room.match.home_team} vs {room.match.away_team}</span>
                <span>{room.match.flag_away}</span>
                <span className="mx-1 text-white/20">·</span>
                <MatchCountdown matchDate={room.match.match_date} />
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="flex -space-x-1">
                  {Array.from({ length: Math.min(room.player_count || 1, 4) }).map((_, i) => (
                    <div key={i} className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-body font-bold"
                      style={{ background: ["#1a2f4a","#2a1a4a","#1a4a2a","#4a2a1a"][i%4], border: "1px solid rgba(255,255,255,0.1)", color: ["#60a5fa","#a78bfa","#4ade80","#fb923c"][i%4], zIndex: 4 - i }}>
                      {String.fromCharCode(65 + i)}
                    </div>
                  ))}
                </div>
                <span className="font-body text-xs text-text-muted">{room.player_count} already in</span>
              </div>
              <span className="font-body text-xs text-text-muted">Host: {room.creator_name}</span>
            </div>
          </div>
        </div>

        {/* Auth / join */}
        {!user ? (
          <div className="rounded-2xl p-5 mb-4" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="font-body text-sm font-semibold text-white mb-1">Sign in to join</p>
            <p className="font-body text-xs text-text-muted mb-4">Your score, streak and history saved automatically. Free. Takes 10 seconds.</p>
            <SignInWithGoogle redirectTo={`/join/${params.code}`} />
          </div>
        ) : (
          <>
            <div className="rounded-2xl p-5 mb-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-start gap-3 mb-3">
                <button
                  onClick={() => setWantNotifs(!wantNotifs)}
                  className="w-5 h-5 rounded flex-shrink-0 mt-0.5 flex items-center justify-center transition-all"
                  style={{ background: wantNotifs ? "#00ff87" : "transparent", border: `1.5px solid ${wantNotifs ? "#00ff87" : "rgba(255,255,255,0.2)"}` }}
                >
                  {wantNotifs && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#0a0a0f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </button>
                <div>
                  <p className="font-body text-sm text-white font-medium">
                    WhatsApp notifications <span className="font-body text-xs text-text-muted font-normal">(optional)</span>
                  </p>
                  <p className="font-body text-xs text-text-muted mt-0.5">Get pinged the moment questions fire. We only message you during this game.</p>
                </div>
              </div>
              {wantNotifs && (
                <div className="mt-3">
                  <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+44 7700 900000"
                    className="w-full rounded-xl px-4 py-3 font-body text-white text-sm outline-none transition-all placeholder:text-white/20"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <p className="font-body text-xs text-text-muted mt-2">Include country code.</p>
                </div>
              )}
            </div>
            <button onClick={handleJoin} disabled={joining}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-body font-bold text-base transition-all"
              style={{ background: "#00ff87", color: "#0a0a0f", boxShadow: "0 0 20px rgba(0,255,135,0.25)" }}>
              {joining ? <Spinner size={18} /> : "Join room"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
