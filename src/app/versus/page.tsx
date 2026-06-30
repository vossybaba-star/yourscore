"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { useYourTurns, type InboxChallenge } from "@/hooks/useYourTurns";
import { VERSUS_FEED, type VersusFeedItem } from "@/lib/versus/registry";
import { BottomNav } from "@/components/ui/BottomNav";
import { FriendsPanel } from "@/components/friends/FriendsPanel";
import { LeaguesPanel } from "@/components/leagues/LeaguesPanel";

// The Versus tab: an enhanced, image-led hub for playing other people across
// every game. Play = a discovery feed + Your Turns inbox. Friends / Groups /
// Leagues are real in-place sub-tabs (Friends + Leagues render the existing
// pages with their chrome stripped via `embedded`, so back never leaves Versus).

type View = "play" | "friends" | "leagues";

function FeedIcon({ k, color }: { k: VersusFeedItem["iconKey"]; color: string }) {
  const p =
    k === "jersey" ? "M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z"
    : k === "quiz" ? "M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z"
    : null;
  if (p) return <svg width="18" height="18" viewBox="0 0 22 22" fill="none"><path d={p} stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill={color} fillOpacity={0.15} /></svg>;
  if (k === "group") return (
    <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
      <circle cx="8.5" cy="8" r="3" stroke={color} strokeWidth="1.7" /><path d="M3 19a5.5 5.5 0 0111 0" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="9" r="2.2" stroke={color} strokeWidth="1.5" /><path d="M15 14.5a4.5 4.5 0 014.5 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  return <svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="8.5" stroke={color} strokeWidth="1.7" /><path d="M2.5 11h17M11 2.5c2.5 2.3 2.5 14 0 17M11 2.5c-2.5 2.3-2.5 14 0 17" stroke={color} strokeWidth="1.5" /></svg>;
}

function imgStyle(src: string): React.CSSProperties {
  return { backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" };
}

function HeroCard({ item }: { item: VersusFeedItem }) {
  return (
    <Link href={item.href} className="block rounded-3xl overflow-hidden active:scale-[0.99] transition-transform mb-3" style={{ border: `1px solid ${item.accent}4d` }}>
      <div className="relative" style={{ height: 150, ...imgStyle(item.image) }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(6,18,15,0.1) 0%, rgba(6,18,15,0.55) 55%, #06120f 100%)" }} />
        <span className="absolute top-3 left-3 font-body text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-md" style={{ background: item.accent, color: "#04231f", fontWeight: 600 }}>Today</span>
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
          <p className="font-display text-lg text-white leading-tight">{item.title}</p>
          <p className="font-body text-xs mt-0.5" style={{ color: "#cdeee7" }}>{item.sub}</p>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3" style={{ background: "#0e1a18" }}>
        <span className="font-body text-xs text-text-muted">Play it, then send it to a friend</span>
        <span className="font-display text-xs tracking-wide px-4 py-2 rounded-lg" style={{ background: item.accent, color: "#04231f" }}>{item.cta} →</span>
      </div>
    </Link>
  );
}

function FeedCard({ item }: { item: VersusFeedItem }) {
  const darkText = item.accent === "#aeea00";
  return (
    <Link href={item.href} className="flex rounded-2xl overflow-hidden active:scale-[0.99] transition-transform mb-3" style={{ border: `1px solid ${item.accent}40`, background: "#0e1512" }}>
      <div className="flex-shrink-0 relative" style={{ width: 104, ...imgStyle(item.image) }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(14,21,18,0.15), rgba(14,21,18,0.85))" }} />
      </div>
      <div className="flex-1 min-w-0 p-3.5">
        <div className="flex items-center gap-2 mb-1.5"><FeedIcon k={item.iconKey} color={item.accent} /><p className="font-display text-[15px] text-white truncate">{item.title}</p></div>
        <p className="font-body text-xs text-text-muted leading-snug mb-2.5">{item.sub}</p>
        <span className="inline-block font-display text-xs tracking-wide px-3.5 py-2 rounded-lg" style={{ background: item.accent, color: darkText ? "#13200a" : "#04231f" }}>{item.cta} →</span>
      </div>
    </Link>
  );
}

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }

function Avatar({ label, accent, accentBg, accentText, dim }: { label: string; accent?: string; accentBg?: string; accentText?: string; dim?: boolean }) {
  const bg = accentBg ?? (accent ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.06)");
  const fg = accentText ?? accent ?? (dim ? "#9aa39d" : "#cfcfe6");
  return <div className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0" style={{ background: bg, color: fg, border: "1px solid rgba(255,255,255,0.1)" }}>{initial(label)}</div>;
}

function InboxRow({ c, kind }: { c: InboxChallenge; kind: "play" | "waiting" | "result" }) {
  const isGroup = c.kind === "group";
  const href = isGroup ? `/g/${c.id}` : `/h2h/${c.id}`;
  const teal = "#00d8c0";

  if (kind === "waiting") {
    const sub = isGroup ? `${c.packName} · ${c.groupPlayed ?? 0}/${c.groupPlayers ?? 1} played` : `${c.packName} · you scored ${(c.myScore ?? 0).toLocaleString()}`;
    return (
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <Avatar label={c.otherName} dim />
        <div className="flex-1 min-w-0"><p className="font-body text-sm font-semibold text-white truncate">{c.otherName}</p><p className="font-body text-xs text-text-muted truncate">{sub}</p></div>
        <span className="font-body text-xs flex-shrink-0" style={{ color: "#586058" }}>Waiting…</span>
      </div>
    );
  }

  const isPlay = kind === "play";
  if (isGroup || isPlay) {
    return (
      <Link href={href} className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface transition-all active:scale-[0.99]" style={{ border: `1px solid ${isPlay ? "rgba(0,216,192,0.25)" : "rgba(255,255,255,0.08)"}` }}>
        <Avatar label={c.otherName} accent={isPlay ? teal : undefined} />
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm font-semibold text-white truncate">{isPlay ? (isGroup ? `${c.otherName} — your turn` : `${c.otherName} challenged you`) : (isGroup ? c.otherName : `vs ${c.otherName}`)}</p>
          <p className="font-body text-xs text-text-muted truncate">{c.packName}{isGroup ? ` · ${c.groupPlayers ?? 1} player${(c.groupPlayers ?? 1) === 1 ? "" : "s"}` : ""}</p>
        </div>
        <span className="font-display text-xs tracking-wide px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: isPlay ? "rgba(0,216,192,0.15)" : "transparent", color: isPlay ? teal : "#586058", border: isPlay ? "1px solid rgba(0,216,192,0.3)" : "none" }}>{isPlay ? "PLAY" : "BOARD"}</span>
      </Link>
    );
  }

  const my = c.myScore ?? 0, their = c.theirScore ?? 0;
  const draw = my === their, won = my > their;
  const col = draw ? "#8a948f" : won ? "#aeea00" : "#ff6b78";
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface transition-all active:scale-[0.99]" style={{ border: `1px solid ${col}33` }}>
      <Avatar label={c.otherName} accentBg={`${col}22`} accentText={col} />
      <div className="flex-1 min-w-0"><p className="font-body text-sm font-semibold text-white truncate">vs {c.otherName}</p><p className="font-body text-xs text-text-muted truncate">{c.packName}</p></div>
      <div className="text-right flex-shrink-0"><p className="font-display text-sm" style={{ color: col }}>{draw ? "Draw" : won ? "Won" : "Lost"}</p><p className="font-body text-xs text-text-muted">{my.toLocaleString()} · {their.toLocaleString()}</p></div>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: "#586058" }}>{children}</p>;
}

