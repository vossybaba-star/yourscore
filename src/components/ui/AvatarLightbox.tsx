"use client";
/**
 * Wrap a manager's (small) display picture so a tap opens it big enough to
 * actually see (founder, 3 Aug). Portaled to <body> so it sits above the nav
 * and any page stacking context; tap anywhere to close. Falls back to a large
 * gradient monogram when the manager has no uploaded photo.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { avatarPalette, avatarInitial } from "@/lib/avatar";

export function AvatarLightbox({ name, avatarUrl, children }: { name: string; avatarUrl: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pal = avatarPalette(name);

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        aria-label={`View ${name}'s picture`}
        style={{ background: "none", border: "none", padding: 0, margin: 0, cursor: "zoom-in", display: "inline-flex", lineHeight: 0 }}>
        {children}
      </button>

      {open && mounted && createPortal(
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.86)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name} onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "min(86vw, 420px)", maxHeight: "72vh", borderRadius: 20, objectFit: "contain", border: "1px solid rgba(255,255,255,0.12)" }} />
          ) : (
            <div onClick={(e) => e.stopPropagation()} style={{
              width: "min(70vw, 300px)", height: "min(70vw, 300px)", borderRadius: 24,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(140deg, ${pal.from}, ${pal.to})`, color: pal.fg,
              fontSize: "min(30vw, 130px)", fontWeight: 800,
            }}>{avatarInitial(name)}</div>
          )}
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{name}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
