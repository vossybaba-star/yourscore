"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { slugify } from "@/lib/utils";
import { RECORDS_EMOJI } from "@/lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuizPack {
  id: string;
  name: string;
  type: string;
  parameter: string;
  question_count: number;
  status: string;
  description?: string | null;
  featured?: boolean;
  featured_order?: number | null;
  metadata?: { icon?: string; cover_image?: string } | null;
}

// Full-bleed cover image for a card's media zone. Fills the existing 110px-tall
// banner (object-cover, centred) — used when a quiz has a hand-made cover_image,
// otherwise the card falls back to its badge/emoji.
function CoverImg({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="absolute inset-0 h-full w-full" style={{ objectFit: "cover" }} />
  );
}

interface OpenRoom {
  id: string; name: string; code: string; room_mode: string;
  question_count: number; category_filter: string | null;
  difficulty_filter: string; created_at: string; _member_count?: number;
}

// ── Card constants ─────────────────────────────────────────────────────────────

const END_OF_SEASON_EMOJI: Record<string, string> = { "The Farewell Tour": "👋" };

// ── ClubCard ──────────────────────────────────────────────────────────────────

function ClubCard({ pack }: { pack: QuizPack }) {
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);

  useEffect(() => {
    getTeamBadgeUrl(pack.name).then((u) => { if (u) setBadgeUrl(u); });
  }, [pack.name]);

  return (
    <Link
      href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
        border: "1px solid rgba(0,216,192,0.18)",
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 110,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.12) 0%, transparent 70%), linear-gradient(180deg, rgba(0,216,192,0.05) 0%, transparent 100%)",
        }}
      >
        {pack.metadata?.cover_image ? (
          <CoverImg src={pack.metadata.cover_image} alt={pack.name} />
        ) : badgeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={badgeUrl}
            alt={pack.name}
            width={68}
            height={68}
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 6px 16px rgba(0,216,192,0.35))",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-2xl font-display text-3xl text-white"
            style={{ width: 68, height: 68, background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.2)" }}
          >
            {pack.name[0]}
          </div>
        )}
        <div
          className="absolute top-3 right-3 font-display text-xs px-2 py-0.5 rounded-lg text-teal"
          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(0,216,192,0.3)" }}
        >
          {pack.question_count}Q
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-tight mb-0.5 truncate">{pack.name}</p>
        <p className="font-body text-xs mb-1.5" style={{ color: "#8a948f" }}>2025/26 Season Game</p>
        {pack.description && (
          <p className="font-body text-xs mb-2.5 line-clamp-2 leading-relaxed" style={{ color: "#7a857f" }}>{pack.description}</p>
        )}
        <div
          className="rounded-xl py-2 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(255,120,0,0.12) 100%)",
            border: "1px solid rgba(0,216,192,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest text-teal">PLAY NOW →</span>
        </div>
      </div>
    </Link>
  );
}

// ── RecordsCard ───────────────────────────────────────────────────────────────

function RecordsCard({ pack }: { pack: QuizPack }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);
  const emoji = pack.metadata?.icon ?? RECORDS_EMOJI[pack.name] ?? null;

  useEffect(() => {
    getCompetitionBadgeUrl(pack.name).then((u) => { if (u) setLogoUrl(u); });
  }, [pack.name]);

  return (
    <Link
      href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
        border: "1px solid rgba(0,216,192,0.2)",
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 110,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.14) 0%, transparent 70%), linear-gradient(180deg, rgba(0,216,192,0.06) 0%, transparent 100%)",
        }}
      >
        {pack.metadata?.cover_image ? (
          <CoverImg src={pack.metadata.cover_image} alt={pack.name} />
        ) : logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={pack.name}
            width={64}
            height={64}
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 6px 16px rgba(0,216,192,0.45))",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <span className="text-5xl" style={{ filter: "drop-shadow(0 4px 12px rgba(0,216,192,0.4))" }}>
            {emoji ?? "📊"}
          </span>
        )}
        <div
          className="absolute top-3 right-3 font-display text-xs px-2 py-0.5 rounded-lg"
          style={{ background: "rgba(0,0,0,0.5)", color: "#00d8c0", border: "1px solid rgba(0,216,192,0.3)" }}
        >
          {pack.question_count}Q
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-tight mb-0.5">{pack.name}</p>
        <p className="font-body text-xs mb-1.5" style={{ color: "#8a948f" }}>All-Time Records</p>
        {pack.description && (
          <p className="font-body text-xs mb-2.5 line-clamp-2 leading-relaxed" style={{ color: "#7a857f" }}>{pack.description}</p>
        )}
        <div
          className="rounded-xl py-2 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(0,216,192,0.05) 100%)",
            border: "1px solid rgba(0,216,192,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest" style={{ color: "#00d8c0" }}>PLAY NOW →</span>
        </div>
      </div>
    </Link>
  );
}

