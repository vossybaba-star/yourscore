"use client";
/** The League Hub — the default screen, rebuilt as a NATURAL activity hub
 *  (founder 8 Aug): what's happening in THIS league, not fantasy readouts.
 *
 *    Recent results   — games league members have finished
 *    Upcoming fixtures — challenges awaiting a play (your turn / theirs)
 *    To play          — start a challenge + today's gameday quizzes
 *
 *  The gameweek/squad tile, readiness, gw-recap, mini-table, rival race and the
 *  old games promo module are gone — the table lives in the Table tab, and this
 *  is the social pulse. A light recent-chat + members preview stays underneath.
 */
import { useEffect, useState } from "react";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { UpcomingQuizzes } from "@/components/matchweek/UpcomingQuizzes";
import { LeagueMembersView } from "./LeagueMembersView";
import { useUser } from "@/hooks/useUser";
import { trackGamesHubModuleOpened } from "@/lib/analytics/trackSocial";
import type { ChatData, ChatMessage, ChallengeCard, GamesOverview, LeagueDetail, LeagueRow } from "./types";
import { nameOf } from "./types";

// ── Chat preview glyphs (bare SVG, no emoji — house rule) ───────────────────
type PreviewIconKind = "player" | "squad" | "news" | "compare" | "poll" | null;
function previewParts(m: ChatMessage): { icon: PreviewIconKind; text: string } {
  const mine = m.isMe;
  switch (m.kind) {
    case "player": return { icon: "player", text: `shared ${m.player?.name ?? "a player"}` };
    case "captain": return { icon: null, text: `Ⓒ captain pick${m.player ? `: ${m.player.name}` : ""}` };
    case "squad": return { icon: "squad", text: `shared ${mine ? "your" : "their"} squad` };
    case "news": return { icon: "news", text: m.news?.title ?? "shared some news" };
    case "compare": return { icon: "compare", text: m.compare ? `${m.compare.a.name} vs ${m.compare.b.name}` : "shared a comparison" };
    case "poll": return { icon: "poll", text: m.poll?.question ?? "started a poll" };
    default: return { icon: null, text: m.body };
  }
}
const PREVIEW_ICON_PATH: Record<Exclude<PreviewIconKind, null>, string> = {
  player: "M12 3v10 M8 7l4-4 4 4 M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5",
  squad: "M8 4l-4 3 2 3 2-1v11h8V9l2 1 2-3-4-3a4 4 0 0 1-8 0z",
  news: "M6 3h9l3 3v15H6z M15 3v3h3 M9 11h6 M9 15h6",
  compare: "M4 8h10 M10 4l4 4-4 4 M20 16H10 M14 12l-4 4 4 4",
  poll: "M4 6h12 M4 12h16 M4 18h8",
};
function PreviewIcon({ kind }: { kind: Exclude<PreviewIconKind, null> }) {
  return (
    <svg width={12.5} height={12.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginRight: 3, verticalAlign: -1.5 }}>
      <path d={PREVIEW_ICON_PATH[kind]} />
    </svg>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>{children}</span>
      {action}
    </div>
  );
}

// ── Compact game rows ───────────────────────────────────────────────────────
function ResultRow({ c, viewerId, onClick }: { c: ChallengeCard; viewerId: string | null; onClick: () => void }) {
  const iWon = c.winnerId && c.winnerId === viewerId;
  const draw = !c.winnerId;
  const cs = c.challengerScore, os = c.opponentScore;
  return (
    <button onClick={onClick} style={rowBtn}>
      <PlayerAvatar name={c.challengerName} avatarUrl={c.challengerAvatarUrl} size={24} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.challengerName} <span style={{ color: MUTED }}>vs</span> {c.opponentName}
      </span>
      <span className="font-display" style={{ fontSize: 14, fontWeight: 800, color: draw ? MUTED : iWon ? TEAL : INK, flexShrink: 0, letterSpacing: "0.02em" }}>
        {cs ?? "–"}<span style={{ color: MUTED, margin: "0 3px" }}>–</span>{os ?? "–"}
      </span>
    </button>
  );
}
function PendingRow({ c, viewerId, onClick }: { c: ChallengeCard; viewerId: string | null; onClick: () => void }) {
  const yourTurn = c.status === "active" ? !c[c.challengerId === viewerId ? "challengerDone" : "opponentDone"] : c.opponentId === viewerId;
  return (
    <button onClick={onClick} style={rowBtn}>
      <PlayerAvatar name={c.challengerName} avatarUrl={c.challengerAvatarUrl} size={24} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.challengerName} <span style={{ color: MUTED }}>vs</span> {c.opponentName}
        <span style={{ color: MUTED }}> · {c.gameName}</span>
      </span>
      <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", color: yourTurn ? "#04231f" : MUTED, background: yourTurn ? TEAL : "transparent", borderRadius: 999, padding: yourTurn ? "3px 8px" : 0 }}>
        {yourTurn ? "YOUR TURN" : "AWAITING"}
      </span>
    </button>
  );
}

