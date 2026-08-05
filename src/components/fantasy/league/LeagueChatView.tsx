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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AMBER, CORAL, GOLD, INK, LIME, LINE, MUTED, PANEL, PANEL_2, PITCH, PosTag, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { MediaGallery } from "@/components/fantasy/MediaGallery";
import { uploadPostImage } from "@/lib/postMedia";
import { ReportSheet } from "@/components/social/ReportSheet";
import { CHAT_EMOJI, summariseChatMessage, type ChatData, type ChatMessage, type GifCard } from "./types";
import { trackBlockUser, trackMuteUser, trackPollVoted, trackReactionAdded, trackMentionAutocompleteOpened, trackMentionSelected, trackMentionPublished } from "@/lib/analytics/trackSocial";
import { mentionQueryAt, applyMention, MentionDropdown, type MentionUser, type MentionEntity } from "@/components/fantasy/MentionAutocomplete";

async function api(code: string, path: string, body: unknown, method = "POST") {
  const res = await fetch(`/api/fantasy/leagues/${code}/${path}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

/** Same 5-minute window that decides both grouping and where a fresh timestamp
 *  is warranted (AC3). */
const GROUP_WINDOW_MS = 5 * 60_000;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** For each message: whether it leads a new sender-group (avatar + name show)
 *  and whether it's the last of its group (timestamp shows). */
function chatGroups(messages: ChatMessage[]): { showHeader: boolean; showTimestamp: boolean }[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const t = new Date(m.createdAt).getTime();
    // A system row (Phase 4b, AC3) never groups with anything either side — it
    // renders on its own (SystemLine, below) and shouldn't make the message
    // above or below it think it's continuing a run just because the actor id
    // happens to line up (a join line is authored by the joiner; a gw-live or
    // lead-change line by the league owner).
    const sameAsPrev = !!prev && prev.userId === m.userId && prev.kind !== "system" && m.kind !== "system"
      && t - new Date(prev.createdAt).getTime() <= GROUP_WINDOW_MS;
    const sameAsNext = !!next && next.userId === m.userId && next.kind !== "system" && m.kind !== "system"
      && new Date(next.createdAt).getTime() - t <= GROUP_WINDOW_MS;
    return { showHeader: !sameAsPrev, showTimestamp: !sameAsNext };
  });
}

/** A system line (Phase 4b, AC3) — centred, muted, no avatar or bubble, never
 *  tappable (no reactions/reply/pin — it isn't a member's message). */
function SystemLine({ text }: { text: string }) {
  return (
    <div style={{ textAlign: "center", margin: "6px 0" }}>
      <span style={{ fontSize: 11.5, color: MUTED }}>{text}</span>
    </div>
  );
}

/** Scroll a message into view if it's loaded in the current window (a reply's
 *  parent or the pinned message might be off in an earlier page/archive —
 *  scrollIntoView is simply a no-op then, per spec). A brief highlight ring
 *  helps a manager actually spot which bubble the tap landed on. */
function scrollToMessage(id: string) {
  const el = document.getElementById(`chat-msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.outline = `2px solid ${TEAL}`; el.style.outlineOffset = "3px";
  setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 1000);
}

/** The uppercase eyebrow every shared card wears. */
function KindLabel({ text, color }: { text: string; color: string }) {
  return <div className="font-display tracking-widest" style={{ fontSize: 9.5, color, marginBottom: 6 }}>{text}</div>;
}

/** A plain-text message body with any @username token that resolved to a
 *  real profile (m.mentionedUsers, Phase 1A — server-preferred from stored
 *  payload.mentions, regex+resolve fallback for a legacy message) turned
 *  into a link to that profile. An unresolved handle (typo, no such user, or
 *  a non-"text" kind that never carries mentionedUsers) stays plain text.
 *  Same idiom as FeedStream's LinkedText / DiscussionThread's
 *  renderMentionBody, just chat-scoped (no URL linkification — chat bodies
 *  don't unfurl links today). */
