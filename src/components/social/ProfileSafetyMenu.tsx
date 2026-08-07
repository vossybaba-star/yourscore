"use client";
/**
 * Report / Block / Mute for a profile page (Social Phase 5a). Renders nothing
 * on your own profile or for a signed-out visitor (AC8 — guests unaffected,
 * these controls are signed-in-only). Once blocked, this collapses to a
 * single "You've blocked this manager" banner + Unblock (AC3) instead of the
 * overflow menu — blocking is the stronger action, so there's nothing left to
 * report or mute from here.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { useUser } from "@/hooks/useUser";
import { ReportSheet } from "@/components/social/ReportSheet";

export function ProfileSafetyMenu({ userId, userName, initialBlocked, initialMuted }: {
  userId: string; userName: string; initialBlocked: boolean; initialMuted: boolean;
}) {
  const { user } = useUser();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blocked, setBlocked] = useState(initialBlocked);
  const [muted, setMuted] = useState(initialMuted);
  const [busy, setBusy] = useState(false);

  if (!user || user.id === userId) return null;

  const toggleBlock = async () => {
    if (busy) return;
    const next = !blocked;
    if (next && !window.confirm(`Block ${userName}? You won't see each other's posts, and you'll stop following each other.`)) {
      setMenuOpen(false); return;
    }
    setBusy(true); setMenuOpen(false);
    try {
      const res = await fetch("/api/social/block", {
        method: next ? "POST" : "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) { setBlocked(next); if (next) setMuted(false); router.refresh(); }
    } finally { setBusy(false); }
  };

  const toggleMute = async () => {
    if (busy) return;
    const next = !muted;
    setBusy(true); setMenuOpen(false);
    try {
      const res = await fetch("/api/social/mute", {
        method: next ? "POST" : "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) { setMuted(next); router.refresh(); }
    } finally { setBusy(false); }
  };

  if (blocked) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: PANEL_2, border: `1px solid ${LINE}` }}>
        <span style={{ fontSize: 13, color: MUTED, flex: 1 }}>You&apos;ve blocked this manager</span>
        <button onClick={toggleBlock} disabled={busy} style={{
          fontSize: 12.5, fontWeight: 700, color: TEAL, background: "none", border: `1px solid ${tint(TEAL, "55")}`,
          borderRadius: 999, padding: "6px 12px", cursor: busy ? "default" : "pointer",
        }}>Unblock</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", position: "relative" }}>
      <button onClick={() => setMenuOpen((o) => !o)} aria-label="More" style={{
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        width: 30, height: 30, borderRadius: 999, background: menuOpen ? PANEL_2 : "none",
        border: "none", color: MUTED, fontSize: 17, letterSpacing: "0.08em", lineHeight: 1,
      }}>···</button>
      {menuOpen && (
        <>
          <div onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 8 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 9, minWidth: 190,
            borderRadius: 12, background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            padding: "4px 0", overflow: "hidden",
          }}>
            <button onClick={() => { setMenuOpen(false); setReportOpen(true); }} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
              background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: INK, whiteSpace: "nowrap",
            }}><span aria-hidden style={{ fontSize: 15 }}>🚩</span>Report {userName}</button>
            <button onClick={toggleMute} disabled={busy} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
              background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: INK, whiteSpace: "nowrap",
            }}><span aria-hidden style={{ fontSize: 15 }}>🔇</span>{muted ? `Unmute ${userName}` : `Mute ${userName}`}</button>
            <button onClick={toggleBlock} disabled={busy} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
              background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: "#E08A6B", whiteSpace: "nowrap",
            }}><span aria-hidden style={{ fontSize: 15 }}>🚫</span>Block {userName}</button>
          </div>
        </>
      )}
      {reportOpen && <ReportSheet subjectType="profile" subjectId={userId} onClose={() => setReportOpen(false)} />}
    </div>
  );
}
