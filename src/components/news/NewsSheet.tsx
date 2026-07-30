"use client";

/**
 * The half-view — a story opens IN the app instead of a browser tab.
 *
 * Shared by Matchweek → PL → News and the Fantasy news feed. Both had the same
 * problem (one tap and the reader was on someone else's site with no way back
 * but the OS) and the same fix, so this is one component fed a neutral shape:
 * each feed maps its own items and owns its own clock.
 *
 * It is deliberately NOT scrollable. Bodies are capped at ~200 chars upstream so
 * they always fit, which keeps the vertical drag unambiguous: down closes, up
 * moves to the next story. A scrolling sheet would have to disambiguate the two
 * and the gesture would feel dead.
 *
 * The z-index and the safe-area padding are carried over from the fantasy Sheet
 * (src/components/fantasy/shared.tsx): at z-40 the fixed BottomNav renders OVER
 * the sheet and clips the buttons, and without the inset the last row sits under
 * the home indicator.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const TEAL = "#00d8c0";
const PANEL = "#0e1611";
const LINE = "rgba(255,255,255,0.08)";
const INK = "#eef2f0";
const MUTED = "#8a948f";

/** Past this much drag the gesture commits. Below it the sheet springs back. */
const COMMIT_PX = 64;

export interface SheetStory {
  id: string;
  /** The headline, or a tweet's text. */
  title: string;
  url: string;
  /** Outlet name, or an @handle. */
  source: string;
  /** Already formatted ("2h ago") — each feed keeps its own clock. */
  timeLabel: string;
  image?: string | null;
  summary?: string;
  /** Ours: route inside the app rather than opening a tab. */
  internal?: boolean;
  /** Source colour. Outlets read teal; fantasy tweets read gold. */
  accent?: string;
  /** Primary button copy. */
  readLabel?: string;
  /** A tweet is body copy, not a headline, so it should not be set like one. */
  bodyStyle?: "headline" | "quote";
}

