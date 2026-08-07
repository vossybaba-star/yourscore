"use client";
/**
 * The "now bring your friends" moment (founder, 7 Aug). It fires ONCE, right
 * after a manager confirms their first squad — the builder routes to
 * /fantasy/squad?created=1 and SquadTabs opens this. Fantasy lands harder with
 * people you know, so the beat straight after building is where we ask.
 *
 * Two steps in one sheet: NAME + create a private league (one tap, prefilled),
 * then SHARE its invite link — the same `${origin}/fantasy/leagues/${code}` link
 * the leagues page shares, handed to WhatsApp / X / the phone's share sheet, with
 * copy as the fallback. Private by default: it fills from the link you send, not
 * from a public list.
 *
 * Never blocks anything — "Maybe later" and the backdrop both just close it, and
 * the squad is already saved by the time this shows.
 */
import { useState } from "react";
import { GOLD, INK, LINE, LIME, MUTED, PANEL_2, Sheet, TEAL, tint } from "@/components/fantasy/shared";

/** One share channel — an icon in its brand colour, a label, a hint. Mirrors the
 *  SharePost sheet so the two invite surfaces feel like one thing. */
function Channel({ onClick, accent, label, sub, icon }: {
  onClick: () => void; accent: string; label: string; sub: string; icon: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer",
      background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "11px 13px",
    }}>
      <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, background: tint(accent, "1e"), border: `1px solid ${tint(accent, "44")}`, color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: INK }}>{label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
      </span>
      <span style={{ color: MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  );
}

export function LeagueInviteNudge({ open, onClose, defaultName }: {
  open: boolean;
  onClose: () => void;
  /** Prefill for the league name — the manager's own name reads best. */
  defaultName: string;
}) {
  const [name, setName] = useState(defaultName);
  const [step, setStep] = useState<"create" | "share">("create");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const url = code ? `${window.location.origin}/fantasy/leagues/${code}` : "";
  const shareText = `Join my YourScore Fantasy league "${name.trim() || "our league"}"`;
  const msg = `${shareText} ${url}`;

  const create = async () => {
    const clean = name.trim();
    if (!clean) { setErr("Give your league a name"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/fantasy/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not create your league");
      setCode(data.code);
      setStep("share");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openExternal = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  const shareWhatsApp = () => openExternal(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  const shareX = () => openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`);
  const shareNative = () => { if (navigator.share) navigator.share({ text: shareText, url }).catch(() => {}); };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* no clipboard */ }
  };

  return (
    <Sheet onClose={onClose} labelledBy="league-nudge-title">
      {step === "create" ? (
        <>
          <div id="league-nudge-title" className="font-display" style={{ fontSize: 22, color: INK, lineHeight: 1.08 }}>
            Squad in. Now bring your friends
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "6px 0 16px", lineHeight: 1.5 }}>
            Fantasy is better in a league. Start one, send the link, and see who really knows their football.
          </p>

          <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: 0.3, marginBottom: 6 }}>
            LEAGUE NAME
          </label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (err) setErr(null); }}
            maxLength={40}
            placeholder="Give your league a name"
            style={{
              width: "100%", boxSizing: "border-box", background: PANEL_2, border: `1px solid ${LINE}`,
              borderRadius: 12, padding: "12px 13px", color: INK, fontSize: 15, fontWeight: 600, outline: "none",
            }}
          />
          {err && <p style={{ color: "#ff8b8b", fontSize: 12.5, margin: "8px 2px 0" }}>{err}</p>}

          <button onClick={create} disabled={busy} style={{
            width: "100%", marginTop: 14, padding: "13px 16px", borderRadius: 12, border: "none",
            background: busy ? tint(TEAL, "66") : TEAL, color: "#04120f", fontSize: 15, fontWeight: 800,
            cursor: busy ? "default" : "pointer",
          }}>
            {busy ? "Creating…" : "Create your league"}
          </button>
          <button onClick={onClose} style={{
            width: "100%", marginTop: 8, padding: "10px", borderRadius: 12, border: "none",
            background: "transparent", color: MUTED, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
          }}>
            Maybe later
          </button>
        </>
      ) : (
        <>
          <div id="league-nudge-title" className="font-display" style={{ fontSize: 22, color: INK, lineHeight: 1.08 }}>
            {name.trim() || "Your league"} is live
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "6px 0 16px", lineHeight: 1.5 }}>
            Send this link to your friends. Anyone who opens it drops straight into your league.
          </p>

          <div style={{
            display: "flex", alignItems: "center", gap: 10, background: PANEL_2, border: `1px solid ${tint(LIME, "44")}`,
            borderRadius: 12, padding: "11px 13px", marginBottom: 12,
          }}>
            <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
            <button onClick={copyLink} style={{
              flexShrink: 0, padding: "7px 12px", borderRadius: 9, border: "none", cursor: "pointer",
              background: copied ? tint(LIME, "22") : tint(GOLD, "1e"), color: copied ? LIME : GOLD, fontSize: 12.5, fontWeight: 800,
            }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {typeof navigator !== "undefined" && !!navigator.share && (
              <Channel onClick={shareNative} accent={TEAL} label="Share…" sub="Your phone's share sheet"
                icon={<><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>} />
            )}
            <Channel onClick={shareWhatsApp} accent="#25D366" label="WhatsApp" sub="Send to a chat or group"
              icon={<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.5-1.3A9 9 0 1012 3z" />} />
            <Channel onClick={shareX} accent="#e7e9ea" label="X" sub="Post it to your timeline"
              icon={<path d="M4 4l16 16M20 4L4 20" />} />
          </div>

          <button onClick={onClose} style={{
            width: "100%", marginTop: 14, padding: "12px", borderRadius: 12, border: `1px solid ${LINE}`,
            background: "transparent", color: INK, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}>
            Done
          </button>
        </>
      )}
    </Sheet>
  );
}
