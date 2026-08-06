"use client";
/**
 * League Games tab (Phase 4A) — the challenge machinery's own home surface:
 * what you have to act on, what's open across the whole league, recent
 * results, a leaderboard computed fresh on every read, and the games
 * available to challenge someone to. No admin settings this phase (locked):
 * every league has games enabled, every supported game, leaderboard always
 * visible.
 *
 * Reuses the SAME challenge machinery chat already has — never a second flow
 * (product decision, locked):
 *   - ChallengePrepSheet for both a fresh Quick Challenge and a Rematch.
 *   - The rival-picker pattern LeagueChatView's chat-tray Challenge entry
 *     uses (roster fetch, then pick, then the prep sheet).
 *   - challengeClientActions.ts for accept/decline/cancel — the exact fetch
 *     shape LeagueChatView's ChallengeCardMsg already calls, factored out so
 *     this view calls the SAME code rather than a second copy.
 *   - challengeCardsFor's card shape (games.ts hydrates it server-side,
 *     unchanged) for every list here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, GOLD, INK, LINE, MUTED, PANEL, PANEL_2, SectionLabel, Sheet, Skel, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { ChallengePrepSheet } from "@/components/fantasy/ChallengePrepSheet";
import { acceptChallengeAction, declineChallengeAction, cancelChallengeAction, ChallengeActionConflict } from "@/lib/fantasy/challengeClientActions";
import { useUser } from "@/hooks/useUser";
import {
  trackGamesTabViewed, trackGamesQuickChallengeOpened, trackGamesActionRequiredOpened, trackGamesLeaderboardViewed,
} from "@/lib/analytics/trackSocial";
import type { ChallengeCard, GamesActionCard, GamesLeaderboardRow, GamesOverview } from "@/components/fantasy/league/types";

async function apiGamesOverview(code: string): Promise<GamesOverview> {
  const res = await fetch(`/api/fantasy/leagues/${code}/games`);
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/** "Expires in 46 min" / "Expires in 3 hours" / "Expires in 2 days" —
 *  client-derived (the server only ever sends raw ISO timestamps), same
 *  rounding idiom shared.tsx's Deadline component uses. Never a dash. */
function expiryLine(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `Expires in ${mins} min`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** "3 hours ago" / "2 days ago" — for a completed result's timestamp. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

/** "2 open · 4 wins · 2 win streak" — omits zero parts, middle dots never
 *  dashes (house rule). A streak only reads as one from 2 in a row. */
function summaryLine(s: GamesOverview["mySummary"]): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.open > 0) parts.push(`${s.open} open`);
  if (s.wins > 0) parts.push(`${s.wins} win${s.wins === 1 ? "" : "s"}`);
  if (s.losses > 0) parts.push(`${s.losses} loss${s.losses === 1 ? "" : "es"}`);
  if (s.draws > 0) parts.push(`${s.draws} draw${s.draws === 1 ? "" : "s"}`);
  if (s.streakCount > 1 && s.streakType) parts.push(`${s.streakCount} ${s.streakType} streak`);
  return parts.length ? parts.join(" · ") : null;
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending": return "Awaiting response";
    case "active": return "In play";
    case "awaiting_opponent": return "Waiting";
    default: return status;
  }
}

/** The OTHER participant relative to the viewer — a rematch (or an open
 *  row's own participant controls) may have the viewer on either side, so
 *  this is never just "the opponent field". Null for a spectator. */
function counterpart(card: ChallengeCard, viewerId: string | null): { userId: string; name: string; avatarUrl: string | null } | null {
  if (!viewerId) return null;
  if (card.challengerId === viewerId) return { userId: card.opponentId, name: card.opponentName, avatarUrl: card.opponentAvatarUrl };
  if (card.opponentId === viewerId) return { userId: card.challengerId, name: card.challengerName, avatarUrl: card.challengerAvatarUrl };
  return null;
}

const ACTION_LABEL: Record<GamesActionCard["action"], string> = { decline_or_play: "Play", play: "Play", resume: "Resume" };

