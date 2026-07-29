"use client";
/** Captain Assist card — the only recommendation the research validated.
 *
 *  Deliberately NOT a "best team" screen: full-XI selection lost to a simple
 *  most-owned template in both historical seasons, so nothing here suggests an
 *  optimal XI, a transfer, a chip, or an expected points gain.
 *
 *  Answers one question well: who should I captain, and why?
 *
 *  Applying is never silent and never all-or-nothing. One confirmation screen
 *  shows current versus proposed, captain and vice are independent toggles, and
 *  the write quotes the frozen recommendation id so the server can refuse a card
 *  that has gone stale rather than apply something the user did not see.
 */
import { useCallback, useEffect, useState } from "react";
import { api, Btn, Card, GOLD, INK, LINE, MUTED, PANEL_2, TEAL } from "@/components/fantasy/shared";

type Alt = { id: number; name: string; label: string; reason: string };
type Evidence = { label: string; value: string };
type Warning = { kind: "availability" | "early_season" | "chasing_form" | "stale"; text: string };

type Assist =
  | { enabled: false }
  | { enabled: true; available: false; reason: string }
  | {
      enabled: true; available: true; recommendationId: string; gameweek: number | null; model: string;
      signal: string; earlySeason: boolean; dataCutoff: string; stale: boolean;
      captain: { id: number; name: string }; vice: { id: number; name: string };
      headline: string; evidence: Evidence[]; viceReason: string; alternatives: Alt[];
      confidence: "High" | "Medium" | "Low"; confidenceReason: string;
      warnings: Warning[];
      currentCaptain: number | null; currentVice: number | null;
      captainChanges: boolean; viceChanges: boolean;
      currentCaptainName: string | null; currentViceName: string | null;
      fixtureStatus: "confirmed_fixture" | "confirmed_blank" | "unknown";
      canApply: boolean;
      disclaimer: string;
    };

type ApplyResult =
  | { ok: true; appliedCaptain: boolean; appliedVice: boolean }
  | { ok: false; code: string; message: string };

const CONF_TINT: Record<string, string> = { High: TEAL, Medium: GOLD, Low: MUTED };

/** Fire-and-forget funnel step. Analytics must never block or break a captain
 *  change, so failures are swallowed deliberately. */
function track(gameweek: number | null | undefined, event: string) {
  if (gameweek === null || gameweek === undefined) return;
  void api("captain-assist/event", { gameweek, event }).catch(() => {});
}

function freshness(iso: string): string {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 90) return `Updated ${Math.round(mins)} minutes ago`;
  const h = mins / 60;
  return h < 48 ? `Updated ${Math.round(h)} hours ago` : `Updated ${Math.round(h / 24)} days ago`;
}

const rowStyle = { display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 13 } as const;

/** No squad props: the apply route reads and revalidates the squad server-side
 *  from the frozen recommendation, so the client never supplies the XI it is
 *  writing — that is what makes a stale card refusable rather than applied. */
