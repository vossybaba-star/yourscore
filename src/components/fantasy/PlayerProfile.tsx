"use client";
/**
 * Player profile — the six questions a manager asks before keeping or selling.
 *
 * THE PRODUCT TURN (founder, 24 Jul 2026): this does not tell anyone what to
 * do. It lays out the case and the manager decides. We could never prove our
 * picks beat a real manager's; we can prove every number here is true. That is
 * a smaller claim and a far more defensible one.
 *
 * The sections are ordered by what actually PAYS that position — read off the
 * scoring table, not chosen by taste. A clean sheet is 4 points to a defender
 * and 0 to a forward, so a forward's profile never mentions one. That ordering
 * is decided server-side in buildPlayerProfile; this component just renders
 * what it is handed, in order.
 */
import { useEffect, useState } from "react";
import { api, Card, Btn, INK, MUTED } from "./shared";

interface ProfileStat { label: string; value: string; note: string | null }
interface ProfileFixture { gw: number; oppShort: string; home: boolean; difficulty: "kind" | "medium" | "tough" }
interface PlayerProfileResponse {
  name: string; club: string; priceTenths: number;
  profile: {
    playerId: number; pos: "GK" | "DEF" | "MID" | "FWD";
    minutes: number[]; points: number[];
    seasonPoints: number; perGame: number | null;
    flag: { kind: string; severity: "high" | "medium"; reason: string } | null;
    stats: ProfileStat[];
    fixtures: ProfileFixture[];
  };
}

const DIFF_COLOUR: Record<string, string> = {
  kind: "#6FCF97", medium: "#E0C36B", tough: "#E08A6B",
};

/** A row of per-gameweek bars. Deliberately not a chart library: the shape of
 *  "90, 90, 62, 0, 0" is the entire message and a bar per week says it faster
 *  than any axis could. */
function Sparkline({ values, max, label }: { values: number[]; max: number; label: string }) {
  const cap = Math.max(max, ...values, 1);
  return (
    <div>
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 34 }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div
              title={`${v}`}
              style={{
                height: `${Math.max(3, (v / cap) * 100)}%`,
                background: v === 0 ? "#3A4A40" : "#6FCF97",
                borderRadius: 2,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
        {values.map((v, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: MUTED }}>{v}</div>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3, letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em", color: MUTED, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function PlayerProfile({ playerId, onClose, onConsider }: {
  playerId: number;
  onClose: () => void;
  /** Mark him as one you're thinking of dropping — hands straight to the
   *  planner rather than making someone who has just read bad news go and
   *  find the same player again. */
  onConsider?: (id: number) => void;
}) {
  const [data, setData] = useState<PlayerProfileResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setError(false);
    api<PlayerProfileResponse>(`player/${playerId}`)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [playerId]);

  if (error) {
    return (
      <Card>
        <p style={{ margin: 0, color: MUTED, fontSize: 13 }}>Couldn&apos;t load this player right now.</p>
        <div style={{ marginTop: 10 }}><Btn small onClick={onClose}>Back</Btn></div>
      </Card>
    );
  }
  if (!data) return <Card><p style={{ margin: 0, color: MUTED, fontSize: 13 }}>Loading…</p></Card>;

  const p = data.profile;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: INK }}>{data.name}</div>
          <div style={{ fontSize: 12, color: MUTED }}>{data.club} · {p.pos}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>£{(data.priceTenths / 10).toFixed(1)}m</div>
          <div style={{ fontSize: 11, color: MUTED }}>
            {p.seasonPoints} pts{p.perGame !== null ? ` · ${p.perGame} a game` : ""}
          </div>
        </div>
      </div>

      {p.flag && (
        <div style={{
          marginTop: 10, padding: "7px 9px", borderRadius: 6,
          background: p.flag.severity === "high" ? "rgba(224,138,107,0.14)" : "rgba(159,178,165,0.12)",
          fontSize: 12.5, color: p.flag.severity === "high" ? "#E08A6B" : MUTED,
        }}>
          {p.flag.reason}
        </div>
      )}

      <Section title="IS HE PLAYING?">
        <Sparkline values={p.minutes} max={90} label="minutes, most recent last" />
      </Section>

      <Section title="IS HE DELIVERING?">
        <Sparkline values={p.points} max={10} label="points, most recent last" />
      </Section>

      {p.stats.length > 0 && (
        <Section title="THE CASE">
          {p.stats.map((s) => (
            <div key={s.label} style={{ padding: "5px 0", borderTop: "1px solid rgba(159,178,165,0.12)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <span style={{ color: MUTED }}>{s.label}</span>
                <b style={{ color: INK, textAlign: "right" }}>{s.value}</b>
              </div>
              {/* The interpretation line. Mechanical, not a model — a clear
                  margin gets a sentence, a close call gets silence, and the
                  reader can always redo the arithmetic from the value above. */}
              {s.note && (
                <div style={{ fontSize: 11.5, color: "#8FA89A", marginTop: 2, fontStyle: "italic" }}>
                  {s.note}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {p.fixtures.length > 0 && (
        <Section title="WHO'S HE GOT NEXT?">
          <div style={{ display: "flex", gap: 6 }}>
            {p.fixtures.map((f) => (
              <div key={f.gw} style={{
                flex: 1, textAlign: "center", padding: "6px 3px", borderRadius: 5,
                background: "rgba(159,178,165,0.08)",
                borderBottom: `2px solid ${DIFF_COLOUR[f.difficulty] ?? MUTED}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{f.oppShort}</div>
                <div style={{ fontSize: 10, color: MUTED }}>{f.home ? "H" : "A"}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn small onClick={onClose}>Back</Btn>
        {onConsider && (
          <Btn small onClick={() => onConsider(playerId)}>Consider dropping him</Btn>
        )}
      </div>
    </Card>
  );
}