function ActionCard({ card, viewerId, busy, onPlay, onDecline }: {
  card: GamesActionCard; viewerId: string | null; busy: boolean; onPlay: () => void; onDecline: () => void;
}) {
  const other = counterpart(card, viewerId);
  return (
    <div style={{
      background: `linear-gradient(100deg, ${tint(GOLD, "12")}, ${PANEL} 60%)`,
      border: `1px solid ${tint(GOLD, "3a")}`, borderLeft: `3px solid ${GOLD}`,
      borderRadius: 12, padding: 11,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
        {other && <PlayerAvatar name={other.name} avatarUrl={other.avatarUrl} size={30} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {other?.name ?? "League member"}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{card.gameName}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={busy} onClick={onPlay} style={{
          flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
          background: tint(GOLD, "22"), color: GOLD, border: `1px solid ${tint(GOLD, "66")}`, opacity: busy ? 0.6 : 1,
        }}>{ACTION_LABEL[card.action]}</button>
        {card.action === "decline_or_play" && (
          <button disabled={busy} onClick={onDecline} style={{
            flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
            background: PANEL_2, color: MUTED, border: `1px solid ${LINE}`, opacity: busy ? 0.6 : 1,
          }}>Decline</button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 8 }}>{expiryLine(card.expiresAt)}</div>
    </div>
  );
}

/** Two overlapping avatars — the same "who's in this one" glance an open
 *  row needs without spelling out both names twice (the title line already
 *  does that). */
function AvatarPair({ a, b }: { a: { name: string; avatarUrl: string | null }; b: { name: string; avatarUrl: string | null } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
      <div style={{ position: "relative", zIndex: 2 }}><PlayerAvatar name={a.name} avatarUrl={a.avatarUrl} size={24} /></div>
      <div style={{ position: "relative", zIndex: 1, marginLeft: -8 }}><PlayerAvatar name={b.name} avatarUrl={b.avatarUrl} size={24} /></div>
    </div>
  );
}

function OpenRow({ card, viewerId, busy, onCancel }: {
  card: ChallengeCard; viewerId: string | null; busy: boolean; onCancel: () => void;
}) {
  const isChallenger = viewerId === card.challengerId;
  const isParticipant = isChallenger || viewerId === card.opponentId;
  const canCancel = isChallenger && card.status === "pending";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "9px 11px" }}>
      <AvatarPair
        a={{ name: card.challengerName, avatarUrl: card.challengerAvatarUrl }}
        b={{ name: card.opponentName, avatarUrl: card.opponentAvatarUrl }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.challengerName} vs {card.opponentName}
        </div>
        <div style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.gameName} · {statusLabel(card.status)} · {expiryLine(card.expiresAt)}
        </div>
      </div>
      {canCancel && (
        <button disabled={busy} onClick={onCancel} style={{
          flexShrink: 0, padding: 0, fontSize: 11.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
          background: "none", border: "none", color: MUTED, textDecoration: "underline", opacity: busy ? 0.6 : 1,
        }}>Cancel</button>
      )}
      {!canCancel && isParticipant && card.h2hId && (
        <Link href={`/h2h/${card.h2hId}`} style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: TEAL, textDecoration: "none" }}>View</Link>
      )}
    </div>
  );
}

