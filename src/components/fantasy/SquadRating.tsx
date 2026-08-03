"use client";
/**
 * Squad Rating — "Rate my squad": a single 0 to 10 score for the fifteen a
 * manager has actually built, a one line verdict, 2 to 3 strength/risk pills
 * and one suggested move. The score is 100% code (squadRating.ts's
 * scoreSquad()); the AI layer only rephrases an already-decided score into
 * plain words, grounded against the facts it was given — see squadRating.ts
 * for the full discipline.
 *
 * On mount this only PEEKS (a GET, never computes, never bills a model call)
 * so a manager who has already rated this exact squad sees it immediately.
 * The button is the one thing that can trigger a real rate; "fresh take" is
 * the quiet re-ask, throttled server-side.
 *
 * Renders nothing on a 401 (SquadUpdate below already owns the sign-in door
 * for this page) and nothing once the route says there's no complete squad
 * to rate — this block simply isn't there for those states, same restraint
 * ScoutYourSquad already uses for the pitch above it.
 */
import { useCallback, useEffect, useState } from "react";
import {
  api, Btn, Card, ErrorState, SectionLabel,
  INK, MUTED, LIME, CORAL, tint,
} from "./shared";

interface SquadRatingResponse {
  score: number;
  verdict: string;
  strengths: string[];
  risks: string[];
  moveLine: string;
  copySource: "model" | "mechanical";
  generatedAt: string;
}

/** "as of Mon 09:27" — a cached rating can predate today's team news, so the
 *  card is honest about when it was written (a fresh take is one tap away). */
function asOfLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  const time = d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  return `as of ${day} ${time}`;
}
type PeekResult = { noSquad: boolean; rating: SquadRatingResponse | null };
type RateResult = { noSquad: true } | { noSquad: false; rating: SquadRatingResponse };

const scoreColor = (score: number): string => {
  if (score >= 7) return LIME;
  if (score >= 4.5) return "#e0c53c"; // between LIME and CORAL, no new named token needed elsewhere
  return CORAL;
};

function Pill({ text, tone }: { text: string; tone: "strength" | "risk" }) {
  const accent = tone === "strength" ? LIME : CORAL;
  return (
    <div className="font-body rounded-xl" style={{
      padding: "8px 12px", fontSize: 12.5, lineHeight: 1.45,
      background: tint(accent, "12"), border: `1px solid ${tint(accent, "3a")}`,
      color: INK,
    }}>
      {text}
    </div>
  );
}

export function SquadRating() {
  const [state, setState] = useState<PeekResult | null>(null);
  const [rating, setRating] = useState<SquadRatingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshError, setFreshError] = useState<string | null>(null);

  const peek = useCallback(async () => {
    try {
      const res = await api<PeekResult>("squad-rating");
      setState(res);
      setRating(res.rating);
      if (res.noSquad) setHidden(true);
    } catch (e) {
      // A signed-out visitor gets a 401 here — SquadUpdate already renders
      // the sign-in door on this page, so this block just disappears rather
      // than duplicating it or showing a raw error.
      if ((e as { status?: number }).status === 401) { setHidden(true); return; }
      setState({ noSquad: false, rating: null });
    }
  }, []);

  useEffect(() => { void peek(); }, [peek]);

  const rate = useCallback(async (fresh: boolean) => {
    setBusy(true);
    setError(null);
    if (fresh) setFreshError(null);
    try {
      const res = await api<RateResult>("squad-rating", { fresh });
      if (res.noSquad) { setHidden(true); return; }
      setRating(res.rating);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) { setHidden(true); return; }
      if (fresh && status === 429) {
        setFreshError("You've asked for a fresh take a few times already today. Try again tomorrow, friend.");
        return;
      }
      setError(e instanceof Error ? e.message : "Couldn't rate your squad.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (hidden) return null;
  if (state === null) return null; // first paint, before the peek resolves — nothing to hold space for yet

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionLabel>SQUAD RATING</SectionLabel>

      {error && !rating && <ErrorState message={error} onRetry={() => void rate(false)} />}

      {!rating && !error && (
        <Card>
          <div className="font-body" style={{ fontSize: 14.5, fontWeight: 700, color: INK, marginBottom: 6 }}>
            Rate my squad
          </div>
          <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
            A score out of 10 for your fifteen this gameweek, with the strengths, the risks and one move worth a look.
          </p>
          <Btn gold disabled={busy} onClick={() => void rate(false)}>{busy ? "Rating your squad" : "Rate my squad"}</Btn>
        </Card>
      )}

      {rating && (
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
            <span className="font-display" style={{ fontSize: 40, lineHeight: 1, color: scoreColor(rating.score) }}>
              {rating.score.toFixed(1)}
            </span>
            <span className="font-body" style={{ fontSize: 12.5, color: MUTED }}>out of 10</span>
          </div>
          <p className="font-body" style={{ fontSize: 14, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>
            {rating.verdict}
          </p>

          {(rating.strengths.length > 0 || rating.risks.length > 0) && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {rating.strengths.map((s, i) => <Pill key={`s${i}`} text={s} tone="strength" />)}
              {rating.risks.map((r, i) => <Pill key={`r${i}`} text={r} tone="risk" />)}
            </div>
          )}

          <div className="font-body" style={{
            fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 6,
          }}>
            WORTH A LOOK
          </div>
          <p className="font-body" style={{ fontSize: 13, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>
            {rating.moveLine}
          </p>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => void rate(true)} disabled={busy}
              className="font-body"
              style={{
                background: "transparent", border: "none", color: MUTED,
                fontSize: 12, fontWeight: 600, padding: 0, cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}>
              {busy ? "Getting a fresh take" : "Get a fresh take"}
            </button>
            {asOfLabel(rating.generatedAt) && (
              <span className="font-body" style={{ fontSize: 11, color: "#586058" }}>
                {asOfLabel(rating.generatedAt)}
              </span>
            )}
          </div>
          {freshError && (
            <p className="font-body" style={{ fontSize: 12, color: MUTED, margin: "8px 0 0", lineHeight: 1.5 }}>
              {freshError}
            </p>
          )}
        </Card>
      )}
    </section>
  );
}
