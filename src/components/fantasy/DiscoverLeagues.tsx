"use client";
/**
 * Social → Discover → Leagues (founder, 3 Aug). Shows every league worth finding,
 * not just the ones you can join:
 *   - YourScore leagues  — the mixed cross-fan leagues + the Founder League, up top,
 *     because we back fans mixing, not sitting in their own corner.
 *   - Club leagues       — every club's fan league. You can look inside a rival
 *     club's league to see what they talk about; you just can't post there.
 *   - Public leagues     — leagues managers have made public.
 * Search still finds public leagues by name. Every YourScore-run league carries a
 * blue verified tick.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { VerifiedTick } from "@/components/ui/Seal";

/** A league's social links (migration 263) — Discord-like community chips.
 *  Re-declared locally, same shape as the API/lib/fantasy/leagues.ts DTO. */
interface LeagueLinks {
  discord?: string; x?: string; instagram?: string; tiktok?: string; website?: string;
}
interface Row {
  id: string; name: string; code: string; memberCount: number; imageUrl?: string | null;
  official?: boolean; kind?: string; club?: string | null; isMember?: boolean; canContribute?: boolean;
  bio?: string | null; links?: LeagueLinks;
}
interface Groups { featured: Row[]; clubs: Row[]; open: Row[] }

// Community-card sized (founder, 7 Aug) — Discover gets the fullest treatment,
// so the crest is the biggest anywhere leagues render (72-88px, rounded-2xl);
// the shield fallback scales up with it rather than looking lost next to a
// bigger frame.
function LeagueCrest({ imageUrl, size = 84 }: { imageUrl?: string | null; size?: number }) {
  const r = Math.round(size * 0.23);
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: r, objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />;
  }
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: r, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size * 0.48} height={size * 0.48} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></svg>
    </span>
  );
}

const LINK_META: { key: keyof LeagueLinks; label: string; accent: string; icon: React.ReactNode }[] = [
  { key: "discord", label: "Discord", accent: "#5865F2", icon: <path d="M8 8.5C10.3 7.3 13.7 7.3 16 8.5M6.5 9c-1.4 2.8-1.4 5.6 0 8.5 1.4.5 2.8.3 3.8-.6M17.5 9c1.4 2.8 1.4 5.6 0 8.5-1.4.5-2.8.3-3.8-.6M9 13a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0zM12.6 13a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0z" /> },
  { key: "x", label: "X", accent: "#eef2f0", icon: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></> },
  { key: "instagram", label: "Instagram", accent: "#E1306C", icon: <><rect x="4.5" y="4.5" width="15" height="15" rx="5" /><circle cx="12" cy="12" r="3.4" /><circle cx="16" cy="8" r="0.6" fill="currentColor" stroke="none" /></> },
  { key: "tiktok", label: "TikTok", accent: "#25F4EE", icon: <path d="M14 4v9.6a3 3 0 11-2.6-2.97M14 4a4.6 4.6 0 004.5 4.5" /> },
  { key: "website", label: "Website", accent: TEAL, icon: <><circle cx="12" cy="12" r="8" /><line x1="4" y1="12" x2="20" y2="12" /><path d="M12 4c2 2.2 3 5 3 8s-1 5.8-3 8c-2-2.2-3-5-3-8s1-5.8 3-8z" /></> },
];
const hasLinks = (links?: LeagueLinks | null) => !!links && LINK_META.some((m) => links[m.key]);
/** Icon-only circular chips — stopPropagation so tapping one opens the link in
 *  a new tab instead of triggering the row's own onClick (Open/Join). */
function SocialChips({ links, size = 24 }: { links?: LeagueLinks | null; size?: number }) {
  if (!hasLinks(links)) return null;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {LINK_META.filter((m) => links![m.key]).map(({ key, label, accent, icon }) => (
        <span
          key={key} role="button" tabIndex={0} aria-label={label}
          onClick={(e) => { e.stopPropagation(); window.open(links![key], "_blank", "noopener,noreferrer"); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault(); e.stopPropagation(); window.open(links![key], "_blank", "noopener,noreferrer");
          }}
          style={{
            width: size, height: size, flexShrink: 0, borderRadius: "50%", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: tint(accent, "1c"), border: `1px solid ${tint(accent, "44")}`, color: accent,
          }}
        >
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
        </span>
      ))}
    </span>
  );
}