export function NewsSheet({
  stories,
  index,
  onIndexChange,
  onClose,
}: {
  /** The list AS SHOWN on screen, so "next" matches what the reader can see. */
  stories: SheetStory[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const item = stories[index];
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  /**
   * The live drag distance. This is a REF, not just the state below, because
   * touchend decides on it: a fast flick fires touchmove and touchend inside one
   * frame, React hasn't re-rendered, and the handler's closure still sees 0 —
   * the swipe silently did nothing. State drives the transform, the ref decides.
   */
  const dragY = useRef(0);
  const [drag, setDrag] = useState(0);
  const [copied, setCopied] = useState(false);
  const hasNext = index < stories.length - 1;

  const next = useCallback(() => {
    if (hasNext) onIndexChange(index + 1);
  }, [hasNext, index, onIndexChange]);

  // Escape closes; focus moves into the sheet and returns where it came from.
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); next(); }
      if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); onIndexChange(index - 1); }
    };
    document.addEventListener("keydown", onKey);
    // The feed behind must not scroll under the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      returnTo?.focus?.();
    };
  }, [onClose, next, index, onIndexChange]);

  if (!item) return null;

  const accent = item.accent ?? TEAL;

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY;
    dragY.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return;
    const raw = e.touches[0].clientY - startY.current;
    // Upward drag is resisted when there's nothing next — the sheet shouldn't
    // promise a story that isn't there.
    const dy = raw < 0 && !hasNext ? raw / 4 : raw;
    dragY.current = dy;
    setDrag(dy);
  }
  function onTouchEnd() {
    const dy = dragY.current;
    startY.current = null;
    dragY.current = 0;
    setDrag(0);
    if (dy > COMMIT_PX) onClose();
    else if (dy < -COMMIT_PX && hasNext) next();
  }

  async function share() {
    const url = item.internal ? `https://yourscore.app${item.url}` : item.url;
    const text = `${item.title} · via YourScore`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: item.title, text, url });
        return;
      } catch {
        // cancelled or unsupported — fall through to the clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { /* ignore */ }
  }

  function read() {
    if (item.internal) {
      // Ours renders in the app already, so route to it rather than opening a tab.
      onClose();
      router.push(item.url);
      return;
    }
    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(4,8,6,0.72)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes ys-sheet-up { from { transform: translateY(14%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes ys-story-in { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .ys-sheet { animation: ys-sheet-up 260ms cubic-bezier(.22,1,.36,1); }
        .ys-story { animation: ys-story-in 220ms cubic-bezier(.22,1,.36,1); }
        .ys-sheetbtn { transition: background 160ms, border-color 160ms; }
        .ys-sheetbtn:active { transform: scale(0.97); }
        @media (prefers-reduced-motion: reduce) {
          .ys-sheet, .ys-story { animation: none }
          .ys-sheetbtn { transition: none }
        }
      `}</style>

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        tabIndex={-1}
        className="ys-sheet"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          width: "100%", maxWidth: 512,
          background: PANEL,
          borderTop: `1px solid ${LINE}`,
          borderRadius: "20px 20px 0 0",
          overflow: "hidden",
          transform: `translateY(${drag}px)`,
          transition: drag === 0 ? "transform 260ms cubic-bezier(.22,1,.36,1)" : "none",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        {/* Grab handle — the only affordance that says this thing moves. */}
        <div style={{ display: "flex", justifyContent: "center", padding: "9px 0 3px" }}>
          <div style={{ width: 38, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
        </div>

        <div key={item.id} className="ys-story">
          {item.image && (
            <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#0b100e" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {hasNext && (
                <div
                  aria-hidden="true"
                  style={{
                    // The scrim has to carry the text on a WHITE press shot as
                    // well as a dark one — at 0.45 the hint vanished on a cutout
                    // image. Tall gradient, dark at the baseline, text sat low.
                    position: "absolute", left: 0, right: 0, bottom: 0,
                    padding: "26px 0 7px",
                    textAlign: "center", fontSize: 11, letterSpacing: 0.2, color: "rgba(255,255,255,0.92)",
                    textShadow: "0 1px 4px rgba(0,0,0,0.9)",
                    background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.55) 45%, transparent)",
                  }}
                >
                  Swipe up for the next story
                </div>
              )}
            </div>
          )}

          {!item.image && hasNext && (
            <div aria-hidden="true" style={{ textAlign: "center", fontSize: 11, color: MUTED, paddingTop: 4 }}>
              Swipe up for the next story
            </div>
          )}

          <div style={{ padding: "14px 16px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: MUTED }}>
              <span style={{ color: accent, fontWeight: 600 }}>{item.source}</span>
              <span aria-hidden="true">·</span>
              <span>{item.timeLabel}</span>
            </div>

            {item.bodyStyle === "quote" ? (
              <p style={{ margin: "10px 0 0", color: INK, fontSize: 16, lineHeight: 1.5, fontWeight: 400 }}>
                {item.title}
              </p>
            ) : (
              <h2 style={{ margin: "8px 0 0", color: INK, fontSize: 20, lineHeight: 1.25, fontWeight: 700 }}>
                {item.title}
              </h2>
            )}

            {item.summary && (
              <p style={{ margin: "10px 0 0", color: "#b9c2bd", fontSize: 14.5, lineHeight: 1.55 }}>
                {item.summary}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, padding: "16px 16px 18px" }}>
          <button onClick={read} className="ys-sheetbtn" style={btn(true, accent)}>
            {item.readLabel ?? (item.internal ? "Read in the app" : "Read the full story")}
          </button>
          <button onClick={share} className="ys-sheetbtn" style={btn(false, accent)}>
            {copied ? "Link copied" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}

function btn(primary: boolean, accent: string): React.CSSProperties {
  return {
    flex: primary ? 2 : 1,
    minHeight: 46,
    borderRadius: 12,
    border: `1px solid ${primary ? accent : LINE}`,
    background: primary ? accent : "transparent",
    color: primary ? "#062018" : INK,
    fontSize: 14,
    fontWeight: primary ? 700 : 600,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };
}
