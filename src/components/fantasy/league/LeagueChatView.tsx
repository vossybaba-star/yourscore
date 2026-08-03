"use client";
/** The League Chat — a real group chat. Members' messages are the bulk of it; the
 *  gameweek's moments sit up top as event cards. Members can drop a POLL from the
 *  composer, and a shared PLAYER / SQUAD / CAPTAIN / NEWS / COMPARE card arrives
 *  from around the app. Tap a message to react (full emoji set).
 *
 *  Look: tight, phone-first, colour-coded. Each kind of entry carries its own
 *  accent so the thread reads at a glance (gold = captain, lime = poll, amber =
 *  news, teal = squad intel). The composer is a slim bar PINNED above the nav
 *  (position: fixed — genuinely stays put while the thread scrolls). */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AMBER, CORAL, GOLD, INK, LIME, LINE, MUTED, PANEL, PANEL_2, PITCH, PosTag, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { CHAT_EMOJI, type ChatData, type ChatMessage, type GifCard } from "./types";

async function api(code: string, path: string, body: unknown, method = "POST") {
  const res = await fetch(`/api/fantasy/leagues/${code}/${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

/** The uppercase eyebrow every shared card wears. */
function KindLabel({ text, color }: { text: string; color: string }) {
  return <div className="font-display tracking-widest" style={{ fontSize: 9.5, color, marginBottom: 6 }}>{text}</div>;
}

/** Shell every structured card sits in: tinted border in its own accent. */
function CardShell({ accent, full, children }: { accent: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      // A coloured left stripe + faint wash so the kind reads at a glance, not just
      // a thin tinted border. Same idiom as the feed cards.
      background: `linear-gradient(100deg, ${tint(accent, "12")}, ${PANEL} 60%)`,
      border: `1px solid ${tint(accent, "3a")}`, borderLeft: `3px solid ${accent}`,
      borderRadius: 12,
      padding: 10, width: full ? "100%" : undefined, maxWidth: full ? "100%" : "94%",
      // Squad boards overflow their square a touch at the keeper's name; never clip.
      overflow: full ? "visible" : "hidden",
    }}>{children}</div>
  );
}

/** The reactions strip: pills for what's there, an emoji picker when this message
 *  is tapped. No always-on ＋ button — that padded every message with dead space. */
function Reactions({ msg, onReact, open, readOnly }: { msg: ChatMessage; onReact: (emoji: string, on: boolean) => void; open: boolean; readOnly?: boolean }) {
  if (!msg.reactions.length && !open) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, alignItems: "center" }}>
      {msg.reactions.map((r) => (
        <button key={r.emoji} disabled={readOnly} onClick={(e) => { e.stopPropagation(); onReact(r.emoji, !r.mine); }} style={{
          display: "flex", alignItems: "center", gap: 3, padding: "1px 6px", borderRadius: 999, cursor: readOnly ? "default" : "pointer",
          fontSize: 11.5, lineHeight: 1.6, background: r.mine ? tint(TEAL, "1c") : "rgba(255,255,255,0.04)",
          border: `1px solid ${r.mine ? tint(TEAL, "55") : LINE}`, color: INK,
        }}>
          <span>{r.emoji}</span><span style={{ fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
        </button>
      ))}
      {open && !readOnly && (
        <div style={{ display: "flex", gap: 2, padding: "2px 6px", borderRadius: 999, background: PANEL_2, border: `1px solid ${LINE}` }}>
          {CHAT_EMOJI.map((e) => (
            <button key={e} onClick={(ev) => { ev.stopPropagation(); onReact(e, true); }}
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
  const accent = captain ? GOLD : TEAL;
  const who = msg.isMe ? "YOUR" : `${msg.name.toUpperCase()}'S`;
  return (
    <CardShell accent={accent}>
      <KindLabel color={accent} text={captain ? `${who} CAPTAIN` : (msg.isMe ? "YOU SHARED" : `${msg.name.toUpperCase()} SHARED`)} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={40} ring={captain ? GOLD : undefined} />
          {captain && (
            <span aria-hidden style={{ position: "absolute", top: -4, right: -4, width: 17, height: 17, borderRadius: 999, background: GOLD, color: "#3a2600", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>C</span>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1.2 }}>{p.name}</div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{p.club} · <PosTag pos={p.pos} /> · <span style={{ color: GOLD, fontWeight: 700 }}>£{p.price}m</span></div>
        </div>
      </div>
      {p.note && <p style={{ fontSize: 12.5, color: INK, margin: "8px 0 0", lineHeight: 1.45 }}>{p.note}</p>}
      <button onClick={(e) => { e.stopPropagation(); onView(); }} style={{ marginTop: 8, background: "none", border: "none", color: accent, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
        View player →
      </button>
    </CardShell>
  );
}

function SharedSquad({ msg }: { msg: ChatMessage }) {
  const s = msg.squad!;
  return (
    <CardShell accent={LIME} full>
      <KindLabel color={LIME} text={msg.isMe ? "YOUR SQUAD" : `${msg.name.toUpperCase()}'S SQUAD`} />
      <SquadBoard mode="complete" players={s.players} xi={s.xi} bench={s.bench} captain={s.captain ?? undefined} vice={s.vice ?? undefined} />
    </CardShell>
  );
}

function SharedNews({ msg, onOpen }: { msg: ChatMessage; onOpen: () => void }) {
  const n = msg.news!;
  return (
    <div style={{ background: `linear-gradient(100deg, ${tint(AMBER, "12")}, ${PANEL} 60%)`, border: `1px solid ${tint(AMBER, "3a")}`, borderLeft: `3px solid ${AMBER}`, borderRadius: 12, overflow: "hidden", maxWidth: "94%" }}>
      {n.image && (
        <div style={{ aspectRatio: "16 / 9", background: PITCH, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={n.image} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <div style={{ padding: 10 }}>
        <KindLabel color={AMBER} text={`${msg.isMe ? "YOU SHARED" : `${msg.name.toUpperCase()} SHARED`} · NEWS`} />
        {n.source && <div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>{n.source}</div>}
        <div style={{ fontSize: 13.5, color: INK, fontWeight: 600, lineHeight: 1.35 }}>{n.title}</div>
        {n.url && (
          <button onClick={(e) => { e.stopPropagation(); onOpen(); }} style={{ marginTop: 8, background: "none", border: "none", color: AMBER, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            {n.internal ? "Read →" : "Read the story →"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A GIF someone dropped in the chat. Renders the animated preview at a chat-
 *  friendly width; the aspect ratio is reserved from the stored dims so the
 *  thread doesn't jump as it loads. */
function SharedGif({ msg }: { msg: ChatMessage }) {
  const g = msg.gif!;
  return (
    <div style={{ maxWidth: 200 }}>
      {!msg.isMe && <div style={{ fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 3 }}>{msg.name}</div>}
      <div style={{
        borderRadius: 13, overflow: "hidden", border: `1px solid ${msg.isMe ? tint(TEAL, "44") : LINE}`, background: PANEL,
        aspectRatio: g.width && g.height ? `${g.width} / ${g.height}` : undefined,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={g.preview} alt="GIF" loading="lazy" style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
    </div>
  );
}

function CompareSide({ p, onView }: { p: NonNullable<ChatMessage["compare"]>["a"]; onView: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onView(); }} style={{ flex: 1, minWidth: 0, textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 6px" }}>
      <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={38} />
      <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{p.club} · <PosTag pos={p.pos} /></div>
      <div style={{ fontSize: 11.5, color: GOLD, fontWeight: 700, marginTop: 3 }}>£{p.price}m</div>
    </button>
  );
}

function SharedCompare({ msg, onView }: { msg: ChatMessage; onView: (id: number) => void }) {
  const c = msg.compare!;
  return (
    <CardShell accent={CORAL}>
      <KindLabel color={CORAL} text={`${msg.isMe ? "YOU SHARED" : `${msg.name.toUpperCase()} SHARED`} · COMPARE`} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <CompareSide p={c.a} onView={() => onView(c.a.id)} />
        <span className="font-display" style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>vs</span>
        <CompareSide p={c.b} onView={() => onView(c.b.id)} />
      </div>
    </CardShell>
  );
}

function Poll({ msg, onVote, readOnly }: { msg: ChatMessage; onVote: (i: number) => void; readOnly?: boolean }) {
  const poll = msg.poll!;
  const total = poll.totalVotes;
  return (
    <CardShell accent={LIME}>
      <KindLabel color={LIME} text={`POLL · ${msg.isMe ? "YOU" : msg.name.toUpperCase()}`} />
      <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 9, lineHeight: 1.25 }}>{poll.question}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {poll.options.map((o, i) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const mine = poll.myVote === i;
          return (
            <button key={i} disabled={readOnly} onClick={(e) => { e.stopPropagation(); onVote(i); }} style={{
              position: "relative", overflow: "hidden", textAlign: "left", cursor: readOnly ? "default" : "pointer",
              borderRadius: 8, padding: "8px 10px", background: "rgba(255,255,255,0.03)",
              border: `1px solid ${mine ? tint(LIME, "66") : LINE}`,
            }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`, background: tint(LIME, mine ? "24" : "12") }} />
              <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: INK, fontWeight: mine ? 700 : 500 }}>{o.text}{mine ? " ✓" : ""}</span>
                {total > 0 && <span style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 7 }}>{total} vote{total === 1 ? "" : "s"}{poll.myVote === null ? " · tap to vote" : ""}</div>
    </CardShell>
  );
}

function PollComposer({ onPost, onCancel, busy }: { onPost: (q: string, opts: string[]) => void; onCancel: () => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const set = (i: number, v: string) => setOpts((o) => o.map((x, j) => (j === i ? v : x)));
  const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;
  const inputStyle = { width: "100%", boxSizing: "border-box" as const, fontSize: 13, padding: "8px 11px", borderRadius: 8, background: PANEL_2, border: `1px solid ${LINE}`, color: INK, outline: "none" };
  return (
    <div style={{ background: PANEL, border: `1px solid ${tint(LIME, "3a")}`, borderRadius: 12, padding: 11, marginBottom: 8 }}>
      <KindLabel color={LIME} text="NEW POLL" />
      <input value={q} maxLength={120} placeholder="Ask the league something…" onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {opts.map((o, i) => (
          <input key={i} value={o} maxLength={60} placeholder={`Option ${i + 1}`} onChange={(e) => set(i, e.target.value)} style={inputStyle} />
        ))}
      </div>
      {opts.length < 4 && (
        <button onClick={() => setOpts((o) => [...o, ""])} style={{ background: "none", border: "none", color: LIME, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "7px 0 0" }}>
          + Add option
        </button>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        <button disabled={busy || !valid} onClick={() => onPost(q.trim(), opts.map((o) => o.trim()).filter(Boolean))}
          style={{ padding: "8px 16px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: valid && !busy ? "pointer" : "default",
            background: valid ? LIME : PANEL_2, color: valid ? "#12200a" : MUTED, border: `1px solid ${valid ? LIME : LINE}`, opacity: busy ? 0.5 : 1 }}>Post poll</button>
        <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: MUTED, border: `1px solid ${LINE}` }}>Cancel</button>
      </div>
    </div>
  );
}

/** The bubble/card for one message, minus the reactions row. */
function MessageBody({ m, onView, onOpenNews, onVote, readOnly }: {
  m: ChatMessage; onView: (id: number) => void; onOpenNews: (m: ChatMessage) => void; onVote: (i: number) => void; readOnly?: boolean;
}) {
  if ((m.kind === "player" || m.kind === "captain") && m.player) return <SharedPlayer msg={m} onView={() => onView(m.player!.id)} />;
  if (m.kind === "squad" && m.squad) return <SharedSquad msg={m} />;
  if (m.kind === "news" && m.news) return <SharedNews msg={m} onOpen={() => onOpenNews(m)} />;
  if (m.kind === "compare" && m.compare) return <SharedCompare msg={m} onView={onView} />;
  if (m.kind === "gif" && m.gif) return <SharedGif msg={m} />;
  if (m.kind === "poll" && m.poll) return <Poll msg={m} onVote={onVote} readOnly={readOnly} />;
  return (
    <div style={{
      background: m.isMe ? tint(TEAL, "1c") : PANEL, border: `1px solid ${m.isMe ? tint(TEAL, "44") : LINE}`,
      borderRadius: 13, padding: "6px 11px", minWidth: 0,
    }}>
      {!m.isMe && <div style={{ fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 1 }}>{m.name}</div>}
      <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.body}</div>
    </div>
  );
}

type GifResult = { id: string; url: string; preview: string; width: number; height: number };

/** The GIF picker sheet — sits above the composer like the poll composer.
 *  Trending on open, search-as-you-type after that. Degrades to a friendly
 *  message when the provider key isn't set (the route answers 503). */
function GifPicker({ onPick, onCancel, busy }: { onPick: (g: GifCard) => void; onCancel: () => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<GifResult[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const gifInput = { width: "100%", boxSizing: "border-box" as const, fontSize: 13, padding: "8px 11px", borderRadius: 8, background: PANEL_2, border: `1px solid ${LINE}`, color: INK, outline: "none" };

  useEffect(() => {
    let live = true;
    const run = async () => {
      setItems(null); setUnavailable(false);
      try {
        const res = await fetch(`/api/fantasy/gif${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
        if (res.status === 503) { if (live) { setUnavailable(true); setItems([]); } return; }
        const d = await res.json().catch(() => ({ results: [] }));
        if (live) setItems(d.results ?? []);
      } catch { if (live) setItems([]); }
    };
    // Debounce searches; load trending immediately on open.
    const t = setTimeout(run, q.trim() ? 350 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <div style={{ marginBottom: 8, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <input autoFocus value={q} maxLength={80} placeholder="Search GIFs…" onChange={(e) => setQ(e.target.value)} style={gifInput} />
        <button onClick={onCancel} style={{ background: "none", border: "none", color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "0 4px" }}>Close</button>
      </div>
      {unavailable ? (
        <p style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "14px 8px", lineHeight: 1.5 }}>GIFs aren&apos;t switched on yet. Back soon.</p>
      ) : items === null ? (
        <p style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "14px 8px" }}>Loading GIFs…</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: 12.5, color: MUTED, textAlign: "center", padding: "14px 8px" }}>No GIFs found. Try another search.</p>
      ) : (
        <div style={{ columnCount: 2, columnGap: 6, maxHeight: 260, overflowY: "auto" }}>
          {items.map((g) => (
            <button key={g.id} disabled={busy} onClick={() => onPick({ url: g.url, preview: g.preview, width: g.width, height: g.height })}
              style={{ display: "block", width: "100%", marginBottom: 6, padding: 0, border: `1px solid ${LINE}`, borderRadius: 9, overflow: "hidden", background: PITCH, cursor: busy ? "default" : "pointer", breakInside: "avoid" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.preview} alt="" loading="lazy" style={{ width: "100%", height: "auto", display: "block" }} />
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 9.5, color: MUTED, textAlign: "right", marginTop: 4, letterSpacing: "0.04em" }}>via Tenor</div>
    </div>
  );
}

export function LeagueChatView({ code, initialGw = null }: { code: string; initialGw?: number | null }) {
  const router = useRouter();
  const [chat, setChat] = useState<ChatData | null>(null);
  const [viewGw, setViewGw] = useState<number | null>(initialGw);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [poll, setPoll] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [reactFor, setReactFor] = useState<string | null>(null);

  const load = useCallback(async (gw: number | null) => {
    try {
      const res = await fetch(`/api/fantasy/leagues/${code}/chat${gw != null ? `?gw=${gw}` : ""}`);
      if (res.ok) setChat(await res.json());
    } catch { /* keep prior state */ }
  }, [code]);
  useEffect(() => { load(viewGw); }, [viewGw, load]);
  // Poll the LIVE thread only — an archive never changes.
  useEffect(() => {
    if (!chat || chat.readOnly) return;
    const t = setInterval(() => load(viewGw), 15_000);
    return () => clearInterval(t);
  }, [chat, viewGw, load]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(viewGw); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const send = () => { const t = draft.trim(); if (!t) return; guard(async () => { await api(code, "chat", { body: t }); setDraft(""); }); };
  const react = (id: string, emoji: string, on: boolean) => { setReactFor(null); guard(() => api(code, "react", { commentId: id, emoji, on })); };
  const vote = (id: string, i: number) => guard(() => api(code, "poll", { commentId: id, optionIndex: i }, "PATCH"));
  const postPoll = (q: string, opts: string[]) => guard(async () => { await api(code, "poll", { question: q, options: opts }); setPoll(false); });
  const sendGif = (g: GifCard) => guard(async () => { await api(code, "chat", { kind: "gif", gif: g }); setGifOpen(false); });
  const shareSquad = () => guard(async () => { await api(code, "share", { kind: "squad" }); setMenu(false); });
  const shareCaptain = () => guard(async () => { await api(code, "share", { kind: "captain" }); setMenu(false); });
  const openNews = (m: ChatMessage) => { const n = m.news!; if (n.internal) router.push(n.url); else window.open(n.url, "_blank", "noopener,noreferrer"); };

  // Tap anywhere on a message (but not on a control inside it) to react.
  const tapMessage = (id: string, e: React.MouseEvent) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    setReactFor((prev) => (prev === id ? null : id));
  };

  if (!chat) return <p style={{ fontSize: 13, color: MUTED }}>Loading chat…</p>;
  const readOnly = chat.readOnly;
  const canSend = !!draft.trim() && !busy;
  // Most recent gameweeks first, capped so the selector stays thumb-sized.
  const gwChips = [...chat.gameweeks].sort((a, b) => b - a).slice(0, 6);

  return (
    <div>
      {/* Gameweek selector — the live gameweek plus its archives. */}
      {chat.gameweeks.length > 1 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
          {gwChips.map((g) => {
            const on = g === chat.gw;
            return (
              <button key={g} onClick={() => setViewGw(g === chat.currentGw ? null : g)} style={{
                flex: "0 0 auto", padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                background: on ? tint(TEAL, "22") : PANEL, color: on ? TEAL : MUTED,
                border: `1px solid ${on ? tint(TEAL, "66") : LINE}`,
              }}>GW{g}</button>
            );
          })}
        </div>
      )}

      {readOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: "6px 11px" }}>
          <span className="font-display tracking-widest" style={{ fontSize: 9.5, color: MUTED }}>{chat.notice ? "VIEWING" : "ARCHIVE"}</span>
          <span style={{ fontSize: 12.5, color: MUTED }}>{chat.notice ?? `Gameweek ${chat.gw} chat · read-only`}</span>
        </div>
      )}

      {chat.league.stakes && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, background: tint(GOLD, "10"), border: `1px solid ${tint(GOLD, "3a")}`, borderRadius: 10, padding: "6px 11px" }}>
          <span className="font-display tracking-widest" style={{ fontSize: 9.5, color: GOLD }}>STAKES</span>
          <span style={{ fontSize: 12.5, color: GOLD, fontWeight: 600 }}>🏆 {chat.league.stakes}</span>
        </div>
      )}

      {chat.moments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {chat.moments.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: `linear-gradient(150deg, ${tint(TEAL, "10")}, ${PANEL})`, border: `1px solid ${tint(TEAL, "2a")}`, borderRadius: 12, padding: "8px 11px" }}>
              <span style={{ fontSize: 17, lineHeight: 1.2 }}>{m.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div className="font-display tracking-widest" style={{ fontSize: 9, color: TEAL, marginBottom: 2 }}>GW{m.gw} · LEAGUE EVENT</div>
                <div style={{ fontSize: 12.5, color: INK, lineHeight: 1.4 }}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The thread. Tight rhythm — messages sit close, cards breathe. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {!chat.messages.length && (
          <p style={{ fontSize: 12.5, color: MUTED, margin: "2px 0", textAlign: "center", padding: "18px 0" }}>Nothing said yet. Someone has to start it.</p>
        )}
        {chat.messages.map((m) => {
          const structured = m.kind !== "text";
          const mine = m.isMe && !structured;
          return (
            <div key={m.id} onClick={(e) => tapMessage(m.id, e)}
              style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", cursor: readOnly ? "default" : "pointer" }}>
              <div style={{ display: "flex", gap: 7, maxWidth: m.kind === "squad" ? "100%" : "94%", width: m.kind === "squad" ? "100%" : undefined, flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end" }}>
                {!mine && !structured && <PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={22} />}
                <MessageBody m={m} onView={(id) => router.push(`/fantasy/players/${id}`)} onOpenNews={openNews} onVote={(i) => vote(m.id, i)} readOnly={readOnly} />
              </div>
              <div style={{ maxWidth: "94%", paddingLeft: mine ? 0 : (structured ? 2 : 29) }}>
                <Reactions msg={m} onReact={(emoji, on) => react(m.id, emoji, on)} open={reactFor === m.id} readOnly={readOnly} />
              </div>
            </div>
          );
        })}
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}

      {/* Space for the fixed composer + the (tall, two-line) bottom nav so the
          last message never hides behind either. */}
      {!readOnly && <div style={{ height: 96 }} />}

      {/* Composer — FIXED just above the bottom nav, so it never scrolls away. An
          archived gameweek takes no new posts. */}
      {!readOnly && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 30,
          background: "rgba(9,14,11,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          borderTop: `1px solid ${LINE}`,
        }}>
          <div style={{ maxWidth: 512, margin: "0 auto", padding: "7px 14px" }}>
            {poll && <PollComposer onPost={postPoll} onCancel={() => setPoll(false)} busy={busy} />}
            {gifOpen && <GifPicker onPick={sendGif} onCancel={() => setGifOpen(false)} busy={busy} />}
            {menu && !poll && !gifOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <MenuChip onClick={() => { setGifOpen(true); setMenu(false); }} accent={CORAL}>GIF</MenuChip>
                <MenuChip onClick={() => { setPoll(true); setMenu(false); }} accent={LIME}>📊 Poll</MenuChip>
                <MenuChip onClick={shareSquad} accent={TEAL} disabled={busy}>👕 Share my squad</MenuChip>
                <MenuChip onClick={shareCaptain} accent={GOLD} disabled={busy}>Ⓒ Share my captain</MenuChip>
              </div>
            )}
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <button onClick={() => setMenu((v) => !v)} aria-label="Share to the league" style={{
                width: 32, height: 32, flexShrink: 0, borderRadius: 999, cursor: "pointer", fontSize: 18, lineHeight: 1,
                background: menu ? tint(TEAL, "22") : PANEL_2, border: `1px solid ${menu ? tint(TEAL, "66") : LINE}`, color: menu ? TEAL : MUTED,
                display: "flex", alignItems: "center", justifyContent: "center", transform: menu ? "rotate(45deg)" : "none", transition: "transform .15s",
              }}>＋</button>
              <input value={draft} maxLength={280} placeholder="Message the league…"
                onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "7px 14px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" }} />
              <button onClick={send} disabled={!canSend} aria-label="Send" style={{
                width: 32, height: 32, flexShrink: 0, borderRadius: 999, cursor: canSend ? "pointer" : "default", fontSize: 16, lineHeight: 1,
                background: canSend ? TEAL : PANEL_2, color: canSend ? "#03211d" : MUTED, border: `1px solid ${canSend ? TEAL : LINE}`,
                display: "flex", alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1, fontWeight: 800,
              }}>↑</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A composer share option — a rounded chip carrying its target's accent. */
function MenuChip({ children, onClick, accent, disabled }: { children: React.ReactNode; onClick: () => void; accent: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: disabled ? "default" : "pointer",
      background: tint(accent, "14"), color: accent, border: `1px solid ${tint(accent, "40")}`, opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}