// ── EndOfSeasonCard ───────────────────────────────────────────────────────────

function EndOfSeasonCard({ pack }: { pack: QuizPack }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);
  const emoji = END_OF_SEASON_EMOJI[pack.name] ?? null;

  useEffect(() => {
    if (pack.name === "Arsenal Are Champions") {
      getTeamBadgeUrl("Arsenal").then((u) => { if (u) setImageUrl(u); });
    } else {
      getCompetitionBadgeUrl(pack.name).then((u) => { if (u) setImageUrl(u); });
    }
  }, [pack.name]);

  return (
    <Link
      href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #15211a 0%, #0a1a24 100%)",
        border: "1px solid rgba(0,216,192,0.2)",
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 110,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.14) 0%, transparent 70%), linear-gradient(180deg, rgba(0,216,192,0.06) 0%, transparent 100%)",
        }}
      >
        {pack.metadata?.cover_image ? (
          <CoverImg src={pack.metadata.cover_image} alt={pack.name} />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={pack.name}
            width={64}
            height={64}
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 6px 16px rgba(0,216,192,0.45))",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <span className="text-5xl" style={{ filter: "drop-shadow(0 4px 12px rgba(0,216,192,0.4))" }}>
            {emoji ?? "🏁"}
          </span>
        )}
        <div
          className="absolute top-3 right-3 font-display text-xs px-2 py-0.5 rounded-lg"
          style={{ background: "rgba(0,0,0,0.5)", color: "#00d8c0", border: "1px solid rgba(0,216,192,0.3)" }}
        >
          {pack.question_count}Q
        </div>
        <div
          className="absolute top-3 left-3 font-body text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "rgba(0,216,192,0.15)", color: "#00d8c0", border: "1px solid rgba(0,216,192,0.3)" }}
        >
          25/26
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-tight mb-0.5">{pack.name}</p>
        <p className="font-body text-xs mb-1.5" style={{ color: "#8a948f" }}>End of Season</p>
        {pack.description && (
          <p className="font-body text-xs mb-2.5 line-clamp-2 leading-relaxed" style={{ color: "#7a857f" }}>{pack.description}</p>
        )}
        <div
          className="rounded-xl py-2 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(6,182,212,0.12) 100%)",
            border: "1px solid rgba(0,216,192,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest" style={{ color: "#00d8c0" }}>PLAY NOW →</span>
        </div>
      </div>
    </Link>
  );
}

// ── Open room card ─────────────────────────────────────────────────────────────

