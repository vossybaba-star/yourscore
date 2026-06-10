"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/ui/BottomNav";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { slugify } from "@/lib/utils";
import { RECORDS_EMOJI } from "@/lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuizPack {
  id: string; name: string; type: string; parameter: string;
  question_count: number; status: string;
}

interface OpenRoom {
  id: string; name: string; code: string; room_mode: string;
  question_count: number; category_filter: string | null;
  difficulty_filter: string; created_at: string; _member_count?: number;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const END_OF_SEASON_EMOJI: Record<string, string> = { "The Farewell Tour": "👋" };

function SmallCard({ pack, type }: { pack: QuizPack; type: "club" | "records" | "end_of_season" }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);
  const accent = type === "club" ? "#ffb800" : type === "end_of_season" ? "#22d3ee" : "#a78bfa";
  const border = type === "club" ? "rgba(255,184,0,0.2)" : type === "end_of_season" ? "rgba(34,211,238,0.2)" : "rgba(167,139,250,0.2)";
  const bg = type === "club" ? "rgba(255,184,0,0.08)" : type === "end_of_season" ? "rgba(34,211,238,0.08)" : "rgba(167,139,250,0.08)";

  useEffect(() => {
    if (type === "club") getTeamBadgeUrl(pack.name).then(u => { if (u) setImgUrl(u); });
    else if (type === "end_of_season" && pack.name === "Arsenal Are Champions") getTeamBadgeUrl("Arsenal").then(u => { if (u) setImgUrl(u); });
    else getCompetitionBadgeUrl(pack.name).then(u => { if (u) setImgUrl(u); });
  }, [pack.name, type]);

  return (
    <Link href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{ background: `linear-gradient(160deg, #161624 0%, #1c1a2e 100%)`, border: `1px solid ${border}` }}>
      <div className="relative flex items-center justify-center" style={{ height: 90, background: `radial-gradient(ellipse at 50% 80%, ${bg} 0%, transparent 70%)` }}>
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt={pack.name} width={56} height={56} style={{ objectFit: "contain", filter: `drop-shadow(0 4px 12px ${accent}55)`, position: "relative", zIndex: 1 }} />
        ) : type === "records" ? (
          <span className="text-4xl" style={{ filter: `drop-shadow(0 4px 12px ${accent}55)` }}>{RECORDS_EMOJI[pack.name] ?? "📊"}</span>
        ) : type === "end_of_season" ? (
          <span className="text-4xl" style={{ filter: `drop-shadow(0 4px 12px ${accent}55)` }}>{END_OF_SEASON_EMOJI[pack.name] ?? "🏁"}</span>
        ) : (
          // Skeleton shimmer while club badge loads — avoids flashing a raw letter
          <div className="animate-pulse rounded-xl" style={{ width: 56, height: 56, background: "rgba(255,255,255,0.07)" }} />
        )}
        <div className="absolute top-2 right-2 font-display text-xs px-1.5 py-0.5 rounded"
          style={{ background: "rgba(0,0,0,0.5)", color: accent, border: `1px solid ${border}` }}>
          {pack.question_count}Q
        </div>
      </div>
      <div className="px-3 pb-3 pt-2">
        <p className="font-body text-xs font-bold text-white truncate mb-2">{pack.name}</p>
        <div className="rounded-lg py-1.5 text-center" style={{ background: `${bg}`, border: `1px solid ${border}` }}>
          <span className="font-display text-xs" style={{ color: accent }}>PLAY →</span>
        </div>
      </div>
    </Link>
  );
}

// ── Open room card ─────────────────────────────────────────────────────────────

function OpenRoomCard({ room, onJoin }: { room: OpenRoom; onJoin: () => void }) {
  const modeLabel = room.room_mode === "h2h" ? "1v1" : room.room_mode === "open" ? "Public" : "Private";
  const modeColor = room.room_mode === "h2h" ? "#f87171" : room.room_mode === "open" ? "#00ff87" : "#a78bfa";

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3 bg-surface"
      style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.18)" }}>
        <span className="text-lg">⚡</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-bold text-white truncate">{room.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-body text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: `${modeColor}18`, color: modeColor, border: `1px solid ${modeColor}30` }}>
            {modeLabel}
          </span>
          <span className="font-body text-xs" style={{ color: "#555577" }}>
            {room.question_count}Q · {room._member_count ?? 0} waiting
          </span>
        </div>
      </div>
      <button onClick={onJoin}
        className="flex-shrink-0 px-3 py-2 rounded-xl font-body text-xs font-bold transition-all hover:opacity-90 text-amber"
        style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.25)" }}>
        Join
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type MainTab = "solo" | "multiplayer";
type SoloTab = "end_of_season" | "club" | "records";

function joinErrorMessage(raw: string): string {
  if (raw.includes("not found") || raw.includes("Lobby not found")) return "This lobby no longer exists. Go to Play > Head-to-Head to start a new match.";
  if (raw.includes("already started") || raw.includes("Game already")) return "This lobby has already started.";
  if (raw.includes("full") || raw.includes("Lobby is full")) return "This lobby is full.";
  if (raw.includes("Invalid code")) return "That code isn't valid — double-check it.";
  return raw || "Could not join this lobby.";
}

