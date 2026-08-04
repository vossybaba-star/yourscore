"use client";
/**
 * /r/[id] — the public Scout verdict a bot posts back to someone who tweeted
 * their FPL team. A cold visitor lands here from the feed, so it leads with the
 * payoff (the score + read), shows the team we graded, then turns them into a
 * YourScore manager by carrying that exact XI into the builder.
 *
 * Renders entirely from the stored snapshot passed in — no live pool read, no
 * recompute — so it is fast, immutable, and identical to the unfurl card.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Btn, Card, Header, INK, LINE, MUTED, PANEL, TEAL, GOLD, LIME, page, tint, type Pos,
} from "@/components/fantasy/shared";
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";
import { BenchStrip } from "@/components/fantasy/board/BenchStrip";
import { BottomNav } from "@/components/ui/BottomNav";
import { faceUrlById } from "@/lib/fantasy/faces";
import {
  BandGroups, scoreColor, HorizonTabs, HORIZON_HELPER, type Horizon,
} from "@/components/fantasy/RatingBands";
import { trackSquadRated, trackRateOutcome } from "@/lib/analytics/trackGame";
import type { RateShareRow, RateSharePlayer } from "@/lib/fantasy/rateShareTypes";

const DRAFT_KEY = "ys-fantasy-draft";
const ROW_ORDER: Pos[] = ["FWD", "MID", "DEF", "GK"];
const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;

function Marker({ p, dim }: { p: RateSharePlayer; dim?: boolean }) {
  return (
    <div style={{ flex: dim ? undefined : "1 1 0", minWidth: 0, maxWidth: 72, padding: 2 }}>
      <PlayerMarker
        name={p.name} label={surname(p.name)} avatarUrl={faceUrlById(p.id) ?? null} club={p.club}
        size={dim ? 26 : 30} isCaptain={p.isCaptain} isVice={p.isVice} pos={p.pos as Pos} dim={dim} />
    </div>
  );
}

const HOOKS = [
  { accent: TEAL, title: "Graded by the Scout", body: "A real read on your XI, not a guess." },
  { accent: GOLD, title: "Monthly prizes", body: "Top the monthly table and you win." },
  { accent: LIME, title: "League chats", body: "Start a league and the group chat runs all season." },
];

export function RateShareView({ row }: { row: RateShareRow }) {
  const router = useRouter();
  const [horizon, setHorizon] = useState<Horizon>("month");
  const players = row.players;
  const ids = useMemo(() => players.map((p) => p.id), [players]);
  const xi = players.filter((p) => !p.isBench);
  const bench = players.filter((p) => p.isBench);
  const h = row.rating[horizon];

  const xiRows = ROW_ORDER
    .map((pos) => ({ pos, entries: xi.filter((p) => (p.pos as Pos) === pos) }))
    .filter((r) => r.entries.length > 0);

  // A cold viewer seeing a real grade — the same "someone saw their rating"
  // signal the upload flow fires, tagged so the bot funnel reports separately.
  useEffect(() => {
    trackSquadRated({ source: "share", score: row.rating.month.score });
  }, [row.rating.month.score]);

  const writeDraft = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(ids)); } catch { /* private mode */ }
  };
  const makeThisMyTeam = () => {
    writeDraft();
    trackRateOutcome("share-make-this-my-team", true, { source: "share" });
    router.push("/auth/sign-in?next=/fantasy/build");
  };
  const buildMyOwn = () => {
    trackRateOutcome("share-build-my-own", true, { source: "share" });
    router.push("/auth/sign-in?next=/fantasy/build");
  };

  return (
    <>
      <main data-fantasy style={page}>
        <Header />

        {/* ── eyebrow ── */}
        <div className="font-body rounded-full" style={{
          display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          padding: "5px 12px", marginBottom: 12,
          background: tint(TEAL, "1e"), border: `1px solid ${tint(TEAL, "55")}`, color: TEAL,
        }}>
          RATED BY THE YOURSCORE SCOUT
        </div>

        {/* ── the verdict (payoff first) ── */}
        <Card style={{ marginBottom: 16 }}>
          <HorizonTabs active={horizon} onChange={setHorizon} />
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 10px", lineHeight: 1.4 }}>
            {HORIZON_HELPER[horizon]}
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
            <span className="font-display" style={{ fontSize: 52, lineHeight: 1, color: scoreColor(h.score) }}>
              {h.score.toFixed(1)}
            </span>
            <span className="font-body" style={{ fontSize: 13, color: MUTED }}>out of 10</span>
          </div>
          <p style={{ fontSize: 14.5, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>{h.verdict}</p>
          <BandGroups bands={h.bands} />
          <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 6, marginTop: 4 }}>
            WORTH A LOOK
          </div>
          <p style={{ fontSize: 13, color: INK, lineHeight: 1.5, margin: 0 }}>{h.moveLine}</p>
        </Card>

        {/* ── the team we read ── */}
        <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: 8 }}>
          THE TEAM WE GRADED
        </div>
        <div className="rounded-2xl" style={{
          border: `1px solid ${LINE}`, display: "flex", alignItems: "stretch", overflow: "hidden", marginBottom: 22,
        }}>
          <PitchSurface round="left">
            {xiRows.map((r) => (
              <div key={r.pos} style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                {r.entries.map((p) => <Marker key={p.id} p={p} />)}
              </div>
            ))}
          </PitchSurface>
          <BenchStrip>
            {bench.map((p) => <Marker key={p.id} p={p} dim />)}
          </BenchStrip>
        </div>

        {/* ── make this your squad ── */}
        <div style={{
          borderRadius: 16, padding: 18, marginBottom: 16,
          background: `linear-gradient(150deg, ${tint(TEAL, "22")}, ${PANEL})`, border: `1px solid ${tint(TEAL, "55")}`,
        }}>
          <span className="font-body rounded-full" style={{
            display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
            padding: "4px 10px", marginBottom: 12,
            background: tint(GOLD, "1e"), border: `1px solid ${tint(GOLD, "55")}`, color: GOLD,
          }}>
            FANTASY PL IS LIVE ON YOURSCORE
          </span>
          <div className="font-display" style={{ fontSize: 22, color: INK, lineHeight: 1.1, marginBottom: 6 }}>
            Make this your squad
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
            Take this exact team into YourScore free, friend. One transfer a gameweek, and what you know earns you more. Then take on your friends in a league that runs all season.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><Btn onClick={buildMyOwn}>Build my own</Btn></div>
            <div style={{ flex: 1 }}><Btn gold glow onClick={makeThisMyTeam}>Make this my team</Btn></div>
          </div>
        </div>

        {/* ── why ── */}
        <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
          {HOOKS.map((hook) => (
            <div key={hook.title} className="rounded-2xl" style={{
              display: "flex", alignItems: "center", gap: 12, padding: "13px 14px",
              background: PANEL, border: `1px solid ${LINE}`,
            }}>
              <span aria-hidden style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: tint(hook.accent, "1e"), border: `1px solid ${tint(hook.accent, "55")}`,
              } as CSSProperties} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 2 }}>{hook.title}</div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{hook.body}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── footer: rate your own ── */}
        <button type="button" onClick={() => router.push("/fantasy/rate")} style={{
          width: "100%", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 12,
          padding: "12px 14px", cursor: "pointer", color: MUTED, fontSize: 12.5, lineHeight: 1.4,
        }}>
          Got your own team? <span style={{ color: TEAL, fontWeight: 700 }}>Rate it with the Scout</span>
        </button>
      </main>
      <BottomNav />
    </>
  );
}
