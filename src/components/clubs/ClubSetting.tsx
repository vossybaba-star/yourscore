"use client";

/**
 * Settings → "Your club". Where a signed-in fan sets, checks, or changes the club
 * they represent (founder, 2026-07-16; 30-day cooldown added 2026-07-27).
 *
 * Three states, because a club can now be CHANGED, but only once every 30 days
 * (migration 212 — the cooldown is enforced in the DB, this UI just reflects it):
 *
 *   not set     → pick one. Same declaration the Live Quiz ClubPicker makes, so it
 *                 POSTs the same /api/clubs/me. Warns that it locks for 30 days.
 *   set, cooling → show it, and the date they can next change it.
 *   set, free    → show it with a "Change club" option; changing warns and re-locks
 *                  for another 30 days.
 *
 * Still the competition entry (whose leaderboard your gameday scores count for),
 * not a cosmetic favourite-team field — which is why a change is rate-limited
 * rather than free.
 */

import { useEffect, useState } from "react";
import { useClubMe } from "./useClubData";
import { Crest } from "./Crest";
import { ClubGrid } from "./ClubGrid";
import { shortClubName } from "@/lib/clubs/display";

const TEAL = "#00d8c0";

/** "27 August" style — the date a fan may next change their club. */
function formatChangeDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

export function ClubSetting() {
  const { user, data, loaded, refresh } = useClubMe();
  const [pending, setPending] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * DEV-ONLY: `?preview=club-setting` renders the unset state without a session
   * — Settings is signed-in-only, so this row can't otherwise be looked at.
   * Compiled out of production; saving is a no-op in preview.
   */
  const [previewClubs, setPreviewClubs] = useState<string[] | null>(null);
  const preview = previewClubs !== null;
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("preview") !== "club-setting") return;
    fetch("/api/pl/standings")
      .then((r) => r.json())
      .then((j) => {
        const clubs = (j.standings ?? []).map((x: { team: string }) => x.team).sort((a: string, b: string) => a.localeCompare(b));
        if (clubs.length) setPreviewClubs(clubs);
      })
      .catch(() => { /* preview only */ });
  }, []);

  const view = preview
    ? { club: null as string | null, clubs: previewClubs as string[], canChangeNow: true, canChangeAt: null as string | null }
    : data
      ? { club: data.club, clubs: data.clubs, canChangeNow: data.canChangeNow, canChangeAt: data.canChangeAt }
      : null;

  if (!preview && (!loaded || !user || !data)) return null;
  if (!view) return null;

  async function save(club: string) {
    if (preview) { setPending(null); return; } // dev preview — never writes
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/clubs/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ club }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { error?: string }).error ?? "Couldn't save that");
        return;
      }
      await refresh();
      setPending(null);
      setChanging(false);
    } catch {
      setError("Couldn't save that");
    } finally {
      setSubmitting(false);
    }
  }

  // The pick-a-club grid, shared by the not-set state and the change flow. Both
  // warn that the choice locks for 30 days before the confirm button appears.
  const picker = (
    <>
      <ClubGrid clubs={view.clubs} selected={pending} onSelect={setPending} disabled={submitting} />
      <p className="font-body text-xs mt-3" style={{ color: "#8a948f" }}>
        Make sure this is right. You won&apos;t be able to change your club for 30 days.
      </p>
      {pending && (
        <button
          onClick={() => save(pending)}
          disabled={submitting}
          className="w-full mt-3 rounded-xl py-2.5 font-display text-sm tracking-wide"
          style={{ background: TEAL, color: "#062018", opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Saving…" : `Represent ${shortClubName(pending)}`}
        </button>
      )}
      {error && (
        <p className="font-body text-xs mt-2" style={{ color: "#e0a34a" }}>{error}</p>
      )}
    </>
  );

  return (
    <div>
      <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Your club</p>
      <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {view.club ? (
          // Set. Show it; let them change it once the 30-day cooldown is up.
          <>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <span className="font-body text-xs text-text-muted">Representing</span>
              <div className="flex items-center gap-2.5 min-w-0">
                <Crest name={view.club} size={26} />
                <span className="font-body text-sm text-white truncate">{view.club}</span>
              </div>
            </div>
            <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              {changing ? (
                <>
                  {picker}
                  <button
                    onClick={() => { setChanging(false); setPending(null); setError(null); }}
                    disabled={submitting}
                    className="w-full mt-2 rounded-xl py-2 font-body text-xs"
                    style={{ color: "#8a948f" }}
                  >
                    Keep {shortClubName(view.club)}
                  </button>
                </>
              ) : view.canChangeNow ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="font-body text-xs" style={{ color: "#586058" }}>
                    Your scores represent {shortClubName(view.club)}.
                  </p>
                  <button
                    onClick={() => setChanging(true)}
                    className="shrink-0 font-body text-xs font-semibold"
                    style={{ color: TEAL }}
                  >
                    Change club
                  </button>
                </div>
              ) : (
                <p className="font-body text-xs" style={{ color: "#586058" }}>
                  Your scores represent {shortClubName(view.club)}.
                  {view.canChangeAt
                    ? ` You can change club again on ${formatChangeDate(view.canChangeAt)}.`
                    : ""}
                </p>
              )}
            </div>
          </>
        ) : view.clubs.length === 0 ? (
          <div className="px-5 py-4">
            <p className="font-body text-sm text-white">Clubs open with the season</p>
            <p className="font-body text-xs mt-1" style={{ color: "#8a948f" }}>
              You&apos;ll pick who you represent once the fixtures land.
            </p>
          </div>
        ) : (
          <div className="px-5 py-4">
            <p className="font-body text-sm text-white mb-1">Pick your club</p>
            <p className="font-body text-xs mb-3.5" style={{ color: "#8a948f" }}>
              Your scores represent them on the club leaderboard.
            </p>
            {picker}
          </div>
        )}
      </div>
    </div>
  );
}
