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
import { AMBER, CORAL, ErrorState, GOLD, INK, LIME, LINE, Loading, MUTED, PANEL, PANEL_2, PITCH, PosTag, Sheet, Skel, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { MediaGallery } from "@/components/fantasy/MediaGallery";
import { uploadPostImage } from "@/lib/postMedia";
import { uploadPostVideo, validateAndProbeVideo, PostVideoError } from "@/lib/postVideo";
import { InlineVideoPlayer } from "@/components/fantasy/VideoPlayer";
import { ReportSheet } from "@/components/social/ReportSheet";
import { CHAT_EMOJI, summariseChatMessage, type ChatData, type ChatMessage, type ChallengeCard, type CompetitionCard, type GifCard } from "./types";
import { competitionResultLine, type CompetitionFormatId } from "@/lib/fantasy/competitions-pure";
import {
  trackBlockUser, trackMuteUser, trackPollVoted, trackReactionAdded, trackMentionAutocompleteOpened, trackMentionSelected, trackMentionPublished, trackVideoChatMessageSent,
  trackChallengeRematchStarted,
} from "@/lib/analytics/trackSocial";
import { acceptChallengeAction, declineChallengeAction, cancelChallengeAction, ChallengeActionConflict } from "@/lib/fantasy/challengeClientActions";
import { mentionQueryAt, applyMention, MentionDropdown, type MentionUser, type MentionEntity } from "@/components/fantasy/MentionAutocomplete";
import { MemberActionSheet, type MemberActionMember } from "@/components/fantasy/MemberActionSheet";
import { ChallengePrepSheet } from "@/components/fantasy/ChallengePrepSheet";
import { useUser } from "@/hooks/useUser";

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
        <button onClick={(e) => { e.stopPropagation(); onPin?.(); }} style={{ ...actionBtn, display: "flex", alignItems: "center", gap: 4, color: GOLD, borderColor: tint(GOLD, "44") }}>
          {isPinned ? "Unpin" : <><ChipIcon d={CHIP_ICON.pin} />Pin</>}
        </button>
      )}
      {/* Report/Block/Mute (Phase 5a) — never on your own message; Delete is
          the reverse. Each handler is only ever passed in for the case it
          applies to (see LeagueChatView's Reactions call site), so no extra
          isMe check is needed here. */}
      {showActions && onReport && (
        <button onClick={(e) => { e.stopPropagation(); onReport(); }} style={{ ...actionBtn, display: "flex", alignItems: "center", gap: 4 }}>
          <ChipIcon d={CHIP_ICON.flag} />Report
        </button>
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

function fmtChatVideoDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** A video dropped straight into the chat (Phase 2c) — a compact poster tile
 *  (play glyph + duration chip), same footprint as SharedImage's thumb. Tap
 *  swaps in the real player IN PLACE — autoPlay={false} always, chat never
 *  autoplays a video, single-active-player/session-sound still apply. */
function SharedVideo({ msg }: { msg: ChatMessage }) {
  const v = msg.video!;
  const [open, setOpen] = useState(false);
  if (open) {
    // Explicit width, not just maxWidth — the chat bubble sizes to content, and
    // the player's aspect-ratio box resolves against an auto-width parent as
    // ~0px (it collapsed to a 2px sliver on tap before this).
    return (
      <div style={{ width: "min(240px, 72vw)" }}>
        {!msg.isMe && <div style={{ fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 3 }}>{msg.name}</div>}
        <InlineVideoPlayer video={v} autoPlay={false} />
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 220 }}>
      {!msg.isMe && <div style={{ fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 3 }}>{msg.name}</div>}
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label="Play video" style={{
        position: "relative", display: "block", padding: 0, cursor: "pointer", borderRadius: 13, overflow: "hidden",
        background: PANEL, border: `1px solid ${msg.isMe ? tint(TEAL, "44") : LINE}`, width: 180, height: 180,
      }}>
        {v.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.posterUrl} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: PANEL_2 }} />
        )}
        <span aria-hidden style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: 38, height: 38, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
        </span>
        {v.durationMs > 0 && (
          <span style={{ position: "absolute", right: 6, bottom: 6, padding: "2px 6px", borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10.5, fontWeight: 700 }}>
            {fmtChatVideoDuration(v.durationMs)}
          </span>
        )}
      </button>
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
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{
          flex: 1, minWidth: 0, fontSize: 13, color: INK, lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{f.text ?? f.summary}</div>
        {/* The shared post's own thumbnail (Phase 2c) — first image, GIF
            still, or a video post's poster; never re-uploaded. */}
        {f.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.image} alt="" loading="lazy" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
        )}
      </div>
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

/** No dashes anywhere in user-visible copy (house rule) — dates read
 *  "5 Aug", never "2026-08-05". */
