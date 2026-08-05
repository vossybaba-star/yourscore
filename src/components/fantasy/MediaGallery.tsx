"use client";
/**
 * Full-screen image gallery for a feed post (Phase 2a). Portaled to <body> for
 * the same reason as Sheet in shared.tsx — a fixed overlay inside
 * main[data-fantasy] gets trapped below the z-50 BottomNav. Opens at a given
 * index, then a horizontal swipe (touch) or the arrow keys move between images.
 * Pinch-to-zoom is native: `touch-action: pinch-zoom` on the image lets the OS
 * handle the gesture, no library. Closes via the X button or a backdrop tap;
 * body scroll is locked while open.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function MediaGallery({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const [mounted, setMounted] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => setI(index), [index]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, images.length - 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  if (!mounted) return null;

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) setI((v) => Math.min(v + 1, images.length - 1));
      else setI((v) => Math.max(v - 1, 0));
    }
    touchStartX.current = null;
  };

  const arrowBtn: React.CSSProperties = {
    position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 1,
    background: "rgba(255,255,255,0.12)", border: "none", color: "#fff",
    width: 38, height: 38, borderRadius: 999, fontSize: 18, cursor: "pointer",
  };

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.92)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "calc(14px + env(safe-area-inset-top)) 16px 10px", flexShrink: 0,
      }}>
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{i + 1}/{images.length}</span>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Close" style={{
          background: "rgba(255,255,255,0.12)", border: "none", color: "#fff",
          width: 34, height: 34, borderRadius: 999, fontSize: 18, cursor: "pointer", lineHeight: 1,
        }}>×</button>
      </div>

      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{
        flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0,
      }}>
        {images.length > 1 && (
          <button onClick={(e) => { e.stopPropagation(); setI((v) => Math.max(v - 1, 0)); }} aria-label="Previous image" style={{ ...arrowBtn, left: 8 }}>‹</button>
        )}
        <div style={{ width: "100%", height: "100%", overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[i]} alt="" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", touchAction: "pinch-zoom" }} />
        </div>
        {images.length > 1 && (
          <button onClick={(e) => { e.stopPropagation(); setI((v) => Math.min(v + 1, images.length - 1)); }} aria-label="Next image" style={{ ...arrowBtn, right: 8 }}>›</button>
        )}
      </div>

      {images.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "10px 0 calc(14px + env(safe-area-inset-bottom))", flexShrink: 0 }}>
          {images.map((_, d) => (
            <span key={d} style={{ width: 6, height: 6, borderRadius: 999, background: d === i ? "#fff" : "rgba(255,255,255,0.35)" }} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
