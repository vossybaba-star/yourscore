"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MOCK_MATCHES, generateRoomCode, formatMatchDate } from "@/lib/rooms";
import { RoomCodeShare } from "@/components/room/RoomCodeShare";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { useUser } from "@/hooks/useUser";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";

type Step = "match" | "name" | "done";

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  flag_home: string;
  flag_away: string;
}

const FLAG_MAP: Record<string, string> = {
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", France: "🇫🇷", Brazil: "🇧🇷", Argentina: "🇦🇷", Germany: "🇩🇪",
  Spain: "🇪🇸", Portugal: "🇵🇹", Netherlands: "🇳🇱", USA: "🇺🇸", Mexico: "🇲🇽", Italy: "🇮🇹", Morocco: "🇲🇦",
};

export default function CreateRoomPage() {
  return <Suspense fallback={<div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>}><CreateRoomInner /></Suspense>;
}

function CreateRoomInner() {
  const { user, loading } = useUser();
  const router = useRouter();
  void router;
  const searchParams = useSearchParams();
  const preselectedMatchId = searchParams.get("match");

  const [step, setStep] = useState<Step>("match");
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [roomName, setRoomName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{ id: string; code: string } | null>(null);

  // Load matches — try Supabase, fall back to MOCK_MATCHES
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const m = MOCK_MATCHES.map((m) => ({ ...m, flag_home: m.flag_home, flag_away: m.flag_away }));
      setMatches(m);
      if (preselectedMatchId) setSelectedMatch(m.find((x) => x.id === preselectedMatchId) ?? null);
      setMatchesLoading(false);
      return;
    }
    const sb = createClient();
    sb.from("matches")
      .select("id, home_team, away_team, match_date")
      .in("status", ["upcoming", "live"])
      .order("match_date", { ascending: true })
      .limit(20)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const m: Match[] = data.map((d) => ({
            id: d.id, home_team: d.home_team, away_team: d.away_team, match_date: d.match_date,
            flag_home: FLAG_MAP[d.home_team] ?? "🏳️",
            flag_away: FLAG_MAP[d.away_team] ?? "🏳️",
          }));
          setMatches(m);
          if (preselectedMatchId) setSelectedMatch(m.find((x) => x.id === preselectedMatchId) ?? null);
        } else {
          // No DB matches yet — use mock
          const m = MOCK_MATCHES.map((m) => ({ ...m }));
          setMatches(m);
          if (preselectedMatchId) setSelectedMatch(m.find((x) => x.id === preselectedMatchId) ?? null);
        }
        setMatchesLoading(false);
      });
  }, [preselectedMatchId]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-bg flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  async function handleCreateRoom() {
    if (!selectedMatch || !roomName.trim()) return;
    setSubmitting(true);

    const code = generateRoomCode(selectedMatch.home_team);

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      await new Promise((r) => setTimeout(r, 600));
      setCreatedRoom({ id: "mock-room-id", code });
      setStep("done");
      setSubmitting(false);
      return;
    }

    try {
      const supabase = createClient();
      // Try to find real match_id — use null if it's a mock ID (e.g. "m1")
      const isRealUuid = /^[0-9a-f-]{36}$/i.test(selectedMatch.id);
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          code,
          name: roomName.trim(),
          created_by: user?.id ?? null,
          match_id: isRealUuid ? selectedMatch.id : null,
        })
        .select("id, code")
        .single();

      if (error) throw error;
      setCreatedRoom({ id: data.id, code: data.code });
      setStep("done");

      // Auto-add creator as member
      if (user) {
        await supabase.from("room_members").upsert({
          room_id: data.id,
          user_id: user.id,
          notification_consent: false,
        }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh bg-bg">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-2xl mx-auto">
        <Link href="/" className="font-display text-2xl text-white tracking-wider hover:opacity-80 transition-opacity">YOURSCORE</Link>
        {user && (
          <div className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center text-xs font-body font-semibold text-white" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
            {user.email?.[0].toUpperCase()}
          </div>
        )}
      </nav>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-6">
        {/* Progress */}
        {step !== "done" && (
          <div className="flex items-center gap-2 mb-8">
            {(["match", "name"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-display text-sm transition-all"
                  style={{ background: step === s ? "#00ff87" : i < ["match","name"].indexOf(step) ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.06)", color: step === s ? "#0a0a0f" : "#8888aa" }}>
                  {i + 1}
                </div>
                <span className="font-body text-xs text-text-muted capitalize hidden sm:block">{s === "match" ? "Pick match" : "Name room"}</span>
                {i < 1 && <div className="w-8 h-px bg-white/10 mx-1" />}
              </div>
            ))}
          </div>
        )}

        {/* Step: Pick match */}
        {step === "match" && (
          <div>
            <h1 className="font-display text-5xl text-white mb-2">PICK A MATCH</h1>
            <p className="font-body text-text-muted mb-8">Choose the World Cup fixture your room is for.</p>

            {matchesLoading ? (
              <div className="flex items-center justify-center py-12"><Spinner size={28} /></div>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => (
                  <button key={match.id} onClick={() => setSelectedMatch(match)}
                    className="w-full rounded-2xl p-4 text-left transition-all hover:opacity-90"
                    style={{ background: selectedMatch?.id === match.id ? "rgba(0,255,135,0.08)" : "#12121e", border: `1px solid ${selectedMatch?.id === match.id ? "rgba(0,255,135,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{match.flag_home}</span>
                        <div>
                          <p className="font-body font-semibold text-white text-sm">
                            {match.home_team} <span className="text-text-muted font-normal">vs</span> {match.away_team}
                          </p>
                          <p className="font-body text-xs text-text-muted mt-0.5">{formatMatchDate(match.match_date)}</p>
                        </div>
                        <span className="text-2xl">{match.flag_away}</span>
                      </div>
                      {selectedMatch?.id === match.id && (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#00ff87" }}>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#0a0a0f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button onClick={() => selectedMatch && setStep("name")} disabled={!selectedMatch}
              className="mt-6 w-full py-4 rounded-xl font-body font-bold text-base transition-all"
              style={{ background: selectedMatch ? "#00ff87" : "rgba(255,255,255,0.06)", color: selectedMatch ? "#0a0a0f" : "#8888aa", boxShadow: selectedMatch ? "0 0 20px rgba(0,255,135,0.2)" : "none" }}>
              Continue
            </button>
          </div>
        )}

        {/* Step: Name room */}
        {step === "name" && (
          <div>
            <h1 className="font-display text-5xl text-white mb-2">NAME YOUR ROOM</h1>
            <p className="font-body text-text-muted mb-8">
              {selectedMatch?.flag_home} {selectedMatch?.home_team} vs {selectedMatch?.away_team} {selectedMatch?.flag_away}
            </p>

            <div className="mb-6">
              <label className="font-body text-xs text-text-muted uppercase tracking-widest block mb-3">Room name</label>
              <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value.slice(0, 40))}
                placeholder="The Lads' Room" maxLength={40} autoFocus
                className="w-full rounded-xl px-4 py-4 font-body text-white text-base outline-none transition-all placeholder:text-white/20"
                style={{ background: "#12121e", border: `1px solid ${roomName ? "rgba(0,255,135,0.3)" : "rgba(255,255,255,0.1)"}` }}
                onKeyDown={(e) => e.key === "Enter" && roomName.trim() && user && handleCreateRoom()} />
              <p className="font-body text-xs text-text-muted mt-2 text-right">{roomName.length}/40</p>
            </div>

            {!user ? (
              <div className="rounded-2xl p-5 mb-4" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-body text-sm text-white font-medium mb-1">One last step</p>
                <p className="font-body text-xs text-text-muted mb-4">Your score, streak and room history saved automatically. Free. Takes 10 seconds.</p>
                <SignInWithGoogle redirectTo="/room/new" />
              </div>
            ) : (
              <button onClick={handleCreateRoom} disabled={!roomName.trim() || submitting}
                className="w-full py-4 rounded-xl font-body font-bold text-base flex items-center justify-center gap-2 transition-all"
                style={{ background: roomName.trim() ? "#00ff87" : "rgba(255,255,255,0.06)", color: roomName.trim() ? "#0a0a0f" : "#8888aa", boxShadow: roomName.trim() ? "0 0 20px rgba(0,255,135,0.2)" : "none" }}>
                {submitting ? <Spinner size={18} /> : "Create room"}
              </button>
            )}

            <button onClick={() => setStep("match")} className="mt-3 w-full py-3 font-body text-sm text-text-muted hover:text-white transition-colors">
              ← Back
            </button>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && createdRoom && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,255,135,0.15)" }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#00ff87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div>
                <h1 className="font-display text-4xl text-white leading-none">ROOM CREATED</h1>
                <p className="font-body text-xs text-text-muted mt-1">{roomName}</p>
              </div>
            </div>

            <div className="mb-5">
              <RoomCodeShare code={createdRoom.code} roomId={createdRoom.id} roomName={roomName} />
            </div>

            <div className="rounded-2xl p-4 mb-5" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.2)" }}>
              <p className="font-body text-xs text-amber font-semibold mb-1">What happens next?</p>
              <p className="font-body text-xs text-text-muted leading-relaxed">
                Share the code or link with your mates. Questions fire automatically during the match — everyone gets the same question at the same moment. 45 seconds to answer.
              </p>
            </div>

            <Link href={`/room/${createdRoom.id}`}
              className="w-full flex items-center justify-center py-4 rounded-xl font-body font-bold text-base"
              style={{ background: "#00ff87", color: "#0a0a0f", boxShadow: "0 0 20px rgba(0,255,135,0.2)" }}>
              Go to room lobby
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