function expiryLine(iso: string): string {
  return `Expires ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** The league-mate challenge card (Phase 1C, lifecycle Phase 3A) — GOLD
 *  accent (a challenge is a stake, same family as the STAKES banner above).
 *  Fully status- and viewer-aware: every rendered action is real (calls the
 *  matching /api/fantasy/challenges/[id]/* route and refreshes) — a state
 *  with nothing actionable gets a plain status line, never a dead button.
 *
 *  One-tap accept (product decision, locked): "Play" IS acceptance — no
 *  separate Accept step. Decline stays its own action. Cancel (the
 *  challenger's withdraw) and decline are both "quiet" — no shaming line,
 *  just a muted terminal status once they land. */
function ChallengeCardMsg({ msg, viewerId, onDecline, onCancel, onAccept, onRematch, busy }: {
  msg: ChatMessage; viewerId: string | null;
  onDecline: (challengeId: string, gameType: string) => void; onCancel: (challengeId: string, gameType: string) => void;
  onAccept: (challengeId: string, h2hId: string | null, gameType: string) => void;
  /** Phase 3C — the completed card's Rematch action, below. Always passed;
   *  the card itself decides whether to render it (participants only). */
  onRematch: (challenge: ChallengeCard) => void;
  busy: boolean;
}) {
  const c = msg.challenge!;
  const viewerIsOpponent = !!viewerId && viewerId === c.opponentId;
  const viewerIsChallenger = !!viewerId && viewerId === c.challengerId;
  const winnerName = c.winnerId === c.challengerId ? c.challengerName : c.winnerId === c.opponentId ? c.opponentName : null;
  const mutedLine = (text: string) => <div style={{ fontSize: 12, color: MUTED }}>{text}</div>;
  return (
    <CardShell accent={GOLD}>
      <KindLabel color={GOLD} text="CHALLENGE" />
      <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: INK, lineHeight: 1.3, marginBottom: 3 }}>
        {c.challengerName} challenged {c.opponentName}
      </div>
      {c.message && (
        <div style={{
          fontSize: 12, color: MUTED, fontStyle: "italic", lineHeight: 1.4,
          borderLeft: `2px solid ${tint(GOLD, "66")}`, padding: "1px 0 1px 9px", margin: "2px 0 8px",
        }}>“{c.message}”</div>
      )}
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 9 }}>{c.gameName} · {c.quizName}</div>

      {c.status === "pending" && viewerIsOpponent && (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={busy} onClick={(e) => { e.stopPropagation(); onAccept(c.challengeId, c.h2hId, c.gameType); }} style={{
            flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
            background: tint(GOLD, "22"), color: GOLD, border: `1px solid ${tint(GOLD, "66")}`, opacity: busy ? 0.6 : 1,
          }}>Play</button>
          <button disabled={busy} onClick={(e) => { e.stopPropagation(); onDecline(c.challengeId, c.gameType); }} style={{
            flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
            background: PANEL_2, color: MUTED, border: `1px solid ${LINE}`, opacity: busy ? 0.6 : 1,
          }}>Decline</button>
        </div>
      )}
      {c.status === "pending" && !viewerIsOpponent && (
        <div>
          {mutedLine(`Waiting for ${c.opponentName}`)}
          <div style={{ display: "flex", gap: 12, marginTop: 5, alignItems: "center" }}>
            {viewerIsChallenger && (
              <button disabled={busy} onClick={(e) => { e.stopPropagation(); onCancel(c.challengeId, c.gameType); }} style={{
                padding: 0, fontSize: 11.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
                background: "none", border: "none", color: MUTED, textDecoration: "underline", opacity: busy ? 0.6 : 1,
              }}>Cancel</button>
            )}
            {/* Duel only (Phase 3B): the challenger playing their OWN side is
                NOT acceptance — a plain link, no onAccept call, unlike the
                opponent's Play button above (product decision, locked). */}
            {viewerIsChallenger && c.gameMode === "duel" && c.h2hId && (
              <Link href={`/h2h/${c.h2hId}`} onClick={(e) => e.stopPropagation()} style={{
                fontSize: 11.5, fontWeight: 700, color: GOLD, textDecoration: "none",
              }}>Play your side</Link>
            )}
          </div>
        </div>
      )}
      {c.status === "active" && (
        <div>
          {mutedLine(`${c.opponentName} is on it`)}
          {/* A real play destination only — a "#" link is a dead button in
              disguise (house rule). h2hId is always set once accepted. */}
          {viewerIsOpponent && c.h2hId && (
            <Link href={`/h2h/${c.h2hId}`} onClick={(e) => e.stopPropagation()} style={{
              display: "inline-block", marginTop: 6, fontSize: 12, fontWeight: 700, color: GOLD, textDecoration: "none",
            }}>Back in</Link>
          )}
        </div>
      )}
      {/* Duel only (Phase 3B) — one side has played, the other hasn't. Only
          ever names WHO'S played, never a score (challengerDone/opponentDone
          are booleans, nothing more — see challenges.ts's challengeCardsFor). */}
      {c.status === "awaiting_opponent" && (() => {
        const doneName = c.challengerDone ? c.challengerName : c.opponentName;
        const notDoneIsViewer = c.challengerDone ? viewerIsOpponent : viewerIsChallenger;
        const notDoneName = c.challengerDone ? c.opponentName : c.challengerName;
        return (
          <div>
            {mutedLine(`${doneName} has played. Waiting for ${notDoneName}.`)}
            {notDoneIsViewer && c.h2hId && (
              <Link href={`/h2h/${c.h2hId}`} onClick={(e) => e.stopPropagation()} style={{
                display: "inline-block", marginTop: 6, fontSize: 12, fontWeight: 700, color: GOLD, textDecoration: "none",
              }}>Play</Link>
            )}
          </div>
        );
      })()}
      {c.status === "completed" && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{winnerName ? `${winnerName} won` : "It finished level"}</div>
          <div style={{ display: "flex", gap: 14, marginTop: 4, alignItems: "center" }}>
            {c.h2hId && (
              <Link href={`/h2h/${c.h2hId}`} onClick={(e) => e.stopPropagation()} style={{
                fontSize: 12, fontWeight: 700, color: GOLD, textDecoration: "none",
              }}>See the scores</Link>
            )}
            {/* Rematch (Phase 3C) — the two participants only, same "no dead
                ends on a finished challenge" rule the member sheet's chip
                follows. Opens the prep sheet at the LeagueChatView level
                (below) rather than anything owned by this card. */}
            {(viewerIsChallenger || viewerIsOpponent) && (
              <button onClick={(e) => { e.stopPropagation(); onRematch(c); }} style={{
                padding: 0, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: "none", border: "none", color: GOLD, textDecoration: "underline",
              }}>Rematch</button>
            )}
          </div>
        </div>
      )}
      {c.status === "declined" && mutedLine(`${c.opponentName} passed`)}
      {c.status === "expired" && mutedLine("This one expired")}
      {c.status === "cancelled" && mutedLine(`${c.challengerName} withdrew it`)}

      {(c.status === "pending" || c.status === "awaiting_opponent") && (
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 8 }}>{expiryLine(c.expiresAt)}</div>
      )}
    </CardShell>
  );
}

/** The Phase 3A compact result "ping" (kind: "challenge_result") — one new
 *  line dropped into chat when a challenge completes, distinct from the
 *  original CHALLENGE card above updating in place (product decision,
 *  locked: both happen). No accent shell, no actions — just the outcome and
 *  a link, so it doesn't visually compete with the card it's reporting on. */
function ChallengeResultLine({ challenge: c }: { challenge: ChallengeCard }) {
  const winnerName = c.winnerId === c.challengerId ? c.challengerName : c.winnerId === c.opponentId ? c.opponentName : null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, background: PANEL, border: `1px solid ${tint(GOLD, "2a")}`,
      borderRadius: 10, padding: "8px 11px",
    }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
        <path d="M8 21h8M12 17v4M6 4h12v3a6 6 0 01-12 0V4z" />
        <path d="M6 6H4a2 2 0 002 4M18 6h2a2 2 0 01-2 4" />
      </svg>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
        {winnerName ? `${winnerName} won the challenge` : "The challenge finished level"}
      </span>
      {c.h2hId && (
        <Link href={`/h2h/${c.h2hId}`} onClick={(e) => e.stopPropagation()} style={{
          marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: GOLD, textDecoration: "none", flexShrink: 0,
        }}>See scores</Link>
      )}
    </div>
  );
}

/** "3rd of 8" — same ordinal idiom LeagueHub/LeagueHistoryView/LeagueTableView
 *  each already carry their own copy of (per-file duplication, this
 *  codebase's own established idiom for a one-line display helper). */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** A competition's opens/closes line — the exact same no-dash, day-month
 *  date expression expiryLine (above) already uses for a challenge, just
 *  parameterised for "Opens"/"Closes" rather than a fixed "Expires". */
function competitionWindowLine(prefix: string, iso: string): string {
  return `${prefix} ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** "You scored 42. You're 3rd of 8. Provisional." — a live/pre-lock read
 *  only (c.provisional is always true whenever myEntry is non-null here); a
 *  live position must never read as a final result (house rule). */
function myCompetitionLine(c: CompetitionCard): string | null {
  const e = c.myEntry;
  if (!e) return null;
  if (c.format === "beat_target") {
    return e.result === "placed"
      ? `You scored ${e.score}. You've beaten the target. Provisional.`
      : `You scored ${e.score}. Short of the target so far. Provisional.`;
  }
  const pos = e.rank != null ? `${ordinal(e.rank)} of ${c.entrantCount}` : `of ${c.entrantCount}`;
  return `You scored ${e.score}. You're ${pos}. Provisional.`;
}

/** The settled outcome line — off the SAME competitionResultLine
 *  competitions.ts's own settle path uses for the chat result ping and the
 *  notification body, so this card never grows a second copy of that
 *  wording. */
function competitionOutcomeLine(c: CompetitionCard): string {
  return competitionResultLine({
    format: c.format as CompetitionFormatId,
    entrantCount: c.entrantCount,
    winnerName: c.winner?.name ?? null,
    placedCount: c.placedCount,
  });
}

/** The completed card's top three — rank/name/score, GOLD for the format's
 *  actual winner(s) (league_quiz rank 1, beat_target every "placed" entry). */
function CompetitionTopThree({ entries }: { entries: CompetitionEntryRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
      {entries.map((e, i) => {
        const won = e.result === "winner" || e.result === "placed";
        return (
          <div key={e.userId} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            <span style={{ width: 14, flexShrink: 0, color: won ? GOLD : MUTED, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
            <span style={{ color: won ? GOLD : MUTED, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{e.score}</span>
          </div>
        );
      })}
    </div>
  );
}
type CompetitionEntryRow = NonNullable<ChatMessage["competition"]>["topThree"][number];

/** A league-wide competition card (UI wave) — GOLD accent, same games-family
 *  language as ChallengeCardMsg above. Status- and viewer-aware: whatever's
 *  actionable is a real control, everything else is a quiet, terminal muted
 *  line (house rule: no dead ends). The whole card taps through to the Games
 *  tab's competition detail via `onOpen` — a role="button" wrapper around the
 *  title/status block only, never the whole CardShell, so it never nests
 *  inside the "Play now" link below it (LeagueGamesView's own rule: no
 *  interactive element inside another). */
function CompetitionCardMsg({ msg, onOpen }: { msg: ChatMessage; onOpen: (id: string) => void }) {
  const c = msg.competition!;
  const mutedLine = (text: string) => <div style={{ fontSize: 12, color: MUTED }}>{text}</div>;
  const openBody = () => onOpen(c.id);
  return (
    <CardShell accent={GOLD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
        <KindLabel color={GOLD} text="COMPETITION" />
        {c.source === "official" && (
          <span className="font-display tracking-widest" style={{
            fontSize: 9, fontWeight: 700, color: GOLD, background: tint(GOLD, "18"),
            border: `1px solid ${tint(GOLD, "44")}`, borderRadius: 999, padding: "2px 7px",
          }}>OFFICIAL</span>
        )}
      </div>
      <div role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openBody(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBody(); } }}
        style={{ cursor: "pointer" }}>
        <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: INK, lineHeight: 1.3, marginBottom: 6 }}>{c.title}</div>

        {c.status === "scheduled" && mutedLine(competitionWindowLine("Opens", c.opensAt))}

        {c.status === "open" && (
          <div>
            {mutedLine(competitionWindowLine("Closes", c.closesAt))}
            {c.myEntry && mutedLine(myCompetitionLine(c) ?? "")}
          </div>
        )}

        {(c.status === "locked" || c.status === "calculating") && mutedLine("Results on the way")}

        {c.status === "completed" && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{competitionOutcomeLine(c)}</div>
            {c.topThree.length > 0 && <CompetitionTopThree entries={c.topThree} />}
          </div>
        )}

        {c.status === "void" && mutedLine(competitionOutcomeLine(c))}
        {c.status === "cancelled" && mutedLine("Called off")}
      </div>

      {/* Play now — a sibling control, not nested inside the role="button"
          block above (same "never nest an interactive element" rule the
          Games tab's own game cards follow). Only while open and the viewer
          hasn't entered yet — a real play destination, never a dead link. */}
      {c.status === "open" && !c.myEntry && c.packId && (
        <Link href={`/play/new?packId=${c.packId}`} onClick={(e) => e.stopPropagation()} style={{
          display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 700, color: GOLD, textDecoration: "none",
        }}>Play now</Link>
      )}
    </CardShell>
  );
}

/** The compact settle "ping" (kind "competition_result") — one new line
 *  dropped into chat when a competition completes, distinct from the
 *  original COMPETITION card above updating in place (same product shape as
 *  ChallengeResultLine). No accent shell, no actions — the outcome and a
 *  link through to the detail. */
function CompetitionResultLine({ competition: c, onOpen }: { competition: CompetitionCard; onOpen: (id: string) => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, background: PANEL, border: `1px solid ${tint(GOLD, "2a")}`,
      borderRadius: 10, padding: "8px 11px",
    }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
        <path d="M8 21h8M12 17v4M6 4h12v3a6 6 0 01-12 0V4z" />
        <path d="M6 6H4a2 2 0 002 4M18 6h2a2 2 0 01-2 4" />
      </svg>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{competitionOutcomeLine(c)}</span>
      <button onClick={(e) => { e.stopPropagation(); onOpen(c.id); }} style={{
        marginLeft: "auto", padding: 0, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
        background: "none", border: "none", color: GOLD, textDecoration: "none", flexShrink: 0,
      }}>See it</button>
    </div>
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
function MessageBody({ m, onView, onOpenNews, onVote, onViewImage, onViewFeed, onAuthor, onDeclineChallenge, onCancelChallenge, onAcceptChallenge, onRematchChallenge, onOpenCompetition, viewerId, readOnly, busy, showHeader = true }: {
  m: ChatMessage; onView: (id: number) => void; onOpenNews: (m: ChatMessage) => void; onVote: (i: number) => void;
  onViewImage: (url: string) => void; onViewFeed: (eventId: string) => void; onAuthor: (m: ChatMessage) => void;
  onDeclineChallenge: (challengeId: string, gameType: string) => void; onCancelChallenge: (challengeId: string, gameType: string) => void;
  onAcceptChallenge: (challengeId: string, h2hId: string | null, gameType: string) => void;
  onRematchChallenge: (challenge: ChallengeCard) => void;
  onOpenCompetition: (competitionId: string) => void;
  viewerId: string | null;
  readOnly?: boolean; busy?: boolean; showHeader?: boolean;
}) {
  if ((m.kind === "player" || m.kind === "captain") && m.player) return <SharedPlayer msg={m} onView={() => onView(m.player!.id)} />;
  if (m.kind === "squad" && m.squad) return <SharedSquad msg={m} />;
  if (m.kind === "news" && m.news) return <SharedNews msg={m} onOpen={() => onOpenNews(m)} />;
  if (m.kind === "compare" && m.compare) return <SharedCompare msg={m} onView={onView} />;
  if (m.kind === "gif" && m.gif) return <SharedGif msg={m} />;
  if (m.kind === "image" && m.image) return <SharedImage msg={m} onView={() => onViewImage(m.image!.url)} />;
  if (m.kind === "video" && m.video) return <SharedVideo msg={m} />;
  if (m.kind === "feed" && m.feed) return <SharedFeedPost msg={m} onView={() => onViewFeed(m.feed!.eventId)} />;
  if (m.kind === "challenge" && m.challenge)
    return <ChallengeCardMsg msg={m} viewerId={viewerId} onDecline={onDeclineChallenge} onCancel={onCancelChallenge} onAccept={onAcceptChallenge} onRematch={onRematchChallenge} busy={!!busy} />;
  if (m.kind === "challenge_result" && m.challenge) return <ChallengeResultLine challenge={m.challenge} />;
  if (m.kind === "competition" && m.competition) return <CompetitionCardMsg msg={m} onOpen={onOpenCompetition} />;
  if (m.kind === "competition_result" && m.competition) return <CompetitionResultLine competition={m.competition} onOpen={onOpenCompetition} />;
  if (m.kind === "poll" && m.poll) return <Poll msg={m} onVote={onVote} readOnly={readOnly} />;
  return (
    <div style={{
      background: m.isMe ? tint(TEAL, "1c") : PANEL, border: `1px solid ${m.isMe ? tint(TEAL, "44") : LINE}`,
      borderRadius: 13, padding: "6px 11px", minWidth: 0,
    }}>
      {!m.isMe && showHeader && (
        <button onClick={(e) => { e.stopPropagation(); onAuthor(m); }} style={{
          display: "block", background: "none", border: "none", cursor: "pointer", padding: 0,
          fontSize: 10.5, color: TEAL, fontWeight: 700, marginBottom: 1,
        }}>{m.name}</button>
      )}
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

export function LeagueChatView({ code, initialGw = null, onOpenCompetition }: {
  code: string; initialGw?: number | null;
  /** A competition card's tap through to the Games tab detail (UI wave) —
   *  mirrors page.tsx's openGamesChallenge deep-link pattern: the parent
   *  switches tabs AND tells LeagueGamesView which competition to open, so
   *  this view never needs to know anything about that sheet's own state. */
  onOpenCompetition: (competitionId: string) => void;
}) {
  const router = useRouter();
  const { user } = useUser();
  const [chat, setChat] = useState<ChatData | null>(null);
  // Member action sheet (Phase 1B) — tapping an avatar or author name.
  const [actionMember, setActionMember] = useState<MemberActionMember | null>(null);
  // Rematch prep sheet (Phase 3C) — a completed card's Rematch tap. See
  // startRematch's own doc, below, for why this view needs its own
  // ChallengePrepSheet mount rather than reusing MemberActionSheet's.
  const [rematchChallenge, setRematchChallenge] = useState<ChallengeCard | null>(null);
  // The + tray's Challenge entry (founder, 6 Aug): tapping it first asks WHO
  // (the league roster already loaded for mention autocomplete), then opens
  // the same ChallengePrepSheet the member sheet and rematch use.
  const [challengePick, setChallengePick] = useState(false);
  const [challengeOpponent, setChallengeOpponent] = useState<{ userId: string; name: string; avatarUrl: string | null } | null>(null);
  const [viewGw, setViewGw] = useState<number | null>(initialGw);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The FIRST load's own failure — distinct from `err` above (which is an
  // action's failure, e.g. sending a message). While `chat` is still null a
  // failed fetch used to leave the screen stuck on "Loading chat…" forever
  // (the catch below kept prior state, which was nothing); this makes that
  // failure visible with a retry, and never fires again once the thread has
  // loaded once (a later poll failure still just keeps the prior state).
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const chatLoadedRef = useRef(false);
  const [menu, setMenu] = useState(false);
  const [poll, setPoll] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [reactFor, setReactFor] = useState<string | null>(null);
  // AC2 — the message being replied to (composer switches into reply mode).
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // AC4 — the image currently open full-screen.
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 2c — the video file input; no staged preview tile (same immediate-
  // send shape as the image flow above).
  const videoFileInputRef = useRef<HTMLInputElement>(null);
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
  // The FULL roster, handle-less members included — the + tray's challenge
  // picker needs everyone (a challenge doesn't need an @handle the way a
  // mention does; filtering here made the picker claim an occupied league
  // was empty).
  const [roster, setRoster] = useState<{ userId: string; displayName: string; avatarUrl: string | null }[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => {
        if (!live) return;
        type RawMember = { userId: string; username: string | null; displayName: string | null; avatarUrl: string | null };
        const raw = (d.members ?? []) as RawMember[];
        setRoster(raw.map((m) => ({ userId: m.userId, displayName: m.displayName ?? (m.username ? `@${m.username}` : "Player"), avatarUrl: m.avatarUrl })));
        setMembers(
          raw
            .filter((m): m is RawMember & { username: string } => !!m.username)
            .map((m) => ({ userId: m.userId, username: m.username, displayName: m.displayName ?? `@${m.username}`, avatarUrl: m.avatarUrl })),
        );
      })
      .catch(() => {});
    return () => { live = false; };
  }, [code]);

  // A member tap from the shared MemberActionSheet (feed/hub "Mention in
  // league chat" destination) arrives as ?mention=<username> — read it once
  // on mount, prefill the composer the same way picking a mention does, then
  // strip the param so a refresh doesn't repeat it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const mention = sp.get("mention");
    if (!mention) return;
    const text = `@${mention} `;
    setDraft(text);
    setDraftCaret(text.length);
    const u = new URL(window.location.href);
    u.searchParams.delete("mention");
    window.history.replaceState(null, "", u);
    requestAnimationFrame(() => { draftInputRef.current?.focus(); draftInputRef.current?.setSelectionRange(text.length, text.length); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the shared member action sheet for a message's author — the roster
  // (fetched above) has their username; fall back to just what the message
  // itself carries if they're not on it for some reason (never blocks the tap).
  const openAuthor = (m: ChatMessage) => {
    const found = members.find((mm) => mm.userId === m.userId);
    setActionMember({
      userId: m.userId,
      username: found?.username ?? null,
      displayName: found?.displayName ?? m.name,
      avatarUrl: found?.avatarUrl ?? m.avatarUrl,
    });
  };
  // The member sheet's Mention action didn't come from typing "@" — there's
  // no partial token for applyMention to replace — so this inserts the same
  // "@username " string at the caret directly, same insertion shape pickMention
  // uses, then focuses the field exactly like it does.
  const insertMention = (username: string) => {
    const before = draft.slice(0, draftCaret);
    const after = draft.slice(draftCaret);
    const insert = `@${username} `;
    const text = (before + insert + after).slice(0, 280);
    const caret = (before + insert).length;
    setDraft(text);
    setDraftCaret(caret);
    if (actionMember) setDraftMentions((prev) => [...prev, { userId: actionMember.userId, usernameSnapshot: username }]);
    requestAnimationFrame(() => { draftInputRef.current?.focus(); draftInputRef.current?.setSelectionRange(caret, caret); });
  };

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
      if (res.ok) {
        setChat(await res.json());
        chatLoadedRef.current = true;
        setLoadErr(null);
      } else if (!chatLoadedRef.current) {
        setLoadErr(`HTTP ${res.status}`);
      }
      // A failed poll AFTER the thread has already loaded once keeps the
      // prior state on screen rather than replacing it with an error — same
      // "keep prior state" call this file always made, just now scoped to
      // only the very first load.
    } catch { if (!chatLoadedRef.current) setLoadErr("Couldn't load the chat."); }
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

  // Decline a challenge card (Phase 1C) — a dedicated top-level route, not
  // under /leagues/[code]/*, so it doesn't go through this file's api()
  // helper (see challengeClientActions.ts, shared with the Games tab, Phase
  // 4A). guard() still reloads the thread after, so the card flips to
  // "Declined" immediately rather than waiting on the 15s poll.
  const declineChallenge = (challengeId: string, gameType: string) => {
    setReactFor(null);
    guard(() => declineChallengeAction(challengeId, gameType));
  };

  // Withdraw a challenge (Phase 3A) — the challenger only, while pending.
  // Same shared-helper shape as decline above.
  const cancelChallenge = (challengeId: string, gameType: string) => {
    setReactFor(null);
    guard(() => cancelChallengeAction(challengeId, gameType));
  };

  // One-tap accept (Phase 3A, product decision, locked): the opponent's
  // "Play" tap on the pending card IS acceptance — no separate Accept step.
  // Doesn't reuse guard(): on success it navigates straight into the game
  // rather than reloading the thread first (nothing to show — the manager's
  // already leaving the page), and on a 409 (someone else's tap already
  // closed it, or it's expired) it still reloads so the card never sits on a
  // dead Play button.
  const acceptChallenge = (challengeId: string, h2hId: string | null, gameType: string) => {
    setReactFor(null);
    setBusy(true); setErr(null);
    (async () => {
      try {
        const { h2hId: gotH2hId } = await acceptChallengeAction(challengeId, gameType);
        router.push(`/h2h/${gotH2hId ?? h2hId}`);
        return; // navigating away — no need to clear busy or reload the thread
      } catch (e) {
        if (e instanceof ChallengeActionConflict) { await load(viewGw); setBusy(false); return; }
        setErr((e as Error).message);
        await load(viewGw);
      }
      setBusy(false);
    })();
  };

  // Rematch (Phase 3C) — a completed card's Rematch tap. This view mounts
  // its OWN ChallengePrepSheet (below, next to the member action sheet) —
  // unlike every OTHER challenge action here (accept/decline/cancel), which
  // hit a route directly, sending a challenge needs the full prep sheet
  // (game/pack picker), and MemberActionSheet's copy is scoped to ITS OWN
  // member tap, not this card's. Preselects the completed game and carries
  // the old challenge's id through as rematchOf. Opponent is the OTHER
  // participant relative to the viewer — a rematch may flip roles, so this
  // is never just "the same opponent as last time" from the challenger's
  // fixed seat.
  const startRematch = (c: ChallengeCard) => {
    setReactFor(null);
    trackChallengeRematchStarted(c.gameType);
    setRematchChallenge(c);
  };
  const rematchOpponent = rematchChallenge && user?.id
    ? (rematchChallenge.challengerId === user.id
        ? { userId: rematchChallenge.opponentId, name: rematchChallenge.opponentName, avatarUrl: rematchChallenge.opponentAvatarUrl }
        : { userId: rematchChallenge.challengerId, name: rematchChallenge.challengerName, avatarUrl: rematchChallenge.challengerAvatarUrl })
    : null;

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

  // Phase 2c — pick + validate/probe + upload one video, then post it, the
  // same immediate-send pattern pickImage/onImageChosen already use above
  // (no staged preview tile — the image flow doesn't have one either).
  // validateAndProbeVideo fails fast on a bad format BEFORE the (up to
  // 100MB) upload starts, same idiom CreatePostSheet's composer uses.
  const pickVideo = () => { setMenu(false); videoFileInputRef.current?.click(); };
  const onVideoChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy(true); setErr(null);
    try {
      const { durationMs, width, height } = await validateAndProbeVideo(file);
      const res = await uploadPostVideo(file);
      await api(code, "chat", { kind: "video", video: { url: res.url, posterUrl: res.posterUrl, width, height, durationMs }, parentId });
      trackVideoChatMessageSent();
      setReplyTo(null);
      await load(viewGw);
    } catch (vidErr) {
      setErr(vidErr instanceof PostVideoError ? vidErr.message : (vidErr as Error).message);
    }
    setBusy(false);
  };

  // Tap anywhere on a message (but not on a control inside it) to react.
  const tapMessage = (id: string, e: React.MouseEvent) => {
    if (readOnly) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    setReactFor((prev) => (prev === id ? null : id));
  };

  if (!chat) {
    if (loadErr) return <ErrorState message={loadErr} onRetry={() => load(viewGw)} />;
    return (
      <Loading label="Loading chat">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={44} r={13} w="70%" />
          <Skel h={44} r={13} w="55%" style={{ marginLeft: "auto" }} />
          <Skel h={44} r={13} w="65%" />
          <Skel h={44} r={13} w="50%" style={{ marginLeft: "auto" }} />
        </div>
      </Loading>
    );
  }
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
          <span style={{ color: GOLD, flexShrink: 0, display: "flex" }}><ChipIcon d={CHIP_ICON.pin} /></span>
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
                  ? (
                    <button onClick={(e) => { e.stopPropagation(); openAuthor(m); }} aria-label={`View ${m.name}`} style={{
                      display: "block", background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, borderRadius: 999,
                    }}><PlayerAvatar name={m.name} avatarUrl={m.avatarUrl} size={22} /></button>
                  )
                  : <span aria-hidden style={{ width: 22, flexShrink: 0 }} />)}
                <MessageBody m={m} onView={(id) => router.push(`/fantasy/players/${id}`)} onOpenNews={openNews}
                  onVote={(i2) => vote(m.id, i2)} onViewImage={setGalleryUrl} onViewFeed={openFeed} onAuthor={openAuthor}
                  onDeclineChallenge={declineChallenge} onCancelChallenge={cancelChallenge} onAcceptChallenge={acceptChallenge}
                  onRematchChallenge={startRematch}
                  onOpenCompetition={onOpenCompetition}
                  viewerId={user?.id ?? null}
                  readOnly={readOnly} busy={busy} showHeader={showHeader} />
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

      {/* Member action sheet (Phase 1B) — avatar/name tap; Mention inserts
          straight into the composer instead of the feed/hub mini-list. */}
      {actionMember && (
        <MemberActionSheet
          member={actionMember}
          context="chat"
          leagueCode={code}
          viewerId={user?.id ?? null}
          onClose={() => setActionMember(null)}
          onMention={insertMention}
        />
      )}

      {/* The + tray's Challenge flow: pick the rival first (the same roster
          mention autocomplete uses, minus yourself), then the shared prep
          sheet. Handle-less members don't appear here (the roster fetch
          filters them for mentions) — they're still challengeable from the
          table and members list, where the member sheet has no such filter. */}
      {challengePick && (
        <Sheet onClose={() => setChallengePick(false)} labelledBy="chat-challenge-pick-title">
          <div id="chat-challenge-pick-title" className="font-display" style={{ fontSize: 16, fontWeight: 800, color: INK, marginBottom: 10 }}>Who are you calling out?</div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {roster.filter((m) => m.userId !== user?.id).map((m) => (
              <button key={m.userId} onClick={() => { setChallengeOpponent({ userId: m.userId, name: m.displayName, avatarUrl: m.avatarUrl }); setChallengePick(false); }} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
                minHeight: 48, background: "none", border: "none", borderTop: `1px solid ${LINE}`, padding: "9px 2px",
              }}>
                <PlayerAvatar name={m.displayName} avatarUrl={m.avatarUrl} size={30} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{m.displayName}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: GOLD }}>Challenge</span>
              </button>
            ))}
            {roster.filter((m) => m.userId !== user?.id).length === 0 && (
              <p style={{ fontSize: 13, color: MUTED, margin: "8px 0" }}>Nobody else is in this league yet. Invite a friend first.</p>
            )}
          </div>
        </Sheet>
      )}
      {challengeOpponent && (
        <ChallengePrepSheet
          leagueCode={code}
          opponent={challengeOpponent}
          createdFrom="league_chat"
          onSent={() => { setChallengeOpponent(null); load(viewGw); }}
          onClose={() => setChallengeOpponent(null)}
        />
      )}

      {/* Rematch prep sheet (Phase 3C) — a completed card's Rematch tap. See
          startRematch's own doc, above, for why this is its own mount rather
          than MemberActionSheet's copy. */}
      {rematchChallenge && rematchOpponent && (
        <ChallengePrepSheet
          leagueCode={code}
          opponent={rematchOpponent}
          createdFrom="league_chat"
          initialGame={rematchChallenge.gameType}
          rematchOf={rematchChallenge.challengeId}
          onSent={() => { setRematchChallenge(null); load(viewGw); }}
          onClose={() => setRematchChallenge(null)}
        />
      )}

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
                <MenuChip icon={<ChipIcon d={CHIP_ICON.photo} />} onClick={pickImage} accent={TEAL} disabled={busy}>Photo</MenuChip>
                <MenuChip icon={<ChipIcon d={CHIP_ICON.video} />} onClick={pickVideo} accent={TEAL} disabled={busy}>Video</MenuChip>
                <MenuChip icon={<ChipIcon d={CHIP_ICON.gif} />} onClick={() => { setGifOpen(true); setMenu(false); }} accent={CORAL}>GIF</MenuChip>
                <MenuChip icon={<ChipIcon d={CHIP_ICON.poll} />} onClick={() => { setPoll(true); setMenu(false); }} accent={LIME}>Poll</MenuChip>
                <MenuChip icon={<ChipIcon d={CHIP_ICON.challenge} />} onClick={() => { setChallengePick(true); setMenu(false); }} accent={GOLD} disabled={busy}>Challenge</MenuChip>
                <MenuChip icon={<ChipIcon d={CHIP_ICON.shirt} />} onClick={shareSquad} accent={TEAL} disabled={busy}>Share my squad</MenuChip>
                <MenuChip icon={<ChipIcon d={CHIP_ICON.captain} />} onClick={shareCaptain} accent={GOLD} disabled={busy}>Share my captain</MenuChip>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageChosen} style={{ display: "none" }} />
            <input ref={videoFileInputRef} type="file" accept="video/mp4,video/quicktime" onChange={onVideoChosen} style={{ display: "none" }} />
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
/** The tray chips' icons — the same bare-SVG stroke language as the timeline
 *  composer's toolbar (CreatePostSheet's ToolIcon), sized down for a pill.
 *  Never emoji (house rule; the tray shipped with 📷/📊/👕 before this). */
