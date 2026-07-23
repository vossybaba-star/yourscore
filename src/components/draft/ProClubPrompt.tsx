"use client";

/**
 * "Which club?" — asked on the way into a 38-0 PRO draft (founder, 2026-07-22).
 *
 * This is deliberately a SECOND prompt, not a duplicate of ClubPrompt. The global one
 * (mounted in layout.tsx) asks a new account to enter the club-fan competition, and a skip
 * there sticks for the session. But Pro has its own reason to ask, and it's a concrete one
 * the player can see the value of right now: **Pro asks you questions about your own club**.
 * So this appears even when the global prompt was skipped, and says plainly what the club
 * buys you here.
 *
 * It is skippable and never blocks. Pro plays perfectly well without a club — you draw the
 * neutral Premier League pool — so gating the draft behind this would cost more than it
 * gains, and 38-0 is the anonymous acquisition hook.
 *
 * ── GUESTS ARE ASKED TOO, and that's the point ───────────────────────────────
 * A guest can't be written to club_supporters (no profiles row), so their pick is held in
 * localStorage and used for their Pro questions straight away. A guest who has picked a
 * club and played with it has a reason to make an account — to keep it (founder's
 * rationale). ClubPrompt then pre-selects that pick after they sign up.
 *
 * The two picks are NOT the same promise and the copy reflects it:
 *   guest     → "Pick your club" — a local preference, changeable.
 *   signed in → writes club_supporters, which is LOCKED for the season, so the confirm
 *               line says so. Nobody takes that lock without being told.
 */

import { useEffect, useState } from "react";
import { useUser } from "@/hooks/useUser";
import { ClubGrid } from "@/components/clubs/ClubGrid";
import { shortClubName } from "@/lib/clubs/display";
import { loadGuestClub, saveGuestClub } from "@/lib/clubs/guestClub";
import { trackClubPick } from "@/lib/analytics/trackGame";
import CLUB_COUNTS from "@/data/draft/pl-quiz-clubs.json";

const LIME = "#aeea00";

/** How many questions Pro actually holds per club, keyed by the picker's own club names.
 *  Answer-free (see scripts/draft/build-pl-quiz.mjs) so it's safe on the client. */
const COUNTS = (CLUB_COUNTS as { clubs: Record<string, number> }).clubs;
const questionsFor = (club: string): number => COUNTS[club] ?? 0;
/** Session-scoped, and deliberately its OWN key — skipping the global club prompt must not
 *  silently skip this one, because this asks a different question for a different reason. */
const SKIP_KEY = "ys:pro-club-prompt:skipped";

