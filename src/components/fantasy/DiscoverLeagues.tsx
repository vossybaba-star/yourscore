"use client";
/**
 * Social → Discover → Leagues: find PUBLIC leagues to join. Shows the newest
 * public leagues by default and searches them by name; each row opens the league
 * or joins it in one tap. Private leagues stay code-only (Join with code lives on
 * the Leagues tab).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";

interface League { id: string; name: string; code: string; memberCount: number; imageUrl?: string | null }

function LeagueCrest({ imageUrl }: { imageUrl?: string | null }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />;
  }
  return (
    <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></svg>
    </span>
  );
}

export function DiscoverLeagues() {
  const router = useRouter();
  const [suggested, setSuggested] = useState<League[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<League[] | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const query = q.trim();

  // Default: the newest public leagues (the same list the Leagues tab shows).
  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/leagues")
      .then((r) => (r.ok ? r.json() : { public: [] }))
      .then((d) => { if (live) setSuggested(d.public ?? []); })
      .catch(() => { if (live) setSuggested([]); });
    return () => { live = false; };
  }, []);

  // Debounced league-name search.
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

  const join = async (code: string) => {
    if (joining) return;
    setJoining(code);
    try {
      const r = await fetch("/api/fantasy/leagues/join", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
      });
      if (r.ok) { router.push(`/fantasy/leagues/${code}`); return; }
    } catch { /* leave the Join button, they can retry */ }
    setJoining(null);
  };

  const Row = ({ l }: { l: League }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
      <button onClick={() => router.push(`/fantasy/leagues/${l.code}`)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer", background: "none", border: "none", textAlign: "left", padding: 0 }}>
        <LeagueCrest imageUrl={l.imageUrl} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{l.memberCount} member{l.memberCount === 1 ? "" : "s"} · <span style={{ color: TEAL, fontWeight: 700 }}>Public</span></div>
        </div>
      </button>
      <button onClick={() => join(l.code)} disabled={joining === l.code} style={{
        flexShrink: 0, cursor: "pointer", padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
        background: TEAL, color: "#04231f", border: "none", opacity: joining === l.code ? 0.7 : 1,
      }}>{joining === l.code ? "…" : "Join"}</button>
    </div>
  );

  const searching = query.length >= 2;
  const list = searching ? results : suggested;

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leagues by name…"
        style={{ width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 14px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none", marginBottom: 14 }} />

      <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "0 2px 8px" }}>
        {searching ? "SEARCH RESULTS" : "PUBLIC LEAGUES"}
      </div>

      {list === null ? (
        <p style={{ fontSize: 13, color: MUTED }}>{searching ? "Searching…" : "Loading…"}</p>
      ) : list.length === 0 ? (
        <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>
          {searching ? `No public leagues found for "${query}".` : "No public leagues yet. Create one and make it public so others can find it."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((l) => <Row key={l.id} l={l} />)}
        </div>
      )}
    </div>
  );
}