function ChipIcon({ d }: { d: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}
const CHIP_ICON = {
  // Photo/video/GIF/poll are CreatePostSheet's own toolbar paths, verbatim.
  photo: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
  video: "M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z M16 9.5l5-3v11l-5-3",
  gif: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z M7.5 9.5v5 M7.5 9.5h2 M7.5 12h1.5 M12 9.5v5 M17 9.5h-2.5v5",
  poll: "M4 6h12 M4 12h16 M4 18h8",
  shirt: "M8 4l-4 3 2 3 2-1v11h8V9l2 1 2-3-4-3a4 4 0 0 1-8 0z",
  captain: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15.2 9.6a4 4 0 1 0 0 4.8",
  // The member sheet's crossed-swords Challenge icon, flattened to one path.
  challenge: "M4 4l7 7 M11 4l-7 7 M20 4l-7 7 M13 4l7 7 M6.5 17.5l-3 3 M17.5 17.5l3 3 M12 11l-5.5 6.5 M12 11l5.5 6.5",
  // The Reactions row's Pin/Report actions, replacing 📌/🚩 (house rule).
  pin: "M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
  flag: "M4 22V4 M4 4s1-1 4-1 4 2 8 2 4-1 4-1v10s-1 1-4 1-4-2-8-2-4 1-4 1z",
};

function MenuChip({ icon, children, onClick, accent, disabled }: { icon?: React.ReactNode; children: React.ReactNode; onClick: () => void; accent: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "7px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: disabled ? "default" : "pointer",
      background: tint(accent, "14"), color: accent, border: `1px solid ${tint(accent, "40")}`, opacity: disabled ? 0.5 : 1,
    }}>{icon}{children}</button>
  );
}
