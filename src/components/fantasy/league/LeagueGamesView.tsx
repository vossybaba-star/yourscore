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
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, PANEL_2, SectionLabel, Sheet, Skel, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { ChallengePrepSheet } from "@/components/fantasy/ChallengePrepSheet";
import { acceptChallengeAction, declineChallengeAction, cancelChallengeAction, ChallengeActionConflict } from "@/lib/fantasy/challengeClientActions";
import { useUser } from "@/hooks/useUser";
import { resultForParticipant, deriveStreak, winRatePercent } from "@/lib/fantasy/games-pure";
import { supportedCompetitionFormats, competitionFormat, type CompetitionFormat } from "@/lib/fantasy/competitionFormats";
import { timeAgo } from "@/lib/timeAgo";
import { competitionResultLine, type CompetitionFormatId } from "@/lib/fantasy/competitions-pure";
import { coverUrl } from "@/lib/img";
import {
  trackGamesTabViewed, trackGamesQuickChallengeOpened, trackGamesActionRequiredOpened, trackGamesLeaderboardViewed,
  trackGamesLeaderboardFullOpened, trackGamesMemberSummaryOpened, trackGameDetailOpened,
} from "@/lib/analytics/trackSocial";
import type {
  ChallengeCard, CompetitionCard, CompetitionDetail, CompetitionEntry,
  GamesActionCard, GamesAvailableGame, GamesLeaderboardRow, GamesOverview,
} from "@/components/fantasy/league/types";

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

/** "3rd" — same ordinal idiom every other league surface already carries
 *  its own copy of (per-file duplication, this codebase's established idiom
 *  for a small display helper). */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "5 Aug" — date-only, no dashes, same expression expiryLine's own date
 *  formatting already uses. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

// ── League competitions (UI wave) ─────────────────────────────────────────
// A league-wide, game-agnostic wrapper (competitions.ts) sitting above the
// 1v1 challenge machinery this whole file otherwise serves — everyone in the
// league plays the SAME pack inside a shared window, as opposed to a
// challenge's two-player shape. GOLD accent (same family the challenge
// cards already use — competitions are games too, just league-wide).

/** The small "OFFICIAL" pill an official (cron-created Gameday) competition
 *  wears, distinguishing it from one an owner started by hand (source
 *  "admin"). */
function OfficialTag() {
  return (
    <span className="font-display tracking-widest" style={{
      fontSize: 9, fontWeight: 700, color: GOLD, background: tint(GOLD, "18"),
      border: `1px solid ${tint(GOLD, "44")}`, borderRadius: 999, padding: "2px 7px", flexShrink: 0,
    }}>OFFICIAL</span>
  );
}

/** "You scored 42. You're 3rd of 8." / "You scored 42. Beaten the target." —
 *  a live/pre-lock read only (never phrased as final — house rule: no live
 *  position ever reads as settled). Null once there's no entry to report,
 *  or the competition isn't open. */
function myCompetitionLine(c: CompetitionCard): string | null {
  if (c.status !== "open" || !c.myEntry) return null;
  if (c.format === "beat_target") {
    return c.myEntry.result === "placed"
      ? `You scored ${c.myEntry.score}. Beaten the target.`
      : `You scored ${c.myEntry.score}. Not there yet.`;
  }
  const pos = c.myEntry.rank != null ? `${ordinal(c.myEntry.rank)} of ${c.entrantCount}` : `of ${c.entrantCount}`;
  return `You scored ${c.myEntry.score}. You're ${pos}.`;
}

/** "Opens 5 Aug" / "Expires in 3 hours" / "Results on the way" — the
 *  window/status line every active competition row carries. Reuses this
 *  file's own expiryLine for the closing countdown (the exact helper the
 *  challenge cards in this file already use), rather than a second one. */
function competitionStatusLine(c: CompetitionCard): string {
  if (c.status === "scheduled") return `Opens ${shortDate(c.opensAt)}`;
  if (c.status === "open") return expiryLine(c.closesAt);
  return "Results on the way"; // locked / calculating
}

/** The settled outcome line — the SAME competitionResultLine
 *  competitions.ts's own settle path writes to the chat result ping and the
 *  notification body, never a second copy of that wording anywhere in the
 *  UI. */
function competitionOutcomeLine(entrantCount: number, format: string, winnerName: string | null, placedCount: number): string {
  return competitionResultLine({ format: format as CompetitionFormatId, entrantCount, winnerName, placedCount });
}

