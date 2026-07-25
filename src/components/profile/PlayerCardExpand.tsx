"use client";

import { useState } from "react";
import { PlayerCard, tierFor, ATTRIBUTE_META, ATTRIBUTE_ORDER, type Attributes } from "@/components/profile/PlayerCard";

/**
 * Tap the card to open it bigger, with the six attributes spelled out.
 *
 * The card face only has room for three-letter codes (KNO, PAC…), which look
 * sharp but tell a new player nothing. The expanded view is where the codes
 * become words and each one gets a line on what it actually measures.
 *
 * The card itself is a plain SVG; this thin client wrapper adds the tap + modal
 * so the visual component stays server-rendered and shareable.
 */
export function PlayerCardExpand(props: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  ovr: number;
  archetype: string;
  club: string | null;
  attributes: Attributes;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const tier = tierFor(props.ovr);

  return (
    <>
      {/* The card's own avatar-picker overlay sits ABOVE this in the page, so a
          tap on the avatar still changes it; taps anywhere else expand. */}
      <button
        onClick={() => setOpen(true)}
        className="block w-full active:scale-[0.98] transition-transform"
        style={{ maxWidth: props.width }}
        aria-label={`Expand ${props.name}'s card`}
      >
        <PlayerCard {...props} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-6 py-8 overflow-y-auto"
          style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm"
            style={{ animation: "slideUp 0.24s ease" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ maxWidth: 220, margin: "0 auto 20px" }}>
              <PlayerCard {...props} width={220} />
            </div>

            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p
                className="font-body text-[10px] uppercase tracking-widest px-4 pt-4 pb-1"
                style={{ color: "#8a948f" }}
              >
                What your ratings mean
              </p>
              {ATTRIBUTE_ORDER.map((k, i) => {
                const meta = ATTRIBUTE_META[k];
                return (
                  <div
                    key={k}
                    className="flex items-center gap-3 px-4 py-2.5"
                    style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}
                  >
                    <span
                      className="font-display flex-shrink-0 text-right"
                      style={{ width: 34, fontSize: 24, color: tier.edge === "#8a948f" ? "#eef2f0" : tier.edge, lineHeight: 1 }}
                    >
                      {props.attributes[k]}
                    </span>
                    <div className="min-w-0">
                      <p className="font-body text-sm text-white leading-tight">
                        {meta.label} <span style={{ color: "#586058" }}>· {k}</span>
                      </p>
                      <p className="font-body text-xs text-text-muted leading-tight mt-0.5">{meta.blurb}</p>
                    </div>
                  </div>
                );
              })}
              <p className="font-body text-[11px] text-text-muted px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                {props.ovr} overall · {props.archetype} — every YourScore game raises these, not just one.
              </p>
            </div>

            <button
              onClick={() => setOpen(false)}
              className="w-full mt-4 rounded-2xl py-3 font-body text-sm"
              style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
