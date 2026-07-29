"use client";
/**
 * Squad Update — the personalised head of the Scout Briefing.
 *
 * The general Scout Report below is the same for everyone; this block is about
 * the fifteen YOU own. For each player the feed has a fact on — an injury, a
 * suspension, a doubt, or a blank gameweek — it shows one card: who, the fact in
 * plain words, and their next fixture. It states facts and stops there: no
 * replacement is suggested, and nothing here says sell, bench, buy or avoid. The
 * manager reads the fact and decides.
 *
 * REUSES the fantasy visual language rather than inventing one: the same
 * PlayerAvatar portrait (with the licensed headshot via faceFor) the pitch and
 * teaser use, the same Card, the same status-pill idiom as shared.tsx's Chip, and
 * the same colour tokens. A status is never colour alone — the word is always on
 * the pill.
 */
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  api, Card, SectionLabel, Loading, ErrorState,
  INK, MUTED, PANEL_2, LINE, CORAL, AMBER, LIME, tint,
} from "./shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";
import type { SquadUpdateItem, SquadUpdateStatus } from "@/lib/fantasy/advice";

/** Role colour per status. Red/coral = out for sure; amber = a doubt to weigh;
 *  green = a positive; neutral grey = informational (a blank gameweek). Paired
 *  ALWAYS with the status word, never carrying meaning on its own. */
const STATUS_ACCENT: Record<SquadUpdateStatus, string> = {
  Injured: CORAL,
  Suspended: CORAL,
  Doubt: AMBER,
  "No fixture": MUTED,
  Returning: LIME,
  "Favourable fixture": LIME,
};

function StatusPill({ status }: { status: SquadUpdateStatus }) {
  const accent = STATUS_ACCENT[status];
  const neutral = accent === MUTED;
  return (
    <span className="font-body rounded-full whitespace-nowrap" style={{
      fontSize: 11.5, fontWeight: 600, padding: "4px 10px",
      background: neutral ? PANEL_2 : tint(accent),
      color: neutral ? MUTED : accent,
      border: `1px solid ${neutral ? LINE : tint(accent, "44")}`,
    }}>{status}</span>
  );
}

/** The next fixture as a small quiet chip — "vs ARS" / "@ MCI". Silent when the
 *  club has no next fixture in range. */
function FixtureChip({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="font-body rounded-md whitespace-nowrap" style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", padding: "3px 8px",
      background: PANEL_2, color: MUTED, border: `1px solid ${LINE}`,
      fontVariantNumeric: "tabular-nums",
    }}>{text}</span>
  );
}

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 11 };

function UpdateCard({ item }: { item: SquadUpdateItem }) {
  return (
    <Card style={{ padding: 13 }}>
      <div style={rowStyle}>
        <PlayerAvatar name={item.name} avatarUrl={faceFor(item.name)} size={40} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="font-body" style={{ color: INK, fontSize: 14.5, fontWeight: 700, lineHeight: 1.15 }}>
            {item.name}
          </div>
          <div className="font-body" style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
            {item.club} · {item.position}
          </div>
        </div>
        <StatusPill status={item.status} />
      </div>
      <p className="font-body" style={{ color: INK, fontSize: 13, lineHeight: 1.45, margin: "10px 0 0" }}>
        {item.explanation}
      </p>
      {item.nextFixture && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}>
          <span className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#586058" }}>NEXT</span>
          <FixtureChip text={item.nextFixture} />
        </div>
      )}
    </Card>
  );
}

/** Compact, reassuring, and honest: a clean squad is a real result, not an empty
 *  state to apologise for. */
function AllClear() {
  return (
    <Card style={{ padding: 14 }}>
      <div className="font-display tracking-widest" style={{ color: LIME, fontSize: 13, marginBottom: 6 }}>
        YOUR SQUAD LOOKS CLEAR
      </div>
      <p className="font-body" style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        No major injuries, suspensions or availability concerns currently affect your squad.
      </p>
    </Card>
  );
}

export function SquadUpdate() {
  const [items, setItems] = useState<SquadUpdateItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ items: SquadUpdateItem[] }>("squad-update");
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your squad update.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionLabel>SQUAD UPDATE</SectionLabel>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : items === null ? (
        <Loading label="Loading your squad update">
          <div style={{ display: "grid", gap: 10 }}>
            <Card style={{ padding: 13 }}><div style={{ height: 40 }} /></Card>
            <Card style={{ padding: 13 }}><div style={{ height: 40 }} /></Card>
          </div>
        </Loading>
      ) : items.length === 0 ? (
        <AllClear />
      ) : (
        items.map((it) => <UpdateCard key={it.playerId} item={it} />)
      )}
    </section>
  );
}
