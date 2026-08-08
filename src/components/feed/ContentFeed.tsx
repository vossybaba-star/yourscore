"use client";

/**
 * The live football content feed (founder 8 Aug) — "what's happening now":
 * recent news (headline + snippet, links out to the source, attributed) and
 * embeddable YouTube videos that autoplay muted as they scroll into view. Reads
 * the edge-cached /api/feed/live. Category chips filter reports / transfers /
 * managers / videos.
 *
 * Every card is INTERACTIVE like the X feed (founder 8 Aug): an emoji reaction
 * bar, a comment thread, and share — all keyed off a synthetic subject uuid the
 * live feed attaches to each item (item.subjectKey, see contentSubjectId), so
 * external content needs no DB row. Reactions hit /api/feed/content/react;
 * comments reuse the shipped DiscussionThread (subject type "content"); counts
 * come batched from /api/feed/content/state. Reads are public; posting a comment
 * or reaction needs an account (a 401 bounces to sign-in).
 *
 * Attribution: every card names its source (approved 8 Aug). News links out in a
 * new tab; videos are embedded via the official YouTube iframe.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DiscussionThread } from "@/components/debate/DiscussionThread";

const INK = "#eef2f0";
const MUTED = "#8a948f";
const PANEL = "#0e1611";
const LINE = "rgba(255,255,255,0.08)";
const TEAL = "#00d8c0";
const GOLD = "#ffc233";
const CORAL = "#e0653c";

// Same set as league chat + the fantasy feed (that module is server-only).
const REACTION_SET = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;
const tint = (hex: string, alpha: string) => `${hex}${alpha}`;

interface Reaction { emoji: string; count: number }
interface ItemState { reactions: Reaction[]; mine: string | null; comments: number }

interface FeedItem {
  id: string; title: string; url: string; source: string;
  image: string | null; summary?: string; publishedAt: string;
  kind?: "news" | "video"; videoId?: string;
  category?: "transfer" | "manager" | "video" | "report";
  subjectKey?: string;
}

const CATS: { id: "all" | FeedItem["category"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "report", label: "News" },
  { id: "transfer", label: "Transfers" },
  { id: "manager", label: "Managers" },
  { id: "video", label: "Video" },
];
const CAT_COLOR: Record<string, string> = { transfer: GOLD, manager: CORAL, video: TEAL, report: MUTED };
const CAT_LABEL: Record<string, string> = { transfer: "Transfer", manager: "Manager", video: "Video", report: "News" };

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function applyReaction(current: Reaction[], from: string | null, to: string | null): Reaction[] {
  const counts = new Map(current.map((r) => [r.emoji, r.count]));
  if (from) counts.set(from, Math.max(0, (counts.get(from) ?? 0) - 1));
  if (to) counts.set(to, (counts.get(to) ?? 0) + 1);
  return REACTION_SET.filter((e) => (counts.get(e) ?? 0) > 0).map((emoji) => ({ emoji, count: counts.get(emoji)! }));
}

/** The interactive footer under every content card: react · comment · share.
 *  Mirrors the fantasy feed's control set so the feeds feel like one product. */
