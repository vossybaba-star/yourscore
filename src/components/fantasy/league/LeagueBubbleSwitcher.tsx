"use client";
/**
 * The league bubble switcher — a horizontal, story-style strip at the very top of
 * a league so you can hop straight between YOUR groups without going back to a
 * list (founder 8 Aug). This IS the Leagues navigation now: the list-style "My
 * Leagues" tab is gone, so the strip carries two pinned entries plus your leagues:
 *
 *   [ + ]            leading bubble → dropdown: Create a league / Browse leagues
 *   [ Competition ]  pinned → the YourScore-wide tables + club-fan board
 *   [ your leagues… ]
 *
 * Reuses the existing /api/fantasy/leagues payload — no new endpoint.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TEAL, GOLD, LINE, MUTED, INK, tint } from "@/components/fantasy/shared";

type Bubble = {
  code: string; name: string; imageUrl?: string | null;
  unread?: number; live?: boolean;
};
type MyLeague = {
  code: string; name: string; imageUrl?: string | null; unread?: number;
  highlight?: { tone?: string } | null;
};

const GRADS = ["#1a2f4a,#3a423d", "#3a1a4a,#1a3a3d", "#4a2f1a,#3d3a1a", "#1a4a2f,#3d1a3a"];
function grad(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADS[h % GRADS.length];
}

const SIZE = 52;

function Avatar({ b, size, active }: { b: Bubble; size: number; active: boolean }) {
  const ring = active ? `2.5px solid ${TEAL}` : `1px solid ${LINE}`;
  const common: React.CSSProperties = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover",
    border: ring, boxShadow: active ? `0 0 0 3px ${tint(TEAL, "22")}` : "none",
  };
  if (b.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={b.imageUrl} alt="" width={size} height={size} style={common} />;
  }
  const [c1, c2] = grad(b.name).split(",");
  return (
    <span style={{ ...common, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(140deg, ${c1}, ${c2})` }}>
      <span className="font-display" style={{ fontSize: size * 0.4, color: "#eef2f0", lineHeight: 1 }}>
        {(b.name.trim()[0] || "?").toUpperCase()}
      </span>
    </span>
  );
}

/** A pinned/system bubble (the + and Competition) — a labelled column matching
 *  the league bubbles' footprint, so the strip stays visually even. */
