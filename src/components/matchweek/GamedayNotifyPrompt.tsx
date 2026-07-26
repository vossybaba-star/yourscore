"use client";

/**
 * Gameday Quiz notify pop-up. When a fan lands on the Gameday Quiz section
 * (usually from the home "Gameday Quizzes" tile), nudge them to arm a reminder
 * for THEIR club's first fixture — the one pack that scores for them — so the
 * whistle finds them on game day instead of hoping they come back.
 *
 * Two paths, one goal (founder, 2026-07-25):
 *   has a club  → "[Club]'s first game is [Home] v [Away]" + one Notify tap.
 *   no club yet → nudge to pick a club first; the moment they pick, the same
 *                 pop-up flips to the notify step for their new club's fixture.
 *
 * FREQUENCY: once, until they act. "Acting" is arming the reminder OR dismissing
 * — either way we stamp a flag and never pop again. Picking a club is progress,
 * not the terminal act, so it advances the sheet rather than closing it.
 *
 * Signed-in only. A signed-out fan can't pick a club or own a reminder, so the
 * pop-up would dead-end; they still have the plain Notify buttons on every card,
 * which run their own sign-in round-trip.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useClubMe } from "@/components/clubs/useClubData";
import { Crest } from "@/components/clubs/Crest";
import { NotifyButton } from "./NotifyButton";
import type { RemindersState } from "./useReminders";

const TEAL = "#00d8c0";

/** Once-until-they-act flag. Bumped suffix if the copy/behaviour ever resets. */
const SEEN_KEY = "ys:gameday-notify-prompt-v1";

interface Fixture { fixtureId: number; home: string; away: string }
interface Gameweek { round: string; fixtures: Fixture[] }

/** Empty until loaded; a fixture once we find one; null when there is none. */
type FixtureLookup = Gameweek[] | null;

function isDone(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    return false; // storage blocked → treat as not-done, but we also never stamp
  }
}
function markDone() {
  try {
    window.localStorage.setItem(SEEN_KEY, "done");
  } catch {
    /* non-fatal */
  }
}

