"use client";
/**
 * Share a feed post anywhere (founder, 3 Aug — "share to WhatsApp, X, Instagram
 * as a story, a bunch of options", not just to a league). One "Share" action
 * opens a sheet with every channel plus the existing share-to-a-league flow.
 *
 * The sheet is the shared portaled <Sheet/>, so its controls never hide under the
 * bottom nav. A signed-out user can still share (these are outbound links); only
 * the in-app "Share to a league" needs an account, handled by ShareToLeague.
 */
import { useState, type ReactNode } from "react";
import { GOLD, INK, LINE, MUTED, PANEL_2, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { ShareToLeague } from "@/components/fantasy/league/ShareToLeague";

/** One channel row — an icon in its brand colour, a label, a hint. */
function ChannelRow({ onClick, accent, label, sub, icon }: { onClick: () => void; accent: string; label: string; sub: string; icon: ReactNode }) {
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

export function SharePost({ url, text, leagueBody, trigger, open: openProp, onClose }: {
  /** The public link to share (a manager's squad, a player, or the feed). */
  url: string;
  /** The message that leads the share. */
  text: string;
  /** Payload for the in-app "Share to a league" option (null hides it). */
  leagueBody?: () => Record<string, unknown> | null;
  trigger?: (open: () => void) => ReactNode;
  /** Controlled mode — the parent owns open state (the feed's ⋯ menu). When
   *  provided, `trigger` may be omitted and `onClose` must be handled. */
  open?: boolean;
  onClose?: () => void;
}) {
  const [openState, setOpen] = useState(false);
  const open = openProp ?? openState;
  const [copied, setCopied] = useState(false);
  const msg = `${text} ${url}`;

  const close = () => { setOpen(false); onClose?.(); };
  const openExternal = (href: string) => { window.open(href, "_blank", "noopener,noreferrer"); close(); };
  const shareNative = () => {
    if (navigator.share) navigator.share({ text, url }).catch(() => {});
    close();
  };
  const shareWhatsApp = () => openExternal(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  const shareX = () => openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`);
  const shareInstagram = async () => {
    // Instagram has no web hand-off for a link, so copy it and open Instagram —
    // paste it straight into a story or a DM.
    try { await navigator.clipboard.writeText(url); } catch { /* no clipboard */ }
    openExternal("https://www.instagram.com/");
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* no clipboard */ }
  };
  const body = leagueBody?.() ?? null;

  return (
    <>
      {trigger?.(() => { setCopied(false); setOpen(true); })}
      {open && (
        <Sheet onClose={close} labelledBy="share-post-title">
          <div id="share-post-title" className="font-display" style={{ fontSize: 20, color: INK, lineHeight: 1.1 }}>Share</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "4px 0 14px", lineHeight: 1.45 }}>Send it wherever your football chat lives.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {typeof navigator !== "undefined" && !!navigator.share && (
              <ChannelRow onClick={shareNative} accent={TEAL} label="Share…" sub="Your phone's share sheet"
                icon={<><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>} />
            )}
            <ChannelRow onClick={shareWhatsApp} accent="#25D366" label="WhatsApp" sub="Send to a chat or group"
              icon={<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.5-1.3A9 9 0 1012 3z" />} />
            <ChannelRow onClick={shareX} accent="#e7e9ea" label="X" sub="Post it to your timeline"
              icon={<path d="M4 4l16 16M20 4L4 20" />} />
            <ChannelRow onClick={shareInstagram} accent="#E1306C" label="Instagram" sub="Copy the link, then add to your story"
              icon={<><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><circle cx="17" cy="7" r="0.6" fill="currentColor" /></>} />
            <ChannelRow onClick={copyLink} accent={GOLD} label={copied ? "Link copied" : "Copy link"} sub={url}
              icon={<><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></>} />
            {body && (
              <ShareToLeague
                buildBody={() => body}
                trigger={(openShare) => (
                  <ChannelRow onClick={() => { close(); openShare(); }} accent={TEAL} label="Share to a league" sub="Drop it into a league chat"
                    icon={<><path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M21 21v-2a4 4 0 00-3-3.9M16 3.1A4 4 0 0116 11" /></>} />
                )}
              />
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
