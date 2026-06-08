"use client";

import { useState } from "react";

export function SaveTeamButton({ ogUrl }: { ogUrl: string }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(ogUrl);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "yourscore-38-0.png";
      a.click();
      URL.revokeObjectURL(url);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // fallback: open image in new tab
      window.open(ogUrl, "_blank", "noopener");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={handleSave}
      disabled={saving}
      className="inline-flex items-center justify-center gap-2 font-body font-bold rounded-2xl px-6 py-4 transition-all active:scale-[0.97] disabled:opacity-60"
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 16, width: "100%" }}
    >
      {saving ? (
        <>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
            <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Saving…
        </>
      ) : saved ? (
        <>✓ Saved!</>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1v9M4 6l4 4 4-4M2 12h12v3H2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Save My Team
        </>
      )}
    </button>
  );
}