function ResultRow({ card, viewerId, onRematch }: { card: ChallengeCard; viewerId: string | null; onRematch: () => void }) {
  const isParticipant = viewerId === card.challengerId || viewerId === card.opponentId;
  const winnerName = card.winnerId === card.challengerId ? card.challengerName : card.winnerId === card.opponentId ? card.opponentName : null;
  const hasScores = typeof card.challengerScore === "number" && typeof card.opponentScore === "number";
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "9px 11px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hasScores ? `${card.challengerName} ${card.challengerScore} v ${card.opponentScore} ${card.opponentName}` : `${card.challengerName} vs ${card.opponentName}`}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
            {winnerName ? `${winnerName} won` : "Level"} · {card.gameName}{card.completedAt ? ` · ${timeAgo(card.completedAt)}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexShrink: 0, alignItems: "center" }}>
          {card.h2hId && <Link href={`/h2h/${card.h2hId}`} style={{ fontSize: 11.5, fontWeight: 700, color: GOLD, textDecoration: "none" }}>See result</Link>}
          {isParticipant && (
            <button onClick={onRematch} style={{ padding: 0, fontSize: 11.5, fontWeight: 700, cursor: "pointer", background: "none", border: "none", color: GOLD, textDecoration: "underline" }}>
              Rematch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LeaderboardPreview({ rows, viewerId }: { rows: GamesLeaderboardRow[]; viewerId: string | null }) {
  const headCell: React.CSSProperties = { width: 22, textAlign: "center", flexShrink: 0 };
  const cell: React.CSSProperties = { width: 22, textAlign: "center", flexShrink: 0, fontSize: 12, color: MUTED };
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", fontSize: 10, color: MUTED, letterSpacing: "0.06em", borderBottom: `1px solid ${LINE}` }}>
        <span style={headCell}>#</span>
        <span style={{ flex: 1 }}>MEMBER</span>
        <span style={headCell}>P</span>
        <span style={headCell}>W</span>
        <span style={headCell}>D</span>
        <span style={headCell}>L</span>
        <span style={{ width: 34, textAlign: "right", flexShrink: 0 }}>PTS</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.userId} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 11px",
          background: r.userId === viewerId ? tint(TEAL, "10") : "transparent",
          borderBottom: i < rows.length - 1 ? `1px solid ${LINE}` : "none",
        }}>
          <span style={{ ...headCell, fontSize: 12, color: MUTED, fontWeight: 700 }}>{i + 1}</span>
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <PlayerAvatar name={r.name} avatarUrl={r.avatarUrl} size={22} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          </span>
          <span style={cell}>{r.played}</span>
          <span style={cell}>{r.wins}</span>
          <span style={cell}>{r.draws}</span>
          <span style={cell}>{r.losses}</span>
          <span style={{ width: 34, textAlign: "right", flexShrink: 0, fontSize: 13, fontWeight: 800, color: GOLD }}>{r.points}</span>
        </div>
      ))}
    </div>
  );
}

type PrepTarget = { opponent: { userId: string; name: string; avatarUrl: string | null }; initialGame?: string; rematchOf?: string };

export function LeagueGamesView({ code }: { code: string }) {
  const router = useRouter();
  const { user } = useUser();
  const viewerId = user?.id ?? null;

  const [overview, setOverview] = useState<GamesOverview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The rival picker (Quick Challenge / a per-game "Challenge someone") and
  // the prep sheet it (or a Rematch tap) hands off to — one PrepTarget state
  // covers every entry point into ChallengePrepSheet on this view.
  const [roster, setRoster] = useState<{ userId: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [picking, setPicking] = useState(false);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepTarget | null>(null);

  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const leaderboardTracked = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGamesOverview(code);
      setOverview(d);
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { trackGamesTabViewed(); }, []);
  useEffect(() => { void load(); }, [load]);

  // Refetch on window focus + a 30s interval while the tab is actually
  // visible — no dedicated "poll the live thing" precedent exists for a view
  // with no read-only/archive mode (LeagueChatView's own poll is gated on
  // that instead), so this gates on document visibility directly.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(t);
    };
  }, [load]);

  // The league roster (Quick Challenge's picker) — same lighter-than-
  // leagueDetail fetch the chat tray's Challenge entry uses, fetched once.
  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => {
        if (!live) return;
        type RawMember = { userId: string; username: string | null; displayName: string | null; avatarUrl: string | null };
        const raw = (d.members ?? []) as RawMember[];
        setRoster(raw.map((m) => ({ userId: m.userId, displayName: m.displayName ?? (m.username ? `@${m.username}` : "Player"), avatarUrl: m.avatarUrl })));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [code]);

  useEffect(() => {
    if (overview && overview.leaderboard.length > 0 && !leaderboardTracked.current) {
      leaderboardTracked.current = true;
      trackGamesLeaderboardViewed();
    }
  }, [overview]);

  const openPicker = (gameId: string | null) => {
    trackGamesQuickChallengeOpened();
    setPendingGameId(gameId);
    setPicking(true);
  };
  const pickOpponent = (m: { userId: string; displayName: string; avatarUrl: string | null }) => {
    setPrep({ opponent: { userId: m.userId, name: m.displayName, avatarUrl: m.avatarUrl }, initialGame: pendingGameId ?? undefined });
    setPicking(false);
  };
  const startRematch = (card: ChallengeCard) => {
    const opp = counterpart(card, viewerId);
    if (!opp) return;
    setPrep({ opponent: opp, initialGame: card.gameType, rematchOf: card.challengeId });
  };

  const play = async (card: GamesActionCard) => {
    trackGamesActionRequiredOpened(card.gameType);
    setActionErr(null); setActionBusyId(card.challengeId);
    try {
      if (card.action === "decline_or_play") {
        const { h2hId } = await acceptChallengeAction(card.challengeId, card.gameType);
        router.push(`/h2h/${h2hId ?? card.h2hId}`);
        return; // navigating away
      }
      // "play" / "resume" — already accepted (scorecard) or already an open
      // duel — plain navigate, no accept call.
      if (card.h2hId) router.push(`/h2h/${card.h2hId}`);
    } catch (e) {
      if (e instanceof ChallengeActionConflict) await load();
      else setActionErr((e as Error).message);
    } finally {
      setActionBusyId(null);
    }
  };
  const decline = async (card: GamesActionCard) => {
    setActionErr(null); setActionBusyId(card.challengeId);
    try { await declineChallengeAction(card.challengeId, card.gameType); await load(); }
    catch (e) { setActionErr((e as Error).message); }
    finally { setActionBusyId(null); }
  };
  const cancel = async (card: ChallengeCard) => {
    setActionErr(null); setActionBusyId(card.challengeId);
    try { await cancelChallengeAction(card.challengeId, card.gameType); await load(); }
    catch (e) { setActionErr((e as Error).message); }
    finally { setActionBusyId(null); }
  };

  const summary = overview ? summaryLine(overview.mySummary) : null;
  const empty = overview && !overview.actionRequired.length && !overview.open.length && !overview.recentResults.length;

  return (
    <div>
      {summary && <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>{summary}</div>}

      {/* Loading skeleton — stable heights, shown only until the FIRST load
          resolves (a background refetch never blanks the view underneath). */}
      {loading && !overview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={18} w="45%" />
          <Skel h={92} r={14} />
          <Skel h={56} r={12} />
          <Skel h={56} r={12} />
        </div>
      )}

      {/* A failed fetch shows an inline retry, never a blank tab — stale data
          (if any) stays visible underneath. */}
      {loadErr && (
        <Card style={{ marginBottom: 14, border: "1px solid rgba(224,138,107,0.4)" }}>
          <div style={{ fontSize: 13, color: INK, marginBottom: 8 }}>That didn&apos;t load.</div>
          <button onClick={() => { setLoading(true); void load(); }} style={{
            padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            background: PANEL_2, color: TEAL, border: `1px solid ${tint(TEAL, "44")}`,
          }}>Try again</button>
        </Card>
      )}

      {overview && (
        <>
          {overview.actionRequired.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionLabel>YOUR TURN</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {overview.actionRequired.map((c) => (
                  <ActionCard key={c.challengeId} card={c} viewerId={viewerId} busy={actionBusyId === c.challengeId}
                    onPlay={() => play(c)} onDecline={() => decline(c)} />
                ))}
              </div>
            </div>
          )}

          {actionErr && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "0 0 12px" }}>{actionErr}</p>}

          {/* Quick Challenge — always here, empty league or not. */}
          <div style={{ marginBottom: 18 }}>
            <button onClick={() => openPicker(null)} style={{
              width: "100%", padding: "13px 16px", borderRadius: 14, fontSize: 14.5, fontWeight: 700, cursor: "pointer",
              background: `linear-gradient(100deg, ${tint(GOLD, "1c")}, ${PANEL} 70%)`,
              border: `1px solid ${tint(GOLD, "44")}`, color: GOLD, textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            }}>
              Challenge a league member
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>→</span>
            </button>
          </div>

          {empty && (
            <Card style={{ marginBottom: 18, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>No one has thrown down a challenge yet.</p>
            </Card>
          )}

          {overview.open.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionLabel>OPEN CHALLENGES</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {overview.open.map((c) => (
                  <OpenRow key={c.challengeId} card={c} viewerId={viewerId} busy={actionBusyId === c.challengeId} onCancel={() => cancel(c)} />
                ))}
              </div>
            </div>
          )}

          {overview.recentResults.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionLabel>RECENT RESULTS</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {overview.recentResults.map((c) => (
                  <ResultRow key={c.challengeId} card={c} viewerId={viewerId} onRematch={() => startRematch(c)} />
                ))}
              </div>
            </div>
          )}

          {overview.leaderboard.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionLabel>GAMES TABLE</SectionLabel>
              <LeaderboardPreview rows={overview.leaderboard.slice(0, 8)} viewerId={viewerId} />
            </div>
          )}

          <div>
            <SectionLabel>GAMES</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {overview.availableGames.map((g) => (
                <div key={g.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 3 }}>{g.name}</div>
                  <p style={{ fontSize: 12, color: MUTED, margin: "0 0 4px", lineHeight: 1.4 }}>{g.shortDesc}</p>
                  <div style={{ fontSize: 11, color: MUTED, marginBottom: 9 }}>{g.typicalDuration}</div>
                  <button onClick={() => openPicker(g.id)} style={{
                    padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    background: tint(TEAL, "14"), color: TEAL, border: `1px solid ${tint(TEAL, "40")}`,
                  }}>Challenge someone</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Rival picker — the same roster the chat tray's Challenge entry
          lists (minus yourself). */}
      {picking && (
        <Sheet onClose={() => setPicking(false)} labelledBy="games-pick-title">
          <div id="games-pick-title" className="font-display" style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 10 }}>Who are you calling out?</div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {roster.filter((m) => m.userId !== viewerId).map((m) => (
              <button key={m.userId} onClick={() => pickOpponent(m)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
                minHeight: 48, background: "none", border: "none", borderTop: `1px solid ${LINE}`, padding: "9px 2px",
              }}>
                <PlayerAvatar name={m.displayName} avatarUrl={m.avatarUrl} size={30} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{m.displayName}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: GOLD }}>Challenge</span>
              </button>
            ))}
            {roster.filter((m) => m.userId !== viewerId).length === 0 && (
              <p style={{ fontSize: 13, color: MUTED, margin: "8px 0" }}>Nobody else is in this league yet. Invite a friend first.</p>
            )}
          </div>
        </Sheet>
      )}

      {prep && (
        <ChallengePrepSheet
          leagueCode={code}
          opponent={prep.opponent}
          createdFrom="member_action"
          initialGame={prep.initialGame}
          rematchOf={prep.rematchOf}
          onSent={() => { setPrep(null); void load(); }}
          onClose={() => setPrep(null)}
        />
      )}
    </div>
  );
}
