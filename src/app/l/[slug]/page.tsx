"use client";

/**
 * /l/[slug] — a Club League's home (spec: 2026-06-12-club-leagues-design.md).
 *
 * Non-members (incl. signed-out) see the public landing: the partner's branding
 * and one CTA — "Join the club". Members see the hub: branded header, pinned
 * announcement, and Board / Events / Feed tabs (+ Manage for the owner).
 * All data comes from /api/club/[slug]; this page never queries the DB.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import QRCode from "react-qr-code";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { GridBackground } from "@/components/ui/GridBackground";

type Tab = "board" | "events" | "feed" | "manage";

interface LeagueData {
  id?: string;
  slug: string;
  name: string;
  tier: string;
  logo_url: string | null;
  cover_url: string | null;
  brand_color: string | null;
  welcome_text: string | null;
  prize_text: string | null;
  announcement?: string | null;
  join_code?: string;
}

interface BoardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  overall_score: number;
  overall_rank: number;
  wins: number;
  draws: number;
  losses: number;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  prize_text: string | null;
  status: string;
  window: "cancelled" | "upcoming" | "live" | "ended";
}

interface FeedRow {
  kind: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

interface HubPayload {
  member: boolean;
  role?: string;
  league: LeagueData;
  memberCount: number;
  events?: EventRow[];
  board?: BoardRow[];
  feed?: FeedRow[];
}

const DEFAULT_BRAND = "#a78bfa";

function initial(name: string) {
  return (name || "?").trim()[0]?.toUpperCase() ?? "?";
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function feedLine(f: FeedRow): { icon: string; text: string } {
  const d = f.detail ?? {};
  switch (f.kind) {
    case "join":
      return { icon: "👋", text: `${f.display_name} joined the club` };
    case "h2h_result": {
      const out = d.outcome === "won" ? "beat" : d.outcome === "lost" ? "lost to" : "drew with";
      return {
        icon: d.outcome === "won" ? "🏆" : "⚽",
        text: `${f.display_name} ${out} ${d.opponent ?? "an opponent"} ${d.score_for ?? 0}–${d.score_against ?? 0} in 38-0`,
      };
    }
    case "solo_quiz":
      return { icon: "🧠", text: `${f.display_name} scored ${Number(d.score ?? 0).toLocaleString()} on ${d.pack ?? "a quiz"}` };
    case "event_result":
      return { icon: "🎯", text: `${f.display_name} scored ${Number(d.score ?? 0).toLocaleString()} in ${d.event ?? "an event"}` };
    default:
      return { icon: "•", text: `${f.display_name} was active` };
  }
}

function windowChip(w: EventRow["window"]) {
  switch (w) {
    case "live":
      return { label: "LIVE NOW", color: "#00ff87", bg: "rgba(0,255,135,0.12)" };
    case "upcoming":
      return { label: "UPCOMING", color: "#60a5fa", bg: "rgba(96,165,250,0.12)" };
    case "ended":
      return { label: "ENDED", color: "#8888aa", bg: "rgba(255,255,255,0.06)" };
    case "cancelled":
      return { label: "CANCELLED", color: "#ff4757", bg: "rgba(255,71,87,0.1)" };
  }
}

export default function ClubLeaguePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();

  const [data, setData] = useState<HubPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("board");
  const [joining, setJoining] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/club/${slug}`);
      if (r.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const d = (await r.json()) as HubPayload;
      setData(d);
    } catch {
      setErr("Network error");
    }
    setLoading(false);
  }, [slug]);

  // Re-fetch when auth state settles so a fresh sign-in upgrades landing → hub.
  useEffect(() => {
    if (!userLoading) load();
  }, [load, userLoading, user?.id]);

  async function join() {
    if (!user) {
      router.push(`/auth/sign-in?next=/l/${slug}?join=1`);
      return;
    }
    if (joining) return;
    setJoining(true);
    setErr(null);
    try {
      const r = await fetch(`/api/club/${slug}/join`, { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d.error ?? "Could not join");
        setJoining(false);
        return;
      }
      await load();
    } catch {
      setErr("Network error");
    }
    setJoining(false);
  }

  // Auto-join after returning from sign-in (?join=1).
  useEffect(() => {
    if (typeof window === "undefined" || !user || !data || data.member) return;
    if (new URLSearchParams(window.location.search).get("join") === "1") {
      window.history.replaceState(null, "", `/l/${slug}`);
      join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, data]);

  if (loading || userLoading) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <Spinner size={28} />
      </main>
    );
  }

  if (notFound || !data) {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-8 text-center">
        <p className="font-display text-4xl mb-3">🔍</p>
        <p className="font-display text-2xl text-white mb-2">Club not found</p>
        <p className="font-body text-sm mb-6" style={{ color: "#8888aa" }}>
          This club league doesn&apos;t exist or is no longer active.
        </p>
        <Link href="/" className="rounded-xl px-5 py-3 font-body font-bold text-sm" style={{ background: "#a78bfa", color: "#0a0a0f" }}>
          Back to YourScore
        </Link>
      </main>
    );
  }

  const league = data.league;
  const brand = league.brand_color || DEFAULT_BRAND;

  // ── Landing (non-member) ──────────────────────────────────────────────────
  if (!data.member) {
    return (
      <main className="min-h-dvh bg-bg pb-16">
        <GridBackground opacity={0.025} />
        <div className="max-w-lg mx-auto">
          <div
            className="h-44 relative"
            style={{
              background: league.cover_url
                ? `url(${league.cover_url}) center/cover`
                : `linear-gradient(135deg, ${brand}33 0%, #12121e 80%)`,
            }}
          >
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 30%, #0a0a0f 100%)" }} />
          </div>
          <div className="px-5 -mt-12 relative z-10">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 overflow-hidden"
              style={{ background: "#12121e", border: `2px solid ${brand}55` }}
            >
              {league.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={league.logo_url} alt={league.name} className="w-full h-full object-cover" />
              ) : (
                <span className="font-display text-4xl" style={{ color: brand }}>{initial(league.name)}</span>
              )}
            </div>
            <h1 className="font-display text-3xl text-white tracking-wide mb-1">{league.name}</h1>
            <p className="font-body text-xs uppercase tracking-widest mb-4" style={{ color: brand }}>
              Club League · {data.memberCount} member{data.memberCount === 1 ? "" : "s"}
            </p>
            {league.welcome_text && (
              <p className="font-body text-sm mb-4" style={{ color: "#aaaacc", lineHeight: 1.6 }}>{league.welcome_text}</p>
            )}
            {league.prize_text && (
              <div className="rounded-2xl px-4 py-3 mb-5" style={{ background: "rgba(255,215,0,0.07)", border: "1px solid rgba(255,215,0,0.2)" }}>
                <p className="font-body text-xs uppercase tracking-widest mb-1" style={{ color: "#ffd700" }}>🏆 Up for grabs</p>
                <p className="font-body text-sm text-white">{league.prize_text}</p>
              </div>
            )}
            {err && (
              <div className="rounded-xl px-4 py-2 mb-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>
            )}
            <button
              onClick={join}
              disabled={joining}
              className="w-full py-4 rounded-2xl font-display text-xl tracking-wide transition-all active:scale-[0.98] disabled:opacity-60"
              style={{ background: brand, color: "#0a0a0f" }}
            >
              {joining ? "JOINING…" : "JOIN THE CLUB →"}
            </button>
            <p className="font-body text-xs text-center mt-3" style={{ color: "#555577" }}>
              {user ? "You'll appear on the club board instantly." : "Sign in or create a free account to join."}
            </p>
            <p className="font-body text-xs text-center mt-6" style={{ color: "#444466" }}>
              Powered by <Link href="/" className="underline" style={{ color: "#8888aa" }}>YourScore</Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  // ── Hub (member) ──────────────────────────────────────────────────────────
  const isOwner = data.role === "owner";
  const tabs: [Tab, string][] = [
    ["board", "Board"],
    ["events", "Events"],
    ["feed", "Feed"],
    ...(isOwner ? ([["manage", "Manage"]] as [Tab, string][]) : []),
  ];

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.025} />
      <div className="max-w-lg mx-auto">
        {/* Branded header */}
        <div
          className="h-32 relative"
          style={{
            background: league.cover_url
              ? `url(${league.cover_url}) center/cover`
              : `linear-gradient(135deg, ${brand}33 0%, #12121e 80%)`,
          }}
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 20%, #0a0a0f 100%)" }} />
        </div>
        <div className="px-5 -mt-9 relative z-10 flex items-end gap-3 mb-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0"
            style={{ background: "#12121e", border: `2px solid ${brand}55` }}
          >
            {league.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={league.logo_url} alt={league.name} className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-3xl" style={{ color: brand }}>{initial(league.name)}</span>
            )}
          </div>
          <div className="min-w-0 pb-1">
            <h1 className="font-display text-2xl text-white tracking-wide truncate leading-none mb-1">{league.name}</h1>
            <p className="font-body text-xs" style={{ color: brand }}>
              Club League · {data.memberCount} member{data.memberCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="px-5 space-y-4">
          {league.announcement && (
            <div className="rounded-2xl px-4 py-3" style={{ background: `${brand}11`, border: `1px solid ${brand}33` }}>
              <p className="font-body text-xs uppercase tracking-widest mb-1" style={{ color: brand }}>📌 Pinned</p>
              <p className="font-body text-sm text-white" style={{ lineHeight: 1.55 }}>{league.announcement}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {tabs.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
                style={tab === key ? { background: brand, color: "#0a0a0f" } : { background: "transparent", color: "#8888aa" }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "board" && <BoardTab board={data.board ?? []} meId={user?.id} brand={brand} prizeText={league.prize_text} />}
          {tab === "events" && <EventsTab events={data.events ?? []} slug={slug} brand={brand} />}
          {tab === "feed" && <FeedTab feed={data.feed ?? []} />}
          {tab === "manage" && isOwner && <ManageTab league={league} slug={slug} brand={brand} onSaved={load} />}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}

// ── Board ───────────────────────────────────────────────────────────────────

function BoardTab({ board, meId, brand, prizeText }: { board: BoardRow[]; meId?: string; brand: string; prizeText: string | null }) {
  if (board.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="font-body text-sm" style={{ color: "#8888aa" }}>No members on the board yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {prizeText && (
        <div className="rounded-xl px-4 py-2.5 mb-2" style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
          <p className="font-body text-xs" style={{ color: "#ffd700" }}>🏆 {prizeText}</p>
        </div>
      )}
      {board.map((r, i) => {
        const pos = i + 1;
        const isMe = r.user_id === meId;
        return (
          <Link
            key={r.user_id}
            href={`/profile/${r.user_id}`}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-opacity hover:opacity-80"
            style={{
              background: isMe ? `${brand}14` : "#12121e",
              border: `1px solid ${isMe ? `${brand}44` : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <div className="w-8 text-center flex-shrink-0">
              {pos <= 3 ? (
                <span className="text-base">{["🥇", "🥈", "🥉"][pos - 1]}</span>
              ) : (
                <span className="font-display text-sm" style={{ color: "#8888aa" }}>#{pos}</span>
              )}
            </div>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0 overflow-hidden"
              style={{ background: "#1a2f4a", color: "#60a5fa", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {r.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                initial(r.display_name)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-medium text-white truncate">
                {r.display_name}
                {isMe && <span className="font-normal ml-1.5" style={{ fontSize: "0.7rem", color: brand }}>you</span>}
              </p>
              <p className="font-body text-xs" style={{ color: "#555577" }}>
                {r.wins}W · {r.draws}D · {r.losses}L · global #{r.overall_rank}
              </p>
            </div>
            <p className="font-display text-lg flex-shrink-0" style={{ color: pos === 1 ? "#ffd700" : isMe ? brand : "#aaaacc" }}>
              {r.overall_score.toLocaleString()}
            </p>
          </Link>
        );
      })}
      <p className="font-body text-xs text-center pt-2" style={{ color: "#444466" }}>
        YourScore points — 38-0 wins, quiz knowledge, one table.
      </p>
    </div>
  );
}

// ── Events ──────────────────────────────────────────────────────────────────

function EventsTab({ events, slug, brand }: { events: EventRow[]; slug: string; brand: string }) {
  const active = events.filter((e) => e.window === "live");
  const upcoming = events.filter((e) => e.window === "upcoming");
  const past = events.filter((e) => e.window === "ended" || e.window === "cancelled");

  if (events.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="font-display text-3xl mb-2">🗓️</p>
        <p className="font-body text-sm" style={{ color: "#8888aa" }}>No events yet — watch this space.</p>
      </div>
    );
  }

  const Card = ({ e }: { e: EventRow }) => {
    const chip = windowChip(e.window);
    return (
      <Link
        href={`/l/${slug}/event/${e.id}`}
        className="block rounded-2xl px-4 py-4 transition-opacity hover:opacity-90 active:scale-[0.99]"
        style={{
          background: e.window === "live" ? `${brand}10` : "#12121e",
          border: `1px solid ${e.window === "live" ? `${brand}44` : "rgba(255,255,255,0.07)"}`,
        }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-body text-xs font-bold px-2 py-0.5 rounded-md" style={{ color: chip.color, background: chip.bg }}>
            {chip.label}
          </span>
          <span className="font-body text-xs" style={{ color: "#555577" }}>
            {new Date(e.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
            {new Date(e.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <p className="font-body text-base font-bold text-white mb-0.5">{e.title}</p>
        {e.description && <p className="font-body text-xs truncate" style={{ color: "#8888aa" }}>{e.description}</p>}
        {e.prize_text && (
          <p className="font-body text-xs mt-1.5" style={{ color: "#ffd700" }}>🏆 {e.prize_text}</p>
        )}
        {e.window === "live" && (
          <div className="mt-3 rounded-xl py-2.5 text-center font-display tracking-wide" style={{ background: brand, color: "#0a0a0f", fontSize: 16 }}>
            PLAY NOW →
          </div>
        )}
      </Link>
    );
  };

  return (
    <div className="space-y-3">
      {active.map((e) => <Card key={e.id} e={e} />)}
      {upcoming.length > 0 && (
        <>
          <p className="font-body text-xs uppercase tracking-widest pt-1" style={{ color: "#555577" }}>Upcoming</p>
          {upcoming.map((e) => <Card key={e.id} e={e} />)}
        </>
      )}
      {past.length > 0 && (
        <>
          <p className="font-body text-xs uppercase tracking-widest pt-1" style={{ color: "#555577" }}>Past</p>
          {past.map((e) => <Card key={e.id} e={e} />)}
        </>
      )}
    </div>
  );
}

// ── Feed ────────────────────────────────────────────────────────────────────

function FeedTab({ feed }: { feed: FeedRow[] }) {
  if (feed.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="font-body text-sm" style={{ color: "#8888aa" }}>Nothing yet — go play something.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {feed.map((f, i) => {
        const { icon, text } = feedLine(f);
        return (
          <div
            key={`${f.kind}-${f.user_id}-${f.created_at}-${i}`}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-lg flex-shrink-0">{icon}</span>
            <p className="font-body text-sm flex-1 min-w-0" style={{ color: "#ccccdd", lineHeight: 1.45 }}>{text}</p>
            <span className="font-body text-xs flex-shrink-0" style={{ color: "#555577" }}>{timeAgo(f.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Manage (owner) ──────────────────────────────────────────────────────────

interface Pack {
  id: string;
  name: string;
  question_count: number | null;
}

function ManageTab({ league, slug, brand, onSaved }: { league: LeagueData; slug: string; brand: string; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    name: league.name ?? "",
    logo_url: league.logo_url ?? "",
    cover_url: league.cover_url ?? "",
    brand_color: league.brand_color ?? "",
    welcome_text: league.welcome_text ?? "",
    prize_text: league.prize_text ?? "",
    announcement: league.announcement ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [packs, setPacks] = useState<Pack[]>([]);
  const [ev, setEv] = useState({ title: "", packId: "", startsAt: "", endsAt: "", prizeText: "" });
  const [evBusy, setEvBusy] = useState(false);
  const [evMsg, setEvMsg] = useState<string | null>(null);

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/l/${slug}` : `https://yourscore.app/l/${slug}`;

  useEffect(() => {
    fetch(`/api/club/${slug}/events`)
      .then((r) => r.json())
      .then((d) => setPacks(d.packs ?? []))
      .catch(() => {});
  }, [slug]);

  async function saveBranding() {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch(`/api/club/${slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      setSaveMsg(r.ok ? "Saved ✓" : d.error ?? "Could not save");
      if (r.ok) await onSaved();
    } catch {
      setSaveMsg("Network error");
    }
    setSaving(false);
  }

  async function createEvent() {
    if (evBusy) return;
    setEvBusy(true);
    setEvMsg(null);
    try {
      const r = await fetch(`/api/club/${slug}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: ev.title,
          packId: ev.packId,
          startsAt: ev.startsAt ? new Date(ev.startsAt).toISOString() : "",
          endsAt: ev.endsAt ? new Date(ev.endsAt).toISOString() : "",
          prizeText: ev.prizeText,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setEvMsg(d.error ?? "Could not create event");
      } else {
        setEvMsg("Event created ✓");
        setEv({ title: "", packId: "", startsAt: "", endsAt: "", prizeText: "" });
        await onSaved();
      }
    } catch {
      setEvMsg("Network error");
    }
    setEvBusy(false);
  }

  const inputStyle = {
    background: "#0a0a0f",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.1)",
  } as const;

  return (
    <div className="space-y-4">
      {/* Share / QR */}
      <div className="rounded-2xl p-4" style={{ background: "#12121e", border: `1px solid ${brand}33` }}>
        <p className="font-display tracking-wide mb-3" style={{ fontSize: 16, color: brand }}>INVITE YOUR PUNTERS</p>
        <div className="flex gap-4 items-center">
          <div className="bg-white p-2 rounded-xl flex-shrink-0">
            <QRCode value={joinUrl} size={104} />
          </div>
          <div className="min-w-0">
            <p className="font-body text-xs mb-1" style={{ color: "#8888aa" }}>Scan to join, or share the link:</p>
            <p className="font-body text-sm text-white break-all mb-2">{joinUrl}</p>
            <button
              onClick={() => navigator.clipboard?.writeText(joinUrl)}
              className="font-body text-xs font-bold px-3 py-1.5 rounded-lg"
              style={{ background: `${brand}22`, color: brand }}
            >
              Copy link
            </button>
          </div>
        </div>
      </div>

      {/* Create event */}
      <div className="rounded-2xl p-4 space-y-2.5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
        <p className="font-display tracking-wide" style={{ fontSize: 16, color: "#fff" }}>RUN A QUIZ NIGHT</p>
        {packs.length === 0 ? (
          <p className="font-body text-xs" style={{ color: "#8888aa" }}>
            First, build a quiz pack —{" "}
            <Link href="/quiz/create" className="underline" style={{ color: brand }}>create one here</Link>, then come back to schedule the night.
          </p>
        ) : (
          <>
            <input
              value={ev.title}
              onChange={(e) => setEv({ ...ev, title: e.target.value })}
              maxLength={80}
              placeholder="Event title (e.g. Tuesday Quiz Night)"
              className="w-full rounded-xl px-3 py-3 font-body text-sm outline-none"
              style={inputStyle}
            />
            <select
              value={ev.packId}
              onChange={(e) => setEv({ ...ev, packId: e.target.value })}
              className="w-full rounded-xl px-3 py-3 font-body text-sm outline-none"
              style={inputStyle}
            >
              <option value="">Pick a quiz pack…</option>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.question_count ?? "?"} questions)
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="font-body text-xs block mb-1" style={{ color: "#8888aa" }}>Starts</span>
                <input type="datetime-local" value={ev.startsAt} onChange={(e) => setEv({ ...ev, startsAt: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
              </label>
              <label className="flex-1">
                <span className="font-body text-xs block mb-1" style={{ color: "#8888aa" }}>Ends</span>
                <input type="datetime-local" value={ev.endsAt} onChange={(e) => setEv({ ...ev, endsAt: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
              </label>
            </div>
            <input
              value={ev.prizeText}
              onChange={(e) => setEv({ ...ev, prizeText: e.target.value })}
              maxLength={120}
              placeholder="Prize (optional — e.g. Free pint for the winner)"
              className="w-full rounded-xl px-3 py-3 font-body text-sm outline-none"
              style={inputStyle}
            />
            <p className="font-body text-xs" style={{ color: "#8888aa" }}>
              Need new questions? <Link href="/quiz/create" className="underline" style={{ color: brand }}>Build a pack</Link>
            </p>
            {evMsg && <p className="font-body text-xs" style={{ color: evMsg.includes("✓") ? "#00ff87" : "#ff4757" }}>{evMsg}</p>}
            <button
              onClick={createEvent}
              disabled={evBusy || !ev.title.trim() || !ev.packId || !ev.startsAt || !ev.endsAt}
              className="w-full py-3 rounded-xl font-display tracking-wide disabled:opacity-50"
              style={{ background: brand, color: "#0a0a0f", fontSize: 16 }}
            >
              {evBusy ? "CREATING…" : "SCHEDULE EVENT"}
            </button>
          </>
        )}
      </div>

      {/* Branding */}
      <div className="rounded-2xl p-4 space-y-2.5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
        <p className="font-display tracking-wide" style={{ fontSize: 16, color: "#fff" }}>YOUR CLUB&apos;S LOOK</p>
        {(
          [
            ["name", "Club name", "text"],
            ["logo_url", "Logo image URL", "url"],
            ["cover_url", "Cover image URL", "url"],
            ["brand_color", "Brand colour (#rrggbb)", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <label key={key} className="block">
            <span className="font-body text-xs block mb-1" style={{ color: "#8888aa" }}>{label}</span>
            <input
              type={type}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none"
              style={inputStyle}
            />
          </label>
        ))}
        {(
          [
            ["welcome_text", "Welcome message (landing page)"],
            ["prize_text", "Standing prize (shown on the board)"],
            ["announcement", "Pinned announcement"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block">
            <span className="font-body text-xs block mb-1" style={{ color: "#8888aa" }}>{label}</span>
            <textarea
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              rows={2}
              maxLength={300}
              className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none resize-none"
              style={inputStyle}
            />
          </label>
        ))}
        {saveMsg && <p className="font-body text-xs" style={{ color: saveMsg.includes("✓") ? "#00ff87" : "#ff4757" }}>{saveMsg}</p>}
        <button
          onClick={saveBranding}
          disabled={saving || !form.name.trim()}
          className="w-full py-3 rounded-xl font-display tracking-wide disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: 16 }}
        >
          {saving ? "SAVING…" : "SAVE CHANGES"}
        </button>
      </div>
    </div>
  );
}
