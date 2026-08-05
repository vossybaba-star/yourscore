"use client";
/**
 * A bottom sheet to report a post, chat message or profile (Social Phase 5a,
 * AC2). Reason chips + an optional 200-char detail field + Submit. Reusable
 * across the three surfaces it's wired into (FeedStream's CardMenu,
 * LeagueChatView's message action row, ProfileSafetyMenu) — same portal
 * pattern as InviteToLeagueSheet, since the sheet is position:fixed and would
 * otherwise get trapped inside a transformed ancestor (the feed's
 * pull-to-refresh wrapper, the chat's message list).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { trackReportSubmitted } from "@/lib/analytics/trackSocial";

const REASONS = ["Spam", "Abuse or hate", "Unsafe link", "Other"] as const;
const DETAIL_MAX = 200;

export function ReportSheet({ subjectType, subjectId, onClose }: {
  subjectType: "post" | "comment" | "profile";
  subjectId: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [reason, setReason] = useState<typeof REASONS[number] | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy || done || !reason) return;
    setBusy(true); setErr(null);
    try {
      const combined = [reason, detail.trim()].filter(Boolean).join(". ");
      const res = await fetch("/api/social/report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, reason: combined || null }),
      });
      if (res.status === 401) { window.location.href = "/auth/sign-in"; return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "Couldn't send that report"); setBusy(false); return;
      }
      trackReportSubmitted(subjectType);
      setDone(true); setBusy(false);
      window.setTimeout(onClose, 1400);
    } catch { setErr("Couldn't send that report"); setBusy(false); }
  };

  if (!mounted) return null;

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center",
      background: "rgba(4,8,6,0.6)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 512, background: PANEL, borderTopLeftRadius: 18, borderTopRightRadius: 18,
        border: `1px solid ${LINE}`, borderBottom: "none", padding: "16px 16px calc(20px + env(safe-area-inset-bottom))",
        maxHeight: "80vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div className="font-display" style={{ fontSize: 17, color: INK }}>Report</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, padding: "0 4px" }}>Close</button>
        </div>

        {done ? (
          <p style={{ fontSize: 13.5, color: TEAL, fontWeight: 600, padding: "8px 0 4px" }}>
            Reported. Our team will take a look.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>What&apos;s wrong with this?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)} aria-pressed={reason === r} style={{
                  padding: "8px 13px", minHeight: 44, borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  background: reason === r ? tint(TEAL, "22") : PANEL_2, color: reason === r ? TEAL : MUTED,
                  border: `1px solid ${reason === r ? tint(TEAL, "66") : LINE}`,
                }}>{r}</button>
              ))}
            </div>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, DETAIL_MAX))} maxLength={DETAIL_MAX}
              placeholder="Add detail, optional" rows={3}
              style={{
                width: "100%", resize: "none", fontSize: 13.5, padding: "10px 12px", borderRadius: 10,
                background: PANEL_2, border: `1px solid ${LINE}`, color: INK, outline: "none", fontFamily: "inherit",
                boxSizing: "border-box",
              }} />
            <div style={{ fontSize: 11, color: MUTED, textAlign: "right", marginTop: 4 }}>{detail.length}/{DETAIL_MAX}</div>

            {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "8px 0 0" }}>{err}</p>}

            <button onClick={submit} disabled={!reason || busy} style={{
              width: "100%", marginTop: 12, padding: "12px 0", minHeight: 44, borderRadius: 999, fontSize: 14, fontWeight: 700,
              cursor: (!reason || busy) ? "default" : "pointer",
              background: (!reason || busy) ? PANEL_2 : TEAL, color: (!reason || busy) ? MUTED : "#04231f", border: "none",
            }}>{busy ? "Sending…" : "Submit"}</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
