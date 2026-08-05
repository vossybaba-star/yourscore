"use client";
/**
 * Fixture picker sheet for the post composer (Phase 2b) — same portaled
 * bottom sheet pattern as GifPicker/PlayerPickerSheet. Lists the current
 * gameweek's fixtures from /api/fantasy/fixtures/current (server-side reuses
 * the SAME SportMonks fixture list the news ticker builds from — see
 * lib/fantasy/fixtureList.ts).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";

export interface PickableFixture {
  fixtureId: number; homeClub: string; awayClub: string; kickoffIso: string; gw: number;
}

type LoadState = "loading" | "ready" | "empty" | "error";

export function FixturePickerSheet({ open, onClose, onSelect }: {
  open: boolean; onClose: () => void; onSelect: (f: PickableFixture) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [fixtures, setFixtures] = useState<PickableFixture[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setState("loading");
    fetch("/api/fantasy/fixtures/current")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const list: PickableFixture[] = Array.isArray(d.fixtures) ? d.fixtures : [];
        setFixtures(list);
        setState(list.length ? "ready" : "empty");
      })
      .catch(() => { setFixtures([]); setState("error"); });
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 65, background: "rgba(4,8,6,0.72)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Attach a fixture" style={{
        width: "100%", maxWidth: 480, maxHeight: "75vh",
        background: PANEL, borderTopLeftRadius: 18, borderTopRightRadius: 18,
        border: `1px solid ${tint(TEAL, "44")}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px", flexShrink: 0 }}>
          <span className="font-display" style={{ fontSize: 17, color: INK }}>Attach a fixture</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: MUTED, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          {state === "loading" && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Loading fixtures</p>}
          {state === "error" && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Couldn&apos;t load fixtures. Try again in a moment.</p>}
          {state === "empty" && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24, lineHeight: 1.5 }}>No fixtures for this gameweek yet.</p>}
          {state === "ready" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {fixtures.map((f) => {
                const home = getTeamBadgeUrlSync(f.homeClub);
                const away = getTeamBadgeUrlSync(f.awayClub);
                const kickoff = new Date(f.kickoffIso);
                const label = Number.isNaN(kickoff.getTime()) ? "" : kickoff.toLocaleString("en-GB", {
                  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
                });
                return (
                  <button key={f.fixtureId} onClick={() => onSelect(f)} style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
                    background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px",
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {home && <img src={home} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />}
                      <span style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.homeClub}</span>
                    </span>
                    <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>v</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{f.awayClub}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {away && <img src={away} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain" }} />}
                    </span>
                    <span style={{ fontSize: 10.5, color: MUTED, flexShrink: 0, whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