function PlayPageInner() {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mainTab, setMainTab] = useState<MainTab>("solo");
  const [soloTab, setSoloTab] = useState<SoloTab>("end_of_season");
  const [packs, setPacks] = useState<QuizPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsFetched, setRoomsFetched] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const joinInputRef = useRef<HTMLInputElement>(null);

  // Load quiz packs
  useEffect(() => {
    createClient()
      .from("quiz_packs").select("id, name, type, parameter, question_count, status")
      .eq("status", "published").order("name")
      .then(({ data }) => {
        setPacks((data ?? []) as QuizPack[]);
        setPacksLoading(false);
      });
  }, []);

  // Load open rooms (lazy)
  useEffect(() => {
    if (mainTab !== "multiplayer" || roomsFetched || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    setRoomsLoading(true);
    import("@/lib/supabase/client").then(async ({ createClient: cc }) => {
      const sb = cc();
      const { data: rooms } = await sb
        .from("rooms")
        .select("id, name, code, room_mode, question_count, category_filter, difficulty_filter, created_at")
        .eq("type", "player").eq("status", "lobby").eq("room_mode", "open")
        .order("created_at", { ascending: false }).limit(20);

      if (rooms?.length) {
        const withCounts = await Promise.all(rooms.map(async (r) => {
          const { count } = await sb.from("room_members").select("*", { count: "exact", head: true }).eq("room_id", r.id);
          return { ...r, _member_count: count ?? 0 };
        }));
        setOpenRooms(withCounts as unknown as OpenRoom[]);
      }
      setRoomsFetched(true);
      setRoomsLoading(false);
    });
  }, [mainTab, roomsFetched]);

  // Join sheet focus
  useEffect(() => {
    if (joinSheetOpen) setTimeout(() => joinInputRef.current?.focus(), 120);
    else { setJoinCode(""); setJoinError(""); }
  }, [joinSheetOpen]);

  // Auto-join from ?join=CODE URL param (shared invite links)
  useEffect(() => {
    const code = searchParams?.get("join");
    if (!code) return;
    setMainTab("multiplayer");
    setJoinCode(code.toUpperCase());
    setJoinSheetOpen(true);
  }, [searchParams]);

  async function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(`/play?join=${code}`)}`); return; }
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch("/api/room/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) { setJoinError(joinErrorMessage(data.error ?? "")); setJoining(false); return; }
      setJoinSheetOpen(false);
      router.push(`/play/${data.room.id}`);
    } catch {
      setJoinError("Network error");
      setJoining(false);
    }
  }

  async function handleJoinOpen(room: OpenRoom) {
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(`/play?join=${room.code}`)}`); return; }
    const res = await fetch("/api/room/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: room.code }),
    });
    const data = await res.json();
    if (res.ok) router.push(`/play/${data.room.id}`);
  }

  // Pack filtering
  const endOfSeasonPacks = packs.filter(p => p.parameter === "2025/26 End of Season");
  const filtered =
    soloTab === "end_of_season" ? endOfSeasonPacks
    : soloTab === "records" ? packs.filter(p => p.type === "records" && p.parameter !== "2025/26 End of Season")
    : packs.filter(p => p.type === "club");

  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-20 pt-safe"
        style={{ background: "rgba(10,10,15,0.97)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 pt-3 pb-3">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-display text-2xl tracking-tight text-amber">PLAY</h1>
              <p className="font-body text-xs mt-0.5 text-text-muted">
                {mainTab === "solo" ? "Solo challenges · Test your knowledge" : "Real-time multiplayer · Play with mates"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.2)" }}>
              <span className="text-xs">⚡</span>
              <span className="font-display text-xs text-amber">
                {packsLoading ? "…" : `${packs.length} GAMES`}
              </span>
            </div>
          </div>

          {/* Solo / Multiplayer toggle */}
          <div className="flex gap-1 p-1 rounded-2xl mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {(["solo", "multiplayer"] as MainTab[]).map(t => (
              <button key={t} onClick={() => setMainTab(t)}
                className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
                style={mainTab === t
                  ? { background: "#ffb800", color: "#0a0a0f" }
                  : { background: "transparent", color: "#8888aa" }}>
                {t === "solo" ? "Solo" : "Multiplayer"}
              </button>
            ))}
          </div>

          {/* Solo sub-tabs */}
          {mainTab === "solo" && (
            <div className="flex gap-2">
              {([
                { key: "end_of_season", label: "🏁 Season", color: "#22d3ee" },
                { key: "club",          label: "⚽ Club",   color: "#ffb800" },
                { key: "records",       label: "🏆 Records", color: "#a78bfa" },
              ] as { key: SoloTab; label: string; color: string }[]).map(({ key, label, color }) => (
                <button key={key} onClick={() => setSoloTab(key)}
                  className="flex-1 py-2 rounded-full font-display text-xs tracking-wide transition-all"
                  style={{
                    background: soloTab === key ? `${color}25` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${soloTab === key ? `${color}55` : "rgba(255,255,255,0.08)"}`,
                    color: soloTab === key ? color : "#8888aa",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── SOLO TAB ─────────────────────────────────────────────────── */}
      {mainTab === "solo" && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          {/* Build a quiz CTA */}
          <button onClick={() => router.push("/quiz/create")}
            className="w-full rounded-2xl mb-4 active:scale-[0.98] transition-all"
            style={{ background: "linear-gradient(135deg, rgba(0,255,135,0.12) 0%, rgba(0,200,100,0.06) 100%)", border: "1px solid rgba(0,255,135,0.3)", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ textAlign: "left" }}>
              <p className="font-display text-sm tracking-wide text-green">✨ BUILD YOUR OWN</p>
              <p className="font-body text-xs mt-0.5 text-text-muted">Pick a team · choose your era · challenge a friend</p>
            </div>
            <span className="font-display text-lg text-green">→</span>
          </button>

          {packsLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-3xl bg-surface" style={{ border: "1px solid rgba(255,255,255,0.06)", height: 180, opacity: 0.3 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-4xl mb-4">🏟️</p>
              <p className="font-body text-sm text-text-muted">No games here yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filtered.map(pack => (
                <SmallCard key={pack.id} pack={pack}
                  type={soloTab === "end_of_season" ? "end_of_season" : pack.type === "club" ? "club" : "records"} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MULTIPLAYER TAB ───────────────────────────────────────────── */}
      {mainTab === "multiplayer" && (
        <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">

          {/* Create / Join CTAs */}
          <div className="grid grid-cols-2 gap-3">
            <Link href="/play/new"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl py-5 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, rgba(255,184,0,0.12) 0%, rgba(255,120,0,0.06) 100%)", border: "1px solid rgba(255,184,0,0.28)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(255,184,0,0.15)", border: "1px solid rgba(255,184,0,0.3)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2v16M2 10h16" stroke="#ffb800" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </div>
              <p className="font-body text-sm font-bold text-amber">Create Game</p>
              <p className="font-body text-xs text-center text-text-muted">Set mode, questions &amp; invite mates</p>
            </Link>

            <button onClick={() => setJoinSheetOpen(true)}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl py-5 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M2 10h12M10 4l6 6-6 6" stroke="#aaaacc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="font-body text-sm font-bold text-white">Join with Code</p>
              <p className="font-body text-xs text-text-muted">Enter invite code from a mate</p>
            </button>
          </div>

          {/* Open rooms */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: "#555577" }}>Open Lobbies</p>
              <button onClick={() => { setRoomsFetched(false); }} className="font-body text-xs" style={{ color: "#555577" }}>Refresh</button>
            </div>

            {roomsLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.1)", borderTopColor: "#ffb800" }} />
              </div>
            )}

            {!roomsLoading && openRooms.length === 0 && (
              <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-3xl mb-2">🎮</p>
                <p className="font-body text-sm text-white mb-1">No open lobbies right now</p>
                <p className="font-body text-xs text-text-muted">Create one and let anyone join</p>
              </div>
            )}

            {!roomsLoading && openRooms.length > 0 && (
              <div className="space-y-2">
                {openRooms.map(room => (
                  <OpenRoomCard key={room.id} room={room} onJoin={() => handleJoinOpen(room)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav />

      {/* Join code sheet */}
      {joinSheetOpen && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
            onClick={() => setJoinSheetOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl px-5 pt-5 pb-10 bg-surface"
            style={{ border: "1px solid rgba(255,184,0,0.2)", borderBottom: "none" }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: "rgba(255,255,255,0.12)" }} />
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="font-display text-xl text-white tracking-wide">Join a game</p>
                <p className="font-body text-xs mt-0.5 text-text-muted">Enter the code your mate shared</p>
              </div>
              <button onClick={() => setJoinSheetOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.07)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="#aaaacc" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleJoinSubmit}>
              <input ref={joinInputRef} type="text" value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="ENTER CODE" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                className="w-full rounded-2xl px-5 font-display text-3xl text-center tracking-[0.25em] text-white outline-none mb-3"
                style={{ height: 72, background: "rgba(255,184,0,0.06)", border: `1px solid ${joinCode.length >= 4 ? "rgba(255,184,0,0.5)" : "rgba(255,184,0,0.2)"}`, caretColor: "#ffb800", transition: "border-color 0.2s" }} />
              {joinError && <p className="text-center font-body text-sm mb-3" style={{ color: "#f87171" }}>{joinError}</p>}
              <button type="submit" disabled={joinCode.trim().length < 4 || joining}
                className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all"
                style={{ background: joinCode.trim().length >= 4 && !joining ? "#ffb800" : "rgba(255,184,0,0.15)", color: joinCode.trim().length >= 4 && !joining ? "#0a0a0f" : "#555577" }}>
                {joining ? "Joining…" : "Join game →"}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense>
      <PlayPageInner />
    </Suspense>
  );
}
