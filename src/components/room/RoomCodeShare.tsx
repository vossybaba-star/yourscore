"use client";

import { useState } from "react";

export function RoomCodeShare({ code, roomName, matchLabel }: { code: string; roomId?: string; roomName: string; matchLabel?: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const url = `${typeof window !== "undefined" ? window.location.origin : "https://yourscore.vercel.app"}/join/${code}`;

  const shareText = [
    `Join my YourScore room 🏆`,
    matchLabel ? `Match: ${matchLabel}` : null,
    `Room: ${roomName}`,
    `Code: ${code}`,
    `Join here: ${url}`,
  ].filter(Boolean).join("\n");

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied("code");
    setTimeout(() => setCopied(null), 2000);
  }

  function copyLink() {
    navigator.clipboard.writeText(url);
    setCopied("link");
    setTimeout(() => setCopied(null), 2000);
  }

  async function shareNative() {
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${roomName}`, text: shareText, url }); }
      catch { /* dismissed */ }
    } else {
      copyLink();
    }
  }

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
  }

  function shareSMS() {
    window.open(`sms:?body=${encodeURIComponent(shareText)}`, "_blank");
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
      {/* Code display */}
      <div className="px-5 pt-5 pb-4">
        <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Room code</p>
        <div className="flex items-center gap-3 mb-1">
          <span className="font-display text-5xl tracking-[0.12em]" style={{ color: "#00ff87", textShadow: "0 0 20px rgba(0,255,135,0.3)" }}>
            {code}
          </span>
          <button
            onClick={copyCode}
            className="ml-auto flex items-center gap-1.5 text-xs font-body font-semibold px-3 py-2 rounded-lg transition-all"
            style={{
              background: copied === "code" ? "rgba(0,255,135,0.15)" : "rgba(255,255,255,0.06)",
              color: copied === "code" ? "#00ff87" : "#8888aa",
              border: `1px solid ${copied === "code" ? "rgba(0,255,135,0.3)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {copied === "code" ? "✓ Copied" : "Copy code"}
          </button>
        </div>
        <p className="font-body text-xs text-text-muted">Anyone with this code can join your room</p>
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

      {/* Share buttons */}
      <div className="p-4 grid grid-cols-2 gap-2">
        <button
          onClick={copyLink}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-body font-medium text-white transition-all hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {copied === "link" ? (
            <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3 3 7-7" stroke="#00ff87" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg><span style={{ color: "#00ff87" }}>Copied!</span></>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5l3-3M6.5 4.5l1-1a2.828 2.828 0 1 1 4 4l-1 1M7.5 9.5l-1 1a2.828 2.828 0 1 1-4-4l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>Copy link</>
          )}
        </button>

        <button
          onClick={shareNative}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-body font-medium text-white transition-all hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 4L7 1l3 3M2 9v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Share
        </button>

        <button
          onClick={shareWhatsApp}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-body font-medium transition-all hover:opacity-80"
          style={{ background: "rgba(37,211,102,0.1)", border: "1px solid rgba(37,211,102,0.2)", color: "#25d366" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
          </svg>
          WhatsApp
        </button>

        <button
          onClick={shareSMS}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-body font-medium transition-all hover:opacity-80"
          style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4l-3 2V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          </svg>
          SMS / iMessage
        </button>
      </div>
    </div>
  );
}
