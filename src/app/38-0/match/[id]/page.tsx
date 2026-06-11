/**
 * /38-0/match/[id] — public, server-rendered H2H result. Reads the snapshotted
 * match from draft_matches and sets og:image → /api/draft/og so pasted links
 * unfurl as a broadcast graphic (the growth loop). Framed from the challenger's
 * perspective (the sharer). Fails soft if the match isn't found / DB not live.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Pitch } from "@/components/draft/Pitch";
import { createDraftDb, type TeamSnapshot } from "@/lib/draft/server";
import { tierColor } from "@/lib/draft/ui";
import { liveOgQuery } from "@/lib/draft/share";
import { asLeague, LEAGUE_META } from "@/lib/draft/types";
import type { MatchReport } from "@/lib/draft/live-score";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

// Both live (two-half) and one-off (quick/async/challenge) matches store a report in
// `detail`; one-offs additionally carry `single: true`.
type MatchDetail = { pens?: { a: number; b: number } | null; report?: MatchReport; single?: boolean };

type Match = {
  challenger_team: TeamSnapshot;
  opponent_team: TeamSnapshot;
  challenger_strength: number;
  opponent_strength: number;
  challenger_id: string | null;
  winner_id: string | null; // null = draw (live two-half matches can draw)
  challenger_goals: number | null;
  opponent_goals: number | null;
  detail: MatchDetail | null;
};

async function getMatch(id: string): Promise<Match | null> {
  try {
    const db = createDraftDb();
    const { data, error } = await db
      .from("draft_matches")
      .select("challenger_team, opponent_team, challenger_strength, opponent_strength, challenger_id, winner_id, challenger_goals, opponent_goals, detail")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      challenger_team: data.challenger_team as unknown as TeamSnapshot,
      opponent_team: data.opponent_team as unknown as TeamSnapshot,
      challenger_strength: Number(data.challenger_strength),
      opponent_strength: Number(data.opponent_strength),
      challenger_id: data.challenger_id,
      winner_id: data.winner_id,
      challenger_goals: data.challenger_goals,
      opponent_goals: data.opponent_goals,
      detail: (data.detail ?? null) as MatchDetail | null,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const m = await getMatch(params.id);
  if (!m) {
    return { title: "Draft XI — YourScore" };
  }
  const live = hasReport(m);
  const leagueName = LEAGUE_META[asLeague((m as { competition?: string }).competition)].name;

  let image: string;
  let title: string;
  let description: string;
  if (live) {
    const s1 = m.challenger_goals ?? 0, s2 = m.opponent_goals ?? 0;
    image = `${BASE}/api/draft/live-og?${liveOgQuery({
      p1: m.challenger_team.name, p2: m.opponent_team.name, s1, s2,
      str1: m.challenger_strength, str2: m.opponent_strength,
      pens: m.detail?.pens ?? null, report: m.detail!.report!,
    })}`;
    const pens = m.detail?.pens ? ` (pens ${m.detail.pens.a}-${m.detail.pens.b})` : "";
    title = `${m.challenger_team.name} ${s1}–${s2} ${m.opponent_team.name}${pens} — ${m.detail?.single ? "Draft XI" : "38-0 Live"}`;
    description = m.detail!.report!.potm
      ? `MOTM ${m.detail!.report!.potm.name} (${m.detail!.report!.potm.rating.toFixed(1)}). Build your XI and go live, head-to-head.`
      : `Build your all-time ${leagueName} XI and go live, head-to-head.`;
  } else {
    const challengerWon = m.winner_id === m.challenger_id;
    const og = new URLSearchParams({
      result: challengerWon ? "win" : "loss",
      tier: m.challenger_team.projected?.tier ?? "Champions",
      formation: m.challenger_team.formation,
      you: m.challenger_team.name, youStr: String(m.challenger_strength),
      opp: m.opponent_team.name, oppStr: String(m.opponent_strength),
    });
    image = `${BASE}/api/draft/og?${og.toString()}`;
    title = `${m.challenger_team.name} ${challengerWon ? "beat" : "lost to"} ${m.opponent_team.name} — Draft XI`;
    description = `${m.challenger_strength} vs ${m.opponent_strength}. Build your all-time ${leagueName} XI and take them on.`;
  }

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** Any engine-resolved result (live two-half OR a one-off) carries goals + a full
 *  report; legacy strength-only async rows don't. Drives the rich scoreline view. */
function hasReport(m: Match): m is Match & { detail: { report: MatchReport } } {
  return m.challenger_goals != null && !!m.detail?.report;
}

