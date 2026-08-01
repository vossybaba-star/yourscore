"use client";
/** The League Chat — a real group chat. Members' messages are the bulk of it; the
 *  gameweek's moments sit up top as event cards. Members can drop a POLL from the
 *  composer, and a shared PLAYER card arrives from a player's profile. Full emoji
 *  reactions on every message. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { CHAT_EMOJI, type ChatData, type ChatMessage } from "./types";

async function api(code: string, path: string, body: unknown, method = "POST") {
  const res = await fetch(`/api/fantasy/leagues/${code}/${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
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

function SharedPlayer({ msg, onView }: { msg: ChatMessage; onView: () => void }) {
  const p = msg.player!;
  const captain = msg.kind === "captain";
  const who = msg.isMe ? "YOUR" : `${msg.name.toUpperCase()}'S`;
  return (
    <div style={{ background: PANEL, border: `1px solid ${captain ? tint(GOLD, "44") : LINE}`, borderRadius: 12, padding: 12, maxWidth: "92%" }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: captain ? GOLD : TEAL, marginBottom: 8 }}>
        {captain ? `${who} CAPTAIN` : (msg.isMe ? "YOU SHARED" : `${msg.name.toUpperCase()} SHARED`)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={44} ring={captain ? GOLD : undefined} />
          {captain && (
            <span aria-hidden style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: 999, background: GOLD, color: "#3a2600", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>C</span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1.2 }}>{p.name}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{p.club} · {p.pos} · <span style={{ color: GOLD, fontWeight: 700 }}>£{p.price}m</span></div>
        </div>
      </div>
      {p.note && <p style={{ fontSize: 13, color: INK, margin: "9px 0 0", lineHeight: 1.45 }}>{p.note}</p>}
      <button onClick={onView} style={{ marginTop: 10, background: "none", border: "none", color: TEAL, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
        View player →
      </button>
    </div>
  );
}

function SharedSquad({ msg }: { msg: ChatMessage }) {
  const s = msg.squad!;
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, width: "100%" }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: TEAL, marginBottom: 8 }}>{msg.isMe ? "YOUR SQUAD" : `${msg.name.toUpperCase()}'S SQUAD`}</div>
      <SquadBoard mode="complete" players={s.players} xi={s.xi} bench={s.bench} captain={s.captain ?? undefined} vice={s.vice ?? undefined} />
    </div>
  );
}

function Poll({ msg, onVote }: { msg: ChatMessage; onVote: (i: number) => void }) {
  const poll = msg.poll!;
  const total = poll.totalVotes;
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, maxWidth: "92%" }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: TEAL, marginBottom: 6 }}>POLL · {msg.isMe ? "YOU" : msg.name}</div>
      <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: INK, marginBottom: 10, lineHeight: 1.25 }}>{poll.question}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {poll.options.map((o, i) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const mine = poll.myVote === i;
          return (
            <button key={i} onClick={() => onVote(i)} style={{
              position: "relative", overflow: "hidden", textAlign: "left", cursor: "pointer",
              borderRadius: 9, padding: "9px 11px", background: "rgba(255,255,255,0.03)",
              border: `1px solid ${mine ? tint(TEAL, "66") : LINE}`,
            }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`, background: tint(TEAL, mine ? "22" : "12") }} />
              <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: INK, fontWeight: mine ? 700 : 500 }}>{o.text}{mine ? " ✓" : ""}</span>
                {total > 0 && <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>{total} vote{total === 1 ? "" : "s"}{poll.myVote === null ? " · tap to vote" : ""}</div>
    </div>
  );
}

function PollComposer({ onPost, onCancel, busy }: { onPost: (q: string, opts: string[]) => void; onCancel: () => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const set = (i: number, v: string) => setOpts((o) => o.map((x, j) => (j === i ? v : x)));
  const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;
  const inputStyle = { width: "100%", boxSizing: "border-box" as const, fontSize: 13.5, padding: "9px 11px", borderRadius: 9, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" };
  return (
    <div style={{ background: PANEL, border: `1px solid ${tint(TEAL, "3a")}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.1em", color: TEAL, marginBottom: 8 }}>NEW POLL</div>
      <input value={q} maxLength={120} placeholder="Ask the league something…" onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {opts.map((o, i) => (
          <input key={i} value={o} maxLength={60} placeholder={`Option ${i + 1}`} onChange={(e) => set(i, e.target.value)} style={inputStyle} />
        ))}
      </div>
      {opts.length < 4 && (
        <button onClick={() => setOpts((o) => [...o, ""])} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "8px 0 0" }}>
          + Add option
        </button>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn small gold disabled={busy || !valid} onClick={() => onPost(q.trim(), opts.map((o) => o.trim()).filter(Boolean))}>Post poll</Btn>
        <Btn small onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

export function LeagueChatView({ chat, code, onReload }: { chat: ChatData; code: string; onReload: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [poll, setPoll] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); onReload(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const send = () => { const t = draft.trim(); if (!t) return; guard(async () => { await api(code, "chat", { body: t }); setDraft(""); }); };
  const react = (id: string, emoji: string, on: boolean) => guard(() => api(code, "react", { commentId: id, emoji, on }));
  const vote = (id: string, i: number) => guard(() => api(code, "poll", { commentId: id, optionIndex: i }, "PATCH"));
  const postPoll = (q: string, opts: string[]) => guard(async () => { await api(code, "poll", { question: q, options: opts }); setPoll(false); });
  const shareSquad = () => guard(async () => { await api(code, "share", { kind: "squad" }); setMenu(false); });
  const shareCaptain = () => guard(async () => { await api(code, "share", { kind: "captain" }); setMenu(false); });

  return (
    <div>
      {chat.league.stakes && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, background: PANEL, border: `1px solid ${tint(GOLD, "44")}`, borderRadius: 10, padding: "8px 11px" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED }}>PINNED</span>
          <span style={{ fontSize: 12.5, color: GOLD, fontWeight: 600 }}>🏆 {chat.league.stakes}</span>
        </div>
      )}

      {chat.moments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {chat.moments.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: `linear-gradient(150deg, ${tint(TEAL, "10")}, ${PANEL})`, border: `1px solid ${tint(TEAL, "2a")}`, borderRadius: 12, padding: 11 }}>
              <span style={{ fontSize: 20 }}>{m.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9.5, letterSpacing: "0.1em", color: TEAL, marginBottom: 3 }}>GW{m.gw} · LEAGUE EVENT</div>
                <div style={{ fontSize: 12.5, color: INK, lineHeight: 1.45 }}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {!chat.messages.length && <p style={{ fontSize: 12.5, color: MUTED, margin: "2px 0" }}>Nothing said yet. Someone has to start it.</p>}
        {chat.messages.map((m) => {
          const structured = m.kind !== "text";
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.isMe && !structured ? "flex-end" : "flex-start" }}>
              <div style={{ display: "flex", gap: 8, maxWidth: "92%", flexDirection: m.isMe && !structured ? "row-reverse" : "row" }}>
                {!m.isMe && !structured && <PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={26} />}
                {(m.kind === "player" || m.kind === "captain") && m.player ? (
                  <SharedPlayer msg={m} onView={() => router.push(`/fantasy/players/${m.player!.id}`)} />
                ) : m.kind === "squad" && m.squad ? (
                  <SharedSquad msg={m} />
                ) : m.kind === "poll" && m.poll ? (
                  <Poll msg={m} onVote={(i) => vote(m.id, i)} />
                ) : (
                  <div style={{ background: m.isMe ? tint(TEAL, "1c") : PANEL, border: `1px solid ${m.isMe ? tint(TEAL, "55") : LINE}`, borderRadius: 12, padding: "7px 11px", minWidth: 0 }}>
                    {!m.isMe && <div style={{ fontSize: 10.5, color: INK, fontWeight: 700, marginBottom: 1 }}>{m.name}</div>}
                    <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.body}</div>
                  </div>
                )}
              </div>
              <div style={{ maxWidth: "92%", paddingLeft: m.isMe && !structured ? 0 : (structured ? 0 : 34) }}>
                <Reactions msg={m} onReact={(emoji, on) => react(m.id, emoji, on)} />
              </div>
            </div>
          );
        })}
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "0 0 8px" }}>{err}</p>}

      {poll && <PollComposer onPost={postPoll} onCancel={() => setPoll(false)} busy={busy} />}

      {/* Composer plus-menu: poll + share your own squad/captain. Other content
          (a player, a scout pick) is shared from its own screen. */}
      {menu && !poll && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          <Btn small onClick={() => { setPoll(true); setMenu(false); }}>📊 Poll</Btn>
          <Btn small disabled={busy} onClick={shareSquad}>👕 Share my squad</Btn>
          <Btn small disabled={busy} onClick={shareCaptain}>©️ Share my captain</Btn>
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => setMenu((v) => !v)} aria-label="More" style={{ width: 42, flexShrink: 0, borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, color: MUTED, fontSize: 20, cursor: "pointer" }}>＋</button>
        <input value={draft} maxLength={280} placeholder="Message the league…"
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          style={{ flex: 1, fontSize: 13.5, padding: "10px 12px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" }} />
        <Btn gold disabled={busy || !draft.trim()} onClick={send}>Send</Btn>
      </div>
    </div>
  );
}
