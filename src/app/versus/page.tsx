"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { useYourTurns, type InboxChallenge } from "@/hooks/useYourTurns";
import { VERSUS_PROMOS, type VersusPromo } from "@/lib/versus/registry";
import { BottomNav } from "@/components/ui/BottomNav";

// The Versus tab: a game-first hub for playing other people across every game.
// Play (Your Turns inbox + game picker) and Groups render in-place; Friends and
// Leagues route to their existing pages (the bottom-nav Versus tab stays active
// there, so the three read as one hub). See the spec for the v1 boundaries.

type View = "play" | "groups";

function PromoIcon({ k, color }: { k: VersusPromo["iconKey"]; color: string }) {
  const p =
    k === "jersey" ? "M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z"
    : k === "quiz" ? "M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z"
    : null;
  if (p) {
    return (
      <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
        <path d={p} stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill={color} fillOpacity={0.15} />
      </svg>
    );
  }
  if (k === "group") {
    return (
      <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
        <circle cx="8.5" cy="8" r="3" stroke={color} strokeWidth="1.7" />
        <path d="M3 19a5.5 5.5 0 0111 0" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="16" cy="9" r="2.2" stroke={color} strokeWidth="1.5" />
        <path d="M15 14.5a4.5 4.5 0 014.5 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="8.5" stroke={color} strokeWidth="1.7" />
      <path d="M2.5 11h17M11 2.5c2.5 2.3 2.5 14 0 17M11 2.5c-2.5 2.3-2.5 14 0 17" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }

// One inbox row, normalised across 1v1 + group. Routes to /h2h/<id> or /g/<id>.
function InboxRow({ c, kind }: { c: InboxChallenge; kind: "play" | "waiting" | "result" }) {
  const isGroup = c.kind === "group";
  const href = isGroup ? `/g/${c.id}` : `/h2h/${c.id}`;
  const teal = "#00d8c0";

  if (kind === "waiting") {
    const sub = isGroup
      ? `${c.packName} · ${c.groupPlayed ?? 0}/${c.groupPlayers ?? 1} played`
      : `${c.packName} · you scored ${(c.myScore ?? 0).toLocaleString()}`;
    return (
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <Avatar label={c.otherName} dim />
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm font-semibold text-white truncate">{c.otherName}</p>
          <p className="font-body text-xs text-text-muted truncate">{sub}</p>
        </div>
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
          <p className="font-body text-sm font-semibold text-white truncate">
            {isPlay ? (isGroup ? `${c.otherName} — your turn` : `${c.otherName} challenged you`) : (isGroup ? c.otherName : `vs ${c.otherName}`)}
          </p>
          <p className="font-body text-xs text-text-muted truncate">
            {c.packName}{isGroup ? ` · ${c.groupPlayers ?? 1} player${(c.groupPlayers ?? 1) === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <span className="font-display text-xs tracking-wide px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: isPlay ? "rgba(0,216,192,0.15)" : "transparent", color: isPlay ? teal : "#586058", border: isPlay ? "1px solid rgba(0,216,192,0.3)" : "none" }}>
          {isPlay ? "PLAY" : "BOARD"}
        </span>
      </Link>
    );
  }

  // 1v1 result
  const my = c.myScore ?? 0, their = c.theirScore ?? 0;
  const draw = my === their, won = my > their;
  const col = draw ? "#8a948f" : won ? "#aeea00" : "#ff6b78";
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface transition-all active:scale-[0.99]" style={{ border: `1px solid ${col}33` }}>
      <Avatar label={c.otherName} accentBg={`${col}22`} accentText={col} />
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-semibold text-white truncate">vs {c.otherName}</p>
        <p className="font-body text-xs text-text-muted truncate">{c.packName}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="font-display text-sm" style={{ color: col }}>{draw ? "Draw" : won ? "Won" : "Lost"}</p>
        <p className="font-body text-xs text-text-muted">{my.toLocaleString()} · {their.toLocaleString()}</p>
      </div>
    </Link>
  );
}

function Avatar({ label, accent, accentBg, accentText, dim }: { label: string; accent?: string; accentBg?: string; accentText?: string; dim?: boolean }) {
  const bg = accentBg ?? (accent ? "rgba(0,216,192,0.15)" : dim ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.06)");
  const fg = accentText ?? accent ?? (dim ? "#9aa39d" : "#cfcfe6");
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
      style={{ background: bg, color: fg, border: "1px solid rgba(255,255,255,0.1)" }}>{initial(label)}</div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: "#586058" }}>{children}</p>;
}

function VersusInner() {
  const { user, loading } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const view = (params.get("view") as View) ?? "play";
  const turns = useYourTurns();

  if (!loading && !user) {
    return (
      <main className="min-h-dvh bg-bg grid place-items-center px-6">
        <div className="text-center">
          <p className="font-display text-xl text-white mb-2">Versus</p>
          <p className="font-body text-sm text-text-muted mb-5">Sign in to challenge your mates.</p>
          <Link href="/auth/sign-in?next=/versus" className="inline-block rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Sign in →</Link>
        </div>
      </main>
    );
  }

  const groupTurns = turns.yourTurn.filter((c) => c.kind === "group");
  const groupWaiting = turns.waiting.filter((c) => c.kind === "group");
  const groupResults = turns.results.filter((c) => c.kind === "group");

  const PILLS: { key: View | "friends" | "leagues"; label: string; href?: string }[] = [
    { key: "play", label: "Play" },
    { key: "friends", label: "Friends", href: "/friends" },
    { key: "groups", label: "Groups" },
    { key: "leagues", label: "Leagues", href: "/leagues" },
  ];

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="sticky top-0 z-20 pt-safe" style={{ background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 py-4">
          <h1 className="font-display text-2xl text-white" style={{ letterSpacing: "-0.01em" }}>Versus</h1>
          <p className="font-body text-xs text-text-muted mt-0.5">Play your mates. Or anyone.</p>
        </div>
        <div className="flex max-w-lg mx-auto px-5 pb-3 gap-2 overflow-x-auto">
          {PILLS.map((p) => {
            const active = !p.href && p.key === view;
            const cls = "font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex-shrink-0";
            const style = {
              background: active ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)",
              color: active ? "#00d8c0" : "#8a948f",
              border: `1px solid ${active ? "rgba(0,216,192,0.3)" : "transparent"}`,
            };
            return p.href
              ? <Link key={p.key} href={p.href} className={cls} style={style}>{p.label}</Link>
              : <button key={p.key} onClick={() => router.replace(`/versus?view=${p.key}`)} className={cls} style={style}>{p.label}</button>;
          })}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5">
        {view !== "groups" && (
          <>
            {turns.yourTurn.length > 0 && (
              <>
                <SectionLabel>Your turn</SectionLabel>
                <div className="space-y-2">{turns.yourTurn.map((c) => <InboxRow key={c.id} c={c} kind="play" />)}</div>
              </>
            )}

            <SectionLabel>What do you want to do?</SectionLabel>
            <div className="-mx-5 px-5 overflow-x-auto no-scrollbar" style={{ scrollSnapType: "x mandatory" }}>
              <div className="flex gap-2.5 pb-1" style={{ width: "max-content" }}>
                {VERSUS_PROMOS.map((p) => (
                  <Link key={p.id} href={p.href} className="block rounded-2xl p-4 active:scale-[0.98] transition-transform"
                    style={{ width: 228, scrollSnapAlign: "start", background: "#0f1512", border: `1px solid ${p.accent}55` }}>
                    <span className="inline-flex p-2 rounded-xl" style={{ background: `${p.accent}22` }}>
                      <PromoIcon k={p.iconKey} color={p.accent} />
                    </span>
                    <p className="font-display text-base text-white mt-3">{p.title}</p>
                    <p className="font-body text-xs text-text-muted mt-1 leading-snug" style={{ minHeight: 32 }}>{p.sub}</p>
                    <span className="inline-flex items-center gap-1.5 mt-3 font-display text-xs tracking-wide px-3.5 py-2 rounded-lg"
                      style={{ background: p.accent, color: p.accent === "#aeea00" ? "#13200a" : "#04231f" }}>{p.cta} →</span>
                  </Link>
                ))}
              </div>
            </div>

            {turns.waiting.length > 0 && (
              <>
                <SectionLabel>Waiting on them</SectionLabel>
                <div className="space-y-2">{turns.waiting.map((c) => <InboxRow key={c.id} c={c} kind="waiting" />)}</div>
              </>
            )}

            {turns.results.length > 0 && (
              <>
                <SectionLabel>Recent results</SectionLabel>
                <div className="space-y-2">{turns.results.map((c) => <InboxRow key={c.id} c={c} kind="result" />)}</div>
              </>
            )}

            {!turns.loading && turns.yourTurn.length === 0 && turns.waiting.length === 0 && turns.results.length === 0 && (
              <p className="font-body text-sm text-text-muted mt-6 text-center">Pick a game above to challenge someone.</p>
            )}
          </>
        )}

        {view === "groups" && (
          <>
            <SectionLabel>Your turn</SectionLabel>
            {groupTurns.length ? <div className="space-y-2">{groupTurns.map((c) => <InboxRow key={c.id} c={c} kind="play" />)}</div>
              : <p className="font-body text-sm text-text-muted">Nothing waiting on you.</p>}

            {groupWaiting.length > 0 && (<><SectionLabel>Waiting on them</SectionLabel>
              <div className="space-y-2">{groupWaiting.map((c) => <InboxRow key={c.id} c={c} kind="waiting" />)}</div></>)}

            {groupResults.length > 0 && (<><SectionLabel>Finished</SectionLabel>
              <div className="space-y-2">{groupResults.map((c) => <InboxRow key={c.id} c={c} kind="result" />)}</div></>)}

            <div className="mt-6 rounded-2xl p-4 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-body text-sm text-white">Start a group board</p>
              <p className="font-body text-xs text-text-muted mt-1 mb-3">Play a quiz, then invite the group from the result screen.</p>
              <Link href="/play" className="inline-block rounded-xl px-4 py-2 font-display text-sm tracking-wide" style={{ background: "rgba(0,216,192,0.12)", border: "1px solid rgba(0,216,192,0.35)", color: "#00d8c0" }}>Pick a quiz →</Link>
            </div>
          </>
        )}
      </div>

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
