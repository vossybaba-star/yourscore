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
import { api, Card, Btn, ErrorState, INK, Loading, MUTED, TEAL, GOLD, PosTag } from "./shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor, faceUrlById } from "@/lib/fantasy/faces";

interface ProfileStat { label: string; value: string; note: string | null }
interface ProfileFixture { gw: number; oppShort: string; home: boolean; difficulty: "kind" | "medium" | "tough" }
interface LastSeasonLine {
  label: string; points: number; minutes: number; goals: number; assists: number;
  starts: number; perStart: number | null;
}
interface Projection {
  epNext: number | null; form: number | null; ownership: number | null;
  available: boolean; chance: number | null; news: string | null;
}
interface PlayerProfileResponse {
  name: string; club: string; priceTenths: number;
  profile: {
    playerId: number; pos: "GK" | "DEF" | "MID" | "FWD";
    preseason: boolean;
    minutes: number[]; points: number[];
    seasonPoints: number; perGame: number | null;
    flag: { kind: string; severity: "high" | "medium"; reason: string } | null;
    stats: ProfileStat[];
    lastSeason: LastSeasonLine | null;
    projection: Projection | null;
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

type ProfileTab = "overview" | "fixtures" | "stats" | "updates";
const TABS: { key: ProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "fixtures", label: "Fixtures" },
  { key: "stats", label: "Stats" },
  { key: "updates", label: "Updates" },
];

/** The profile's own tab strip — underline tabs, same language as ScoutTabs. */
function ProfileTabs({ active, onChange }: { active: ProfileTab; onChange: (t: ProfileTab) => void }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: 14 }}>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className="font-body"
            style={{
              flex: 1, padding: "8px 4px", fontSize: 12.5, fontWeight: on ? 700 : 500,
              color: on ? INK : MUTED, background: "none", cursor: "pointer",
              borderBottom: `2px solid ${on ? TEAL : "transparent"}`, marginBottom: -1,
            }}>{t.label}</button>
        );
      })}
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
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null); setError(false); setTab("overview");
    api<PlayerProfileResponse>(`player/${playerId}`)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [playerId, reload]);

  if (error) {
    return (
      <div>
        <ErrorState message="Couldn't load this player right now." onRetry={() => setReload((n) => n + 1)} />
        <div style={{ marginTop: 10 }}><Btn small onClick={onClose}>Back</Btn></div>
      </div>
    );
  }
  if (!data) return <Card><Loading label="Loading player" /></Card>;

  const p = data.profile;

  // ── Content blocks, composed under the tabs below ──────────────────────────
  const lastSeasonBlock = p.lastSeason && (
    <Section title={`LAST SEASON · ${p.lastSeason.label}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[
          { k: "Points", v: p.lastSeason.points },
          { k: "Starts", v: p.lastSeason.starts },
          { k: "Goals", v: p.lastSeason.goals },
          { k: "Assists", v: p.lastSeason.assists },
        ].map((c) => (
          <div key={c.k} style={{ textAlign: "center", padding: "8px 4px", borderRadius: 8, background: "rgba(159,178,165,0.08)" }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: INK, lineHeight: 1 }}>{c.v}</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>{c.k}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
        {p.lastSeason.minutes.toLocaleString()} minutes
        {p.lastSeason.perStart !== null ? ` · ${p.lastSeason.perStart} points a start` : ""}. Per-gameweek form begins at GW1.
      </div>
    </Section>
  );

  const projectionBlock = p.projection && (p.projection.epNext !== null || !p.projection.available) && (
    <Section title="FPL PROJECTION · NEXT GW">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        {p.projection.epNext !== null && (
          <span style={{ fontSize: 22, fontWeight: 800, color: GOLD }}>{p.projection.epNext.toFixed(1)}</span>
        )}
        <span style={{ fontSize: 12, color: MUTED }}>
          {p.projection.epNext !== null ? "FPL projected points" : "no projection yet"}
          {p.projection.ownership !== null ? ` · ${p.projection.ownership.toFixed(1)}% owned` : ""}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6, fontStyle: "italic" }}>
        A projection from FPL, not a result. Tips can be wrong.
      </div>
    </Section>
  );

  const sparklineBlocks = (
    <>
      <Section title="IS HE PLAYING?">
        <Sparkline values={p.minutes} max={90} label="minutes, most recent last" />
      </Section>
      <Section title="IS HE DELIVERING?">
        <Sparkline values={p.points} max={10} label="points, most recent last" />
      </Section>
    </>
  );

  const theCaseBlock = p.stats.length > 0 && (
    <Section title={p.preseason ? `THE CASE · ${p.lastSeason?.label ?? "last season"}` : "THE CASE"}>
      {p.stats.map((s) => (
        <div key={s.label} style={{ padding: "5px 0", borderTop: "1px solid rgba(159,178,165,0.12)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
            <span style={{ color: MUTED }}>{s.label}</span>
            <b style={{ color: INK, textAlign: "right" }}>{s.value}</b>
          </div>
          {s.note && (
            <div style={{ fontSize: 11.5, color: "#8FA89A", marginTop: 2, fontStyle: "italic" }}>{s.note}</div>
          )}
        </div>
      ))}
    </Section>
  );

  const fixturesBlock = p.fixtures.length > 0 ? (
    <Section title="WHO'S HE GOT NEXT?">
      <div style={{ display: "flex", gap: 6 }}>
        {p.fixtures.map((f) => (
          <div key={f.gw} style={{
            flex: 1, textAlign: "center", padding: "8px 3px", borderRadius: 6,
            background: "rgba(159,178,165,0.08)",
            borderBottom: `2px solid ${DIFF_COLOUR[f.difficulty] ?? MUTED}`,
          }}>
            <div style={{ fontSize: 10, color: MUTED }}>GW{f.gw}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 2 }}>{f.oppShort}</div>
            <div style={{ fontSize: 10, color: MUTED }}>{f.home ? "Home" : "Away"}</div>
          </div>
        ))}
      </div>
    </Section>
  ) : (
    <Section title="WHO'S HE GOT NEXT?">
      <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>No confirmed fixtures in range yet.</p>
    </Section>
  );

  // Availability + team news. The squad flag (if any) shows above the tabs, so
  // this tab carries FPL's availability read + any news, or an explicit all-clear.
  const avail = p.projection;
  const hasUpdate = avail && (!avail.available || !!avail.news);
  const updatesBlock = (
    <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
      {avail && (
        <div style={{
          padding: "10px 12px", borderRadius: 8, fontSize: 13,
          background: avail.available ? "rgba(0,216,192,0.08)" : "rgba(224,138,107,0.12)",
          color: avail.available ? TEAL : "#E08A6B",
        }}>
          {avail.available ? "Available" : avail.chance !== null ? `${avail.chance}% chance of playing` : "Flagged by FPL"}
          {avail.news ? ` · ${avail.news}` : ""}
        </div>
      )}
      {!hasUpdate && (
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>No fresh team news. He&apos;s available and unflagged.</p>
      )}
    </div>
  );

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <PlayerAvatar name={data.name} avatarUrl={faceUrlById(p.playerId) ?? faceFor(data.name)} size={44} />
          <div style={{ minWidth: 0 }}>
            <div id="fantasy-player-profile-name" style={{ fontSize: 17, fontWeight: 800, color: INK }}>{data.name}</div>
            <div style={{ fontSize: 12, color: MUTED }}>{data.club} · <PosTag pos={p.pos} /></div>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>£{(data.priceTenths / 10).toFixed(1)}m</div>
          <div style={{ fontSize: 11, color: MUTED }}>
            {p.seasonPoints} pts{p.perGame !== null ? ` · ${p.perGame} a ${p.preseason ? "start" : "game"}` : ""}
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

      <ProfileTabs active={tab} onChange={setTab} />

      {tab === "overview" && (
        <>
          {p.preseason ? (
            <>{lastSeasonBlock}{projectionBlock}</>
          ) : (
            <>
              <Section title="THIS SEASON">
                <div style={{ display: "flex", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: INK, lineHeight: 1 }}>{p.seasonPoints}</div>
                    <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>points</div>
                  </div>
                  {p.perGame !== null && (
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: INK, lineHeight: 1 }}>{p.perGame}</div>
                      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>a game</div>
                    </div>
                  )}
                </div>
              </Section>
              <Section title="IS HE DELIVERING?">
                <Sparkline values={p.points} max={10} label="points, most recent last" />
              </Section>
            </>
          )}
          {fixturesBlock}
        </>
      )}

      {tab === "fixtures" && fixturesBlock}

      {tab === "stats" && (
        <>
          {!p.preseason && sparklineBlocks}
          {theCaseBlock || (
            <Section title="THE CASE">
              <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>Match-by-match stats begin at GW1.</p>
            </Section>
          )}
        </>
      )}

      {tab === "updates" && updatesBlock}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn small onClick={onClose}>Back</Btn>
        {onConsider && (
          <Btn small onClick={() => onConsider(playerId)}>Consider dropping him</Btn>
        )}
      </div>
    </Card>
  );
}