function InteractionBar({ item, initial, signInNext }: { item: FeedItem; initial?: ItemState; signInNext: string }) {
  const subjectId = item.subjectKey ?? "";
  const [reactions, setReactions] = useState<Reaction[]>(initial?.reactions ?? []);
  const [mine, setMine] = useState<string | null>(initial?.mine ?? null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [shared, setShared] = useState(false);

  // initial arrives async (batched state fetch lands after the feed renders).
  useEffect(() => {
    if (!initial) return;
    setReactions(initial.reactions); setMine(initial.mine);
  }, [initial]);

  const react = async (emoji: string) => {
    if (!subjectId) return;
    const remove = mine === emoji;
    const prev = { reactions, mine };
    const next = remove ? null : emoji;
    setReactions(applyReaction(reactions, mine, next));
    setMine(next);
    setTrayOpen(false);
    try {
      const res = remove
        ? await fetch("/api/feed/content/react", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectId }) })
        : await fetch("/api/feed/content/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjectId, emoji }) });
      if (res.status === 401) { window.location.href = `/auth/sign-in?next=${encodeURIComponent(signInNext)}`; return; }
      if (!res.ok) { setReactions(prev.reactions); setMine(prev.mine); }
    } catch { setReactions(prev.reactions); setMine(prev.mine); }
  };

  const share = async () => {
    const data = { title: item.title, url: item.url };
    try {
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (typeof navigator !== "undefined" && nav.share) { await nav.share(data); return; }
    } catch { /* user dismissed the native sheet — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(item.url);
      setShared(true); setTimeout(() => setShared(false), 1600);
    } catch { /* clipboard blocked — nothing more we can do silently */ }
  };

  const total = reactions.reduce((s, r) => s + r.count, 0);
  const top = [...reactions].sort((a, b) => b.count - a.count).slice(0, 3);

  const btn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, cursor: "pointer", minHeight: 40,
    padding: "6px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
    background: "transparent", color: MUTED, border: `1px solid ${LINE}`,
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px 12px", position: "relative" }}>
        {/* React */}
        <div style={{ position: "relative", display: "flex" }}>
          <button onClick={() => setTrayOpen((o) => !o)} aria-label="React" aria-expanded={trayOpen}
            style={{ ...btn, background: mine ? tint(TEAL, "1a") : "transparent", color: mine ? TEAL : MUTED, border: `1px solid ${mine ? tint(TEAL, "55") : LINE}` }}>
            {total > 0 ? (
              <>
                <span aria-hidden style={{ display: "flex" }}>{top.map((r) => <span key={r.emoji} style={{ fontSize: 13 }}>{r.emoji}</span>)}</span>
                <span>{total}</span>
              </>
            ) : (
              <>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="12" r="8" /><path d="M8 14s1.2 1.6 3 1.6 3-1.6 3-1.6" /><path d="M9 10h.01" /><path d="M13.5 10h.01" /><path d="M19 3v4" /><path d="M17 5h4" />
                </svg>
                <span>React</span>
              </>
            )}
          </button>
          {trayOpen && (
            <>
              <div onClick={() => setTrayOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 4 }} />
              <div role="group" aria-label="Reactions" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 5, display: "flex", gap: 2, padding: 5, borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 6px 20px rgba(0,0,0,0.4)" }}>
                {REACTION_SET.map((emoji) => (
                  <button key={emoji} onClick={() => react(emoji)} aria-label={`React with ${emoji}`} aria-pressed={emoji === mine}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: emoji === mine ? tint(TEAL, "22") : "none", border: "none", borderRadius: 999, fontSize: 18, lineHeight: 1, minWidth: 40, minHeight: 40 }}>{emoji}</button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Comment */}
        <button onClick={() => setShowThread((o) => !o)} aria-label="Comments" aria-expanded={showThread}
          style={{ ...btn, background: showThread ? tint(TEAL, "12") : "transparent", color: showThread ? TEAL : MUTED, border: `1px solid ${showThread ? tint(TEAL, "44") : LINE}` }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
          </svg>
          <span>{initial?.comments ? initial.comments : "Comment"}</span>
        </button>

        {/* Share */}
        <button onClick={share} aria-label="Share" style={{ ...btn, marginLeft: "auto", color: shared ? TEAL : MUTED, border: `1px solid ${shared ? tint(TEAL, "44") : LINE}` }}>
          {shared ? <span>Copied</span> : (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" />
            </svg>
          )}
        </button>
      </div>

      {showThread && subjectId && (
        <div style={{ borderTop: `1px solid ${LINE}`, padding: "4px 12px 12px" }}>
          <DiscussionThread
            subjectType="content" subjectId={subjectId}
            title="Comments" embedded accent={TEAL} signInNext={signInNext}
          />
        </div>
      )}
    </div>
  );
}

/** A video card — poster until it scrolls into view, then a muted autoplay embed
 *  (founder 8 Aug: "autoplay as scroll"). Out of view → back to the poster, so
 *  only what you're looking at is playing. */