function PinnedBubble({ label, ariaLabel, onClick, ring, color, children }: {
  label: string; ariaLabel: string; onClick: () => void; ring: string; color: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} aria-label={ariaLabel}
      style={{ flexShrink: 0, width: SIZE + 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
      <span style={{
        width: SIZE, height: SIZE, borderRadius: "50%", flexShrink: 0,
        border: ring, display: "flex", alignItems: "center", justifyContent: "center", color,
      }}>{children}</span>
      <span style={{ fontSize: 10.5, lineHeight: 1.1, color, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

export function LeagueBubbleSwitcher({ currentCode, current, onSwitch, onCreate }: {
  currentCode: string;
  current?: { name: string; imageUrl?: string | null };
  /** When provided, tapping a bubble switches the league IN PLACE (no route
   *  navigation) — the caller swaps its own data. Falls back to a normal push. */
  onSwitch?: (code: string) => void;
  /** Opens the Create-league flow (mounted by the parent). Falls back to Browse
   *  if not provided. */
  onCreate?: () => void;
}) {
  const router = useRouter();
  const [leagues, setLeagues] = useState<MyLeague[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const plusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/leagues")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.leagues) setLeagues(d.leagues as MyLeague[]); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Close the + dropdown on any outside tap / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (plusRef.current && !plusRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  // Build the strip: my leagues, with the current one guaranteed present (a
  // non-member peeking at a public league still sees which one they're in).
  const list: Bubble[] = (leagues ?? []).map((l) => ({
    code: l.code, name: l.name, imageUrl: l.imageUrl,
    unread: l.unread ?? 0, live: l.highlight?.tone === "chat",
  }));
  if (current && !list.some((b) => b.code.toUpperCase() === currentCode)) {
    list.unshift({ code: currentCode, name: current.name, imageUrl: current.imageUrl });
  }

  // Bring the active bubble into view once the strip has rendered.
  useEffect(() => {
    if (!leagues) return;
    const el = stripRef.current?.querySelector<HTMLElement>('[data-active="1"]');
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
  }, [leagues]);

  const goBrowse = () => { setMenuOpen(false); router.push("/fantasy/leagues?browse=1"); };
  const goCreate = () => { setMenuOpen(false); if (onCreate) onCreate(); else goBrowse(); };
  const goCompetition = () => router.push("/fantasy/leagues?view=competition");

  return (
    <div ref={stripRef} className="no-scrollbar" style={{
      display: "flex", gap: 14, overflowX: "auto", padding: "2px 0 6px",
      scrollbarWidth: "none", WebkitOverflowScrolling: "touch", margin: "0 -2px 6px",
    }}>
      {/* + bubble — create or browse. Leading, always present (founder 8 Aug). */}
      <div ref={plusRef} style={{ position: "relative", flexShrink: 0 }}>
        <PinnedBubble
          label="New" ariaLabel="Create or browse leagues" onClick={() => setMenuOpen((o) => !o)}
          ring={`1.5px dashed ${tint(TEAL, "66")}`} color={TEAL}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        </PinnedBubble>
        {menuOpen && (
          <div role="menu" style={{
            position: "absolute", top: SIZE + 8, left: 0, zIndex: 40, minWidth: 168,
            background: "#101915", border: `1px solid ${LINE}`, borderRadius: 12, padding: 6,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          }}>
            <button role="menuitem" onClick={goCreate} style={menuItem}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Create a league
            </button>
            <button role="menuitem" onClick={goBrowse} style={menuItem}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx={11} cy={11} r={7} /><path d="M21 21l-4-4" /></svg>
              Browse leagues
            </button>
          </div>
        )}
      </div>

      {/* Competition — its own pinned bubble (founder 8 Aug): the YourScore-wide
          tables + club-fan board. */}
      <PinnedBubble
        label="Competition" ariaLabel="YourScore Competition" onClick={goCompetition}
        ring={`1.5px solid ${tint(GOLD, "66")}`} color={GOLD}
      >
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h12v3a6 6 0 01-12 0V4z" /><path d="M6 6H4v1a3 3 0 003 3M18 6h2v1a3 3 0 01-3 3M9 17h6M8 20h8M12 13v4" /></svg>
      </PinnedBubble>

      {/* Your leagues */}
      {(leagues ? list : Array.from({ length: 3 }, (_, i) => ({ code: `_s${i}`, name: "", imageUrl: null } as Bubble))).map((b) => {
        const active = b.code.toUpperCase() === currentCode;
        const skeleton = !leagues;
        return (
          <button
            key={b.code}
            data-active={active ? "1" : undefined}
            onClick={() => { if (!skeleton && !active) { if (onSwitch) onSwitch(b.code); else router.push(`/fantasy/leagues/${b.code}`); } }}
            aria-label={active ? `${b.name} (current)` : `Switch to ${b.name}`}
            aria-current={active ? "true" : undefined}
            style={{
              flexShrink: 0, width: SIZE + 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
              background: "transparent", border: "none", padding: 0, cursor: skeleton || active ? "default" : "pointer",
            }}
          >
            <span style={{ position: "relative", opacity: skeleton ? 0.4 : active ? 1 : 0.72 }}>
              {skeleton
                ? <span style={{ width: SIZE, height: SIZE, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "block" }} />
                : <Avatar b={b} size={SIZE} active={active} />}
              {!skeleton && (b.unread ?? 0) > 0 && (
                <span aria-hidden style={{
                  position: "absolute", top: -1, right: -1, minWidth: 16, height: 16, borderRadius: 999, padding: "0 4px",
                  background: TEAL, color: "#04231f", fontSize: 9.5, fontWeight: 800, lineHeight: "16px", textAlign: "center",
                  border: "2px solid #0a0f0c", boxSizing: "content-box",
                }}>{(b.unread ?? 0) > 9 ? "9+" : b.unread}</span>
              )}
              {!skeleton && !((b.unread ?? 0) > 0) && b.live && (
                <span aria-hidden style={{
                  position: "absolute", top: 1, right: 1, width: 11, height: 11, borderRadius: 999,
                  background: TEAL, border: "2px solid #0a0f0c",
                }} />
              )}
            </span>
            {!skeleton && (
              <span style={{
                fontSize: 10.5, lineHeight: 1.1, maxWidth: SIZE + 10, textAlign: "center",
                color: active ? INK : MUTED, fontWeight: active ? 700 : 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{b.name}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const menuItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", cursor: "pointer",
  background: "transparent", border: "none", padding: "9px 10px", borderRadius: 8,
  fontSize: 13.5, fontWeight: 600, color: INK,
};
