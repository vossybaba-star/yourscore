"use client";
/** The League Hub — the default screen. Tells the league's story right now:
 *  the gameweek state, where you stand, the key moments, and the latest banter.
 *  Not a full table or a full chat — it points at both. */
import { useEffect, useState } from "react";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { LeagueTableRows } from "./LeagueTableRows";
import { LeagueRecentRail } from "./LeagueRecentRail";
import { LeagueMembersView } from "./LeagueMembersView";
import { MemberActionSheet, type MemberActionMember } from "@/components/fantasy/MemberActionSheet";
import { useUser } from "@/hooks/useUser";
import { trackGamesHubModuleOpened } from "@/lib/analytics/trackSocial";
import type { ChatData, ChatMessage, GamesPulse, LeagueDetail, LeagueRow } from "./types";
import { nameOf } from "./types";

/** The Games module's status line (Phase 4B) — three fixed states, in
 *  priority order: the viewer's own action-required items come first (most
 *  urgent to THEM), then whether anything's open league-wide, then the
 *  quiet default. `lastResultLine` (a completed result, if any) is never the
 *  PRIMARY line — it's a secondary caption under it, so it never competes
 *  with the three states above for the headline. */
/** "League Quiz · Closes 5 Aug" — the pulse only ever carries closesAt (the
 *  soonest-closing scheduled/open competition), so this reads off that
 *  regardless of whether it's open yet or still scheduled — either way,
 *  that's when the window shuts. Plain date, no dashes (house rule). */
