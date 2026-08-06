"use client";
/**
 * "Managers to follow" — with a reason, not just a directory (founder, 2 Aug).
 * The most relevant few show as activity tiles (their squad on the pitch); the
 * rest are rows, each with WHY you'd follow (shared picks, a player in common,
 * a fresh squad) and their captain's-club crest. Plus a username search.
 *
 * Extracted from the /fantasy/feed/discover page so the SAME discovery renders
 * both at that route AND under the Social tab's "Discover" panel. Presentational
 * shell only (no BackPill/BottomNav) — the caller owns the chrome.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { FollowButton } from "@/components/social/FollowButton";
import { InviteToLeagueButton } from "@/components/fantasy/InviteToLeagueButton";
import type { BoardPlayer } from "@/lib/fantasy/board";

interface DiscoverBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain: number | null; vice: number | null }
interface Manager {
  userId: string; username: string | null; displayName: string; avatarUrl: string | null;
  club: string | null; reason: string; shared: number; followers: number; following: number; board: DiscoverBoard | null;
  /** Disclosure flag (Trust sprint 1) — true for a synthetic community
   *  account. Kept in sync with DiscoverManager in lib/fantasy/discover.ts. */
  isCommunity: boolean;
}

function ManagerFace({ name, avatarUrl, club, size = 40 }: { name: string; avatarUrl: string | null; club: string | null; size?: number }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <PlayerAvatar name={name} avatarUrl={avatarUrl} size={size} />
      {club && (
        <span aria-hidden style={{ position: "absolute", bottom: -2, right: -3, width: size * 0.5, height: size * 0.5, minWidth: 15, minHeight: 15, borderRadius: "50%", background: "#0a1710", border: "1.5px solid #0a1710", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Crest club={club} size={size * 0.5} />
        </span>
      )}
    </div>
  );
}

function ReasonChip({ m }: { m: Manager }) {
  const strong = m.shared >= 1;
  const accent = m.shared >= 3 ? GOLD : strong ? TEAL : MUTED;
  const icon = m.shared >= 3 ? "🔗" : strong ? "🤝" : "👕";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
      color: accent, background: tint(accent === MUTED ? "#8a948f" : accent, "16"), border: `1px solid ${tint(accent === MUTED ? "#8a948f" : accent, "40")}` }}>
      <span aria-hidden>{icon}</span>{m.reason}
    </span>
  );
}

function ManagerHead({ m }: { m: Manager }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Link href={`/profile/${m.userId}`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textDecoration: "none" }}>
        <ManagerFace name={m.displayName} avatarUrl={m.avatarUrl} club={m.club} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName}</div>
          {m.username && <div style={{ fontSize: 11.5, color: MUTED }}>@{m.username}</div>}
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
            <b style={{ color: INK, fontWeight: 700 }}>{m.followers.toLocaleString()}</b> followers · <b style={{ color: INK, fontWeight: 700 }}>{m.following.toLocaleString()}</b> following
          </div>
        </div>
      </Link>
      <FollowButton userId={m.userId} size="sm" initialFollowing={false} />
    </div>
  );
}

interface SearchUser { userId: string; username: string | null; displayName: string; avatarUrl: string | null }

/** A username-search result: tap to open their profile, follow, or invite. */
function SearchRow({ u }: { u: SearchUser }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
      <Link href={`/profile/${u.userId}`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textDecoration: "none" }}>
        <PlayerAvatar name={u.displayName} avatarUrl={u.avatarUrl} size={40} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.displayName}</div>
          {u.username && <div style={{ fontSize: 11.5, color: MUTED }}>@{u.username}</div>}
        </div>
      </Link>
      <FollowButton userId={u.userId} size="sm" initialFollowing={false} />
      <InviteToLeagueButton userId={u.userId} userName={u.displayName} variant="chip" />
    </div>
  );
}

/** The Discover body: intro line, username search, reason-ranked suggestions.
 *  `intro` hides the description line (the Social tab has its own header). */
export function DiscoverManagers({ intro = true }: { intro?: boolean }) {
  const [managers, setManagers] = useState<Manager[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchUser[] | null>(null);
  const query = q.trim();

  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/discover")
      .then((r) => (r.ok ? r.json() : { managers: [] }))
      .then((d) => { if (live) setManagers(d.managers ?? []); })
      .catch(() => { if (live) setManagers([]); });
    return () => { live = false; };
  }, []);

  // Debounced username search — results replace the suggestions while typing.
  useEffect(() => {
    if (query.length < 2) { setResults(null); return; }
    let live = true;
    setResults(null);
    const t = setTimeout(() => {
      fetch(`/api/fantasy/users/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d) => { if (live) setResults(d.users ?? []); })
        .catch(() => { if (live) setResults([]); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  // The most relevant few become activity tiles (their squad shown); the rest rows.
  const tiles = (managers ?? []).slice(0, 3);
  const rows = (managers ?? []).slice(3);

  return (
    <div>
      {intro && (
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px", lineHeight: 1.5 }}>
          Follow them and their transfers, captains and big weeks land in your feed.
        </p>
      )}

      {/* Search anyone by username — follow them or invite them to a league. */}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username…"
        style={{ width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 14px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none", marginBottom: 14 }} />

      {query.length >= 2 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "0 2px 2px" }}>SEARCH RESULTS</div>
          {results === null ? (
            <p style={{ fontSize: 13, color: MUTED }}>Searching…</p>
          ) : results.length === 0 ? (
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>No one found for &ldquo;{query}&rdquo;. Search by their username.</p>
          ) : (
            results.map((u) => <SearchRow key={u.userId} u={u} />)
          )}
        </div>
      ) : managers === null ? (
        <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>
      ) : managers.length === 0 ? (
        <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>No one to suggest yet. Check back once more managers join.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tiles.map((m) => (
            <div key={m.userId} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12 }}>
              <ManagerHead m={m} />
              <div style={{ margin: "9px 0 2px" }}><ReasonChip m={m} /></div>
              {m.board && m.board.xi.length > 0 && (
                <Link href={`/profile/${m.userId}#fantasy-xi`} style={{ display: "block", marginTop: 8, textDecoration: "none" }}>
                  <div style={{ paddingBottom: 12 }}>
                    <SquadBoard mode="complete" players={m.board.players} xi={m.board.xi} bench={m.board.bench} captain={m.board.captain ?? undefined} vice={m.board.vice ?? undefined} />
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: TEAL }}>See {m.displayName}&apos;s squad ›</div>
                </Link>
              )}
            </div>
          ))}

          {rows.length > 0 && (
            <>
              <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "8px 2px 0" }}>MORE MANAGERS</div>
              {rows.map((m) => (
                <div key={m.userId} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
                  <ManagerHead m={m} />
                  <div style={{ marginTop: 8 }}><ReasonChip m={m} /></div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
