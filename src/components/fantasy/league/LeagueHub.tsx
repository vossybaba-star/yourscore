"use client";
/** The League Hub — the default screen. Tells the league's story right now:
 *  the gameweek state, where you stand, the key moments, and the latest banter.
 *  Not a full table or a full chat — it points at both. */
import { useState } from "react";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { LeagueTableRows } from "./LeagueTableRows";
import { LeagueRecentRail } from "./LeagueRecentRail";
import { LeagueMembersView } from "./LeagueMembersView";
import { MemberActionSheet, type MemberActionMember } from "@/components/fantasy/MemberActionSheet";
import { useUser } from "@/hooks/useUser";
import type { ChatData, ChatMessage, LeagueDetail, LeagueRow } from "./types";
import { nameOf } from "./types";

/** A one-line summary of a message for the hub preview. A structured card can't
 *  show its whole self here, so it says what it is in plain words — never the raw
 *  internal body ("shared their captain"), which read as broken third person. */
function previewText(m: ChatMessage): string {
  const mine = m.isMe;
  switch (m.kind) {
    case "player": return `📤 shared ${m.player?.name ?? "a player"}`;
    case "captain": return `Ⓒ captain pick${m.player ? `: ${m.player.name}` : ""}`;
    case "squad": return `👕 shared ${mine ? "your" : "their"} squad`;
    case "news": return `📰 ${m.news?.title ?? "shared some news"}`;
    case "compare": return m.compare ? `⚖️ ${m.compare.a.name} vs ${m.compare.b.name}` : "⚖️ shared a comparison";
    case "poll": return `📊 ${m.poll?.question ?? "started a poll"}`;
    default: return m.body;
  }
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

export function LeagueHub({ detail, chat, onTab }: {
  detail: LeagueDetail;
  chat: ChatData | null;
  onTab: (t: "chat" | "table" | "history") => void;
}) {
  const { user } = useUser();
  const viewerId = user?.id ?? null;
  const [selected, setSelected] = useState<MemberActionMember | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
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

      {/* RECENT ACTIVITY — the league's pulse, a swipeable rail into the feed. */}
      <LeagueRecentRail code={detail.league.code} onSelect={detail.league.isMember ? openActor : undefined} />

      {/* CHAT PREVIEW */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>CHAT</span>
      </div>
      <Card style={{ marginBottom: 12 }}>
        {preview.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {preview.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={22} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: m.isMe ? TEAL : INK }}>{m.isMe ? "You" : m.name}: </span>
                  <span style={{ fontSize: 12.5, color: MUTED, overflowWrap: "anywhere" }}>{previewText(m)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px" }}>Nothing said yet. Someone has to start it.</p>
        )}
        <Btn onClick={() => onTab("chat")}>Open league chat</Btn>
      </Card>

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