export default function CaptainAssistCard({ onApplied, previewData }: {
  onApplied?: () => void;
  /** Dev-only: render a fixed state without hitting the API, so the card can be
   *  eyeballed in every state. Never passed in the real app. */
  previewData?: Assist;
}) {
  const [a, setA] = useState<Assist | null>(null);
  const [step, setStep] = useState<"card" | "confirm" | "done">("card");
  const [why, setWhy] = useState(false);
  const [doCap, setDoCap] = useState(true);
  const [doVice, setDoVice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (previewData) { setA(previewData); return; }
    api<Assist>("captain-assist")
      .then((r) => {
        setA(r);
        if (r.enabled && "available" in r && r.available) {
          setDoCap(r.captainChanges);
          setDoVice(r.viceChanges);
          track(r.gameweek, "viewed");
        }
      })
      .catch(() => setA({ enabled: false }));
  }, [previewData]);

  useEffect(() => { load(); }, [load]);

  if (!a || !a.enabled || !("available" in a) || !a.available) return null;

  const nothingToChange = !a.captainChanges && !a.viceChanges;

  async function confirm() {
    if (!a || !("recommendationId" in a)) return;
    setBusy(true); setErr(null);
    try {
      const res = await api<ApplyResult>("captain-assist/apply", {
        recommendationId: a.recommendationId, applyCaptain: doCap, applyVice: doVice,
      });
      if (!res.ok) {
        // The server refused a stale card. Send the user back to a fresh one
        // rather than applying something they did not see.
        track(a.gameweek, "refresh_required");
        setErr(res.message);
        setStep("card");
        load();
        return;
      }
      setStep("done");
      onApplied?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not apply that change.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <Card style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, color: TEAL, letterSpacing: 0.4, textTransform: "uppercase" }}>Captain updated</div>
        <div style={{ marginTop: 6, fontSize: 14, color: INK }}>
          {doCap ? <>{a.captain.name} is now your captain. </> : null}
          {doVice ? <>{a.vice.name} is your vice-captain.</> : null}
        </div>
      </Card>
    );
  }

  if (step === "confirm") {
    return (
      <Card style={{ marginTop: 10 }}>
        <div style={{ fontSize: 15, color: INK, fontWeight: 600 }}>Confirm captain changes</div>

        <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}` }}>
          <div style={{ ...rowStyle, color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <span />
            <span style={{ display: "flex", gap: 24 }}><span>Current</span><span>Proposed</span></span>
          </div>
          <div style={{ ...rowStyle, borderTop: `1px solid ${LINE}` }}>
            <span style={{ color: MUTED }}>Captain</span>
            <span style={{ display: "flex", gap: 16 }}>
              <span style={{ color: MUTED }}>{a.currentCaptainName ?? "—"}</span>
              <span style={{ color: a.captainChanges ? GOLD : MUTED }}>{a.captain.name}</span>
            </span>
          </div>
          <div style={{ ...rowStyle, borderTop: `1px solid ${LINE}` }}>
            <span style={{ color: MUTED }}>Vice-captain</span>
            <span style={{ display: "flex", gap: 16 }}>
              <span style={{ color: MUTED }}>{a.currentViceName ?? "—"}</span>
              <span style={{ color: a.viceChanges ? GOLD : MUTED }}>{a.vice.name}</span>
            </span>
          </div>
        </div>

        {/* Captain and vice are independent — a user may take one and not the other. */}
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {a.captainChanges && (
            <label style={{ fontSize: 13, color: INK, display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={doCap} onChange={(e) => setDoCap(e.target.checked)} />
              Apply captain change
            </label>
          )}
          {a.viceChanges && (
            <label style={{ fontSize: 13, color: INK, display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={doVice} onChange={(e) => setDoVice(e.target.checked)} />
              Apply vice-captain change
            </label>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: MUTED, margin: "10px 0 0", lineHeight: 1.45 }}>
          {doCap ? `${a.captain.name} will become your captain and score double points. ` : ""}
          {doVice ? `${a.vice.name} will become vice-captain if your captain does not play.` : ""}
        </p>

        {err && <div style={{ marginTop: 8, fontSize: 12, color: "#E08A6B" }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Btn small gold disabled={busy || (!doCap && !doVice)} onClick={confirm}>
            {busy ? "Confirming…" : "Confirm changes"}
          </Btn>
          <Btn small disabled={busy} onClick={() => { setStep("card"); setErr(null); }}>Go back</Btn>
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 13, letterSpacing: 0.4, color: MUTED, textTransform: "uppercase" }}>
          Captain Assist{a.earlySeason ? " Beta" : ""}
        </div>
        <div style={{ fontSize: 11, color: CONF_TINT[a.confidence] ?? MUTED }}>{a.confidence} confidence</div>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
        {freshness(a.dataCutoff)}{a.earlySeason ? " · early-season model" : ""}
      </div>

      <div style={{ marginTop: 10, fontSize: 20, color: INK, fontWeight: 600 }}>{a.captain.name}</div>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>Vice-captain: {a.vice.name}</div>
      <div style={{ fontSize: 13, color: INK, marginTop: 8 }}>{a.headline}</div>

      {/* Warnings outrank the ordinary reasons visually. */}
      {a.warnings.map((w, i) => (
        // Availability is a genuine alert. The form comparison is not: it is two
        // facts side by side, so it is styled as information rather than alarm.
        <div key={i} style={{
          marginTop: 8, padding: "8px 10px", background: PANEL_2,
          border: `1px solid ${w.kind === "availability" ? "rgba(224,138,107,0.5)" : LINE}`,
          borderRadius: 8, fontSize: 12, lineHeight: 1.45,
          color: w.kind === "availability" ? "#E08A6B"
            : w.kind === "chasing_form" ? INK
            : GOLD,
        }}>{w.text}</div>
      ))}

      <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}` }}>
        {a.evidence.map((e, i) => (
          <div key={i} style={{ ...rowStyle, borderBottom: `1px solid ${LINE}` }}>
            <span style={{ color: MUTED }}>{e.label}</span>
            <span style={{ color: INK }}>{e.value}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => { if (!why) track(a.gameweek, "expanded"); setWhy((v) => !v); }}
        style={{ marginTop: 10, background: "none", border: "none", padding: 0, color: TEAL, fontSize: 12.5, cursor: "pointer" }}
      >
        {why ? "Hide explanation" : "Why this recommendation?"}
      </button>

      {why && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
          <div>{a.confidenceReason}</div>
          <div style={{ marginTop: 6 }}>{a.viceReason}</div>
          {a.currentCaptainName && (
            <div style={{ marginTop: 6 }}>Your current captain is {a.currentCaptainName}.</div>
          )}
          {a.alternatives.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {a.alternatives.map((x) => (
                <div key={x.id} style={{ ...rowStyle, borderTop: `1px solid ${LINE}` }}>
                  <span style={{ color: INK }}>{x.name} <span style={{ color: MUTED }}>· {x.label}</span></span>
                  <span style={{ color: MUTED }}>{x.reason}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11 }}>
            Data cutoff {new Date(a.dataCutoff).toLocaleString()} · model {a.model}
          </div>
        </div>
      )}

      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#E08A6B" }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {nothingToChange ? (
          <div style={{ fontSize: 12.5, color: TEAL }}>This is already your captain and vice-captain.</div>
        ) : (
          <>
            <Btn small gold disabled={!a.canApply} onClick={() => {
              if (!a.canApply) return;
              track(a.gameweek, "prepare_clicked");
              track(a.gameweek, "confirmation_opened");
              setStep("confirm");
            }}>Prepare captain changes</Btn>
            <Btn small onClick={() => { track(a.gameweek, "dismissed"); setA({ enabled: false }); }}>
              Keep my current captain
            </Btn>
          </>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: MUTED }}>{a.disclaimer}</div>
    </Card>
  );
}