/** An active (scheduled/open/locked/calculating) competition — title,
 *  Official tag, status line, my position or Play now, entrant count. The
 *  whole row opens the detail sheet; there's no separate Play control here
 *  (open its own Play now, since the row is already the one interactive
 *  element — same "never nest a control inside another" rule the GAMES
 *  cards below already follow). */
function CompetitionRow({ card, onOpen }: { card: CompetitionCard; onOpen: () => void }) {
  const mine = myCompetitionLine(card);
  const playNow = card.status === "open" && !card.myEntry;
  return (
    <button onClick={onOpen} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      background: `linear-gradient(100deg, ${tint(GOLD, "12")}, ${PANEL} 60%)`,
      border: `1px solid ${tint(GOLD, "3a")}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 12, padding: 11,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title}</div>
        {card.source === "official" && <OfficialTag />}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: playNow || mine ? 4 : 0 }}>
        {competitionStatusLine(card)} · {card.entrantCount} entrant{card.entrantCount === 1 ? "" : "s"}
      </div>
      {playNow && <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>Play now</div>}
      {!playNow && mine && <div style={{ fontSize: 12, color: MUTED }}>{mine}</div>}
    </button>
  );
}

/** A completed/void competition — compact, winner/placed line off the same
 *  competitionResultLine wording, still tappable through to the detail
 *  (house rule: no dead ends, even on a settled record). */
function CompetitionCompactRow({ card, onOpen }: { card: CompetitionCard; onOpen: () => void }) {
  const line = competitionOutcomeLine(card.entrantCount, card.format, card.winner?.name ?? null, card.placedCount);
  return (
    <button onClick={onOpen} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "9px 11px",
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title}</div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{line}</div>
    </button>
  );
}

/** The full standings list (detail sheet) — rank/name/avatar/score, the
 *  viewer's own row highlighted. beat_target groups "placed" entries above
 *  "played" ones with a subtle divider (no rank column meaning there — see
 *  competitions-pure.ts's own doc on resolveBeatTarget); league_quiz is a
 *  strict 1..N order throughout. */
function CompetitionStandings({ standings, format, viewerId }: { standings: CompetitionEntry[]; format: string; viewerId: string | null }) {
  if (!standings.length) return <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>No one has played yet.</p>;

  const row = (s: CompetitionEntry, i: number) => (
    <div key={s.userId} style={{
      display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 10,
      background: s.userId === viewerId ? tint(TEAL, "10") : "transparent",
    }}>
      <span style={{ width: 20, textAlign: "center", fontSize: 12, color: MUTED, fontWeight: 700, flexShrink: 0 }}>{s.rank ?? i + 1}</span>
      <PlayerAvatar name={s.name} avatarUrl={s.avatarUrl} size={26} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {s.name}{s.userId === viewerId ? " · you" : ""}
      </span>
      <span style={{ fontSize: 13, fontWeight: 800, color: GOLD, fontVariantNumeric: "tabular-nums" }}>{s.score}</span>
    </div>
  );

  if (format !== "beat_target") {
    return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{standings.map(row)}</div>;
  }
  const placed = standings.filter((s) => s.result === "placed");
  const played = standings.filter((s) => s.result !== "placed");
  return (
    <div>
      {placed.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{placed.map(row)}</div>}
      {placed.length > 0 && played.length > 0 && <div style={{ height: 1, background: LINE, margin: "8px 0" }} />}
      {played.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{played.map(row)}</div>}
    </div>
  );
}

/** One competition's full detail (UI wave) — format's howItWorks off the
 *  registry (never hardcoded here, same rule GameDetailSheet follows for a
 *  challenge game), window, full standings, a winner banner once completed,
 *  Play now when open and the viewer hasn't entered, and (owner, admin-
 *  sourced, scheduled/open only) a quiet Call it off. */
function CompetitionDetailSheet({ code, competitionId, viewerId, isOwner, onClose, onChanged }: {
  code: string; competitionId: string; viewerId: string | null; isOwner: boolean;
  onClose: () => void;
  /** Refresh the Games tab's competitions list after a cancel (same
   *  action-then-reload shape every challenge action in this file already
   *  follows). */
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CompetitionDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/competitions/${competitionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load this competition"))))
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => { if (live) setLoadErr((e as Error).message); });
    return () => { live = false; };
  }, [code, competitionId]);

  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true); setCancelErr(null);
    try {
      const res = await fetch(`/api/fantasy/leagues/${code}/competitions/${competitionId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not call it off");
      onChanged();
      onClose();
    } catch (e) {
      setCancelErr((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const format = detail ? competitionFormat(detail.format) : undefined;
  const hasMyEntry = !!detail && !!viewerId && detail.standings.some((s) => s.userId === viewerId);
  const placedCount = detail && detail.format === "beat_target" ? detail.standings.filter((s) => s.result === "placed").length : 0;

  return (
    <Sheet onClose={onClose} labelledBy="competition-detail-title">
      {!detail && !loadErr && <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>}
      {loadErr && <p style={{ fontSize: 13, color: MUTED }}>{loadErr}</p>}
      {detail && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div id="competition-detail-title" className="font-display" style={{ fontSize: 19, color: INK, lineHeight: 1.1 }}>{detail.title}</div>
            {detail.source === "official" && <OfficialTag />}
          </div>
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 14px" }}>{shortDate(detail.opensAt)} to {shortDate(detail.closesAt)}</p>

          {format && format.howItWorks.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>HOW IT WORKS</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {format.howItWorks.map((line, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.45 }}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {detail.status === "completed" && (
            <div style={{
              borderRadius: 12, padding: 12, marginBottom: 14,
              background: `linear-gradient(100deg, ${tint(GOLD, "14")}, ${PANEL} 60%)`, border: `1px solid ${tint(GOLD, "3a")}`,
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: GOLD }}>
                {competitionOutcomeLine(detail.standings.length, detail.format, detail.winner?.name ?? null, placedCount)}
              </div>
            </div>
          )}
          {detail.status === "void" && (
            <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px" }}>
              {competitionOutcomeLine(0, detail.format, null, 0)}
            </p>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <SectionLabel>STANDINGS</SectionLabel>
              {detail.provisional && (
                <span style={{ fontSize: 9.5, letterSpacing: "0.08em", color: MUTED }}>PROVISIONAL</span>
              )}
            </div>
            <CompetitionStandings standings={detail.standings} format={detail.format} viewerId={viewerId} />
          </div>

          {/* Eligibility (P2, 6 Aug) — the ONLY way a viewer learns why they
              never show up above: they played this pack before the window
              opened, and quiz_attempts' unique (user, pack) index means they
              physically cannot replay it. Plain, non-blaming, no emoji. */}
          {detail.viewerIneligible && (
            <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px", lineHeight: 1.45 }}>
              You played this quiz before the competition opened, so that run does not count here.
            </p>
          )}

          {detail.status === "open" && !hasMyEntry && !detail.viewerIneligible && detail.packId && (
            <div style={{ marginBottom: 12 }}>
              <Link href={`/play/new?packId=${detail.packId}`} onClick={onClose} style={{ display: "block" }}>
                <Btn gold>Play now</Btn>
              </Link>
            </div>
          )}

          {isOwner && detail.source === "admin" && (detail.status === "scheduled" || detail.status === "open") && (
            <div>
              {cancelErr && <p style={{ fontSize: 12, color: "#E08A6B", margin: "0 0 8px" }}>{cancelErr}</p>}
              <button disabled={cancelling} onClick={cancel} style={{
                padding: 0, fontSize: 12, fontWeight: 700, cursor: cancelling ? "default" : "pointer",
                background: "none", border: "none", color: MUTED, textDecoration: "underline", opacity: cancelling ? 0.6 : 1,
              }}>Call it off</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** A pack the create sheet's picker can offer — same DuelPack shape
 *  ChallengePrepSheet's own Quiz Duel step already fetches (a pack neither
 *  side has played), reused here via the SAME route rather than a second
 *  pack source (see the route's own doc on why: a competition needs a fresh
 *  pack, not the owner's played scorecard). */
interface CreatePack { packId: string; name: string; cover: string | null; total: number }

/** League owner only — starts a competition. Three steps: format, pack,
 *  then (beat_target only) a target score + the window picker, then
 *  Publish. Same "Sent" confirmation shape ChallengePrepSheet's own send
 *  step uses. */
function CompetitionCreateSheet({ code, onClose, onCreated }: { code: string; onClose: () => void; onCreated: () => void }) {
  const formats = supportedCompetitionFormats();
  const [format, setFormat] = useState<CompetitionFormat | null>(formats.length === 1 ? formats[0] : null);
  const [packs, setPacks] = useState<CreatePack[] | null>(null);
  const [pickedPack, setPickedPack] = useState<CreatePack | null>(null);
  const [targetScore, setTargetScore] = useState("");
  const [windowHours, setWindowHours] = useState<24 | 48 | 72>(24);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!format || packs !== null) return;
    fetch(`/api/fantasy/challenges/packs?game=duel`)
      .then((r) => r.json())
      .then((j) => setPacks(((j?.packs as CreatePack[] | undefined) ?? [])))
      .catch(() => setPacks([]));
  }, [format, packs]);

  const needsTarget = format?.id === "beat_target";
  const canPublish = !!format && !!pickedPack && (!needsTarget || (targetScore.trim() !== "" && Number(targetScore) > 0));

  const publish = () => {
    if (!canPublish || sending) return;
    setSending(true); setErr(null);
    const now = Date.now();
    fetch(`/api/fantasy/leagues/${code}/competitions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: format!.id, packId: pickedPack!.packId,
        targetScore: needsTarget ? Number(targetScore) : undefined,
        opensAt: new Date(now).toISOString(), closesAt: new Date(now + windowHours * 3_600_000).toISOString(),
      }),
    })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(j.error ?? "Could not start the competition"); return; }
        setSent(true);
        onCreated();
      })
      .catch(() => setErr("Could not start the competition"))
      .finally(() => setSending(false));
  };

  // ── Sent ──
  if (sent) {
    return (
      <Sheet onClose={onClose} labelledBy="competition-sent-title">
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <div style={{
            width: 56, height: 56, borderRadius: 999, margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center",
            background: tint(GOLD, "18"), border: `1px solid ${tint(GOLD, "50")}`,
          }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" stroke={GOLD} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div id="competition-sent-title" className="font-display" style={{ fontSize: 19, color: INK, marginBottom: 4 }}>Competition started</div>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 18px" }}>Everyone in the league can see it and play now.</p>
          <button onClick={onClose} style={{
            width: "100%", padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer",
            background: tint(GOLD, "18"), color: GOLD, border: `1px solid ${tint(GOLD, "50")}`,
          }}>Done</button>
        </div>
      </Sheet>
    );
  }

  // ── Format choice ──
  if (!format) {
    return (
      <Sheet onClose={onClose} labelledBy="competition-create-title">
        <div id="competition-create-title" className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 14 }}>Start a competition</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {formats.map((f) => (
            <button key={f.id} onClick={() => setFormat(f)} style={{
              textAlign: "left", cursor: "pointer", borderRadius: 12, padding: 12,
              background: `linear-gradient(100deg, ${tint(GOLD, "12")}, ${PANEL} 60%)`,
              border: `1px solid ${tint(GOLD, "3a")}`, borderLeft: `3px solid ${GOLD}`,
            }}>
              <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: GOLD, marginBottom: 5 }}>{f.name.toUpperCase()}</div>
              <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.4 }}>{f.shortDesc}</p>
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{
          width: "100%", marginTop: 16, padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer",
          background: "transparent", color: MUTED, border: `1px solid ${LINE}`,
        }}>Close</button>
      </Sheet>
    );
  }

  // ── Pack, target (beat_target only), window ──
  return (
    <Sheet onClose={onClose} labelledBy="competition-create-title">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        {formats.length > 1 && (
          <button onClick={() => { setFormat(null); setPickedPack(null); }} aria-label="Change format" style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999,
            background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer", flexShrink: 0, padding: 0,
          }}>←</button>
        )}
        <div id="competition-create-title" className="font-display" style={{ fontSize: 18, color: INK }}>{format.name}</div>
      </div>

      <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>
        {pickedPack ? "QUIZ" : "PICK A QUIZ"}
      </div>
      {pickedPack ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: pickedPack.cover ? `center/cover url(${coverUrl(pickedPack.cover, 40)})` : tint(TEAL, "18") }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pickedPack.name}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>{pickedPack.total} questions</div>
          </div>
          <button onClick={() => setPickedPack(null)} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Change</button>
        </div>
      ) : packs === null ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 16px" }}>Loading packs…</p>
      ) : packs.length === 0 ? (
        <div style={{ textAlign: "center", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "20px 16px", marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: INK, margin: 0, fontWeight: 600 }}>No fresh packs to run this on right now.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, maxHeight: 260, overflowY: "auto" }}>
          {packs.map((p) => (
            <button key={p.packId} onClick={() => setPickedPack(p)} style={{
              display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer",
              background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 9,
            }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, background: p.cover ? `center/cover url(${coverUrl(p.cover, 38)})` : tint(TEAL, "18") }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: MUTED }}>{p.total} questions</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {needsTarget && (
        <div style={{ marginBottom: 16 }}>
          <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>TARGET SCORE</div>
          <input
            inputMode="numeric" value={targetScore} placeholder="e.g. 500"
            onChange={(e) => setTargetScore(e.target.value.replace(/[^0-9]/g, ""))}
            style={{
              width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 10,
              background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none",
            }}
          />
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>WINDOW</div>
        <div style={{ display: "flex", gap: 6 }}>
          {([24, 48, 72] as const).map((h) => {
            const on = windowHours === h;
            const label = h === 24 ? "One day" : h === 48 ? "Two days" : "Three days";
            return (
              <button key={h} onClick={() => setWindowHours(h)} style={{
                flex: 1, padding: "9px 6px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: on ? tint(GOLD, "22") : PANEL_2, color: on ? GOLD : MUTED, border: `1px solid ${on ? tint(GOLD, "55") : LINE}`,
              }}>{label}</button>
            );
          })}
        </div>
      </div>

      {err && <p style={{ fontSize: 12.5, color: "#E08A6B", margin: "0 0 10px" }}>{err}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={!canPublish || sending} onClick={publish} style={{
          flex: 1, padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: canPublish && !sending ? "pointer" : "default",
          background: canPublish ? GOLD : PANEL_2, color: canPublish ? "#3a2600" : MUTED,
          border: `1px solid ${canPublish ? GOLD : LINE}`, opacity: sending ? 0.7 : 1,
        }}>{sending ? "Starting…" : "Publish"}</button>
        <button onClick={onClose} style={{
          padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer",
          background: "transparent", color: MUTED, border: `1px solid ${LINE}`,
        }}>Close</button>
      </div>
    </Sheet>
  );
}

/** Both the Games tab's top-8 preview AND the full-table Sheet (Phase 4C) —
 *  same rows shape, same styling, the caller just passes more of them and a
 *  taller container. `onRowClick` (Phase 4C) opens the member gaming
 *  summary; omitted nowhere here — every row is always tappable, own row
 *  included (its sheet just comes back with no Challenge action). */
function LeaderboardPreview({ rows, viewerId, onRowClick }: { rows: GamesLeaderboardRow[]; viewerId: string | null; onRowClick: (row: GamesLeaderboardRow) => void }) {
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
        <button key={r.userId} onClick={() => onRowClick(r)} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", width: "100%", cursor: "pointer",
          background: r.userId === viewerId ? tint(TEAL, "10") : "transparent",
          borderTop: "none", borderLeft: "none", borderRight: "none",
          borderBottom: i < rows.length - 1 ? `1px solid ${LINE}` : "none", textAlign: "left",
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
        </button>
      ))}
    </div>
  );
}

/** Member gaming summary (Phase 4C) — opened from any leaderboard row, preview
 *  or full table. Aggregate record (played/wins/draws/losses/win rate) comes
 *  off the leaderboard row itself (comprehensive, every completed game this
 *  league has). Recent results and the streak are derived from
 *  overview.recentResults instead — that list is capped at 12 league-wide
 *  (games.ts's RECENT_RESULTS_LIMIT), so a member whose games get pushed out
 *  of that window by OTHER pairs' more-recent results will show fewer
 *  results (and a possibly-undercounted streak) here than their true record.
 *  No extra fetch to fix that this phase (brief, Phase 4C) — this sheet only
 *  ever reads what the Games tab already has on the client. */
function MemberSummarySheet({ row, viewerId, recentResults, onChallenge, onClose }: {
  row: GamesLeaderboardRow; viewerId: string | null; recentResults: ChallengeCard[];
  onChallenge: (row: GamesLeaderboardRow) => void; onClose: () => void;
}) {
  const isSelf = viewerId === row.userId;
  const rate = winRatePercent(row.wins, row.played);
  const myResults = recentResults
    .filter((c) => c.challengerId === row.userId || c.opponentId === row.userId)
    .map((c) => ({ card: c, result: resultForParticipant(c.winnerId, row.userId), completedAt: c.completedAt ?? c.createdAt }));
  const streak = deriveStreak(myResults);

  return (
    <Sheet onClose={onClose} labelledBy="member-summary-title">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <PlayerAvatar name={row.name} avatarUrl={row.avatarUrl} size={48} />
        <div id="member-summary-title" className="font-display" style={{ fontSize: 18, color: INK, lineHeight: 1.1 }}>
          {row.name}{isSelf ? <span style={{ color: TEAL, fontWeight: 700 }}> · you</span> : ""}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <StatChip label="Played" value={`${row.played}`} />
        <StatChip label="Wins" value={`${row.wins}`} />
        <StatChip label="Draws" value={`${row.draws}`} />
        <StatChip label="Losses" value={`${row.losses}`} />
        {rate !== null && <StatChip label="Win rate" value={`${rate}%`} accent={GOLD} />}
      </div>

      {streak && streak.count > 1 && (
        <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px" }}>
          {streak.count} {streak.type} streak
        </p>
      )}

      {myResults.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel>RECENT RESULTS</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {myResults.map(({ card }) => (
              <ResultRow key={card.challengeId} card={card} viewerId={viewerId} onRematch={() => {}} />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {!isSelf && <div style={{ flex: 1 }}><Btn gold onClick={() => onChallenge(row)}>Challenge</Btn></div>}
        <div style={{ flex: 1 }}><Link href={`/profile/${row.userId}`} onClick={onClose} style={{ display: "block" }}><Btn>View profile</Btn></Link></div>
        <div style={{ flex: 1 }}><Link href={`/profile/${row.userId}#fantasy-xi`} onClick={onClose} style={{ display: "block" }}><Btn>View squad</Btn></Link></div>
      </div>
    </Sheet>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: "7px 11px", minWidth: 60 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: accent ?? INK }}>{value}</div>
      <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{label}</div>
    </div>
  );
}

/** Game detail sheet (Phase 4D) — opened by tapping a game's name/body (not
 *  its "Challenge someone" button) in the GAMES section below. Copy comes
 *  straight off the registry (challengeGames.ts's howItWorks) — nothing
 *  hardcoded here. The tie rule is the one line true of every game this
 *  registry offers today (single-shot, no replay), so it's fixed text rather
 *  than a registry field. */
function GameDetailSheet({ game, recentResults, viewerId, onChallenge, onRematch, onClose }: {
  game: GamesAvailableGame; recentResults: ChallengeCard[]; viewerId: string | null;
  onChallenge: (gameId: string) => void; onRematch: (card: ChallengeCard) => void; onClose: () => void;
}) {
  const results = recentResults.filter((c) => c.gameType === game.id).slice(0, 3);
  return (
    <Sheet onClose={onClose} labelledBy="game-detail-title">
      <div id="game-detail-title" className="font-display" style={{ fontSize: 20, color: INK, lineHeight: 1.1, marginBottom: 6 }}>{game.name}</div>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.45 }}>{game.shortDesc}</p>

      <div style={{ marginBottom: 14 }}>
        <SectionLabel>HOW IT WORKS</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {game.howItWorks.map((line, i) => (
            <p key={i} style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.45 }}>{line}</p>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginBottom: 4 }}>DURATION</div>
          <div style={{ fontSize: 12.5, color: INK, fontWeight: 600 }}>{game.typicalDuration}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED, marginBottom: 4 }}>TIE RULE</div>
          <div style={{ fontSize: 12.5, color: INK, fontWeight: 600 }}>Level scores finish level. No tiebreaker.</div>
        </div>
      </div>

      {results.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel>RECENT RESULTS</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((c) => (
              <ResultRow key={c.challengeId} card={c} viewerId={viewerId} onRematch={() => onRematch(c)} />
            ))}
          </div>
        </div>
      )}

      <Btn gold onClick={() => onChallenge(game.id)}>Challenge someone</Btn>
    </Sheet>
  );
}

type PrepTarget = { opponent: { userId: string; name: string; avatarUrl: string | null }; initialGame?: string; rematchOf?: string };

export function LeagueGamesView({
  code, isOwner, autoOpenChallenge, onAutoOpenChallengeHandled, initialCompetitionId = null, onCompetitionIdChange,
}: {
  code: string;
  /** The league page already knows this off leagueDetail() (leagues.ts) —
   *  same isOwner the header/settings gate already reads (page.tsx's
   *  `league.isOwner`), just threaded down here for the competitions
   *  section's owner-only "Start a competition" action. */
  isOwner: boolean;
  /** Set by the League Hub's "Challenge someone" module action (Phase 4B) —
   *  page.tsx switches to this tab AND flips this true in the same tap, so
   *  the rival picker opens itself here rather than the hub needing to know
   *  anything about the picker's own state. Cleared via
   *  onAutoOpenChallengeHandled the moment it's acted on, so navigating away
   *  and back to Games never re-opens it uninvited. */
  autoOpenChallenge?: boolean;
  onAutoOpenChallengeHandled?: () => void;
  /** Which competition's detail sheet to open on mount — a chat card's tap
   *  through, the Hub module, or a page load carrying `?c=`. page.tsx owns
   *  the `c` URL param; this view reports every open/close of the sheet back
   *  through onCompetitionIdChange (same mirror pattern LeagueChatView uses
   *  for initialGw) so the URL always matches what's actually on screen. */
  initialCompetitionId?: string | null;
  onCompetitionIdChange?: (competitionId: string | null) => void;
}) {
  const router = useRouter();
  const { user } = useUser();
  const viewerId = user?.id ?? null;

  const [overview, setOverview] = useState<GamesOverview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // League competitions (UI wave) — a separate fetch alongside the overview
  // above (own load/refresh cycle, same focus+interval triggers), since it
  // reads a different table entirely (league_competitions, not
  // member_challenges) via its own route.
  const [competitions, setCompetitions] = useState<CompetitionCard[] | null>(null);
  const [compErr, setCompErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCompetitionId, setDetailCompetitionId] = useState<string | null>(initialCompetitionId);
  // Every open/close of the detail sheet is reported up so the `c` URL param
  // (owned by page.tsx) always matches what's actually on screen.
  const openCompetitionDetail = (competitionId: string | null) => {
    setDetailCompetitionId(competitionId);
    onCompetitionIdChange?.(competitionId);
  };

  // The rival picker (Quick Challenge / a per-game "Challenge someone") and
  // the prep sheet it (or a Rematch tap) hands off to — one PrepTarget state
  // covers every entry point into ChallengePrepSheet on this view.
  const [roster, setRoster] = useState<{ userId: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [picking, setPicking] = useState(false);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepTarget | null>(null);

  // Full table (Phase 4C) — every leaderboard row, not just the top-8
  // preview. Member gaming summary (Phase 4C) — the row that's been tapped,
  // preview or full table, null while closed. Game detail (Phase 4D) — the
  // GAMES card whose name/body (not its Challenge someone button) was tapped.
  const [fullTableOpen, setFullTableOpen] = useState(false);
  const [memberSheet, setMemberSheet] = useState<GamesLeaderboardRow | null>(null);
  const [gameDetail, setGameDetail] = useState<GamesAvailableGame | null>(null);

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

  const loadCompetitions = useCallback(async () => {
    try {
      const res = await fetch(`/api/fantasy/leagues/${code}/competitions`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setCompetitions(await res.json());
      setCompErr(null);
    } catch (e) {
      setCompErr((e as Error).message);
    }
  }, [code]);

  useEffect(() => { void loadCompetitions(); }, [loadCompetitions]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void loadCompetitions(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const t = setInterval(() => { if (document.visibilityState === "visible") void loadCompetitions(); }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(t);
    };
  }, [loadCompetitions]);

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

  // The Hub module's "Challenge someone" deep-link (Phase 4B) — open the
  // same Quick Challenge picker the button below does, then tell the parent
  // it's been handled so the flag doesn't fire again on its own.
  useEffect(() => {
    if (!autoOpenChallenge) return;
    openPicker(null);
    onAutoOpenChallengeHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenChallenge]);

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

  // Member gaming summary (Phase 4C) — a leaderboard row's own Challenge
  // action preselects that member as opponent, same PrepTarget shape as
  // pickOpponent above, just skipping the rival picker entirely.
  const openMemberSheet = (row: GamesLeaderboardRow) => { trackGamesMemberSummaryOpened(); setMemberSheet(row); };
  const challengeFromMemberSheet = (row: GamesLeaderboardRow) => {
    setMemberSheet(null);
    setPrep({ opponent: { userId: row.userId, name: row.name, avatarUrl: row.avatarUrl } });
  };

  // Game detail (Phase 4D) — "Challenge someone" inside the sheet is the
  // same per-game entry point the card's own button offers.
  const openGameDetail = (g: GamesAvailableGame) => { trackGameDetailOpened(g.id); setGameDetail(g); };
  const challengeFromGameDetail = (gameId: string) => { setGameDetail(null); openPicker(gameId); };

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

  // Competitions split into active (scheduled/open/locked/calculating) and
  // recent completed/void — competitionsForLeague (competitions.ts) already
  // returns exactly these two families (never "cancelled", which that read
  // excludes outright), so this is a plain status partition, not a second
  // query.
  const activeCompetitions = (competitions ?? []).filter((c) => c.status !== "completed" && c.status !== "void");
  const completedCompetitions = (competitions ?? []).filter((c) => c.status === "completed" || c.status === "void").slice(0, 3);

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

      {/* COMPETITIONS (UI wave) — above the 1v1 sections below (challenges
          are all two-player; a competition is league-wide). Hidden outright
          when there are none and the viewer isn't the owner (house rule: no
          empty shell section) — the owner still gets a small entry point
          near Quick Challenge in that case. */}
      {compErr && (
        <Card style={{ marginBottom: 14, border: "1px solid rgba(224,138,107,0.4)" }}>
          <div style={{ fontSize: 13, color: INK, marginBottom: 8 }}>Competitions didn&apos;t load.</div>
          <button onClick={() => { setCompErr(null); void loadCompetitions(); }} style={{
            padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            background: PANEL_2, color: TEAL, border: `1px solid ${tint(TEAL, "44")}`,
          }}>Try again</button>
        </Card>
      )}
      {competitions && competitions.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <SectionLabel>COMPETITIONS</SectionLabel>
            {isOwner && (
              <button onClick={() => setCreateOpen(true)} style={{ background: "none", border: "none", color: GOLD, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                Start a competition
              </button>
            )}
          </div>
          {activeCompetitions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeCompetitions.map((c) => (
                <CompetitionRow key={c.id} card={c} onOpen={() => openCompetitionDetail(c.id)} />
              ))}
            </div>
          )}
          {completedCompetitions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: activeCompetitions.length > 0 ? 8 : 0 }}>
              {completedCompetitions.map((c) => (
                <CompetitionCompactRow key={c.id} card={c} onOpen={() => openCompetitionDetail(c.id)} />
              ))}
            </div>
          )}
        </div>
      )}
      {competitions !== null && competitions.length === 0 && isOwner && (
        <div style={{ marginBottom: 18 }}>
          <button onClick={() => setCreateOpen(true)} style={{
            width: "100%", padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: PANEL, color: GOLD, border: `1px solid ${tint(GOLD, "44")}`, textAlign: "left",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          }}>
            Start a league competition
            <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>→</span>
          </button>
        </div>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <SectionLabel>GAMES TABLE</SectionLabel>
                {overview.leaderboard.length > 8 && (
                  <button onClick={() => { trackGamesLeaderboardFullOpened(); setFullTableOpen(true); }} style={{
                    background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0,
                  }}>Full table →</button>
                )}
              </div>
              <LeaderboardPreview rows={overview.leaderboard.slice(0, 8)} viewerId={viewerId} onRowClick={openMemberSheet} />
            </div>
          )}

          <div>
            <SectionLabel>GAMES</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {overview.availableGames.map((g) => (
                <div key={g.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12 }}>
                  {/* Name/body opens the game detail sheet (Phase 4D) — the
                      Challenge someone button below stays a separate,
                      sibling control so this never nests an interactive
                      element inside another. */}
                  <div role="button" tabIndex={0} onClick={() => openGameDetail(g)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGameDetail(g); } }}
                    style={{ cursor: "pointer" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 3 }}>{g.name}</div>
                    <p style={{ fontSize: 12, color: MUTED, margin: "0 0 4px", lineHeight: 1.4 }}>{g.shortDesc}</p>
                    <div style={{ fontSize: 11, color: MUTED, marginBottom: 9 }}>{g.typicalDuration}</div>
                  </div>
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

      {/* Full table (Phase 4C) — every leaderboard row, same styling as the
          preview above (LeaderboardPreview handles both). Sheet's own
          maxHeight:100%-of-viewport scroll already gives this a full-height
          feel without a bespoke container. */}
      {fullTableOpen && overview && (
        <Sheet onClose={() => setFullTableOpen(false)} labelledBy="full-table-title">
          <div id="full-table-title" className="font-display" style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 10 }}>Games table</div>
          <LeaderboardPreview rows={overview.leaderboard} viewerId={viewerId} onRowClick={(r) => { setFullTableOpen(false); openMemberSheet(r); }} />
        </Sheet>
      )}

      {memberSheet && (
        <MemberSummarySheet
          row={memberSheet}
          viewerId={viewerId}
          recentResults={overview?.recentResults ?? []}
          onChallenge={challengeFromMemberSheet}
          onClose={() => setMemberSheet(null)}
        />
      )}

      {gameDetail && (
        <GameDetailSheet
          game={gameDetail}
          recentResults={overview?.recentResults ?? []}
          viewerId={viewerId}
          onChallenge={challengeFromGameDetail}
          onRematch={(c) => { setGameDetail(null); startRematch(c); }}
          onClose={() => setGameDetail(null)}
        />
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

      {/* Competitions (UI wave) — detail sheet (any row) and, owner only,
          the create sheet. */}
      {detailCompetitionId && (
        <CompetitionDetailSheet
          code={code} competitionId={detailCompetitionId} viewerId={viewerId} isOwner={isOwner}
          onClose={() => openCompetitionDetail(null)}
          onChanged={() => void loadCompetitions()}
        />
      )}
      {createOpen && (
        <CompetitionCreateSheet
          code={code}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void loadCompetitions()}
        />
      )}
    </div>
  );
}
