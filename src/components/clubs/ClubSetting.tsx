"use client";

/**
 * Settings → "Your club". Where a signed-in fan sets, or checks, the club they
 * represent (founder, 2026-07-16).
 *
 * Two states, because the club is LOCKED FOR THE SEASON (locked decision #3:
 * club_supporters' PK is (user_id, season_id) and there is no update or delete
 * policy — the lock is enforced by the database, not by this UI):
 *
 *   not set  → pick one. This is the same declaration the Live Quiz ClubPicker
 *              makes, so it POSTs the same /api/clubs/me.
 *   set      → show it, and say plainly that it's theirs until the season ends.
 *              A settings row that looks editable but silently refuses would be
 *              worse than one that tells you why.
 *
 * Deliberately NOT a "favourite team" field. It decides whose leaderboard your
 * halftime scores count for, which is a competition entry, not a preference —
 * and that's exactly why it can't be swapped mid-season.
 */

import { useEffect, useState } from "react";
import { useClubMe } from "./useClubData";
import { Crest } from "./Crest";
import { ClubGrid } from "./ClubGrid";
import { shortClubName } from "@/lib/clubs/display";

const TEAL = "#00d8c0";

export function ClubSetting() {
  const { user, data, loaded, refresh } = useClubMe();
  const [pending, setPending] = useState<string | null>(null);
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
    ? { club: null as string | null, clubs: previewClubs as string[] }
    : data
      ? { club: data.club, clubs: data.clubs }
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
    } catch {
      setError("Couldn't save that");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Your club</p>
      <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {view.club ? (
          // Locked for the season — show it, and say why it can't change.
          <>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <span className="font-body text-xs text-text-muted">Representing</span>
              <div className="flex items-center gap-2.5 min-w-0">
                <Crest name={view.club} size={26} />
                <span className="font-body text-sm text-white truncate">{view.club}</span>
              </div>
            </div>
            <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <p className="font-body text-xs" style={{ color: "#586058" }}>
                Locked until the end of the season — your scores represent {shortClubName(view.club)}.
              </p>
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
              Your scores represent them all season.
            </p>

            <ClubGrid clubs={view.clubs} selected={pending} onSelect={setPending} disabled={submitting} />

            {pending && (
              <button
                onClick={() => save(pending)}
                disabled={submitting}
                className="w-full mt-4 rounded-xl py-2.5 font-display text-sm tracking-wide"
                style={{ background: TEAL, color: "#062018", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "Saving…" : `Represent ${shortClubName(pending)}`}
              </button>
            )}
            {error && (
              <p className="font-body text-xs mt-2" style={{ color: "#e0a34a" }}>{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