function VideoCard({ item, state, signInNext }: { item: FeedItem; state?: ItemState; signInNext: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => setPlaying(ents[0]?.isIntersecting && ents[0].intersectionRatio > 0.55),
      { threshold: [0, 0.55, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" }}>
      <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
        {playing && item.videoId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`}
            title={item.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
            loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <button onClick={() => setPlaying(true)} aria-label={`Play: ${item.title}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, cursor: "pointer", padding: 0, background: "#000" }}>
            {item.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
            )}
            <span aria-hidden style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 54, height: 54, borderRadius: 999, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </button>
        )}
      </div>
      <div style={{ padding: "10px 12px 2px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.3 }}>{item.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11, color: MUTED }}>
          <span style={{ color: TEAL, fontWeight: 700 }}>{item.source}</span>
          <span aria-hidden>·</span><span>{ago(item.publishedAt)}</span>
        </div>
      </div>
      <InteractionBar item={item} initial={state} signInNext={signInNext} />
    </div>
  );
}

function NewsCard({ item, state, signInNext }: { item: FeedItem; state?: ItemState; signInNext: string }) {
  const cat = item.category ?? "report";
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" }}>
      <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", gap: 12, textDecoration: "none", padding: 12 }}>
        {item.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" style={{ width: 92, height: 92, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: "#0a0f0c" }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            {cat !== "report" && (
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: CAT_COLOR[cat], background: `${CAT_COLOR[cat]}1f`, borderRadius: 999, padding: "1px 7px" }}>{CAT_LABEL[cat].toUpperCase()}</span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, color: TEAL }}>{item.source}</span>
            <span style={{ fontSize: 11, color: MUTED }}>· {ago(item.publishedAt)}</span>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</div>
          {item.summary && (
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.summary}</div>
          )}
        </div>
      </a>
      <InteractionBar item={item} initial={state} signInNext={signInNext} />
    </div>
  );
}

export function ContentFeed({ endpoint = "/api/feed/live" }: { endpoint?: string }): ReactNode {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [filter, setFilter] = useState<"all" | FeedItem["category"]>("all");
  const pathname = usePathname();
  const signInNext = pathname || "/play";

  useEffect(() => {
    let live = true;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (!live) return;
        const list = (d.items ?? []) as FeedItem[];
        setItems(list);
        // Batch-fetch reaction + comment counts for everything we're about to show.
        const ids = list.map((i) => i.subjectKey).filter(Boolean).join(",");
        if (ids) {
          fetch(`/api/feed/content/state?ids=${ids}`)
            .then((r) => (r.ok ? r.json() : { states: {} }))
            .then((s) => { if (live) setStates(s.states ?? {}); })
            .catch(() => {});
        }
      })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [endpoint]);

  const shown = (items ?? []).filter((it) => filter === "all" || (it.category ?? "report") === filter);

  return (
    <div>
      {/* Category chips */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 0 12px", scrollbarWidth: "none" }}>
        {CATS.map((c) => {
          const on = filter === c.id;
          return (
            <button key={c.id} onClick={() => setFilter(c.id)} style={{
              flexShrink: 0, padding: "6px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: on ? TEAL : "transparent", color: on ? "#04231f" : MUTED, border: `1px solid ${on ? TEAL : LINE}`,
            }}>{c.label}</button>
          );
        })}
      </div>

      {items === null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ height: 96, borderRadius: 16, background: PANEL, border: `1px solid ${LINE}` }} />)}
        </div>
      ) : shown.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED, textAlign: "center", padding: "24px 0" }}>Nothing here right now. Check back soon.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((it) => {
            const state = it.subjectKey ? states[it.subjectKey] : undefined;
            return it.kind === "video" && it.videoId
              ? <VideoCard key={it.id} item={it} state={state} signInNext={signInNext} />
              : <NewsCard key={it.id} item={it} state={state} signInNext={signInNext} />;
          })}
        </div>
      )}
    </div>
  );
}
