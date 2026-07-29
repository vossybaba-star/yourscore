"use client";
/** DEV-ONLY visual preview of the Captain Assist card.
 *  Renders the REAL component in each state so it can be eyeballed before
 *  anyone sees it. The gate lives in page.tsx (a Server Component, so
 *  notFound() actually produces an HTTP 404) — this file is never reached in
 *  production. */
import CaptainAssistCard from "@/components/fantasy/CaptainAssistCard";
import { INK, MUTED, PITCH } from "@/components/fantasy/shared";

type Conf = "High" | "Medium" | "Low";
type FixStatus = "confirmed_fixture" | "confirmed_blank" | "unknown";

const base = {
  enabled: true as const, available: true as const,
  recommendationId: "preview", gameweek: 1, model: "captain_season_ppg_v1_gw6_plus",
  signal: "season_points_per_game", earlySeason: false,
  dataCutoff: new Date(Date.now() - 12 * 60000).toISOString(), stale: false,
  captain: { id: 1, name: "Salah" }, vice: { id: 2, name: "Saka" },
  headline: "The strongest combination of scoring rate and playing time in your XI.",
  evidence: [
    { label: "Season scoring", value: "6.8 points per appearance this season" },
    { label: "Availability", value: "High availability" },
    { label: "Fixture", value: "Home to Everton" },
  ],
  viceReason: "Saka is the second-highest score in your XI: high availability.",
  alternatives: [
    { id: 3, name: "Haaland", label: "Higher upside", reason: "6.2 points per appearance · High availability" },
    { id: 4, name: "Palmer", label: "Safer alternative", reason: "5.4 points per appearance · Likely to play" },
  ],
  confidence: "High" as Conf,
  confidenceReason: "Strong availability and a clear advantage over your alternatives.",
  warnings: [] as { kind: "availability" | "early_season" | "chasing_form" | "stale"; text: string }[],
  currentCaptain: 9, currentVice: 8,
  captainChanges: true, viceChanges: true,
  currentCaptainName: "Haaland", currentViceName: "Palmer",
  fixtureStatus: "confirmed_fixture" as FixStatus, canApply: true,
  disclaimer: "Recommended.",
};

const withWarnings = {
  ...base, confidence: "Medium" as Conf,
  warnings: [
    { kind: "availability" as const, text: "Ekitiké is currently marked with a 0% chance of playing (Achilles injury)." },
    { kind: "chasing_form" as const, text: "Haaland is your in-form pick. Salah has scored more per game across the season." },
  ],
};

const earlySeason = {
  ...base, earlySeason: true, confidence: "Low" as Conf,
  headline: "FPL's projection and current availability are the strongest in your XI for this gameweek.",
  evidence: [
    { label: "FPL's projection", value: "4.0 for this gameweek" },
    { label: "Availability", value: "High availability" },
    { label: "Fixture", value: "Away at Fulham" },
  ],
  warnings: [{ kind: "early_season" as const, text: "There is not enough current-season data yet, so this uses FPL's projection and current availability information." }],
};

const unknownFixtures = {
  ...base, confidence: "Low" as Conf, fixtureStatus: "unknown" as FixStatus, canApply: false,
  evidence: base.evidence.slice(0, 2),
  warnings: [{ kind: "stale" as const, text: "Fixture information is temporarily unavailable." }],
};

export default function CaptainAssistPreview() {
  const states: [string, typeof base][] = [
    ["Normal", base],
    ["With warnings", withWarnings],
    ["Early season (Beta)", earlySeason],
    ["Fixtures unknown (apply blocked)", unknownFixtures],
  ];
  return (
    <div style={{ background: PITCH, minHeight: "100dvh", padding: 16, color: INK }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>Captain Assist — visual preview</h1>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 0 }}>Dev only. Not linked, not deployed.</p>
      <div style={{ display: "grid", gap: 20, maxWidth: 420 }}>
        {states.map(([label, data]) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            <CaptainAssistCard previewData={data} />
          </div>
        ))}
      </div>
    </div>
  );
}
