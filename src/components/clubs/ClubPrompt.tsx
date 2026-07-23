"use client";

/**
 * "Pick your club" — asked once, right after a new account's first sign-in
 * (founder, 2026-07-16). Mirrors UsernamePrompt: same modal shape, same
 * session-scoped skip, same "only when it isn't set yet" rule, mounted globally
 * in the layout so it lands wherever they arrive after auth.
 *
 * WORDING: the founder asked for "their favourite Premier League team", but
 * locked decision #4 is that we never ask "what team do you support?" — we lead
 * with the competition, because the club decides whose leaderboard your halftime
 * scores count for. So it asks the same question in the locked voice: "Pick your
 * club · Your halftime scores count for them." Same answer, framed as entering a
 * competition rather than filling in a profile field.
 *
 * SUGGESTION-FIRST: /api/clubs/me returns a `suggestion` derived from what
 * they've actually played, so the club is offered rather than demanded — the
 * "give them a club to represent" rule. They can pick any of the 20.
 *
 * SKIPPABLE, deliberately: blocking the app behind it would tax a brand-new
 * account before it has seen anything. Skipping re-nudges next session, and
 * Settings → Your club is always there.
 *
 * Self-hides: signed out, club already locked, or no clubs yet this season.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useClubMe } from "./useClubData";
import { ClubGrid } from "./ClubGrid";
import { shortClubName } from "@/lib/clubs/display";
import { clearGuestClub, loadGuestClub } from "@/lib/clubs/guestClub";

const SKIP_KEY = "ys:club-prompt:skipped"; // session-scoped: re-nudges next visit
const TEAL = "#00d8c0";

export function ClubPrompt() {
  const pathname = usePathname();
  const { user, data, loaded, refresh } = useClubMe();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * DEV-ONLY: `?preview=club-prompt` renders this as a brand-new account would
   * see it. It can't otherwise be looked at — it only appears for a signed-in
   * user with no club, and the demo has no auth. Compiled out of production;
   * saving is disabled in preview so nothing is written.
   */
  const [previewClubs, setPreviewClubs] = useState<string[] | null>(null);
  const preview = previewClubs !== null;

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("preview") !== "club-prompt") return;
    fetch("/api/pl/standings")
      .then((r) => r.json())
      .then((j) => {
        const clubs = (j.standings ?? []).map((s: { team: string }) => s.team).sort((a: string, b: string) => a.localeCompare(b));
        if (clubs.length) { setPreviewClubs(clubs); setOpen(true); }
      })
      .catch(() => { /* preview only */ });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || preview) return;
    if (sessionStorage.getItem(SKIP_KEY)) return;
    // Never over the auth screens or Settings (which has its own club row).
    if (pathname?.startsWith("/auth") || pathname?.startsWith("/settings")) return;
    if (!loaded || !user || !data) return;
    if (data.club || data.clubs.length === 0) return; // already locked, or no season yet
    setOpen(true);
    // Offer, don't demand. A club they already picked as a GUEST (38-0 Pro's prompt, held
    // in localStorage) wins over the played-quizzes suggestion — they've told us outright,
    // and carrying it over is what makes "make an account to keep it" true. They still
    // confirm: the account version locks for the season, the guest one didn't.
    setChoice(loadGuestClub(data.clubs) ?? data.suggestion ?? null);
  }, [pathname, loaded, user, data, preview]);

  const clubs = previewClubs ?? data?.clubs ?? [];
  if (!open || clubs.length === 0) return null;

  function skip() {
    try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* private mode */ }
    setOpen(false);
  }

  async function save() {
    if (!choice) return;
    if (preview) { setOpen(false); return; } // dev preview — never writes
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/clubs/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ club: choice }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { error?: string }).error ?? "Couldn't save that");
        return;
      }
      // The account row is now the authority — drop the guest copy so the two can't
      // disagree (and so a later sign-out doesn't resurrect a stale pick).
      clearGuestClub();
      await refresh();
      setOpen(false);
    } catch {
      setError("Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div
        className="w-full max-w-md rounded-3xl overflow-hidden mb-4 sm:mb-0"
        style={{ background: "#0e1611", border: "1px solid rgba(0,216,192,0.22)" }}
      >
        <div className="px-5 pt-5 pb-4">
          <p className="font-display text-[10px] tracking-widest mb-2" style={{ color: TEAL }}>ONE LAST THING</p>
          <p className="font-display text-white" style={{ fontSize: 30, lineHeight: 0.95, letterSpacing: "-0.015em" }}>
            Pick your club.
          </p>
          <p className="font-body text-sm mt-2" style={{ color: "#8a948f" }}>
            Your scores represent them all season.
          </p>
        </div>

        {/* The 20, as a game-style grid. Suggestion pre-selected when we have one. */}
        <div className="px-5 pb-4 max-h-[46vh] overflow-y-auto no-scrollbar">
          <ClubGrid clubs={clubs} selected={choice} onSelect={setChoice} disabled={saving} />
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={save}
            disabled={!choice || saving}
            className="w-full rounded-xl py-3 font-display text-sm tracking-wide transition-opacity"
            style={{ background: TEAL, color: "#062018", opacity: !choice || saving ? 0.5 : 1 }}
          >
            {saving ? "Saving…" : choice ? `Represent ${shortClubName(choice)}` : "Pick a club"}
          </button>
          {error && <p className="font-body text-xs mt-2 text-center" style={{ color: "#e0a34a" }}>{error}</p>}
          <button onClick={skip} className="w-full mt-2.5 py-2 font-body text-xs" style={{ color: "#586058" }}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
