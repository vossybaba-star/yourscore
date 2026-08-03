"use client";
/**
 * Swipe-down-to-refresh for the fantasy feeds (founder, 3 Aug). Pull the top of
 * the page down and let go to fetch the latest; a small indicator tracks the
 * pull, spins while it loads, then says whether there was anything new ("Updated"
 * vs "You're up to date"). Only arms when the page is scrolled to the very top,
 * so it never fights a normal scroll.
 *
 * onRefresh returns { updated } so we can tell the two end states apart; return
 * nothing and it just says "Updated".
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

const TRIGGER = 64; // px of pull needed to fire a refresh
const MAX = 96; // px the content can travel while pulling (rubber-banded)
const TEAL = "#00d8c0";

type Phase = "idle" | "pulling" | "ready" | "refreshing" | "done";

export function PullToRefresh({ onRefresh, children, accent = TEAL }: {
  onRefresh: () => Promise<{ updated?: boolean } | void>;
  children: ReactNode;
  accent?: string;
}) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (phase === "refreshing") return;
    // Only arm at the very top of the page, or a mid-page down-swipe would trip it.
    if (window.scrollY > 0) { armed.current = false; return; }
    startY.current = e.touches[0].clientY;
    armed.current = true;
  }, [phase]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!armed.current || startY.current == null || phase === "refreshing") return;
    if (window.scrollY > 0) { armed.current = false; startY.current = null; setPull(0); setPhase("idle"); return; }
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) { if (pull !== 0) setPull(0); if (phase !== "idle") setPhase("idle"); return; }
    const p = Math.min(MAX, dy * 0.5); // resist as it stretches
    setPull(p);
    setPhase(p >= TRIGGER ? "ready" : "pulling");
  }, [phase, pull]);

  const onTouchEnd = useCallback(async () => {
    if (!armed.current) return;
    armed.current = false;
    startY.current = null;
    if (phase !== "ready") { setPull(0); setPhase("idle"); return; }
    setPhase("refreshing");
    setPull(TRIGGER * 0.6);
    let updated: boolean | undefined;
    try { const r = await onRefresh(); updated = r?.updated; } catch { /* keep what's on screen */ }
    setMsg(updated === false ? "You're up to date" : "Updated");
    setPhase("done");
    setPull(0);
    window.setTimeout(() => setPhase((cur) => (cur === "done" ? "idle" : cur)), 1300);
  }, [phase, onRefresh]);

  const label = phase === "ready" ? "Release to refresh"
    : phase === "refreshing" ? "Refreshing…"
    : phase === "done" ? msg
    : "Pull to refresh";
  const show = phase !== "idle";
  const spin = phase === "refreshing";

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{ position: "relative" }}
    >
      {/* Indicator sits above the content and is revealed as the content slides down. */}
      <div aria-live="polite" style={{
        position: "absolute", top: -34, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        height: 30, opacity: show ? 1 : 0, transition: phase === "pulling" || phase === "ready" ? "none" : "opacity .2s ease",
        pointerEvents: "none",
      }}>
        <span style={{
          width: 14, height: 14, borderRadius: "50%",
          border: `2px solid ${accent}`, borderTopColor: "transparent",
          transform: spin ? undefined : `rotate(${Math.min(180, (pull / TRIGGER) * 180)}deg)`,
          animation: spin ? "ptr-spin .7s linear infinite" : undefined,
          display: phase === "done" ? "none" : "inline-block",
        }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>
          {phase === "done" ? "✓ " : ""}{label}
        </span>
      </div>

      <div style={{ transform: `translateY(${pull}px)`, transition: pull === 0 ? "transform .25s ease" : "none", willChange: "transform" }}>
        {children}
      </div>

      <style>{`@keyframes ptr-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
