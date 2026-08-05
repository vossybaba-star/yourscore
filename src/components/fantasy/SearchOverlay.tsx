"use client";
/**
 * Social's full-screen search (Phase 5b, AC3) — one input, debounced, results
 * grouped under Users / Posts / Leagues / Players. Portaled to <body> for the
 * same reason every other fantasy overlay is (Sheet, MediaGallery, GifPicker):
 * a fixed overlay inside `main[data-fantasy] > * { z-index:1 }` gets trapped
 * below the z-50 BottomNav.
 *
 * Users — existing /api/fantasy/users/search. Posts — the new authed-optional
 * /api/fantasy/search/posts (Phase 5b). Leagues — discoverLeagues() via the
 * existing public /api/fantasy/leagues/discover, fetched once and filtered by
 * name client-side (it's a small, already-public list). Players — clientPool()
 * via the existing public /api/fantasy/pool, same one-fetch-then-filter
 * approach, by name or club substring.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { trackSearchPerformed } from "@/lib/analytics/trackSocial";

interface UserResult { userId: string; username: string | null; displayName: string; avatarUrl: string | null }
interface PostResult { id: string; rowKey: string; actorName: string; actorAvatar: string | null; text: string | null }
interface LeagueResult { id: string; name: string; code: string; memberCount: number; imageUrl?: string | null }
interface PlayerResult { id: number; name: string; club: string; avatarUrl: string | null }

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
  padding: "10px 8px", minHeight: 44, borderRadius: 12, background: "none", border: "none", color: "inherit",
};

function ResultGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: TEAL, margin: "10px 2px 6px" }}>{title.toUpperCase()}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </div>
  );
}

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [users, setUsers] = useState<UserResult[] | null>(null);
  const [posts, setPosts] = useState<PostResult[] | null>(null);
  const [leaguesAll, setLeaguesAll] = useState<LeagueResult[] | null>(null);
  const [playersAll, setPlayersAll] = useState<PlayerResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const firedFor = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted) inputRef.current?.focus(); }, [mounted]);

  // Body scroll lock while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape closes; a simple Tab focus trap keeps focus inside the overlay
  // while it's open (same technique as shared.tsx's Sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !overlayRef.current) return;
      const items = Array.from(overlayRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Leagues + player pool: small, already-public lists — fetch once, filter
  // client-side on every keystroke rather than round-tripping per query.
  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/leagues/discover")
      .then((r) => (r.ok ? r.json() : { featured: [], clubs: [], open: [] }))
      .then((d) => { if (live) setLeaguesAll([...(d.featured ?? []), ...(d.clubs ?? []), ...(d.open ?? [])]); })
      .catch(() => { if (live) setLeaguesAll([]); });
    fetch("/api/fantasy/pool")
      .then((r) => (r.ok ? r.json() : { players: [] }))
      .then((d) => { if (live) setPlayersAll(d.players ?? []); })
      .catch(() => { if (live) setPlayersAll([]); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Users + Posts need a real query — server round trip per debounced value.
  useEffect(() => {
    if (debounced.length < MIN_CHARS) { setUsers(null); setPosts(null); return; }
    let live = true;
    setUsers(null); setPosts(null);
    fetch(`/api/fantasy/users/search?q=${encodeURIComponent(debounced)}`)
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => { if (live) setUsers(d.users ?? []); })
      .catch(() => { if (live) setUsers([]); });
    fetch(`/api/fantasy/search/posts?q=${encodeURIComponent(debounced)}`)
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((d) => { if (live) setPosts(d.posts ?? []); })
      .catch(() => { if (live) setPosts([]); });
    return () => { live = false; };
  }, [debounced]);

  const searching = debounced.length >= MIN_CHARS;
  const needle = debounced.toLowerCase();
  const leagueResults = searching && leaguesAll ? leaguesAll.filter((l) => l.name.toLowerCase().includes(needle)).slice(0, 10) : [];
  const playerResults = searching && playersAll
    ? playersAll.filter((p) => p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle)).slice(0, 10)
    : [];
  const groupsLoaded = !searching || (users !== null && posts !== null && leaguesAll !== null && playersAll !== null);
  const totalResults = (users?.length ?? 0) + (posts?.length ?? 0) + leagueResults.length + playerResults.length;

  useEffect(() => {
    if (!searching || !groupsLoaded || firedFor.current === debounced) return;
    firedFor.current = debounced;
    trackSearchPerformed({ users: users?.length ?? 0, posts: posts?.length ?? 0, leagues: leagueResults.length, players: playerResults.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, groupsLoaded, debounced]);

  if (!mounted) return null;

  const go = (path: string) => { onClose(); router.push(path); };

  return createPortal(
    <div ref={overlayRef} role="dialog" aria-modal="true" aria-label="Search" style={{
      position: "fixed", inset: 0, zIndex: 90, background: "#080d0a",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(12px + env(safe-area-inset-top)) 16px 10px", flexShrink: 0 }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users, posts, leagues, players…"
          aria-label="Search Social"
          style={{ flex: 1, minWidth: 0, fontSize: 15, padding: "11px 16px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" }} />
        <button onClick={onClose} aria-label="Close search" style={{
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          width: 44, height: 44, borderRadius: 999, background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED, fontSize: 20, cursor: "pointer",
        }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px calc(24px + env(safe-area-inset-bottom))" }}>
        {!searching && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Type at least 2 characters to search.</p>}
        {searching && groupsLoaded && totalResults === 0 && (
          <p style={{ fontSize: 13.5, color: MUTED, textAlign: "center", marginTop: 24, lineHeight: 1.5 }}>
            Nothing found for &ldquo;{debounced}&rdquo;.
          </p>
        )}

        {searching && !!users?.length && (
          <ResultGroup title="Users">
            {users.map((u) => (
              <button key={u.userId} onClick={() => go(`/profile/${u.userId}`)} style={rowStyle}>
                <PlayerAvatar name={u.displayName} avatarUrl={u.avatarUrl} size={36} />
                <span style={{ minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.displayName}</span>
                  {u.username && <span style={{ display: "block", fontSize: 12, color: MUTED }}>@{u.username}</span>}
                </span>
              </button>
            ))}
          </ResultGroup>
        )}

        {searching && !!posts?.length && (
          <ResultGroup title="Posts">
            {posts.map((p) => (
              <button key={p.rowKey} onClick={() => go(`/fantasy/social/post/${p.id}`)} style={rowStyle}>
                <PlayerAvatar name={p.actorName} avatarUrl={p.actorAvatar} size={36} />
                <span style={{ minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: INK }}>{p.actorName}</span>
                  {p.text && (
                    <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12.5, color: MUTED, marginTop: 2 }}>{p.text}</span>
                  )}
                </span>
              </button>
            ))}
          </ResultGroup>
        )}

        {searching && !!leagueResults.length && (
          <ResultGroup title="Leagues">
            {leagueResults.map((l) => (
              <button key={l.id} onClick={() => go(`/fantasy/leagues/${l.code}`)} style={rowStyle}>
                <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 9, overflow: "hidden", background: PANEL_2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }} aria-hidden>
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" width={36} height={36} style={{ width: 36, height: 36, objectFit: "cover" }} />
                  ) : "🏆"}
                </span>
                <span style={{ minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: MUTED }}>{l.memberCount} member{l.memberCount === 1 ? "" : "s"}</span>
                </span>
              </button>
            ))}
          </ResultGroup>
        )}

        {searching && !!playerResults.length && (
          <ResultGroup title="Players">
            {playerResults.map((p) => (
              <button key={p.id} onClick={() => go(`/fantasy/players/${p.id}`)} style={rowStyle}>
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={36} />
                <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, textAlign: "left" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{p.name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: MUTED }}><Crest club={p.club} size={13} /> {p.club}</span>
                </span>
              </button>
            ))}
          </ResultGroup>
        )}
      </div>
    </div>,
    document.body,
  );
}
