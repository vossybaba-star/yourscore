"use client";
/**
 * Squad Rating — "Rate my squad": a single 0 to 10 score for the fifteen a
 * manager has actually built, a one line verdict, the XI grouped into
 * strong/decent/weak bands, and one suggested move. The score AND the bands
 * are 100% code (squadRating.ts's scoreSquad() / bandPlayers()); the AI layer
 * only rephrases an already-decided score into plain words, grounded against
 * the facts it was given — see squadRating.ts for the full discipline.
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
  INK, MUTED,
} from "./shared";
import {
  BandGroups, scoreColor, HorizonTabs, HORIZON_HELPER,
  type RatingBandsShape as RatingBands, type Horizon,
} from "./RatingBands";
import { ScoutScanState } from "./ScoutScanState";

interface HorizonResult {
  score: number;
  verdict: string;
  bands: RatingBands;
  moveLine: string;
  copySource: "model" | "mechanical";
}

interface SquadRatingResponse {
  month: HorizonResult;
  season: HorizonResult;
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

export function SquadRating() {
  const [state, setState] = useState<PeekResult | null>(null);
  const [rating, setRating] = useState<SquadRatingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshError, setFreshError] = useState<string | null>(null);
  // Defaults to "month" — the immediate August competition is the objective
  // right now. Both horizons already ride along on every rating, so this is
  // a pure client-side switch, never a refetch.
  const [horizon, setHorizon] = useState<Horizon>("month");

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

      {/* A rate in flight (first ask or a fresh take) gets the same branded
          pitch-loading beat the signed-out /fantasy/rate flow uses, instead
          of a plain button label flip. The cached peek on mount never sets
          busy, so this never flashes for the instant cached-result path. */}
      {busy && (
        <ScoutScanState
          heading="The Scout is grading your team"
          subline="Reading your fifteen the same way he reads every squad." />
      )}

      {!busy && error && !rating && <ErrorState message={error} onRetry={() => void rate(false)} />}

      {!busy && !rating && !error && (
        <Card>
          <div className="font-body" style={{ fontSize: 14.5, fontWeight: 700, color: INK, marginBottom: 6 }}>
            Rate my squad
          </div>
          <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
            A score out of 10 for your fifteen, with your XI banded strong, decent and weak, and one move worth a look.
          </p>
          <Btn gold disabled={busy} onClick={() => void rate(false)}>Rate my squad</Btn>
        </Card>
      )}

      {!busy && rating && (() => {
        const h = rating[horizon];
        return (
        <div className="rate-result-in">
        <Card>
          <HorizonTabs active={horizon} onChange={setHorizon} />
          <p className="font-body" style={{ fontSize: 12, color: MUTED, margin: "0 0 10px", lineHeight: 1.4 }}>
            {HORIZON_HELPER[horizon]}
          </p>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
            <span className="font-display" style={{ fontSize: 40, lineHeight: 1, color: scoreColor(h.score) }}>
              {h.score.toFixed(1)}
            </span>
            <span className="font-body" style={{ fontSize: 12.5, color: MUTED }}>out of 10</span>
          </div>
          <p className="font-body" style={{ fontSize: 14, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>
            {h.verdict}
          </p>

          <BandGroups bands={h.bands} />

          <div className="font-body" style={{
            fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 6,
          }}>
            WORTH A LOOK
          </div>
          <p className="font-body" style={{ fontSize: 13, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>
            {h.moveLine}
          </p>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => void rate(true)}
              className="font-body"
              style={{
                background: "transparent", border: "none", color: MUTED,
                fontSize: 12, fontWeight: 600, padding: 0, cursor: "pointer",
              }}>
              Get a fresh take
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
        </div>
        );
      })()}
    </section>
  );
}