export function GamedayNotifyPrompt({ reminders }: { reminders: RemindersState }) {
  const { data, loaded: clubLoaded, refresh } = useClubMe();

  // DEV-ONLY: `?club=Arsenal` previews a signed-in fan (mirrors useViewerClub /
  // useReminders). Compiled out of production; lets the notify path be reviewed
  // without a real session.
  const [previewClub, setPreviewClub] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const c = new URLSearchParams(window.location.search).get("club");
    if (c) setPreviewClub(c);
  }, []);

  const club = data?.club ?? previewClub;
  const clubs = data?.clubs ?? [];

  // Upcoming gameweeks, in kickoff order with fixtures sorted inside (same feed
  // NextClubQuiz reads). null = still loading.
  const [gws, setGws] = useState<FixtureLookup>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/gameday/upcoming", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (live) setGws(j.gameweeks ?? []); })
      .catch(() => { if (live) setGws([]); });
    return () => { live = false; };
  }, []);

  // Their club's soonest fixture — the first pack that scores for them. Feed is
  // already in kickoff order, so the first match is the next one (round 1 now,
  // pre-season). Mirrors NextClubQuiz so both tiles agree on "their next game".
  const fixture = useMemo(() => {
    if (!club || !gws) return null;
    for (const gw of gws) {
      const f = gw.fixtures.find((x) => x.home === club || x.away === club);
      if (f) return f;
    }
    return null;
  }, [club, gws]);

  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pickPending, setPickPending] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // Everything the decision needs is settled.
  const ready = reminders.loaded && clubLoaded && gws !== null;
  const signedIn = reminders.signedIn;

  // Already armed for their fixture → they've effectively acted; never pop.
  const alreadyNotifying = fixture ? reminders.ids.has(fixture.fixtureId) : false;

  // A pop-up should land AFTER the page paints, not fight it. Small delay, once.
  useEffect(() => {
    if (!ready || !signedIn) return;
    if (dismissed || isDone() || alreadyNotifying) return;
    // Something to say? Either the notify step (club + fixture) or the pick step
    // (no club, but clubs exist to choose from).
    const hasSomething = (club && fixture) || (!club && clubs.length > 0);
    if (!hasSomething) return;
    const t = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(t);
  }, [ready, signedIn, dismissed, alreadyNotifying, club, fixture, clubs.length]);

  // They armed the reminder from inside the sheet → stamp + close.
  useEffect(() => {
    if (visible && alreadyNotifying) {
      markDone();
      setVisible(false);
    }
  }, [visible, alreadyNotifying]);

  const close = useCallback(() => {
    markDone();
    setDismissed(true);
    setVisible(false);
  }, []);

  async function pick(choice: string) {
    setPickPending(choice);
    setPickError(null);
    try {
      const res = await fetch("/api/clubs/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ club: choice }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setPickError((b as { error?: string }).error ?? "Couldn't save that");
        setPickPending(null);
        return;
      }
      await refresh(); // club now set → the sheet re-renders into the notify step
      setPickPending(null);
    } catch {
      setPickError("Couldn't save that");
      setPickPending(null);
    }
  }

  if (!visible) return null;

  const showNotify = Boolean(club && fixture);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-[max(env(safe-area-inset-bottom,0px),16px)] sm:pb-4"
      style={{ background: "rgba(4,8,6,0.72)", backdropFilter: "blur(3px)" }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Notify me for my club's first Gameday Quiz"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
          border: "1px solid rgba(0,216,192,0.28)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          className="relative flex flex-col items-center text-center px-5 pt-5 pb-4"
          style={{
            background:
              "radial-gradient(ellipse at 50% 90%, rgba(0,216,192,0.14) 0%, transparent 70%)",
          }}
        >
          <button
            onClick={close}
            aria-label="Close"
            className="absolute right-3 top-3 w-7 h-7 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}
          >
            ✕
          </button>
          <span className="font-display text-[11px] tracking-widest" style={{ color: "#586058" }}>
            GAMEDAY QUIZ
          </span>

          {showNotify ? (
            <>
              <p className="font-display text-xl text-white leading-tight mt-1.5">
                {club}&apos;s first game
              </p>
              <div className="flex items-center gap-2.5 mt-3">
                <Crest name={fixture!.home} size={40} />
                <span className="font-display text-sm" style={{ color: TEAL }}>v</span>
                <Crest name={fixture!.away} size={40} />
              </div>
              <p className="font-body text-[13px] mt-2.5" style={{ color: "#c4ccc6" }}>
                {fixture!.home} v {fixture!.away}
              </p>
              <p className="font-body text-xs mt-1" style={{ color: "#8a948f" }}>
                Get the whistle when the pack drops — it&apos;s the one that scores for {club}.
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-xl text-white leading-tight mt-1.5">
                Pick your club
              </p>
              <p className="font-body text-xs mt-2" style={{ color: "#8a948f" }}>
                So we can notify you for the right fixture — the pack that scores for your club.
              </p>
            </>
          )}
        </div>

        {/* Body */}
        <div className="px-5 pb-5 pt-1">
          {showNotify ? (
            <div className="flex flex-col gap-2.5">
              {/* NotifyButton flips reminders.ids; the effect above stamps + closes. */}
              <div className="flex justify-center">
                <NotifyButton fixtureId={fixture!.fixtureId} reminders={reminders} size="md" />
              </div>
              <button
                onClick={close}
                className="w-full rounded-xl py-2 text-center transition-opacity hover:opacity-80"
              >
                <span className="font-body text-xs font-semibold" style={{ color: "#8a948f" }}>
                  Maybe later
                </span>
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                {clubs.map((c) => (
                  <button
                    key={c}
                    onClick={() => pick(c)}
                    disabled={pickPending !== null}
                    className="flex flex-col items-center gap-1 rounded-xl py-2.5 transition-opacity hover:opacity-90 active:scale-[0.96] disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <Crest name={c} size={28} />
                    <span className="font-body text-[10px] text-center leading-tight" style={{ color: "#c4ccc6" }}>
                      {pickPending === c ? "…" : c}
                    </span>
                  </button>
                ))}
              </div>
              {pickError && (
                <p className="font-body text-xs mt-2 text-center" style={{ color: "#ff6b6b" }}>
                  {pickError}
                </p>
              )}
              <button
                onClick={close}
                className="w-full rounded-xl py-2 mt-2 text-center transition-opacity hover:opacity-80"
              >
                <span className="font-body text-xs font-semibold" style={{ color: "#8a948f" }}>
                  Not now
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