export default async function MatchPage({ params }: { params: { id: string } }) {
  const m = await getMatch(params.id);

  if (!m) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-display tracking-wide" style={{ fontSize: 28, color: "#fff" }}>RESULT NOT FOUND</div>
          <Link href="/38-0" className="inline-block mt-4 font-body" style={{ color: "#00ff87" }}>← Play Draft XI</Link>
        </div>
      </div>
    );
  }

  const challengerWon = m.winner_id === m.challenger_id;
  const c = m.challenger_team;
  const o = m.opponent_team;
  const live = hasReport(m);
  const rep = m.detail?.report;
  const s1 = m.challenger_goals ?? 0, s2 = m.opponent_goals ?? 0;
  const cWon = live ? (m.detail?.pens ? m.detail.pens.a > m.detail.pens.b : s1 > s2) : challengerWon;

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        {live ? (
          <div className="pt-8 text-center">
            <div className="font-display tracking-wide" style={{ fontSize: 13, color: "#8888aa" }}>{m.detail?.single ? "DRAFT XI · FULL TIME" : "38-0 LIVE · FULL TIME"}</div>
            <div className="flex items-center justify-center gap-3 mt-3">
              <span className="font-display tracking-wide truncate text-right" style={{ fontSize: 18, color: cWon ? "#00ff87" : "#cfcfe6", maxWidth: 130 }}>{c.name}</span>
              <span className="font-display tabular-nums" style={{ fontSize: 46, fontWeight: 900, color: cWon ? "#00ff87" : "#cfcfe6" }}>{s1}</span>
              <span style={{ color: "#555", fontSize: 28 }}>–</span>
              <span className="font-display tabular-nums" style={{ fontSize: 46, fontWeight: 900, color: !cWon && (s1 !== s2 || m.detail?.pens) ? "#00ff87" : "#cfcfe6" }}>{s2}</span>
              <span className="font-display tracking-wide truncate text-left" style={{ fontSize: 18, color: !cWon && (s1 !== s2 || m.detail?.pens) ? "#00ff87" : "#cfcfe6", maxWidth: 130 }}>{o.name}</span>
            </div>
            {m.detail?.pens && <div className="font-body mt-1" style={{ fontSize: 13, color: "#ffb800" }}>penalties {m.detail.pens.a}–{m.detail.pens.b}</div>}
            {rep?.potm && (
              <div className="inline-flex items-center gap-2 rounded-full mt-3 px-4 py-1.5" style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.35)" }}>
                <span className="font-body" style={{ fontSize: 12, color: "#ffb800", letterSpacing: 1 }}>⭐ MOTM</span>
                <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>{rep.potm.name} <b style={{ color: "#ffb800" }}>{rep.potm.rating.toFixed(1)}</b></span>
              </div>
            )}
            {rep && rep.events.length > 0 && (
              <div className="font-body mt-2 truncate" style={{ fontSize: 12, color: "#cfcfe6" }}>⚽ {rep.events.map((e) => `${e.scorerName} ${e.minute}'`).join(" · ")}</div>
            )}
            {rep && typeof rep.a.shots === "number" && (
              <div className="rounded-xl overflow-hidden mt-4" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
                {([
                  ["Possession", `${rep.a.possession}%`, `${rep.b.possession}%`, rep.a.possession, rep.b.possession],
                  ["Shots", rep.a.shots, rep.b.shots, rep.a.shots, rep.b.shots],
                  ["On target", rep.a.shotsOnTarget, rep.b.shotsOnTarget, rep.a.shotsOnTarget, rep.b.shotsOnTarget],
                  ["Corners", rep.a.corners, rep.b.corners, rep.a.corners, rep.b.corners],
                  ["Fouls", rep.a.fouls, rep.b.fouls, rep.a.fouls, rep.b.fouls],
                  ["Offsides", rep.a.offsides, rep.b.offsides, rep.a.offsides, rep.b.offsides],
                  ["Throw-ins", rep.a.throwins, rep.b.throwins, rep.a.throwins, rep.b.throwins],
                ] as [string, string | number, string | number, number, number][]).map(([label, av, bv, an, bn]) => (
                  <div key={label} className="flex items-center px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <span className="flex-1 text-left font-body tabular-nums font-bold" style={{ fontSize: 15, color: an >= bn ? "#fff" : "#8888aa" }}>{av}</span>
                    <span className="text-center font-body" style={{ width: 110, fontSize: 10, letterSpacing: 1, color: "#7a7a92" }}>{label.toUpperCase()}</span>
                    <span className="flex-1 text-right font-body tabular-nums font-bold" style={{ fontSize: 15, color: bn >= an ? "#fff" : "#8888aa" }}>{bv}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {!live && (
          <div className="pt-8 text-center">
            <div className="font-display tracking-wide" style={{ fontSize: 13, color: "#8888aa" }}>DRAFT XI · HEAD TO HEAD</div>
            <div className="font-display tracking-wide leading-none mt-2" style={{ fontSize: 30, color: "#fff" }}>
              <span style={{ color: challengerWon ? "#00ff87" : "#fff" }}>{c.name}</span>
              <span style={{ color: "#8888aa", fontSize: 20 }}> {challengerWon ? "beat" : "lost to"} </span>
              <span style={{ color: !challengerWon ? "#00ff87" : "#fff" }}>{o.name}</span>
            </div>
            <div className="font-body mt-2" style={{ fontSize: 14, color: "#cfcfe6" }}>
              {m.challenger_strength} vs {m.opponent_strength}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-6">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide truncate" style={{ fontSize: 15, color: challengerWon ? "#00ff87" : "#fff", maxWidth: "70%" }}>{c.name}</span>
              <span className="font-display" style={{ fontSize: 18, color: tierColor(c.projected?.tier ?? "Mid-table") }}>{m.challenger_strength}</span>
            </div>
            <Pitch formation={c.formation} squad={c.squad} compact />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide truncate" style={{ fontSize: 15, color: !challengerWon ? "#00ff87" : "#fff", maxWidth: "70%" }}>{o.name}</span>
              <span className="font-display" style={{ fontSize: 18, color: tierColor(o.projected?.tier ?? "Mid-table") }}>{m.opponent_strength}</span>
            </div>
            <Pitch formation={o.formation} squad={o.squad} compact />
          </div>
        </div>

        <div className="mt-7">
          <Link href="/38-0" className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#00ff87", color: "#062013", fontSize: 26 }}>
            {live ? "▶ PLAY 38-0 — FREE" : "BUILD YOUR OWN XI →"}
          </Link>
          <p className="text-center font-body mt-2" style={{ fontSize: 12, color: "#8888aa" }}>
            Build your all-time Premier League XI and go live, head-to-head. No sign-up to play.
          </p>
        </div>
      </div>
    </div>
  );
}