function OpenRoomCard({ room, onJoin }: { room: OpenRoom; onJoin: () => void }) {
  const modeLabel = room.room_mode === "h2h" ? "1v1" : room.room_mode === "open" ? "Public" : "Private";
  const modeColor = room.room_mode === "h2h" ? "#f87171" : room.room_mode === "open" ? "#aeea00" : "#00d8c0";

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3 bg-surface"
      style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: "rgba(0,216,192,0.08)", border: "1px solid rgba(0,216,192,0.18)" }}>
        <span className="text-lg">⚡</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-bold text-white truncate">{room.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-body text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: `${modeColor}18`, color: modeColor, border: `1px solid ${modeColor}30` }}>
            {modeLabel}
          </span>
          <span className="font-body text-xs" style={{ color: "#586058" }}>
            {room.question_count}Q · {room._member_count ?? 0} waiting
          </span>
        </div>
      </div>
      <Button variant="primary" tone="teal" size="sm" onClick={onJoin} className="flex-shrink-0">
        Join
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type MainTab = "solo" | "multiplayer" | "leaderboards";
type SoloTab = "featured" | "club" | "records";

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
  const [soloTab, setSoloTab] = useState<SoloTab>("featured");
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

  // WC 2026 leaderboard
  interface LBRow { rank: number; userId: string; displayName: string; totalScore: number; quizCount: number; }
  const [wc2026Rows, setWc2026Rows] = useState<LBRow[]>([]);
  const [wc2026Stats, setWc2026Stats] = useState<{ playerCount: number; packCount: number } | null>(null);
  const [wc2026Loading, setWc2026Loading] = useState(false);
  const wc2026Fetched = useRef(false);

  // Load quiz packs (same query as challenges page — rotation_active + full fields)
  useEffect(() => {
    createClient()
      .from("quiz_packs")
      .select("id, name, type, parameter, question_count, status, description, featured, featured_order, metadata")
      .eq("status", "published")
      .eq("rotation_active", true)
      .order("name")
      .then(({ data }) => {
        setPacks((data ?? []) as unknown as QuizPack[]);
        setPacksLoading(false);
      });
  }, []);

  // Load open rooms (lazy)
  useEffect(() => {
    if (mainTab !== "multiplayer" || roomsFetched || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    setRoomsLoading(true);
    import("@/lib/supabase/client").then(async ({ createClient: cc }) => {
      const sb = cc();
      // Only surface lobbies opened in the last 3 hours. Public lobbies waiting
      // on players are abandoned long before then — older ones are dead and were
      // cluttering the list (also swept server-side by /api/cron/cleanup-lobbies).
      const freshCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data: rooms } = await sb
        .from("rooms")
        .select("id, name, code, room_mode, question_count, category_filter, difficulty_filter, created_at")
        .eq("type", "player").eq("status", "lobby").eq("room_mode", "open")
        .gte("created_at", freshCutoff)
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

  // Fetch WC 2026 leaderboard (lazy, once per session)
  useEffect(() => {
    if (mainTab !== "leaderboards" || wc2026Fetched.current) return;
    wc2026Fetched.current = true;
    setWc2026Loading(true);
    fetch("/api/leaderboard/wc2026")
      .then(r => r.json())
      .then(data => {
        setWc2026Rows(data.rows ?? []);
        setWc2026Stats({ playerCount: data.playerCount ?? 0, packCount: data.packCount ?? 0 });
      })
      .catch(() => { /* silent fail */ })
      .finally(() => setWc2026Loading(false));
  }, [mainTab]);

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

  // Pack filtering (mirrors challenges page logic)
  const featuredPacks = packs
    .filter((p) => p.featured)
    .sort((a, b) => (a.featured_order ?? 99) - (b.featured_order ?? 99));
  const endOfSeasonPacks = packs.filter(
    (p) => p.parameter === "2025/26 End of Season" && !p.featured
  );
  const featuredTabPacks = [...featuredPacks, ...endOfSeasonPacks];
  const filtered =
    soloTab === "featured"
      ? featuredTabPacks
      : soloTab === "records"
      ? packs.filter((p) => p.type === "records" && p.parameter !== "2025/26 End of Season" && !p.featured)
      : packs.filter((p) => p.type === "club");

  const clubCount = packs.filter((p) => p.type === "club").length;
  const recordsCount = packs.filter((p) => p.type === "records" && p.parameter !== "2025/26 End of Season" && !p.featured).length;
  const featuredCount = featuredTabPacks.length;

  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-20 pt-safe"
        style={{ background: "rgba(10,10,15,0.97)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 pt-3 pb-3">

          {/* Title row */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-display text-2xl tracking-tight text-teal">QUIZ</h1>
              <p className="font-body text-xs mt-0.5 text-text-muted">
                {mainTab === "solo" ? "Test your football knowledge" : mainTab === "multiplayer" ? "Real-time multiplayer · Play with mates" : "YourScore verified competitions"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(0,216,192,0.08)", border: "1px solid rgba(0,216,192,0.2)" }}>
              <span className="text-xs">⚡</span>
              <span className="font-display text-xs text-teal">
                {packsLoading ? "…" : `${packs.length} GAMES`}
              </span>
            </div>
          </div>

          {/* Solo / Multiplayer / Leaderboards toggle */}
          <div className="flex gap-1 p-1 rounded-2xl mb-3"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <button onClick={() => setMainTab("solo")}
              className="flex-1 py-2 rounded-xl font-body text-xs font-semibold transition-all"
              style={mainTab === "solo" ? { background: "#00d8c0", color: "#0a0a0f" } : { background: "transparent", color: "#8a948f" }}>
              Solo
            </button>
            <button onClick={() => setMainTab("multiplayer")}
              className="flex-1 py-2 rounded-xl font-body text-xs font-semibold transition-all"
              style={mainTab === "multiplayer" ? { background: "#00d8c0", color: "#0a0a0f" } : { background: "transparent", color: "#8a948f" }}>
              Multiplayer
            </button>
            <button onClick={() => setMainTab("leaderboards")}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl font-body text-xs font-semibold transition-all"
              style={mainTab === "leaderboards"
                ? { background: "#aeea00", color: "#062013" }
                : { background: "transparent", color: "#8a948f" }}>
              Leaderboards
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                <path d="M2 5.2l2 2L8 3" stroke={mainTab === "leaderboards" ? "#062013" : "#586058"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Solo sub-tabs (Featured / Club / Records) */}
          {mainTab === "solo" && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setSoloTab("featured")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full font-display text-xs tracking-wide transition-all flex-1 justify-center"
                style={{
                  background: soloTab === "featured" ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${soloTab === "featured" ? "rgba(0,216,192,0.5)" : "rgba(255,255,255,0.08)"}`,
                  color: soloTab === "featured" ? "#00d8c0" : "#8a948f",
                  boxShadow: soloTab === "featured" ? "0 0 16px rgba(0,216,192,0.12)" : "none",
                }}
              >
                ⭐ FEATURED
                <span
                  className="px-1.5 py-0.5 rounded-full text-xs"
                  style={{
                    background: soloTab === "featured" ? "rgba(0,216,192,0.25)" : "rgba(255,255,255,0.06)",
                    color: soloTab === "featured" ? "#00d8c0" : "#5b645e",
                  }}
                >
                  {featuredCount}
                </span>
              </button>
              <button
                onClick={() => setSoloTab("club")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full font-display text-xs tracking-wide transition-all flex-1 justify-center"
                style={{
                  background: soloTab === "club" ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${soloTab === "club" ? "rgba(0,216,192,0.5)" : "rgba(255,255,255,0.08)"}`,
                  color: soloTab === "club" ? "#00d8c0" : "#8a948f",
                  boxShadow: soloTab === "club" ? "0 0 16px rgba(0,216,192,0.12)" : "none",
                }}
              >
                ⚽ CLUB
                <span
                  className="px-1.5 py-0.5 rounded-full text-xs"
                  style={{
                    background: soloTab === "club" ? "rgba(0,216,192,0.25)" : "rgba(255,255,255,0.06)",
                    color: soloTab === "club" ? "#00d8c0" : "#5b645e",
                  }}
                >
                  {clubCount}
                </span>
              </button>
              <button
                onClick={() => setSoloTab("records")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full font-display text-xs tracking-wide transition-all flex-1 justify-center"
                style={{
                  background: soloTab === "records" ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${soloTab === "records" ? "rgba(0,216,192,0.5)" : "rgba(255,255,255,0.08)"}`,
                  color: soloTab === "records" ? "#00d8c0" : "#8a948f",
                  boxShadow: soloTab === "records" ? "0 0 16px rgba(0,216,192,0.12)" : "none",
                }}
              >
                🏆 RECORDS
                <span
                  className="px-1.5 py-0.5 rounded-full text-xs"
                  style={{
                    background: soloTab === "records" ? "rgba(0,216,192,0.25)" : "rgba(255,255,255,0.06)",
                    color: soloTab === "records" ? "#00d8c0" : "#5b645e",
                  }}
                >
                  {recordsCount}
                </span>
              </button>
            </div>
          )}

          {/* Solo sub-filter banners */}
          {mainTab === "solo" && soloTab === "club" && (
            <div className="flex items-center gap-2 pb-1">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full font-body text-xs font-semibold text-green"
                style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.3)" }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#aeea00", display: "inline-block", boxShadow: "0 0 6px #aeea00" }} />
                Premier League
              </div>
            </div>
          )}
          {mainTab === "solo" && soloTab === "featured" && (
            <div className="flex items-center gap-2 pb-1">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full font-body text-xs font-semibold"
                style={{ background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.3)", color: "#00d8c0" }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00d8c0", display: "inline-block", boxShadow: "0 0 6px #00d8c0" }} />
                New this week
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SOLO TAB ─────────────────────────────────────────────────── */}
      {mainTab === "solo" && (
        <>
          {/* Build a Quiz banner */}
          <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
            <button
              onClick={() => router.push("/quiz/create")}
              className="w-full rounded-2xl overflow-hidden transition-all duration-150 active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, rgba(174,234,0,0.12) 0%, rgba(0,200,100,0.06) 100%)",
                border: "1px solid rgba(174,234,0,0.3)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0 0 24px rgba(174,234,0,0.06)",
              }}
            >
              <div style={{ textAlign: "left" }}>
                <p className="font-display text-sm tracking-wide text-green">✨ BUILD YOUR OWN QUIZ</p>
                <p className="font-body text-xs mt-0.5 text-text-muted">Pick a team or topic · choose your era · challenge a friend</p>
              </div>
              <span className="font-display text-lg text-green">→</span>
            </button>
          </div>

          {/* Cards grid */}
          <div className="max-w-lg mx-auto px-4 pt-2">
            {packsLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-3xl bg-surface"
                    style={{ border: "1px solid rgba(255,255,255,0.06)", height: 200, opacity: 0.3 }} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-4xl mb-4">🏟️</p>
                <p className="font-body text-sm text-text-muted">No games here yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filtered.map((pack) =>
                  pack.parameter === "2025/26 End of Season" ? (
                    <EndOfSeasonCard key={pack.id} pack={pack} />
                  ) : pack.type === "club" ? (
                    <ClubCard key={pack.id} pack={pack} />
                  ) : (
                    <RecordsCard key={pack.id} pack={pack} />
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── MULTIPLAYER TAB ───────────────────────────────────────────── */}
      {mainTab === "multiplayer" && (
        <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">

          {/* Create / Join CTAs */}
          <div className="grid grid-cols-2 gap-3">
            <Link href="/play/new"
              className="flex flex-col items-center justify-center gap-2 rounded-2xl py-5 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, rgba(0,216,192,0.12) 0%, rgba(255,120,0,0.06) 100%)", border: "1px solid rgba(0,216,192,0.28)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(0,216,192,0.15)", border: "1px solid rgba(0,216,192,0.3)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2v16M2 10h16" stroke="#00d8c0" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </div>
              <p className="font-body text-sm font-bold text-teal">Create Game</p>
              <p className="font-body text-xs text-center text-text-muted">Set mode, questions &amp; invite mates</p>
            </Link>

            <button onClick={() => setJoinSheetOpen(true)}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl py-5 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M2 10h12M10 4l6 6-6 6" stroke="#9aa39d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="font-body text-sm font-bold text-white">Join with Code</p>
              <p className="font-body text-xs text-text-muted">Enter invite code from a mate</p>
            </button>
          </div>

          {/* Open rooms */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: "#586058" }}>Open Lobbies</p>
              <button onClick={() => { setRoomsFetched(false); }} className="font-body text-xs" style={{ color: "#586058" }}>Refresh</button>
            </div>

            {roomsLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.1)", borderTopColor: "#00d8c0" }} />
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

      {/* ── LEADERBOARDS TAB ─────────────────────────────────────── */}
      {mainTab === "leaderboards" && (
        <div className="max-w-lg mx-auto px-4 pt-4 space-y-3">

          {/* Verified badge */}
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-display text-xs tracking-wide"
              style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00" }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5.2l2 2L8 3" stroke="#aeea00" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              YOURSCORE VERIFIED
            </div>
          </div>

          {/* World Cup 2026 card */}
          <div className="rounded-3xl overflow-hidden"
            style={{ background: "linear-gradient(145deg, #0d1a10 0%, #091510 100%)", border: "1px solid rgba(174,234,0,0.25)" }}>

            {/* Banner strip */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: "linear-gradient(90deg, rgba(174,234,0,0.12) 0%, rgba(0,216,192,0.08) 100%)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2">
                <span className="relative flex" style={{ width: 10, height: 10 }}>
                  <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: "#aeea00" }} />
                  <span className="relative inline-flex rounded-full" style={{ width: 10, height: 10, background: "#aeea00" }} />
                </span>
                <span className="font-display text-xs tracking-widest" style={{ color: "#aeea00" }}>LIVE</span>
              </div>
              <span className="text-2xl">🏆</span>
            </div>

            {/* Title + stats */}
            <div className="px-5 pt-4 pb-2">
              <p className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff", lineHeight: 1.2 }}>WORLD CUP 2026</p>
              <p className="font-body mt-1" style={{ fontSize: 13, color: "#6aaa80" }}>Daily quiz series · 2026 FIFA World Cup</p>

              <div className="flex items-center gap-3 mt-4">
                <div className="flex-1 rounded-2xl px-4 py-3 text-center"
                  style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.15)" }}>
                  <p className="font-display" style={{ fontSize: 18, color: "#aeea00" }}>
                    {wc2026Loading ? "…" : (wc2026Stats?.playerCount ?? 0)}
                  </p>
                  <p className="font-body text-xs mt-0.5" style={{ color: "#4a7a5a" }}>Players</p>
                </div>
                <div className="flex-1 rounded-2xl px-4 py-3 text-center"
                  style={{ background: "rgba(0,216,192,0.07)", border: "1px solid rgba(0,216,192,0.15)" }}>
                  <p className="font-display" style={{ fontSize: 18, color: "#00d8c0" }}>
                    {wc2026Loading ? "…" : (wc2026Stats?.packCount ?? 0)}
                  </p>
                  <p className="font-body text-xs mt-0.5" style={{ color: "#7a6a30" }}>Quizzes</p>
                </div>
              </div>
            </div>

            {/* Rankings */}
            <div className="px-5 pb-5 mt-3">
              {wc2026Loading ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.1)", borderTopColor: "#aeea00" }} />
                </div>
              ) : wc2026Rows.length === 0 ? (
                <div className="rounded-2xl px-4 py-5 text-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="font-body text-sm" style={{ color: "#8a948f" }}>No scores yet — be first on the board</p>
                  <p className="font-body text-xs mt-0.5" style={{ color: "#586058" }}>Play a World Cup 2026 daily quiz to enter</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {/* Column headers */}
                  <div className="flex items-center px-3 pb-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className="font-body text-xs w-8" style={{ color: "#3a423d" }}>#</span>
                    <span className="font-body text-xs flex-1" style={{ color: "#3a423d" }}>Player</span>
                    <span className="font-body text-xs w-10 text-right" style={{ color: "#3a423d" }}>Qs</span>
                    <span className="font-body text-xs w-16 text-right" style={{ color: "#3a423d" }}>Score</span>
                  </div>
                  {wc2026Rows.map((row) => {
                    const medal = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : null;
                    const isTop3 = row.rank <= 3;
                    return (
                      <div key={row.userId}
                        className="flex items-center px-3 py-2.5 rounded-xl"
                        style={{
                          background: isTop3 ? "rgba(174,234,0,0.05)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${isTop3 ? "rgba(174,234,0,0.12)" : "rgba(255,255,255,0.04)"}`,
                        }}>
                        <span className="font-display text-sm w-8" style={{ color: isTop3 ? "#aeea00" : "#3a423d" }}>
                          {medal ?? row.rank}
                        </span>
                        <span className="font-body text-sm flex-1 truncate" style={{ color: isTop3 ? "#e8e8f0" : "#9aa39d" }}>
                          {row.displayName}
                        </span>
                        <span className="font-body text-xs w-10 text-right" style={{ color: "#586058" }}>
                          {row.quizCount}
                        </span>
                        <span className="font-display text-sm w-16 text-right" style={{ color: isTop3 ? "#aeea00" : "#8a948f" }}>
                          {row.totalScore.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
            style={{ border: "1px solid rgba(0,216,192,0.2)", borderBottom: "none" }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: "rgba(255,255,255,0.12)" }} />
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="font-display text-xl text-white tracking-wide">Join a game</p>
                <p className="font-body text-xs mt-0.5 text-text-muted">Enter the code your mate shared</p>
              </div>
              <button onClick={() => setJoinSheetOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.07)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="#9aa39d" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleJoinSubmit}>
              <input ref={joinInputRef} type="text" value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="ENTER CODE" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                className="w-full rounded-2xl px-5 font-display text-3xl text-center tracking-[0.25em] text-white outline-none mb-3"
                style={{ height: 72, background: "rgba(0,216,192,0.06)", border: `1px solid ${joinCode.length >= 4 ? "rgba(0,216,192,0.5)" : "rgba(0,216,192,0.2)"}`, caretColor: "#00d8c0", transition: "border-color 0.2s" }} />
              {joinError && <p className="text-center font-body text-sm mb-3" style={{ color: "#f87171" }}>{joinError}</p>}
              <Button type="submit" variant="primary" tone="teal" size="lg" fullWidth disabled={joinCode.trim().length < 4 || joining}>
                {joining ? "Joining…" : "Join game →"}
              </Button>
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