function competitionHintLine(c: NonNullable<GamesPulse["activeCompetition"]>): string {
  return `${c.title} · Closes ${new Date(c.closesAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

function gamesStatusLine(pulse: GamesPulse): string {
  if (pulse.myActionCount > 0) return `${pulse.myActionCount} waiting on you`;
  if (pulse.openCount > 0) return `${pulse.openCount} open challenge${pulse.openCount === 1 ? "" : "s"}`;
  return "Settle it on the pitch.";
}

/** A one-line summary of a message for the hub preview. A structured card can't
 *  show its whole self here, so it says what it is in plain words — never the raw
 *  internal body ("shared their captain"), which read as broken third person.
 *
 *  Returns {icon, text} rather than a single string: the icon renders as a bare
 *  SVG (house rule; no emoji in UI — see LeagueChatView's ChipIcon), which a
 *  plain string couldn't carry. Duplicated here rather than imported from
 *  LeagueChatView's CHIP_ICON, matching how summariseChatMessage in types.ts is
 *  already duplicated rather than shared across these two files. */
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
  // Shared player: an upload/share glyph.
  player: "M12 3v10 M8 7l4-4 4 4 M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5",
  // Shared squad: the same shirt CreatePostSheet/LeagueChatView already use.
  squad: "M8 4l-4 3 2 3 2-1v11h8V9l2 1 2-3-4-3a4 4 0 0 1-8 0z",
  news: "M6 3h9l3 3v15H6z M15 3v3h3 M9 11h6 M9 15h6",
  // Player comparison: two arrows meeting in the middle, i.e. "versus".
  compare: "M4 8h10 M10 4l4 4-4 4 M20 16H10 M14 12l-4 4 4 4",
  // Poll: the same bar list CreatePostSheet/LeagueChatView use for a poll.
  poll: "M4 6h12 M4 12h16 M4 18h8",
};

/** The chat preview's activity glyph. Bare SVG, not emoji (house rule). aria-hidden
 *  since the accessible name comes from the adjacent preview text. */
function PreviewIcon({ kind }: { kind: Exclude<PreviewIconKind, null> }) {
  return (
    <svg width={12.5} height={12.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginRight: 3, verticalAlign: -1.5 }}>
      <path d={PREVIEW_ICON_PATH[kind]} />
    </svg>
  );
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

const PHASE = {
  pre: { label: "PRE-DEADLINE", accent: TEAL },
  live: { label: "LIVE", accent: TEAL },
  final: { label: "FINAL", accent: GOLD },
} as const;

export function LeagueHub({ detail, chat, onTab, onOpenGamesChallenge }: {
  detail: LeagueDetail;
  chat: ChatData | null;
  onTab: (t: "chat" | "table" | "games" | "history") => void;
  /** Games module's "Challenge someone" (Phase 4B) — mirrors History's own
   *  onOpenChat pattern (a dedicated callback from page.tsx alongside onTab,
   *  rather than onTab growing an options bag every module needs a flag). */
  onOpenGamesChallenge: () => void;
}) {
  const { user } = useUser();
  const viewerId = user?.id ?? null;
  const [selected, setSelected] = useState<MemberActionMember | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  // Games module pulse (Phase 4B) — a small, dedicated fetch (own useEffect,
  // own load, independent of page.tsx's own pulse fetch for the tab badge)
  // so the module works whether or not the viewer ever visits the badge's
  // code path. Member-only (games is a member-only tab); null hides the
  // module outright while loading or on a failed fetch — same "hide clean"
  // idiom Readiness/GwRecap already use above, no skeleton for one line.
  const [gamesPulse, setGamesPulse] = useState<GamesPulse | null>(null);
  useEffect(() => {
    if (!detail.league.isMember) return;
    let live = true;
    fetch(`/api/fantasy/leagues/${detail.league.code}/games/pulse`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setGamesPulse(d); })
      .catch(() => {});
    return () => { live = false; };
  }, [detail.league.code, detail.league.isMember]);
  const openMember = (r: LeagueRow) => {
    if (!detail.league.isMember) return;
    setSelected({ userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl, rank: r.rank, points: r.played ? r.points : undefined });
  };
  const openActor = (a: { actorId: string; actorName: string; actorUsername: string | null; actorAvatar: string | null }) => {
    if (!detail.league.isMember) return;
    setSelected({ userId: a.actorId, username: a.actorUsername, displayName: a.actorName, avatarUrl: a.actorAvatar });
  };

  const { gw, season, month } = detail;
  const phase = PHASE[gw.phase];
  const you = season.find((r) => r.isMe) ?? null;
  const leader = season[0] ?? null;
  const scored = season.some((r) => r.played > 0);
  const gapToFirst = you && leader && !you.isMe ? leader.points - you.points : null;

  // The mini table can show the season race or just this month's — the month
  // competition is what's live now, so it's one tap away on the landing, not
  // buried in the Table tab.
  const [tableTab, setTableTab] = useState<"season" | "month">("season");
  const tblSrc = tableTab === "season" ? season : month.rows;
  const tblTop = tblSrc.slice(0, 4);
  const tblYou = tblSrc.find((r) => r.isMe) ?? null;
  const tblYouBelow = tblYou && !tblTop.some((r) => r.isMe) ? tblYou : null;
  const miniRows: LeagueRow[] = tblYouBelow ? [...tblTop, tblYouBelow] : tblTop;

  const moments = (chat?.moments ?? []).slice(0, 4);
  // System rows (Phase 4b, AC3) are excluded from the preview — they render
  // with a normal author strip here ("You: " / "{name}: "), which would
  // misattribute an auto-posted line ("Gameweek 5 is live") to whichever
  // member's id happened to carry it.
  const preview = (chat?.messages ?? []).filter((m) => m.kind !== "system").slice(-3);

  return (
    <div>
      {/* GAMEWEEK SUMMARY — phase-aware. */}
      <div style={{
        borderRadius: 16, padding: 16, marginBottom: 12,
        background: `linear-gradient(150deg, ${tint(phase.accent, "14")}, ${tint(phase.accent, "03")})`,
        border: `1px solid ${tint(phase.accent, "3a")}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="font-display" style={{ fontSize: 11, letterSpacing: "0.12em", color: phase.accent }}>
            GAMEWEEK {gw.number} · {phase.label}
          </span>
          {gw.phase === "pre" && countdown(gw.deadline) && (
            <span style={{ fontSize: 11.5, color: MUTED }}>Deadline {countdown(gw.deadline)}</span>
          )}
        </div>

        {!scored ? (
          <p className="font-body" style={{ fontSize: 13.5, color: MUTED, margin: "10px 0 0", lineHeight: 1.5 }}>
            Your squad is in. The table fills the moment Gameweek {gw.number} is scored.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {you && (
              <Stat label="Position" value={`${ordinal(you.rank)}`} accent={phase.accent} />
            )}
            {you && you.lastGwPoints !== null && (
              <Stat label={`GW${gw.number} points`} value={`${you.lastGwPoints}`} accent={phase.accent} />
            )}
            {gapToFirst !== null && (
              <Stat label="Gap to first" value={gapToFirst === 0 ? "level" : `${gapToFirst} pts`} accent={phase.accent} />
            )}
            {you?.isMe && you.rank === 1 && scored && (
              <Stat label="You're" value="top" accent={GOLD} />
            )}
          </div>
        )}

        {detail.league.stakes && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: GOLD, fontWeight: 600 }}>🏆 {detail.league.stakes}</div>
        )}
      </div>

      {/* READINESS — pre-deadline only (AC1). */}
      {gw.phase === "pre" && detail.readiness && <Readiness readiness={detail.readiness} />}

      {/* GAMEWEEK RECAP — final phase only (AC2). */}
      {gw.phase === "final" && detail.gwRecap && <GwRecap recap={detail.gwRecap} />}

      {/* MINI TABLE — Season / This month toggle, so both are visible up front. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 10, background: PANEL, border: `1px solid ${LINE}` }}>
          {(["season", "month"] as const).map((t) => {
            const on = tableTab === t;
            const accent = t === "month" ? GOLD : TEAL;
            return (
              <button key={t} onClick={() => setTableTab(t)} style={{
                padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: on ? tint(accent, "22") : "transparent", color: on ? accent : MUTED,
                border: `1px solid ${on ? tint(accent, "55") : "transparent"}`,
              }}>{t === "season" ? "Season" : month.label}</button>
            );
          })}
        </div>
        <span style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          {detail.league.isMember && (
            <button onClick={() => setMembersOpen(true)} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              Members →
            </button>
          )}
          <button onClick={() => onTab("table")} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            Full table →
          </button>
        </span>
      </div>
      <div style={{ marginBottom: 14 }}>
        <LeagueTableRows rows={miniRows} onPeek={detail.league.isMember ? openMember : undefined}
          emptyLabel={tableTab === "month" ? `No scores in ${month.label} yet.` : "No members yet."} />
      </div>

      {/* RIVAL CONTEXT — what the table means. */}
      {you && leader && scored && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 5 }}>YOUR RACE</div>
          <p style={{ fontSize: 13, color: INK, margin: 0, lineHeight: 1.5 }}>
            {you.isMe && you.rank === 1
              ? leader === you && season[1]
                ? `You lead ${nameOf(season[1])} by ${you.points - season[1].points} pts.`
                : "You're top of the table."
              : `You're ${gapToFirst} pts behind ${nameOf(leader)}.`}
          </p>
        </Card>
      )}

      {/* KEY MOMENTS RAIL */}
      {moments.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>KEY MOMENTS</div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {moments.map((m, i) => (
              <button key={i} onClick={() => onTab("chat")} style={{
                flex: "0 0 auto", width: 230, textAlign: "left", cursor: "pointer",
                background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12,
              }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{m.emoji}</div>
                <div style={{ fontSize: 12.5, color: INK, lineHeight: 1.45 }}>{m.text}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* GAMES MODULE — the live/gameday element, so it sits right after the
          table position summary above (Phase 4B module, reordered product
          model 2026-08-07: "what's happening" leads with what's live right
          now, ahead of the recent-activity rail and chat). Hidden outright
          until the pulse actually loads. */}
      {detail.league.isMember && gamesPulse && (() => {
        const live = gamesPulse.activeCompetition?.status === "open";
        return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>GAMES</span>
            </div>
            <Card style={{ marginBottom: 14 }}>
              {live && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: GOLD }} />
                  <span className="font-display" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: GOLD, fontWeight: 800 }}>LIVE NOW</span>
                </div>
              )}
              <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 4 }}>League games</div>
              <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 4px", lineHeight: 1.4 }}>{gamesStatusLine(gamesPulse)}</p>
              {gamesPulse.lastResultLine && (
                <p style={{ fontSize: 11.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.4 }}>{gamesPulse.lastResultLine}</p>
              )}
              {/* Active competition hint (UI wave) — one extra line, tapping
                  goes to Games exactly like "Open Games" below (same onTab).
                  Skipped while live: the LIVE badge + Play now button above
                  already say it, so this line would only repeat itself. */}
              {gamesPulse.activeCompetition && !live && (
                <button onClick={() => { trackGamesHubModuleOpened(); onTab("games"); }} style={{
                  display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
                  padding: 0, margin: "0 0 12px", fontSize: 11.5, color: GOLD, fontWeight: 600, lineHeight: 1.4,
                }}>{competitionHintLine(gamesPulse.activeCompetition)}</button>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: (gamesPulse.lastResultLine || (gamesPulse.activeCompetition && !live)) ? 0 : 8 }}>
                <div style={{ flex: 1 }}>
                  <Btn gold glow={live} onClick={() => { trackGamesHubModuleOpened(); onTab("games"); }}>{live ? "Play now" : "Open Games"}</Btn>
                </div>
                <div style={{ flex: 1 }}>
                  <Btn onClick={() => { trackGamesHubModuleOpened(); onOpenGamesChallenge(); }}>Challenge someone</Btn>
                </div>
              </div>
            </Card>
          </>
        );
      })()}

      {/* HAPPENING NOW — the league's pulse, a swipeable rail into the feed. */}
      <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>HAPPENING NOW</div>
      <LeagueRecentRail code={detail.league.code} onSelect={detail.league.isMember ? openActor : undefined} />

      {/* RECENT CHAT preview — last couple of lines, never the whole thread. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, marginTop: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>RECENT CHAT</span>
      </div>
      <Card style={{ marginBottom: 14 }}>
        {preview.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {preview.slice(-2).map((m) => (
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

      {/* MEMBER PREVIEW — who's in it, a tap from the full member sheet. */}
      {detail.league.isMember && season.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>MEMBERS</div>
          <button onClick={() => setMembersOpen(true)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12, marginBottom: 14,
          }}>
            <span style={{ display: "flex", flexShrink: 0 }}>
              {season.slice(0, 5).map((r, i) => (
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

      {/* SEASON HISTORY — quiet, single row. History lost its own tab pill
          (product model 2026-08-07, four permanent tabs max); this is now
          the way in, alongside the ?t=history deep link. */}
      {detail.league.isMember && (
        <button onClick={() => onTab("history")} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: "10px 0 4px",
          fontSize: 12.5, fontWeight: 600, color: MUTED,
        }}>
          Season history <span style={{ color: TEAL }}>→</span>
        </button>
      )}

      {selected && (
        <MemberActionSheet
          member={selected}
          context="league"
          leagueCode={detail.league.code}
          viewerId={viewerId}
          onClose={() => setSelected(null)}
        />
      )}
      {membersOpen && (
        <LeagueMembersView code={detail.league.code} rows={season} viewerId={viewerId} onClose={() => setMembersOpen(false)} />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: tint(accent, "12"), border: `1px solid ${tint(accent, "33")}`, borderRadius: 12, padding: "8px 12px", minWidth: 0 }}>
      <div className="font-display" style={{ fontSize: 18, fontWeight: 800, color: accent === GOLD ? GOLD : INK, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Waiting on {name}" copy for the readiness rail (AC1) — neutral, no
 *  shaming, at most 2 names then a "+k more" tail (k counts the true total
 *  still out, not just the avatars shown). */
function waitingCopy(waitingCount: number, waitingAvatars: { name: string }[]): string {
  const names = waitingAvatars.slice(0, 2).map((a) => a.name);
  const extra = waitingCount - names.length;
  if (extra > 0) return `Waiting on ${names.join(", ")} +${extra} more`;
  if (names.length === 2) return `Waiting on ${names[0]} and ${names[1]}`;
  return `Waiting on ${names[0] ?? "the rest"}`;
}

/** READINESS — pre-deadline only (AC1). Squads in / total, plus who's still
 *  to build one. `detail.readiness` is null outside the pre phase or if the
 *  server's one extra query came back empty-handed — either way, hide clean. */
function Readiness({ readiness }: { readiness: NonNullable<LeagueDetail["readiness"]> }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>READINESS</div>
      <p style={{ fontSize: 13.5, color: INK, margin: 0, lineHeight: 1.5 }}>
        {readiness.squadsIn} of {readiness.totalMembers} squads in
      </p>
      {readiness.waitingCount > 0 && (
        <>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {readiness.waitingAvatars.map((w) => (
              <PlayerAvatar key={w.userId} name={w.name} avatarUrl={w.avatarUrl} size={26} />
            ))}
          </div>
          <p style={{ fontSize: 12, color: MUTED, margin: "8px 0 0" }}>
            {waitingCopy(readiness.waitingCount, readiness.waitingAvatars)}
          </p>
        </>
      )}
    </Card>
  );
}

/** GAMEWEEK RECAP — final phase only (AC2). Winner always shows; the riser
 *  line only when someone's movement was actually positive (gw1 has nothing
 *  to compare against, so it's winner-only there — same visual language as
 *  the summary card's Stat tiles, gold accent for the win). */
function GwRecap({ recap }: { recap: NonNullable<LeagueDetail["gwRecap"]> }) {
  return (
    <div style={{
      borderRadius: 16, padding: 16, marginBottom: 14,
      background: `linear-gradient(150deg, ${tint(GOLD, "14")}, ${tint(GOLD, "03")})`,
      border: `1px solid ${tint(GOLD, "3a")}`,
    }}>
      <span className="font-display" style={{ fontSize: 11, letterSpacing: "0.12em", color: GOLD }}>
        GAMEWEEK {recap.gw} RECAP
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <PlayerAvatar name={recap.winner.name} avatarUrl={recap.winner.avatarUrl} size={38} ring={GOLD} />
        <div style={{ minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1.2 }}>{recap.winner.name}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Gameweek winner · {recap.winner.points} pts</div>
        </div>
      </div>
      {recap.riser && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${tint(GOLD, "22")}` }}>
          <PlayerAvatar name={recap.riser.name} avatarUrl={recap.riser.avatarUrl} size={26} />
          <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.4 }}>
            <b>{recap.riser.name}</b> climbed {recap.riser.places} place{recap.riser.places === 1 ? "" : "s"} this gameweek.
          </p>
        </div>
      )}
    </div>
  );
}
