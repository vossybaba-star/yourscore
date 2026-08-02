"use client";
/** The League Hub — the default screen. Tells the league's story right now:
 *  the gameweek state, where you stand, the key moments, and the latest banter.
 *  Not a full table or a full chat — it points at both. */
import { useState } from "react";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { LeagueTableRows } from "./LeagueTableRows";
import { LeagueRecentRail } from "./LeagueRecentRail";
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
  const preview = (chat?.messages ?? []).slice(-3);

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
        <button onClick={() => onTab("table")} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, flexShrink: 0 }}>
          Full table →
        </button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <LeagueTableRows rows={miniRows}
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
      <LeagueRecentRail code={detail.league.code} />

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
