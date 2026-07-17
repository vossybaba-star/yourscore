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
import { Crest } from "./Crest";

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
    setChoice(data.suggestion ?? null); // offer, don't demand
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
            Your halftime scores count for them on the fan leaderboard. One club, all season — so choose the one you actually shout for.
          </p>
        </div>

        {/* The 20. Suggestion pre-selected when we have one. */}
        <div className="px-5 pb-4 max-h-[38vh] overflow-y-auto no-scrollbar">
          <div className="flex flex-wrap gap-1.5">
            {clubs.map((c) => {
              const on = choice === c;
              return (
                <button
                  key={c}
                  onClick={() => setChoice(c)}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition-colors"
                  style={{
                    background: on ? "rgba(0,216,192,0.16)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${on ? TEAL : "rgba(255,255,255,0.08)"}`,
                    color: on ? TEAL : "#8a948f",
                  }}
                >
                  <Crest name={c} size={16} />
                  <span className="font-body text-[11px] whitespace-nowrap">{c}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={save}
            disabled={!choice || saving}
            className="w-full rounded-xl py-3 font-display text-sm tracking-wide transition-opacity"
            style={{ background: TEAL, color: "#062018", opacity: !choice || saving ? 0.5 : 1 }}
          >
            {saving ? "Saving…" : choice ? `Represent ${choice}` : "Pick a club"}
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
