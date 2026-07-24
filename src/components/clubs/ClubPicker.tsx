"use client";

/**
 * Club-Fan Leaderboard declare-your-club card. Shown ONLY to signed-in users who
 * have not yet locked a club (GET /api/clubs/me → { locked: false }).
 *
 * LOCKED DECISION #4: leads with the competition — "Pick your club" / "Your
 * halftime scores count for them" — never "what team do you support?". The
 * leaderboard is the reason to declare, not a profile question.
 *
 * Self-hides: not signed in, still loading, already locked, or no clubs to pick
 * from yet (no halftime data this season) → renders nothing. Never an empty box
 * (mirrors HalftimeRail's self-hide contract).
 */

import { useState } from "react";
import { useClubMe } from "./useClubData";
import { Crest } from "./Crest";
import { trackClubPick } from "@/lib/analytics/trackGame";

const TEAL = "#00d8c0";

export function ClubPicker() {
  const { user, data, loaded, refresh } = useClubMe();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loaded || !user || !data || data.locked || data.clubs.length === 0) return null;

  const { suggestion, clubs } = data;

  async function declare(club: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/clubs/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ club }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setError(body.error ?? "Could not lock in that club — try again.");
        setSubmitting(false);
        return;
      }
      // Fan-identity conversion — only after the server confirms the lock.
      trackClubPick(club);
      setPending(null);
      await refresh();
    } catch {
      setError("Could not lock in that club — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
          border: "1px solid rgba(0,216,192,0.25)",
        }}
      >
        <div
          className="relative flex flex-col items-center justify-center gap-1 text-center px-4 pt-5 pb-4"
          style={{
            background:
              "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.12) 0%, transparent 70%), linear-gradient(180deg, rgba(0,216,192,0.05) 0%, transparent 100%)",
          }}
        >
          <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>
            CLUB-FAN LEADERBOARD
          </span>
          <p className="font-display text-xl text-white leading-tight mt-1">Pick your club</p>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>
            Your halftime scores count for them.
          </p>
        </div>

        <div className="px-4 pb-4 pt-3">
          {pending ? (
            <ConfirmStep
              club={pending}
              submitting={submitting}
              error={error}
              onConfirm={() => declare(pending)}
              onCancel={() => {
                setPending(null);
                setError(null);
              }}
            />
          ) : suggestion && !expanded ? (
            <div className="space-y-2">
              <button
                onClick={() => setPending(suggestion)}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-opacity hover:opacity-90 active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(255,120,0,0.12) 100%)",
                  border: "1px solid rgba(0,216,192,0.3)",
                }}
              >
                <Crest name={suggestion} size={32} />
                <span className="font-body text-sm font-semibold text-white text-left leading-snug">
                  You&apos;ve been playing {suggestion} quizzes — represent {suggestion}?
                </span>
              </button>
              <button
                onClick={() => setExpanded(true)}
                className="w-full rounded-xl py-2 text-center transition-opacity hover:opacity-80"
                style={{ border: "1px solid rgba(255,255,255,0.14)" }}
              >
                <span className="font-body text-xs font-semibold" style={{ color: "#c4ccc6" }}>
                  Choose a different club
                </span>
              </button>
            </div>
          ) : (
            <ClubGrid clubs={clubs} onPick={(c) => setPending(c)} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmStep({
  club,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  club: string;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <Crest name={club} size={36} />
        <p className="font-body text-sm font-semibold text-white">{club}</p>
      </div>
      <p className="font-body text-xs" style={{ color: "#8a948f" }}>
        You&apos;re in for the season — you can&apos;t switch later.
      </p>
      {error && (
        <p className="font-body text-xs" style={{ color: "#ff6b6b" }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={submitting}
          className="flex-1 rounded-xl py-2 text-center transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, rgba(0,216,192,0.28) 0%, rgba(255,120,0,0.16) 100%)",
            border: "1px solid rgba(0,216,192,0.4)",
          }}
        >
          <span className="font-display text-xs tracking-widest" style={{ color: TEAL }}>
            {submitting ? "LOCKING IN…" : "CONFIRM"}
          </span>
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded-xl px-4 py-2 text-center transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ border: "1px solid rgba(255,255,255,0.14)" }}
        >
          <span className="font-body text-xs font-semibold" style={{ color: "#c4ccc6" }}>
            Back
          </span>
        </button>
      </div>
    </div>
  );
}

function ClubGrid({ clubs, onPick }: { clubs: string[]; onPick: (club: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {clubs.map((club) => (
        <button
          key={club}
          onClick={() => onPick(club)}
          className="flex flex-col items-center gap-1 rounded-xl py-2.5 transition-opacity hover:opacity-90 active:scale-[0.96]"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <Crest name={club} size={28} />
          <span className="font-body text-[10px] text-center leading-tight" style={{ color: "#c4ccc6" }}>
            {club}
          </span>
        </button>
      ))}
    </div>
  );
}
