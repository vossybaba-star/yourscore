"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { fantasyVisible } from "@/lib/fantasy/flag";
import { trackDiag } from "@/lib/analytics/trackGame";

const GOLD = "#ffc400";
const HAS_SQUAD_KEY = "ys:fantasy:pop:hasSquad";
const DONE_KEY = "ys:fantasy:pop:done";

export interface FantasyResultInterstitialProps {
  /** Where the pop fired, e.g. "quiz", "p10", "wc-run" — passed to both diagnostics. */
  surface: string;
  /** Compact score summary shown big, up top, never covered by the ad panel. */
  scoreLine: ReactNode;
  /** The signed-in viewer's id, or null for a guest — the mounting surface
   *  already has this, so the pop never re-derives auth. */
  userId: string | null;
}

/**
 * Full-screen "you just finished a game" advert for Fantasy. The mounting
 * surface decides WHEN to render this at all — only on a genuine just-finished
 * transition, never a revisit (see each mount site) — this component only
 * decides WHETHER, once asked.
 *
 * Only pops when fantasy is visible to this viewer (lib/fantasy/flag.ts) —
 * while it's gated, the inline FantasyPromoCard on the results screen
 * underneath carries the "save your spot" pitch instead, so a flag-off viewer
 * never sees this. A signed-in viewer who already has a squad is suppressed
 * too: this is an acquisition push, not a nag for people already playing. That
 * check is one fetch per browser session (cached in sessionStorage), and once
 * a squad's confirmed the suppression is permanent (localStorage) so it's
 * never fetched again on this device. A failed fetch fails CLOSED — never pop
 * over what might be a squad owner.
 */
export function FantasyResultInterstitial({ surface, scoreLine, userId }: FantasyResultInterstitialProps) {
  const [eligible, setEligible] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!fantasyVisible(userId)) return;
    if (!userId) { setEligible(true); return; } // guests always eligible — no fetch
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DONE_KEY) === "1") return;

    const cached = window.sessionStorage.getItem(HAS_SQUAD_KEY);
    if (cached === "1") { window.localStorage.setItem(DONE_KEY, "1"); return; }
    if (cached === "0") { setEligible(true); return; }

    fetch("/api/fantasy/state", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((data: { squad: unknown }) => {
        const hasSquad = Boolean(data.squad);
        window.sessionStorage.setItem(HAS_SQUAD_KEY, hasSquad ? "1" : "0");
        if (hasSquad) { window.localStorage.setItem(DONE_KEY, "1"); return; }
        setEligible(true);
      })
      .catch(() => { /* fail closed — stays hidden */ });
  }, [userId]);

  useEffect(() => {
    if (!eligible || shownRef.current) return;
    shownRef.current = true;
    setOpen(true);
    trackDiag("fantasy_pop_shown", { surface });
  }, [eligible, surface]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") dismiss(); }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    setClosing(true);
    setTimeout(() => setOpen(false), 180);
  }

  if (!open) return null;

  const cta = userId
    ? { href: "/fantasy?ref=postgame-pop", label: "BUILD YOUR SQUAD →" }
    : { href: "/auth/sign-in?next=%2Ffantasy%3Fref%3Dpostgame-pop", label: "SIGN UP NOW →" };

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto"
      style={{ background: "rgba(4,4,7,0.94)" }}
      onClick={dismiss}
    >
      <div
        className="relative mx-auto w-full max-w-sm px-5 pt-safe pb-8 flex flex-col"
        style={{ animation: closing ? "fantasyPopOut 180ms ease-in forwards" : "fantasyPopIn 250ms cubic-bezier(0.34,1.56,0.64,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={dismiss} aria-label="Close" className="self-end mt-3 font-body text-2xl leading-none" style={{ color: "#8a948f" }}>
          ✕
        </button>

        {/* Score — always visible, never obstructed by the ad below */}
        <div className="text-center mt-1 mb-5">
          <p className="font-display text-xs tracking-widest" style={{ color: "#8a948f" }}>FULL TIME</p>
          <p className="font-display text-white mt-1" style={{ fontSize: 40, lineHeight: 1.05 }}>{scoreLine}</p>
        </div>

        {/* Ad panel */}
        <div
          className="rounded-3xl p-4"
          style={{
            background: "linear-gradient(160deg, rgba(255,196,0,0.16), rgba(255,196,0,0.03))",
            border: `1px solid ${GOLD}`,
            boxShadow: `0 0 44px -10px ${GOLD}99`,
          }}
        >
          <p className="font-display text-xs tracking-widest text-center mb-3" style={{ color: GOLD }}>
            YOURSCORE FANTASY
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/email/fantasy-hero.png"
            alt="Fantasy Premier League on YourScore"
            className="w-full rounded-2xl"
            style={{ height: "40vh", maxHeight: 340, objectFit: "cover", border: "1px solid rgba(255,255,255,0.12)" }}
          />

          <p className="font-body text-sm text-center mt-4 leading-snug" style={{ color: "#e8e8ec" }}>
            Fantasy Premier League is live. More transfers, more chips and play games directly with your league members.
          </p>

          <div className="mt-4">
            <Button
              variant="primary"
              tone="gold"
              size="lg"
              fullWidth
              href={cta.href}
              onClick={() => trackDiag("fantasy_pop_click", { surface })}
            >
              {cta.label}
            </Button>
          </div>
        </div>

        <Button variant="ghost" size="md" fullWidth className="mt-4" onClick={dismiss}>
          SEE YOUR RESULT →
        </Button>
      </div>

      <style jsx global>{`
        @keyframes fantasyPopIn {
          0% { opacity: 0; transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes fantasyPopOut {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