export function DiscoverLeagues() {
  const router = useRouter();
  const [groups, setGroups] = useState<Groups | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Row[] | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const query = q.trim();

  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/leagues/discover")
      .then((r) => (r.ok ? r.json() : { featured: [], clubs: [], open: [] }))
      .then((d) => { if (live) setGroups({ featured: d.featured ?? [], clubs: d.clubs ?? [], open: d.open ?? [] }); })
      .catch(() => { if (live) setGroups({ featured: [], clubs: [], open: [] }); });
    return () => { live = false; };
  }, []);

  // Debounced league-name search (public leagues only).
  useEffect(() => {
    if (query.length < 2) { setResults(null); return; }
    let live = true;
    setResults(null);
    const t = setTimeout(() => {
      fetch(`/api/fantasy/leagues/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { leagues: [] }))
        .then((d) => { if (live) setResults(d.leagues ?? []); })
        .catch(() => { if (live) setResults([]); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const open = (code: string) => router.push(`/fantasy/leagues/${code}`);
  const join = async (code: string) => {
    if (joining) return;
    setJoining(code);
    try {
      const r = await fetch("/api/fantasy/leagues/join", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
      });
      if (r.status === 401) { router.push(`/auth/sign-in?next=/fantasy/social?tab=discover`); return; }
      if (r.ok) { router.push(`/fantasy/leagues/${code}`); return; }
    } catch { /* leave the button, they can retry */ }
    setJoining(null);
  };

  const RowItem = ({ l }: { l: Row }) => {
    const clubGated = l.kind === "club" || l.kind === "founder";
    const mode: "open" | "join" | "view" = l.isMember ? "open" : (clubGated ? "view" : "join");
    const sub = l.kind === "club" && l.club
      ? `${l.memberCount} member${l.memberCount === 1 ? "" : "s"} · ${l.club} fans`
      : `${l.memberCount} member${l.memberCount === 1 ? "" : "s"}${l.official ? " · Official" : ""}`;
    // Discover gets the fullest treatment (founder, 7 Aug: leagues read as
    // communities) — the biggest crest anywhere leagues render, the bio
    // prominent (not truncated to one line), chips below. The card is a plain
    // <div> (not a <button> root, unlike the My Leagues tile), so the open
    // button + action button + chips can all sit as independent controls.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => open(l.code)} style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer", background: "none", border: "none", textAlign: "left", padding: 0 }}>
          <LeagueCrest imageUrl={l.imageUrl} size={84} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              {l.official && <VerifiedTick size={14} />}
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
          </div>
        </button>
        {mode === "join" ? (
          <button onClick={() => join(l.code)} disabled={joining === l.code} style={{
            flexShrink: 0, cursor: "pointer", padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            background: TEAL, color: "#04231f", border: "none", opacity: joining === l.code ? 0.7 : 1,
          }}>{joining === l.code ? "…" : "Join"}</button>
        ) : (
          <button onClick={() => open(l.code)} style={{
            flexShrink: 0, cursor: "pointer", padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            background: "transparent", color: TEAL, border: `1px solid ${tint(TEAL, "55")}`,
          }}>{mode === "open" ? "Open" : "View"}</button>
        )}
      </div>
      {(l.bio || hasLinks(l.links)) && (
        <div style={{ marginLeft: 96, display: "flex", flexDirection: "column", gap: 8 }}>
          {l.bio && (
            <p style={{
              fontSize: 12.5, color: MUTED, lineHeight: 1.45, margin: 0,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{l.bio}</p>
          )}
          {hasLinks(l.links) && <SocialChips links={l.links} size={26} />}
        </div>
      )}
      </div>
    );
  };

  const Section = ({ label, hint, rows }: { label: string; hint?: string; rows: Row[] }) => {
    if (!rows.length) return null;
    return (
      <div style={{ marginBottom: 18 }}>
        <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "0 2px 3px" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: MUTED, margin: "0 2px 8px", lineHeight: 1.4 }}>{hint}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((l) => <RowItem key={l.id} l={l} />)}
        </div>
      </div>
    );
  };

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leagues by name…"
        style={{ width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 14px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none", marginBottom: 14 }} />

      {query.length >= 2 ? (
        <>
          <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "0 2px 8px" }}>SEARCH RESULTS</div>
          {results === null ? (
            <p style={{ fontSize: 13, color: MUTED }}>Searching…</p>
          ) : results.length === 0 ? (
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>No public leagues found for &quot;{query}&quot;.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{results.map((l) => <RowItem key={l.id} l={l} />)}</div>
          )}
        </>
      ) : groups === null ? (
        <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>
      ) : (
        <>
          <Section label="YOURSCORE LEAGUES" hint="Open to fans of every club. Jump in with anyone." rows={groups.featured} />
          <Section label="CLUB LEAGUES" hint="Look inside any club's league. Post in your own." rows={groups.clubs} />
          <Section label="PUBLIC LEAGUES" rows={groups.open} />
          {!groups.featured.length && !groups.clubs.length && !groups.open.length && (
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>No leagues to show yet.</p>
          )}
        </>
      )}
    </div>
  );
}
