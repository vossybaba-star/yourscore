"use client";
/**
 * The Fantasy tab's feed-first HOME (founder, 2 Aug). Lands here instead of the
 * squad. Top: the "You" strip — where you stand. Below: the social feed, which
 * degrades gracefully so it is NEVER blank — real activity first (your leagues'
 * chatter, other managers' moves), then get-started nudges, then discovery. A
 * cold or pre-season user still sees the game being played around them.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Btn, GOLD, INK, LIME, LINE, MUTED, PANEL, TEAL, page, tint, Skel,
} from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

interface FeedEvent {
  id: string; actorId: string; actorName: string; actorAvatar: string | null;
  type: string; sentence: string; createdAt: string; playerId?: number | null;
}
interface LeagueCard { code: string; name: string; memberCount: number; latest: { author: string; preview: string } | null; msgCount: number }
interface HomeData {
  you: { hasSquad: boolean; gw: number | null; phase: "pre" | "live" | "final"; deadline: string | null;
    rank: number | null; points: number; played: number; totalPlayers: number; gapToFirst: number | null };
  leagues: LeagueCard[];
  moves: FeedEvent[];
  movesScope: "following" | "global";
  followingCount: number;
  todo: { squad: boolean; league: boolean; follow: boolean };
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
const ordinal = (n: number) => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "18px 2px 8px" }}>{children}</div>
);

// ── The "You" strip — always meaningful, whatever state you're in ────────────
function YouStrip({ you }: { you: HomeData["you"] }) {
  const router = useRouter();
  const gwLabel = you.gw ? `GAMEWEEK ${you.gw}` : "PRE-SEASON";
  const cd = countdown(you.deadline);

  if (!you.hasSquad) {
    return (
      <div style={{ borderRadius: 16, padding: 16, background: `linear-gradient(150deg, ${tint(TEAL,"1e")}, ${PANEL})`, border: `1px solid ${tint(TEAL,"44")}` }}>
        <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: TEAL }}>{gwLabel}{cd ? ` · DEADLINE ${cd.toUpperCase()}` : ""}</div>
        <div className="font-display" style={{ fontSize: 24, color: INK, lineHeight: 1.05, margin: "8px 0 4px" }}>You haven&apos;t picked a squad yet</div>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.45 }}>15 players, £100m. Takes a minute, and it&apos;s in every gameweek from then on.</p>
        <Btn gold onClick={() => router.push("/fantasy/build")}>Build your squad</Btn>
      </div>
    );
  }
  const scored = you.rank != null;
  return (
    <div style={{ borderRadius: 16, padding: 16, background: `linear-gradient(150deg, ${tint(TEAL,"14")}, ${PANEL})`, border: `1px solid ${LINE}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: you.phase === "final" ? GOLD : TEAL }}>
          {gwLabel} · {you.phase === "pre" ? "PRE-DEADLINE" : you.phase === "live" ? "LIVE" : "FINAL"}
        </div>
        {cd && <span style={{ fontSize: 12, color: MUTED }}>Deadline {cd}</span>}
      </div>
      {scored ? (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", margin: "10px 0 4px" }}>
          <div><div className="font-display" style={{ fontSize: 30, color: INK, lineHeight: 1 }}>{ordinal(you.rank!)}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>of {you.totalPlayers.toLocaleString()}</div></div>
          <div><div className="font-display" style={{ fontSize: 30, color: GOLD, lineHeight: 1 }}>{you.points}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>points</div></div>
          {you.gapToFirst != null && you.gapToFirst > 0 && <div><div className="font-display" style={{ fontSize: 30, color: INK, lineHeight: 1 }}>{you.gapToFirst}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>behind 1st</div></div>}
        </div>
      ) : (
        <div style={{ margin: "8px 0 4px" }}>
          <div className="font-display" style={{ fontSize: 24, color: INK, lineHeight: 1.05 }}>Your squad is in</div>
          <p style={{ fontSize: 13, color: MUTED, margin: "5px 0 0", lineHeight: 1.45 }}>The table fills the moment {you.gw ? `Gameweek ${you.gw}` : "the season"} is scored. Tweak your team right up to the deadline.</p>
        </div>
      )}
      <button onClick={() => router.push("/fantasy/squad")} style={{ marginTop: 10, background: "none", border: "none", color: TEAL, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>View your squad →</button>
    </div>
  );
}

function ActionCard({ emoji, title, body, cta, onClick, accent }: { emoji: string; title: string; body: string; cta: string; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick} style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 12, alignItems: "center",
      background: PANEL, border: `1px solid ${tint(accent, "3a")}`, borderRadius: 12, padding: 12 }}>
      <span style={{ fontSize: 22 }}>{emoji}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{title}</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 1, lineHeight: 1.35 }}>{body}</div>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: accent, whiteSpace: "nowrap" }}>{cta} →</span>
    </button>
  );
}

function LeagueChatCard({ l }: { l: LeagueCard }) {
  const router = useRouter();
  return (
    <button onClick={() => router.push(`/fantasy/leagues/${l.code}?t=chat`)} style={{ width: "100%", textAlign: "left", cursor: "pointer",
      background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL,"44")}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>🛡️</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
          <div style={{ fontSize: 11, color: MUTED }}>{l.memberCount} member{l.memberCount === 1 ? "" : "s"}</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL, whiteSpace: "nowrap" }}>{l.latest ? "Open chat →" : "Say something →"}</span>
      </div>
      {l.latest ? (
        <div style={{ fontSize: 12.5, color: "#c7d0cb", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <b style={{ color: INK, fontWeight: 700 }}>{l.latest.author}:</b> {l.latest.preview}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: MUTED }}>Quiet so far. Get the banter going.</div>
      )}
    </button>
  );
}

const MOVE_ICON: Record<string, string> = { squad_complete: "👕", squad_update: "🔁", transfer: "🔁", captain: "Ⓒ", chip: "✨", haul: "🔥", rank_jump: "📈", shortlist_add: "⭐" };
function MoveRow({ ev }: { ev: FeedEvent }) {
  return (
    <Link href={`/profile/${ev.actorId}`} style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none",
      background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
      <PlayerAvatar name={ev.actorName} avatarUrl={ev.actorAvatar} size={30} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: INK, lineHeight: 1.35 }}>
          <b style={{ fontWeight: 700 }}>{ev.actorName}</b> <span style={{ color: "#c7d0cb" }}>{ev.sentence}</span>
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{timeAgo(ev.createdAt)}</div>
      </div>
      <span aria-hidden style={{ fontSize: 15 }}>{MOVE_ICON[ev.type] ?? "•"}</span>
    </Link>
  );
}

export function FantasyHome() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fantasy/home");
      if (!res.ok) throw new Error("Couldn't load your fantasy home");
      setData(await res.json());
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <main data-fantasy style={page}>
      <FantasyHeader />
      {err ? (
        <p style={{ fontSize: 13, color: "#E08A6B" }}>{err}</p>
      ) : !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={130} r={16} /><Skel h={64} r={12} /><Skel h={64} r={12} /><Skel h={64} r={12} />
        </div>
      ) : (
        <>
          <YouStrip you={data.you} />

          {/* Get-started nudges — only what you haven't done, max two, so a cold
              user is guided rather than staring at a blank feed. */}
          {(data.todo.league || data.todo.follow) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {data.todo.league && (
                <ActionCard emoji="🏆" title="Start a league with your mates" body="Invite friends, chat every gameweek, settle who really knows their football." cta="Create" accent={GOLD} onClick={() => router.push("/fantasy/leagues")} />
              )}
              {data.todo.follow && (
                <ActionCard emoji="👀" title="Follow other managers" body="Their transfers, captains and hauls show up here as they happen." cta="Find people" accent={LIME} onClick={() => router.push("/fantasy/feed/discover")} />
              )}
            </div>
          )}

          {/* Your leagues' chatter — one tap into any chat. */}
          {data.leagues.length > 0 && (
            <>
              <SectionLabel>YOUR LEAGUES</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.leagues.map((l) => <LeagueChatCard key={l.code} l={l} />)}
              </div>
            </>
          )}

          {/* The game being played around you. */}
          {data.moves.length > 0 && (
            <>
              <SectionLabel>{data.movesScope === "following" ? "FROM MANAGERS YOU FOLLOW" : "AROUND THE GAME"}</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.moves.map((ev) => <MoveRow key={ev.id} ev={ev} />)}
              </div>
              <Link href="/fantasy/feed" style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, fontWeight: 700, color: TEAL, textDecoration: "none" }}>
                See the full feed →
              </Link>
            </>
          )}

          {/* Absolute cold floor: nothing social at all yet. */}
          {data.leagues.length === 0 && data.moves.length === 0 && (
            <div style={{ marginTop: 16, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 4 }}>It&apos;s quiet in here… for now</div>
              <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>Start a league or follow a few managers and this fills with their moves, captains and banter every gameweek.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}><Btn gold onClick={() => router.push("/fantasy/leagues")}>Start a league</Btn></div>
                <div style={{ flex: 1 }}><Btn onClick={() => router.push("/fantasy/feed/discover")}>Find managers</Btn></div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