function LinkedChatText({ body, mentions }: { body: string; mentions?: { username: string; userId: string }[] | null }) {
  const byHandle = new Map((mentions ?? []).map((m) => [m.username.toLowerCase(), m.userId]));
  if (!byHandle.size) return <>{body}</>;
  const parts = body.split(/(@[a-zA-Z0-9_]{2,30})/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          const uid = byHandle.get(part.slice(1).toLowerCase());
          if (uid) {
            return (
              <Link key={i} href={`/profile/${uid}`} onClick={(e) => e.stopPropagation()}
                style={{ color: TEAL, fontWeight: 700, textDecoration: "none" }}>{part}</Link>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
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

/** The reactions strip: pills for what's there, an emoji picker + the Reply/Pin
 *  action row when this message is tapped. No always-on ＋ button — that padded
 *  every message with dead space, so Reply/Pin ride the exact same tap-to-open
 *  gesture reactions already use (AC2/AC6). */
function Reactions({ msg, onReact, open, readOnly, canReply, onReply, canPin, isPinned, onPin, onReport, onBlock, onMute, onDelete }: {
  msg: ChatMessage; onReact: (emoji: string, on: boolean) => void; open: boolean; readOnly?: boolean;
  canReply?: boolean; onReply?: () => void;
  canPin?: boolean; isPinned?: boolean; onPin?: () => void;
  /** Report/Block/Mute the message's author (Phase 5a) — never shown for your
   *  own message. Delete is the reverse: only ever shown for your own. */
  onReport?: () => void; onBlock?: () => void; onMute?: () => void; onDelete?: () => void;
}) {
  const showActions = open && !readOnly;
  if (!msg.reactions.length && !open) return null;
  const actionBtn: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: "2px 8px", borderRadius: 999,
    background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, alignItems: "center" }}>
      {msg.reactions.map((r) => (
        <button key={r.emoji} disabled={readOnly} onClick={(e) => { e.stopPropagation(); onReact(r.emoji, !r.mine); }}
          aria-label={`${r.emoji} reaction, ${r.count}${r.mine ? ", you reacted" : ""}`} aria-pressed={r.mine} style={{
          display: "flex", alignItems: "center", gap: 3, padding: "1px 6px", minHeight: 32, borderRadius: 999, cursor: readOnly ? "default" : "pointer",
          fontSize: 11.5, lineHeight: 1.6, background: r.mine ? tint(TEAL, "1c") : "rgba(255,255,255,0.04)",
          border: `1px solid ${r.mine ? tint(TEAL, "55") : LINE}`, color: INK,
        }}>
          <span aria-hidden>{r.emoji}</span><span aria-hidden style={{ fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
        </button>
      ))}
      {open && !readOnly && (
        <div role="group" aria-label="Reactions" style={{ display: "flex", gap: 2, padding: "2px 6px", borderRadius: 999, background: PANEL_2, border: `1px solid ${LINE}` }}>
          {CHAT_EMOJI.map((e) => (
            <button key={e} onClick={(ev) => { ev.stopPropagation(); trackReactionAdded(e); onReact(e, true); }}
              aria-label={`React with ${e}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 36, minHeight: 36, fontSize: 16, background: "none", border: "none", cursor: "pointer", padding: 1 }}>{e}</button>
          ))}
        </div>
      )}
      {showActions && canReply && (
        <button onClick={(e) => { e.stopPropagation(); onReply?.(); }} style={actionBtn}>↩ Reply</button>
      )}
      {showActions && canPin && (
        <button onClick={(e) => { e.stopPropagation(); onPin?.(); }} style={{ ...actionBtn, color: GOLD, borderColor: tint(GOLD, "44") }}>
          {isPinned ? "Unpin" : "📌 Pin"}
        </button>
      )}
      {/* Report/Block/Mute (Phase 5a) — never on your own message; Delete is
          the reverse. Each handler is only ever passed in for the case it
          applies to (see LeagueChatView's Reactions call site), so no extra
          isMe check is needed here. */}
      {showActions && onReport && (
        <button onClick={(e) => { e.stopPropagation(); onReport(); }} style={actionBtn}>🚩 Report</button>
      )}
      {showActions && onBlock && (
        <button onClick={(e) => { e.stopPropagation(); onBlock(); }} style={actionBtn}>Block</button>
      )}
      {showActions && onMute && (
        <button onClick={(e) => { e.stopPropagation(); onMute(); }} style={actionBtn}>Mute</button>
      )}
      {showActions && onDelete && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...actionBtn, color: "#E08A6B", borderColor: "rgba(224,138,107,0.4)" }}>Delete</button>
      )}
    </div>
  );
}

/** A photo dropped straight into the chat (AC4) — a compact rounded thumb,
 *  never full bubble height, tapping opens the shared full-screen gallery. */
function SharedImage({ msg, onView }: { msg: ChatMessage; onView: () => void }) {
  const im = msg.image!;
  return (
    <div style={{ maxWidth: 220 }}>
      {!msg.isMe && <div style={{ fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 3 }}>{msg.name}</div>}
      <button onClick={(e) => { e.stopPropagation(); onView(); }} style={{
        display: "block", padding: 0, cursor: "pointer", borderRadius: 13, overflow: "hidden", background: PANEL,
        border: `1px solid ${msg.isMe ? tint(TEAL, "44") : LINE}`,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={im.url} alt="" loading="lazy" style={{ display: "block", maxHeight: 240, maxWidth: "100%", width: "auto", objectFit: "cover" }} />
      </button>
    </div>
  );
}

/** A feed post shared into the chat (AC5) — compact pointer card, resolved
 *  fresh server-side each read. Renders the muted stub when the post's gone. */
function SharedFeedPost({ msg, onView }: { msg: ChatMessage; onView: () => void }) {
  const f = msg.feed!;
  const label = msg.isMe ? "YOU SHARED" : `${msg.name.toUpperCase()} SHARED`;
  if (!f.available) {
    return (
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10, maxWidth: "94%" }}>
        <KindLabel color={MUTED} text={label} />
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>This post isn&apos;t available anymore.</p>
      </div>
    );
  }
  return (
    <CardShell accent={TEAL}>
      <KindLabel color={TEAL} text={`${label} · POST`} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <PlayerAvatar name={f.actorName ?? "Player"} avatarUrl={f.actorAvatarUrl} size={22} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{f.actorName ?? "Player"}</span>
      </div>
      <div style={{
        fontSize: 13, color: INK, lineHeight: 1.4,
        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>{f.text ?? f.summary}</div>
      <button onClick={(e) => { e.stopPropagation(); onView(); }} style={{ marginTop: 8, background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
        View post →
      </button>
    </CardShell>
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
              minHeight: 44, display: "flex", alignItems: "center",
              borderRadius: 8, padding: "8px 10px", background: "rgba(255,255,255,0.03)",
              border: `1px solid ${mine ? tint(LIME, "66") : LINE}`,
            }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`, background: tint(LIME, mine ? "24" : "12") }} />
              <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: INK, fontWeight: mine ? 700 : 500 }}>{o.text}{mine ? " ✓" : ""}</span>
                {total > 0 && <span style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      {/* aria-live (AC5): announces the result once a vote lands. */}
      <div aria-live="polite" style={{ fontSize: 10.5, color: MUTED, marginTop: 7 }}>{total} vote{total === 1 ? "" : "s"}{poll.myVote === null ? " · tap to vote" : ""}</div>
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

/** The bubble/card for one message, minus the reactions row. `showHeader` is
 *  the sender-grouping signal (AC3) — only the first bubble of a same-sender
 *  run within 5 minutes carries the name. */
function MessageBody({ m, onView, onOpenNews, onVote, onViewImage, onViewFeed, readOnly, showHeader = true }: {
  m: ChatMessage; onView: (id: number) => void; onOpenNews: (m: ChatMessage) => void; onVote: (i: number) => void;
  onViewImage: (url: string) => void; onViewFeed: (eventId: string) => void;
  readOnly?: boolean; showHeader?: boolean;
}) {
  if ((m.kind === "player" || m.kind === "captain") && m.player) return <SharedPlayer msg={m} onView={() => onView(m.player!.id)} />;
  if (m.kind === "squad" && m.squad) return <SharedSquad msg={m} />;
  if (m.kind === "news" && m.news) return <SharedNews msg={m} onOpen={() => onOpenNews(m)} />;
  if (m.kind === "compare" && m.compare) return <SharedCompare msg={m} onView={onView} />;
  if (m.kind === "gif" && m.gif) return <SharedGif msg={m} />;
  if (m.kind === "image" && m.image) return <SharedImage msg={m} onView={() => onViewImage(m.image!.url)} />;
  if (m.kind === "feed" && m.feed) return <SharedFeedPost msg={m} onView={() => onViewFeed(m.feed!.eventId)} />;
  if (m.kind === "poll" && m.poll) return <Poll msg={m} onVote={onVote} readOnly={readOnly} />;
  return (
    <div style={{
      background: m.isMe ? tint(TEAL, "1c") : PANEL, border: `1px solid ${m.isMe ? tint(TEAL, "44") : LINE}`,
      borderRadius: 13, padding: "6px 11px", minWidth: 0,
    }}>
      {!m.isMe && showHeader && <div style={{ fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 1 }}>{m.name}</div>}
      <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.4, overflowWrap: "anywhere" }}>
        <LinkedChatText body={m.body} mentions={m.mentionedUsers} />
      </div>
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
  // AC2 — the message being replied to (composer switches into reply mode).
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // AC4 — the image currently open full-screen.
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 5a — the message currently being reported (opens the sheet).
  const [reportFor, setReportFor] = useState<ChatMessage | null>(null);

  // @mention autocomplete (Phase 1A) — the composer's caret position and the
  // entities picked from autocomplete, same pattern CreatePostSheet/
  // DiscussionThread use. Members are ranked FIRST and matched INSTANTLY
  // (local, no request) via the roster fetched once below; a remote leg
  // (global mode=mention search — already followed-first, block-filtered)
  // is layered in for non-members from 2+ chars, debounced.
  const draftInputRef = useRef<HTMLInputElement>(null);
  const [draftCaret, setDraftCaret] = useState(0);
  const [draftMentions, setDraftMentions] = useState<MentionEntity[]>([]);
  const draftMentionQuery = mentionQueryAt(draft, draftCaret, 1); // 1 char — member roster is local + instant
  const mentionOpenRef = useRef(false);
  useEffect(() => {
    if (draftMentionQuery && !mentionOpenRef.current) { mentionOpenRef.current = true; trackMentionAutocompleteOpened("chat"); }
    if (!draftMentionQuery) mentionOpenRef.current = false;
  }, [draftMentionQuery]);

  // The league roster — fetched ONCE on mount (id/username/display_name/
  // avatar_url only, see leagueMembers() in lib/fantasy/chat.ts — deliberately
  // lighter than leagueDetail). Blocked accounts are already excluded
  // server-side.
  const [members, setMembers] = useState<MentionUser[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => {
        if (!live) return;
        type RawMember = { userId: string; username: string | null; displayName: string | null; avatarUrl: string | null };
        setMembers(
          ((d.members ?? []) as RawMember[])
            .filter((m): m is RawMember & { username: string } => !!m.username)
            .map((m) => ({ userId: m.userId, username: m.username, displayName: m.displayName ?? `@${m.username}`, avatarUrl: m.avatarUrl })),
        );
      })
      .catch(() => {});
    return () => { live = false; };
  }, [code]);

  // The dropdown's pluggable results source (Phase 1A) — members matched
  // locally and instantly at @ + 1 char; from 2+ chars, a debounced (~200ms)
  // remote leg merges in global matches (followed-first, block-filtered by
  // the endpoint itself), deduped against the local roster by userId. A
  // generation token supersedes — rather than cancels — a stale in-flight
  // leg: the actual fetch is skipped entirely if a newer keystroke landed
  // during the debounce window, and its result is discarded if one landed
  // while the fetch itself was in flight.
  const remoteTokenRef = useRef(0);
  const mentionResults = useCallback(async (query: string): Promise<MentionUser[]> => {
    const q = query.toLowerCase();
    const local = members
      .filter((m) => m.username.toLowerCase().startsWith(q) || m.displayName.toLowerCase().startsWith(q))
      .slice(0, 8);
    if (query.length < 2) return local;
    const myToken = ++remoteTokenRef.current;
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (remoteTokenRef.current !== myToken) return local; // superseded — skip firing the fetch at all
    try {
      const res = await fetch(`/api/fantasy/users/search?q=${encodeURIComponent(query)}&limit=8&mode=mention`);
      if (remoteTokenRef.current !== myToken) return local; // superseded while in flight
      const d = res.ok ? await res.json() : { users: [] };
      const localIds = new Set(local.map((m) => m.userId));
      const remote = ((d.users ?? []) as MentionUser[]).filter((u) => !localIds.has(u.userId));
      return [...local, ...remote].slice(0, 8);
    } catch { return local; }
  }, [members]);
  const pickMention = (u: MentionUser) => {
    const next = applyMention(draft, draftCaret, u.username);
    setDraft(next.text.slice(0, 280));
    setDraftCaret(next.caret);
    setDraftMentions((prev) => [...prev, { userId: u.userId, usernameSnapshot: u.username }]);
    trackMentionSelected("chat");
    requestAnimationFrame(() => { draftInputRef.current?.focus(); draftInputRef.current?.setSelectionRange(next.caret, next.caret); });
  };

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
  const parentId = replyTo?.id;
  const send = () => {
    const t = draft.trim();
    if (!t) return;
    const sentMentions = draftMentions;
    guard(async () => {
      await api(code, "chat", { body: t, parentId, mentions: sentMentions.length ? sentMentions : undefined });
      if (sentMentions.length) trackMentionPublished("chat", sentMentions.length);
      setDraft(""); setDraftMentions([]); setReplyTo(null);
    });
  };
  const react = (id: string, emoji: string, on: boolean) => { setReactFor(null); guard(() => api(code, "react", { commentId: id, emoji, on })); };
  const vote = (id: string, i: number) => { trackPollVoted(); guard(() => api(code, "poll", { commentId: id, optionIndex: i }, "PATCH")); };
  const postPoll = (q: string, opts: string[]) => guard(async () => { await api(code, "poll", { question: q, options: opts, parentId }); setPoll(false); setReplyTo(null); });
  const sendGif = (g: GifCard) => guard(async () => { await api(code, "chat", { kind: "gif", gif: g, parentId }); setGifOpen(false); setReplyTo(null); });
  const shareSquad = () => guard(async () => { await api(code, "share", { kind: "squad", parentId }); setMenu(false); setReplyTo(null); });
  const shareCaptain = () => guard(async () => { await api(code, "share", { kind: "captain", parentId }); setMenu(false); setReplyTo(null); });
  const openNews = (m: ChatMessage) => { const n = m.news!; if (n.internal) router.push(n.url); else window.open(n.url, "_blank", "noopener,noreferrer"); };
  const openFeed = (eventId: string) => router.push(`/fantasy/social/post/${eventId}`);
  const startReply = (m: ChatMessage) => { setReactFor(null); setReplyTo(m); };
  const pin = (id: string) => { setReactFor(null); guard(() => api(code, "chat", { kind: "pin", commentId: id }, "PATCH")); };
  const unpin = () => guard(() => api(code, "chat", { kind: "unpin" }, "PATCH"));

  // Delete/Block/Mute (Phase 5a) — reuse the existing comments DELETE (soft
  // delete, ownership-checked server-side) for a message, and the same
  // report/block/mute endpoints the feed uses. guard() reloads the thread
  // after each, so a block/mute's server-side filter (hiddenActorIds) takes
  // effect immediately rather than waiting for the 15s poll.
  const deleteMsg = (m: ChatMessage) => {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    setReactFor(null);
    guard(async () => {
      await fetch("/api/comments", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: m.id }) });
    });
  };
  const blockAuthor = (m: ChatMessage) => {
    if (!window.confirm(`Block ${m.name}? You won't see each other's posts, and you'll stop following each other.`)) return;
    setReactFor(null);
    guard(async () => {
      await fetch("/api/social/block", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: m.userId }) });
      trackBlockUser();
    });
  };
  const muteAuthor = (m: ChatMessage) => {
    if (!window.confirm(`Mute ${m.name}? Their messages won't show for you.`)) return;
    setReactFor(null);
    guard(async () => {
      await fetch("/api/social/mute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: m.userId }) });
      trackMuteUser();
    });
  };

  // AC4 — pick + upload one image, then post it (own busy/err handling since it
  // wraps an upload step guard() doesn't know about).
  const pickImage = () => { setMenu(false); fileInputRef.current?.click(); };
  const onImageChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy(true); setErr(null);
    try {
      const url = await uploadPostImage(file);
      await api(code, "chat", { kind: "image", image: { url }, parentId });
      setReplyTo(null);
      await load(viewGw);
    } catch (imgErr) { setErr((imgErr as Error).message); }
    setBusy(false);
  };

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
  const groups = chatGroups(chat.messages);

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

      {/* Pinned-message banner (AC6) — slim, sits above the moments/thread.
          Absent entirely when nothing's pinned or the schema doesn't support
          it yet (chat.pinned comes back null either way). */}
      {chat.pinned && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, background: tint(GOLD, "10"), border: `1px solid ${tint(GOLD, "3a")}`, borderRadius: 10, padding: "6px 11px" }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>📌</span>
          <button onClick={() => scrollToMessage(chat.pinned!.id)} style={{
            flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0,
          }}>
            <div style={{ fontSize: 9.5, color: GOLD, fontWeight: 700 }}>{chat.pinned.name}</div>
            <div style={{ fontSize: 12, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chat.pinned.summary}</div>
          </button>
          {chat.league.isOwner && chat.capabilities.pin && (
            <button onClick={unpin} disabled={busy} style={{
              flexShrink: 0, fontSize: 11, color: MUTED, background: "none", border: `1px solid ${LINE}`, borderRadius: 999,
              padding: "3px 9px", cursor: busy ? "default" : "pointer",
            }}>Unpin</button>
          )}
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
        {chat.messages.map((m, i) => {
          // System rows (Phase 4b, AC3) render on their own, before any of the
          // bubble/avatar/reactions machinery below applies.
          if (m.kind === "system") return <SystemLine key={m.id} text={m.body} />;
          const structured = m.kind !== "text";
          const mine = m.isMe && !structured;
          // AC3 — grouping: only the group's first bubble shows avatar/name;
          // a hidden avatar still reserves its column so continuation bubbles
          // stay indented under the one above.
          const { showHeader, showTimestamp } = groups[i];
          return (
            <div key={m.id} id={`chat-msg-${m.id}`} onClick={(e) => tapMessage(m.id, e)}
              style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", cursor: readOnly ? "default" : "pointer" }}>
              {/* AC2 — the quoted-context strip for a reply. Tap scrolls to the
                  parent when it's loaded in this window. */}
              {m.replyTo && (
                <button onClick={(e) => { e.stopPropagation(); if (m.parentId) scrollToMessage(m.parentId); }} style={{
                  display: "block", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 3,
                  maxWidth: "94%", alignSelf: mine ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    display: "inline-flex", flexDirection: "column", gap: 1, padding: "4px 9px", borderRadius: 8,
                    background: PANEL_2, border: `1px solid ${LINE}`, borderLeft: `2px solid ${TEAL}`, maxWidth: 240,
                  }}>
                    <span style={{ fontSize: 9.5, color: TEAL, fontWeight: 700 }}>{m.replyTo.name}</span>
                    <span style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.replyTo.summary}</span>
                  </div>
                </button>
              )}
              <div style={{ display: "flex", gap: 7, maxWidth: m.kind === "squad" ? "100%" : "94%", width: m.kind === "squad" ? "100%" : undefined, flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end" }}>
                {!mine && !structured && (showHeader
                  ? <PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={22} />
                  : <span aria-hidden style={{ width: 22, flexShrink: 0 }} />)}
                <MessageBody m={m} onView={(id) => router.push(`/fantasy/players/${id}`)} onOpenNews={openNews}
                  onVote={(i2) => vote(m.id, i2)} onViewImage={setGalleryUrl} onViewFeed={openFeed}
                  readOnly={readOnly} showHeader={showHeader} />
              </div>
              <div style={{ maxWidth: "94%", paddingLeft: mine ? 0 : (structured ? 2 : 29) }}>
                {/* Replies are ONE level deep (the comments table's reply
                    trigger, migration 221) — no Reply control on a message
                    that's already a reply, so every reply targets a top-level
                    message. */}
                <Reactions msg={m} onReact={(emoji, on) => react(m.id, emoji, on)} open={reactFor === m.id} readOnly={readOnly}
                  canReply={chat.capabilities.replies && !m.parentId} onReply={() => startReply(m)}
                  canPin={chat.capabilities.pin && chat.league.isOwner} isPinned={chat.pinned?.id === m.id} onPin={() => pin(m.id)}
                  onReport={m.isMe ? undefined : () => setReportFor(m)}
                  onBlock={m.isMe ? undefined : () => blockAuthor(m)}
                  onMute={m.isMe ? undefined : () => muteAuthor(m)}
                  onDelete={m.isMe ? () => deleteMsg(m) : undefined} />
                {/* AC3 — timestamp on the last bubble of a sender-group. */}
                {showTimestamp && (
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>{clock(m.createdAt)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}

      {/* Space for the fixed composer + the (tall, two-line) bottom nav so the
          last message never hides behind either. */}
      {!readOnly && <div style={{ height: 96 }} />}

      {/* Full-screen gallery for a chat image (AC4) — the shared viewer. */}
      {galleryUrl && <MediaGallery images={[galleryUrl]} index={0} onClose={() => setGalleryUrl(null)} />}

      {/* Report sheet (Phase 5a) — portaled, same component the feed and
          profile use. */}
      {reportFor && <ReportSheet subjectType="comment" subjectId={reportFor.id} onClose={() => setReportFor(null)} />}

      {/* Composer — FIXED just above the bottom nav, so it never scrolls away. An
          archived gameweek takes no new posts. */}
      {!readOnly && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 30,
          background: "rgba(9,14,11,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          borderTop: `1px solid ${LINE}`,
        }}>
          <div style={{ maxWidth: 512, margin: "0 auto", padding: "7px 14px" }}>
            {/* AC2 — reply mode: a compact quoted strip, × to cancel. */}
            {replyTo && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "6px 10px", borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}`, borderLeft: `2px solid ${TEAL}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: TEAL, fontWeight: 700 }}>Replying to {replyTo.name}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summariseChatMessage(replyTo)}</div>
                </div>
                <button onClick={() => setReplyTo(null)} aria-label="Cancel reply" style={{
                  display: "flex", alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44,
                  background: "none", border: "none", color: MUTED, fontSize: 16, cursor: "pointer", lineHeight: 1,
                }}>×</button>
              </div>
            )}
            {poll && <PollComposer onPost={postPoll} onCancel={() => setPoll(false)} busy={busy} />}
            {gifOpen && <GifPicker onPick={sendGif} onCancel={() => setGifOpen(false)} busy={busy} />}
            {menu && !poll && !gifOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                <MenuChip onClick={pickImage} accent={TEAL} disabled={busy}>📷 Photo</MenuChip>
                <MenuChip onClick={() => { setGifOpen(true); setMenu(false); }} accent={CORAL}>GIF</MenuChip>
                <MenuChip onClick={() => { setPoll(true); setMenu(false); }} accent={LIME}>📊 Poll</MenuChip>
                <MenuChip onClick={shareSquad} accent={TEAL} disabled={busy}>👕 Share my squad</MenuChip>
                <MenuChip onClick={shareCaptain} accent={GOLD} disabled={busy}>Ⓒ Share my captain</MenuChip>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageChosen} style={{ display: "none" }} />
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <button onClick={() => setMenu((v) => !v)} aria-label="Share to the league" aria-expanded={menu} style={{
                width: 44, height: 44, flexShrink: 0, borderRadius: 999, cursor: "pointer", fontSize: 18, lineHeight: 1,
                background: menu ? tint(TEAL, "22") : PANEL_2, border: `1px solid ${menu ? tint(TEAL, "66") : LINE}`, color: menu ? TEAL : MUTED,
                display: "flex", alignItems: "center", justifyContent: "center", transform: menu ? "rotate(45deg)" : "none", transition: "transform .15s",
              }}>＋</button>
              <input ref={draftInputRef} value={draft} maxLength={280} placeholder={replyTo ? "Write a reply…" : "Message the league…"}
                aria-label="Message the league"
                onChange={(e) => { setDraft(e.target.value); setDraftCaret(e.currentTarget.selectionStart ?? 0); }}
                onKeyUp={(e) => setDraftCaret(e.currentTarget.selectionStart ?? 0)}
                onClick={(e) => setDraftCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "7px 14px", minHeight: 44, boxSizing: "border-box", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" }} />
              <button onClick={send} disabled={!canSend} aria-label="Send" style={{
                width: 44, height: 44, flexShrink: 0, borderRadius: 999, cursor: canSend ? "pointer" : "default", fontSize: 16, lineHeight: 1,
                background: canSend ? TEAL : PANEL_2, color: canSend ? "#03211d" : MUTED, border: `1px solid ${canSend ? TEAL : LINE}`,
                display: "flex", alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1, fontWeight: 800,
              }}>↑</button>
            </div>
            <MentionDropdown query={draftMentionQuery} onSelect={pickMention} results={mentionResults} />
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
