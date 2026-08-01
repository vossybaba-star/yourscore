"use client";
/** The League Chat — a real group chat. Members' messages are the bulk of it;
 *  the gameweek's derived moments sit at the top as event cards to react to.
 *  Full emoji reactions on every message. (Shared cards + polls come in Phase 1b.) */
import { useState } from "react";
import { Btn, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { CHAT_EMOJI, type ChatData, type ChatMessage } from "./types";

async function api(code: string, path: string, body: unknown) {
  const res = await fetch(`/api/fantasy/leagues/${code}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

function Reactions({ msg, onReact }: { msg: ChatMessage; onReact: (emoji: string, on: boolean) => void }) {
  const [pick, setPick] = useState(false);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5, alignItems: "center" }}>
      {msg.reactions.map((r) => (
        <button key={r.emoji} onClick={() => onReact(r.emoji, !r.mine)} style={{
          display: "flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 999, cursor: "pointer",
          fontSize: 12, background: r.mine ? tint(TEAL, "1c") : "rgba(255,255,255,0.04)",
          border: `1px solid ${r.mine ? tint(TEAL, "66") : LINE}`, color: INK,
        }}>
          <span>{r.emoji}</span><span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
        </button>
      ))}
      <button onClick={() => setPick((p) => !p)} aria-label="Add reaction" style={{
        width: 24, height: 22, borderRadius: 999, cursor: "pointer", fontSize: 13, lineHeight: 1,
        background: "rgba(255,255,255,0.04)", border: `1px solid ${LINE}`, color: MUTED,
      }}>＋</button>
      {pick && (
        <div style={{ display: "flex", gap: 4, padding: "3px 6px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}` }}>
          {CHAT_EMOJI.map((e) => (
            <button key={e} onClick={() => { onReact(e, true); setPick(false); }}
              style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer", padding: 1 }}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeagueChatView({ chat, code, onReload }: {
  chat: ChatData; code: string; onReload: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null);
    try { await api(code, "chat", { body: text }); setDraft(""); onReload(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const react = async (commentId: string, emoji: string, on: boolean) => {
    try { await api(code, "react", { commentId, emoji, on }); onReload(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div>
      {/* Pinned: the stakes line. */}
      {chat.league.stakes && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
          background: PANEL, border: `1px solid ${tint(GOLD, "44")}`, borderRadius: 10, padding: "8px 11px",
        }}>
          <span style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED }}>PINNED</span>
          <span style={{ fontSize: 12.5, color: GOLD, fontWeight: 600 }}>🏆 {chat.league.stakes}</span>
        </div>
      )}

      {/* This week's moments as event cards, above the conversation. */}
      {chat.moments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {chat.moments.map((m, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              background: `linear-gradient(150deg, ${tint(TEAL, "10")}, ${PANEL})`,
              border: `1px solid ${tint(TEAL, "2a")}`, borderRadius: 12, padding: 11,
            }}>
              <span style={{ fontSize: 20 }}>{m.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: TEAL, marginBottom: 3 }}>GW{m.gw} · LEAGUE EVENT</div>
                <div style={{ fontSize: 12.5, color: INK, lineHeight: 1.45 }}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The conversation. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {!chat.messages.length && (
          <p style={{ fontSize: 12.5, color: MUTED, margin: "2px 0" }}>Nothing said yet. Someone has to start it.</p>
        )}
        {chat.messages.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.isMe ? "flex-end" : "flex-start" }}>
            <div style={{ display: "flex", gap: 8, maxWidth: "88%", flexDirection: m.isMe ? "row-reverse" : "row" }}>
              {!m.isMe && <PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={26} />}
              <div style={{
                background: m.isMe ? tint(TEAL, "1c") : PANEL, border: `1px solid ${m.isMe ? tint(TEAL, "55") : LINE}`,
                borderRadius: 12, padding: "7px 11px", minWidth: 0,
              }}>
                {!m.isMe && <div style={{ fontSize: 10.5, color: INK, fontWeight: 700, marginBottom: 1 }}>{m.name}</div>}
                <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.body}</div>
              </div>
            </div>
            <div style={{ maxWidth: "88%", paddingLeft: m.isMe ? 0 : 34 }}>
              <Reactions msg={m} onReact={(emoji, on) => react(m.id, emoji, on)} />
            </div>
          </div>
        ))}
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "0 0 8px" }}>{err}</p>}

      {/* Composer. */}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={draft} maxLength={280} placeholder="Message the league…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          style={{ flex: 1, fontSize: 13.5, padding: "10px 12px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" }} />
        <Btn gold disabled={busy || !draft.trim()} onClick={send}>Send</Btn>
      </div>
    </div>
  );
}
