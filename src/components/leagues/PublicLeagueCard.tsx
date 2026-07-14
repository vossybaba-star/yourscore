"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// One discoverable public league. Join is one tap: quiz leagues ride the
// existing /league/join/[code] flow; 38-0 leagues call the join API directly
// and drop into the Leagues tab.

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const GOLD = "#ffc233";

export interface PublicLeague {
  id: string;
  name: string;
  description: string | null;
  game: "quiz" | "38-0";
  featured: boolean;
  members: number;
  memberAvatars: { id: string; name: string; avatarUrl: string | null }[];
  creator: string | null;
  joinCode: string;
  /** "board" = an official ranked mode surfaced as a league — VIEW its board
   *  (href) instead of joining by code. */
  kind?: "league" | "board";
  href?: string;
}

export function PublicLeagueCard({ league }: { league: PublicLeague }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = league.game === "38-0" ? LIME : TEAL;

  // Public = viewable: tapping the card opens the league's table even if you're
  // not a member (the view pages carry their own join CTA). JOIN stays one tap.
  const viewHref = league.kind === "board" && league.href
    ? league.href
    : league.game === "quiz" ? `/league/${league.id}` : `/38-0/league/${league.joinCode}`;

  async function join(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setErr(null);
    if (league.kind === "board" && league.href) { router.push(league.href); return; }
    if (league.game === "quiz") { router.push(`/league/join/${league.joinCode}`); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/draft/league/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: league.joinCode }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Could not join"); setBusy(false); return; }
      router.push("/versus?view=leagues");
    } catch { setErr("Could not join"); setBusy(false); }
  }

  return (
    <div onClick={() => router.push(viewHref)} className="rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-transform" style={{ background: "#0e1611", border: `1px solid ${league.featured ? `${GOLD}44` : "rgba(255,255,255,0.08)"}` }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: `${c}14`, border: `1px solid ${c}33` }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M6 3h8v2h2.5v3A3.5 3.5 0 0 1 13 11.4 4 4 0 0 1 11 13v2.5h2.5V17h-7v-1.5H9V13a4 4 0 0 1-2-1.6A3.5 3.5 0 0 1 3.5 8V5H6V3Z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" fill={`${c}22`} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm font-semibold text-white line-clamp-2 leading-snug">{league.name}</p>
          {/* Which game this league is for — loud and unmissable (founder call). */}
          <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
            <span className="font-body text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: `${c}1f`, color: c, border: `1px solid ${c}44` }}>
              {league.game === "38-0" ? "38-0" : "Quiz Battle"}
            </span>
            {league.featured && <span className="font-body text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md flex-shrink-0" style={{ background: `${GOLD}1f`, color: GOLD, border: `1px solid ${GOLD}44` }}>Featured</span>}
            <span className="font-body text-[11px] text-text-muted whitespace-nowrap">{league.members.toLocaleString()} {league.members === 1 ? "member" : "members"}</span>
          </div>
          {league.description && <p className="font-body text-[11px] text-text-muted mt-1.5 line-clamp-2 leading-snug">{league.description}</p>}
        </div>
        <button onClick={join} disabled={busy} className="font-display text-xs tracking-wide px-4 py-2 rounded-lg flex-shrink-0 active:scale-[0.97] transition-transform disabled:opacity-50" style={{ background: c, color: league.game === "38-0" ? "#13200a" : "#04231f" }}>
          {busy ? "…" : league.kind === "board" ? "VIEW" : "JOIN"}
        </button>
      </div>
      {league.memberAvatars.length > 0 && (
        <div className="flex items-center mt-3">
          <div className="flex -space-x-2">
            {league.memberAvatars.map((m) => (
              <span key={m.id} className="rounded-full" style={{ border: "2px solid #0e1611" }}>
                <PlayerAvatar seed={m.id} name={m.name} avatarUrl={m.avatarUrl} size={22} />
              </span>
            ))}
          </div>
          {league.creator && <p className="font-body text-[10px] text-text-muted ml-2.5 truncate">Started by {league.creator}</p>}
        </div>
      )}
      {err && <p className="font-body text-xs mt-2" style={{ color: "#ff6b78" }}>{err}</p>}
    </div>
  );
}

/** Rail of discoverable leagues. `limit` trims it for the Play tab teaser;
 *  `game` narrows it inside the Leagues tab's per-game views. `showEmpty`
 *  renders a be-the-first promo instead of vanishing when nothing is public
 *  yet (the Leagues tab wants the section visible; the Play teaser doesn't). */
export function PublicLeaguesRail({ limit, game, heading = true, showEmpty = false }: { limit?: number; game?: "quiz" | "38-0"; heading?: boolean; showEmpty?: boolean }) {
  const router = useRouter();
  const [leagues, setLeagues] = useState<PublicLeague[] | null>(null);

  useEffect(() => {
    fetch("/api/leagues/discover").then((r) => r.json())
      .then((d) => setLeagues((d.leagues ?? []) as PublicLeague[]))
      .catch(() => setLeagues([]));
  }, []);

  if (!leagues) return null;
  const pool = game ? leagues.filter((l) => l.game === game) : leagues;
  if (pool.length === 0 && !showEmpty) return null;
  const shown = limit ? pool.slice(0, limit) : pool;

  return (
    <div>
      {heading && (
        <div className="flex items-center justify-between mt-7 mb-2.5">
          <p className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: "#586058" }}>Discover public leagues</p>
          {limit && pool.length > limit && (
            <button onClick={() => router.push("/versus?view=leagues")} className="font-body text-xs" style={{ color: TEAL }}>See all →</button>
          )}
        </div>
      )}
      {pool.length === 0 ? (
        <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)" }}>
          <p className="font-body text-sm font-semibold text-white">No public leagues yet</p>
          <p className="font-body text-xs text-text-muted mt-1 mb-3.5 leading-relaxed">Be the first — create a league and set it to Public so anyone on YourScore can find and join it.</p>
          <button onClick={() => router.push("/league/new")} className="font-display text-sm tracking-wide px-5 py-2.5 rounded-xl" style={{ background: `${TEAL}1f`, color: TEAL, border: `1px solid ${TEAL}40` }}>CREATE A PUBLIC LEAGUE →</button>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((l) => <PublicLeagueCard key={`${l.game}:${l.id}`} league={l} />)}
        </div>
      )}
    </div>
  );
}