export function LeagueHub({ detail, chat, onTab, onOpenGamesChallenge }: {
  detail: LeagueDetail;
  chat: ChatData | null;
  onTab: (t: "chat" | "table" | "games" | "history") => void;
  /** "Challenge someone" from the To play section — mirrors the old module's
   *  dedicated callback from page.tsx (opens the Games picker). */
  onOpenGamesChallenge: () => void;
}) {
  const { user } = useUser();
  const viewerId = user?.id ?? null;
  const { season } = detail;
  const isMember = detail.league.isMember;
  const code = detail.league.code;

  const [membersOpen, setMembersOpen] = useState(false);
  const [overview, setOverview] = useState<GamesOverview | null>(null);

  // The league's own games activity (member-only tab data), for the three
  // activity sections. Hidden clean while loading / on failure — no skeleton.
  useEffect(() => {
    if (!isMember) return;
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/games`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setOverview(d as GamesOverview); })
      .catch(() => {});
    return () => { live = false; };
  }, [code, isMember]);

  const toGames = () => { trackGamesHubModuleOpened(); onTab("games"); };

  const recent = (overview?.recentResults ?? []).slice(0, 3);
  const pending = [...(overview?.actionRequired ?? []), ...(overview?.open ?? [])].slice(0, 3);
  const preview = (chat?.messages ?? []).filter((m) => m.kind !== "system").slice(-2);
  const isVenue = detail.league.kind === "venue";
  const offers = (detail.league.venueMeta?.offers ?? []).filter((o) => o.title);

  return (
    <div>
      {/* OFFERS — venue leagues only (founder 8 Aug): what the venue's putting on,
          top of the hub. */}
      {isVenue && offers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel>OFFERS</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {offers.map((o, i) => (
              <div key={i} style={{
                background: `linear-gradient(150deg, ${tint(GOLD, "14")}, ${PANEL})`, border: `1px solid ${tint(GOLD, "3a")}`,
                borderRadius: 12, padding: "11px 13px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{o.title}</span>
                </div>
                {o.detail && <p style={{ fontSize: 12.5, color: MUTED, margin: "5px 0 0", lineHeight: 1.45 }}>{o.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECENT RESULTS — games members have finished. */}
      {isMember && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel action={recent.length > 0 ? <LinkBtn onClick={toGames}>All results →</LinkBtn> : undefined}>RECENT RESULTS</SectionLabel>
          {recent.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recent.map((c) => <ResultRow key={c.challengeId} c={c} viewerId={viewerId} onClick={toGames} />)}
            </div>
          ) : (
            <EmptyLine>No games played yet. Start one below.</EmptyLine>
          )}
        </div>
      )}

      {/* UPCOMING FIXTURES — challenges awaiting a play. */}
      {isMember && pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel action={<LinkBtn onClick={toGames}>All →</LinkBtn>}>UPCOMING FIXTURES</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pending.map((c) => <PendingRow key={c.challengeId} c={c} viewerId={viewerId} onClick={toGames} />)}
          </div>
        </div>
      )}

      {/* TO PLAY — start a challenge + today's gameday quizzes. */}
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>TO PLAY</SectionLabel>
        {isMember && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}><Btn gold onClick={onOpenGamesChallenge}>Challenge a member</Btn></div>
            <div style={{ flex: 1 }}><Btn onClick={toGames}>All games</Btn></div>
          </div>
        )}
        {/* Gameday quizzes — self-hides off-matchday / when none are scheduled. */}
        <div style={{ margin: "0 -4px" }}><UpcomingQuizzes /></div>
      </div>

      {/* RECENT CHAT preview — last couple of lines, never the whole thread. */}
      <SectionLabel>RECENT CHAT</SectionLabel>
      <Card style={{ marginBottom: 16 }}>
        {preview.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {preview.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={22} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: m.isMe ? TEAL : INK }}>{m.isMe ? "You" : m.name}: </span>
                  <span style={{ fontSize: 12.5, color: MUTED, overflowWrap: "anywhere" }}>
                    {(() => { const p = previewParts(m); return <>{p.icon && <PreviewIcon kind={p.icon} />}{p.text}</>; })()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px" }}>Nothing said yet. Someone has to start it.</p>
        )}
        <Btn onClick={() => onTab("chat")}>Open chat</Btn>
      </Card>

      {/* MEMBERS preview — who's in it, a tap from the full member sheet. */}
      {isMember && season.length > 0 && (
        <>
          <SectionLabel>MEMBERS</SectionLabel>
          <button onClick={() => setMembersOpen(true)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12, marginBottom: 14,
          }}>
            <span style={{ display: "flex", flexShrink: 0 }}>
              {season.slice(0, 5).map((r: LeagueRow, i: number) => (
                <span key={r.userId} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 999, border: `2px solid ${PANEL}` }}>
                  <PlayerAvatar name={nameOf(r)} avatarUrl={r.avatarUrl} size={28} />
                </span>
              ))}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: MUTED }}>
              {season.length} member{season.length === 1 ? "" : "s"}
            </span>
            <span style={{ color: TEAL, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>Members →</span>
          </button>
        </>
      )}

      {/* SEASON HISTORY — quiet single row (member-only). */}
      {isMember && (
        <button onClick={() => onTab("history")} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: "10px 0 4px",
          fontSize: 12.5, fontWeight: 600, color: MUTED,
        }}>
          Season history <span style={{ color: TEAL }}>→</span>
        </button>
      )}

      {membersOpen && (
        <LeagueMembersView code={code} rows={season} viewerId={viewerId} onClose={() => setMembersOpen(false)} />
      )}
    </div>
  );
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>{children}</button>;
}
function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: MUTED, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 13px" }}>{children}</div>;
}

const rowBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
  background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "9px 11px",
};
