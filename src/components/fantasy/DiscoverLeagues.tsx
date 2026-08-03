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

interface Row {
  id: string; name: string; code: string; memberCount: number; imageUrl?: string | null;
  official?: boolean; kind?: string; club?: string | null; isMember?: boolean; canContribute?: boolean;
}
interface Groups { featured: Row[]; clubs: Row[]; open: Row[] }

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
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
        <button onClick={() => open(l.code)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer", background: "none", border: "none", textAlign: "left", padding: 0 }}>
          <LeagueCrest imageUrl={l.imageUrl} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
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