function VersusInner() {
  const { user, loading } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const view = ((params.get("view") as View) ?? "play");
  const turns = useYourTurns();

  if (!loading && !user) {
    return (
      <main className="min-h-dvh bg-bg grid place-items-center px-6">
        <div className="text-center">
          <p className="font-display text-xl text-white mb-2">Versus</p>
          <p className="font-body text-sm text-text-muted mb-5">Sign in to challenge your friends.</p>
          <Link href="/auth/sign-in?next=/versus" className="inline-block rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Sign in →</Link>
        </div>
      </main>
    );
  }

  // Groups retired — show only 1v1 challenges in the inbox.
  const only1v1 = (list: InboxChallenge[]) => list.filter((c) => c.kind !== "group");
  const yourTurn = only1v1(turns.yourTurn), waiting = only1v1(turns.waiting), results = only1v1(turns.results);

  const PILLS: { key: View; label: string }[] = [
    { key: "play", label: "Play" }, { key: "friends", label: "Friends" }, { key: "leagues", label: "Leagues" },
  ];

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="sticky top-0 z-20 pt-safe" style={{ background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M3 3l8.5 8.5M3 3v3l7.5 7.5M3 3h3l7.5 7.5" stroke="#00d8c0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M19 3l-8.5 8.5M19 3v3l-7.5 7.5M19 3h-3L8.5 11.5" stroke="#00d8c0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="font-display text-2xl text-white" style={{ letterSpacing: "-0.01em" }}>Versus</h1>
        </div>
        <div className="flex max-w-lg mx-auto px-5 pb-3 gap-2 overflow-x-auto no-scrollbar">
          {PILLS.map((p) => {
            const active = p.key === view;
            return (
              <button key={p.key} onClick={() => router.push(`/versus?view=${p.key}`)} className="font-body text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all flex-shrink-0"
                style={{ background: active ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)", color: active ? "#00d8c0" : "#8a948f", border: `1px solid ${active ? "rgba(0,216,192,0.3)" : "transparent"}` }}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "friends" && <FriendsPanel embedded />}
      {view === "leagues" && <LeaguesPanel embedded />}

      {view === "play" && (
        <div className="max-w-lg mx-auto px-5">
          <div className="pt-4">
            {VERSUS_FEED.map((item) => item.kind === "hero" ? <HeroCard key={item.id} item={item} /> : <FeedCard key={item.id} item={item} />)}
          </div>

          {yourTurn.length > 0 && (<><SectionLabel>Your turn</SectionLabel><div className="space-y-2">{yourTurn.map((c) => <InboxRow key={c.id} c={c} kind="play" />)}</div></>)}
          {waiting.length > 0 && (<><SectionLabel>Waiting on them</SectionLabel><div className="space-y-2">{waiting.map((c) => <InboxRow key={c.id} c={c} kind="waiting" />)}</div></>)}
          {results.length > 0 && (<><SectionLabel>Recent results</SectionLabel><div className="space-y-2">{results.map((c) => <InboxRow key={c.id} c={c} kind="result" />)}</div></>)}
        </div>
      )}

      <BottomNav />
    </main>
  );
}

export default function VersusPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg" />}>
      <VersusInner />
    </Suspense>
  );
}