export function ProClubPrompt({ onClubSet }: { onClubSet?: (club: string) => void }) {
  const { user, loading: userLoading } = useUser();
  const [clubs, setClubs] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  /**
   * Is the picker open, held SEPARATELY from `current` (the club they actually have).
   * Conflating the two was a bug: "Change" cleared `current` to reveal the picker, so
   * dismissing afterwards left them with a club still saved and nothing on screen saying
   * so — the exact "club invisible, no way to change it" problem the status row exists to
   * fix. What club you have and whether the picker is open are different questions.
   */
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    try { if (sessionStorage.getItem(SKIP_KEY)) setSkipped(true); } catch { /* private mode */ }
  }, []);

  // Work out whether this player already has a club, and what they could pick.
  //
  // Signed in  → /api/clubs/me is the authority (it also tells us the season's clubs).
  // Guest      → that route is 401 by design, so the club list comes from the public
  //              standings endpoint. Verified 2026-07-22: it returns the identical 20 names
  //              club_supporters uses, so a guest's pick needs no translation to become a
  //              real declaration later.
  useEffect(() => {
    if (userLoading) return;
    let off = false;
    (async () => {
      try {
        if (user) {
          const res = await fetch("/api/clubs/me", { cache: "no-store" });
          if (res.ok) {
            const j = (await res.json()) as { club: string | null; clubs: string[] };
            if (off) return;
            setCurrent(j.club);
            setClubs(j.clubs ?? []);
          }
        } else {
          const res = await fetch("/api/pl/standings");
          if (res.ok) {
            const j = (await res.json()) as { standings?: { team: string }[] };
            const list = (j.standings ?? []).map((s) => s.team).sort((a, b) => a.localeCompare(b));
            if (off) return;
            setClubs(list);
            setCurrent(loadGuestClub(list));
          }
        }
      } catch {
        // Offline or a blip — stay hidden rather than show an empty picker.
      } finally {
        if (!off) setResolved(true);
      }
    })();
    return () => { off = true; };
  }, [user, userLoading]);

  // Nothing to ask with, or waved away this session.
  if (!resolved || skipped || clubs.length === 0) return null;

  // ALREADY HAS A CLUB → a compact status row, not nothing.
  //
  // This used to self-hide entirely, which a UX walk caught: the club was never named
  // anywhere in the 38-0 flow and a guest who mis-tapped a crest had no route back. Worse
  // for the three clubs Pro holds no questions for, where the silence looked like a bug.
  // A guest can change theirs freely (it's a local preference); a signed-in player can't,
  // because theirs is a season-locked competition entry, so they're told that instead.
  if (current && !picking) {
    const n = questionsFor(current);
    return (
      <div
        className="rounded-2xl mt-3 px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="min-w-0">
          <p className="font-body" style={{ fontSize: 12, color: "#fff" }}>
            Pro is asking about <b style={{ color: LIME }}>{shortClubName(current)}</b>
          </p>
          <p className="font-body mt-0.5" style={{ fontSize: 11, color: "#8a948f" }}>
            {n === 0
              ? "No questions for them yet, so you'll get Premier League ones."
              : `${n} ${shortClubName(current)} questions, mixed in with Premier League ones.`}
          </p>
        </div>
        {user ? (
          <span className="font-body flex-shrink-0" style={{ fontSize: 11, color: "#8a948f" }}>Locked</span>
        ) : (
          <button
            onClick={() => { setChoice(current); setPicking(true); }}
            className="flex-shrink-0 rounded-xl px-3 py-2 transition-opacity hover:opacity-80"
            style={{ border: "1px solid rgba(255,255,255,0.14)" }}
          >
            <span className="font-body font-semibold" style={{ fontSize: 11, color: "#c4ccc6" }}>Change</span>
          </button>
        )}
      </div>
    );
  }

  /** Dismiss the sheet. Only counts as "skipped for the session" when they have no club to
   *  fall back to — someone who opened the picker via Change and thought better of it is
   *  cancelling an edit, not waving away the question, and must land back on their status
   *  row rather than on nothing. */
  function skip() {
    setPicking(false);
    setChoice(null);
    if (current) return;
    try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* private mode */ }
    setSkipped(true);
  }

  async function save() {
    if (!choice) return;
    setError(null);

    // Guest: local only. No account, no leaderboard, nothing locked — it just flavours
    // their questions now and gives them something to keep if they sign up.
    if (!user) {
      saveGuestClub(choice);
      trackClubPick(choice);
      setCurrent(choice);
      setPicking(false);
      onClubSet?.(choice);
      return;
    }

    // Signed in: the real declaration, and it locks for the season.
    setSaving(true);
    try {
      const res = await fetch("/api/clubs/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ club: choice }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Couldn't save that. Try again.");
        return;
      }
      trackClubPick(choice);
      setCurrent(choice);
      setPicking(false);
      onClubSet?.(choice);
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // A POP-UP, not a section (founder, 2026-07-23). A 20-crest grid sitting inline pushed the
  // formation picker and the draft button off the screen and read as another thing to fill in
  // before you could play. As a sheet it asks once, takes the answer or the shrug, and gets
  // out of the way. Same shape as the global ClubPrompt so the two feel like one decision.
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      // Tapping the backdrop is the same as "Not now" — a modal you can't dismiss by
      // tapping away reads as a demand, and this is explicitly not one.
      onClick={skip}
    >
      <div
        className="w-full max-w-md rounded-3xl overflow-hidden mb-4 sm:mb-0"
        style={{ background: "#0e1611", border: `1px solid ${LIME}59` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <p className="font-display tracking-widest" style={{ fontSize: 10, color: LIME }}>
            PRO · YOUR CLUB
          </p>
          <p className="font-display text-white leading-tight mt-1" style={{ fontSize: 26, letterSpacing: "-0.015em" }}>
            Get asked about your team
          </p>
          <p className="font-body mt-2" style={{ fontSize: 13, color: "#8a948f", lineHeight: 1.4 }}>
            Pick your club and Pro mixes in questions about them. Otherwise you get Premier
            League questions only.
          </p>
        </div>

        <div className="px-5 pb-4">
          <div className="max-h-[42vh] overflow-y-auto no-scrollbar">
            <ClubGrid clubs={clubs} selected={choice} onSelect={setChoice} disabled={saving} />
          </div>

          {/* Two truths, both of which the card was getting wrong.
              1. Pro holds no questions at all for some clubs (Coventry 0, Ipswich 1, Hull 2 at
                 time of writing). The headline promises "questions about your team", so a fan
                 of those clubs was being sold something that doesn't exist. Say it plainly at
                 the moment of choosing, while they can still pick something else.
              2. The lock is only real for a signed-in declaration. A guest's pick writes
                 nothing, so telling them it's locked for the season would be false. */}
          {choice && (
            <div className="mt-3">
              <p className="font-body" style={{ fontSize: 12, color: questionsFor(choice) === 0 ? "#ff8a3d" : "#8a948f" }}>
                {questionsFor(choice) === 0
                  ? `No ${shortClubName(choice)} questions yet, so Pro will ask you Premier League ones.`
                  : `${questionsFor(choice)} ${shortClubName(choice)} questions, mixed in with Premier League ones.`}
              </p>
              <p className="font-body mt-1" style={{ fontSize: 12, color: "#8a948f" }}>
                {user
                  ? "You're in for the season, you can't switch later."
                  : "Saved on this device. Make an account to keep it."}
              </p>
            </div>
          )}

          {error && (
            <p className="font-body mt-2" style={{ fontSize: 12, color: "#ff6b6b" }}>{error}</p>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={save}
            disabled={!choice || saving}
            className="flex-1 rounded-xl py-3 text-center transition-opacity active:scale-[0.98] disabled:opacity-40"
            style={{ background: choice ? LIME : "rgba(255,255,255,0.06)", border: `1px solid ${LIME}66` }}
          >
            <span className="font-display tracking-wide" style={{ fontSize: 14, color: choice ? "#062013" : "#8a948f" }}>
              {saving ? "SAVING…" : "USE THIS CLUB"}
            </span>
          </button>
          <button
            onClick={skip}
            disabled={saving}
            className="rounded-xl px-5 py-3 text-center transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ border: "1px solid rgba(255,255,255,0.14)" }}
          >
            <span className="font-body font-semibold" style={{ fontSize: 13, color: "#c4ccc6" }}>
              Not now
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
