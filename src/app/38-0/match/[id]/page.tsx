/**
 * /38-0/match/[id] — public, server-rendered H2H result. Reads the snapshotted
 * match from draft_matches and sets og:image → /api/draft/og so pasted links
 * unfurl as a broadcast graphic (the growth loop). Framed from the challenger's
 * perspective (the sharer). Fails soft if the match isn't found / DB not live.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Pitch } from "@/components/draft/Pitch";
import { ScorecardView, ScorecardShell, SectionLabel, statsFromReport, goalsFromReport, potmFromReport } from "@/components/draft/Scorecard";
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
  const pens = m.detail?.pens ?? null;
  const cWon = live ? (pens ? pens.a > pens.b : s1 > s2) : challengerWon;
  const drew = live && !pens && s1 === s2;

  const cta = (
    <div className="mt-6">
      <Link href="/38-0" className="block w-full rounded-[20px] py-4 text-center font-display tracking-wide transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98]"
        style={{ background: "#00ff87", color: "#062013", fontSize: 26 }}>
        {live ? "▶ PLAY 38-0 — FREE" : "BUILD YOUR OWN XI →"}
      </Link>
      <p className="text-center font-body mt-2" style={{ fontSize: 12, color: "#8888aa" }}>
        Build your all-time Premier League XI and go live, head-to-head. No sign-up to play.
      </p>
    </div>
  );

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative max-w-lg mx-auto px-4 pt-safe">
        <div className="py-3">
          <Link href="/38-0" className="font-mono text-sm uppercase" style={{ color: "#8888aa", letterSpacing: "0.1em" }}>← 38-0</Link>
        </div>

        {live && rep ? (
          <ScorecardView data={{
            id: params.id,
            context: m.detail?.single ? "Draft XI" : "38-0 Live",
            you: { name: c.name, strength: m.challenger_strength, tier: c.projected?.tier, formation: c.formation, squad: c.squad },
            opp: { name: o.name, strength: m.opponent_strength, tier: o.projected?.tier, formation: o.formation, squad: o.squad },
            goals: { you: s1, opp: s2 },
            pens: pens ? { you: pens.a, opp: pens.b } : null,
            outcome: drew ? "draw" : cWon ? "you" : "opp",
            stats: statsFromReport(rep),
            goalEvents: goalsFromReport(rep),
            potm: potmFromReport(rep, c.name, o.name),
          }} />
        ) : (
          <ScorecardShell fk={challengerWon ? "win" : "loss"} accent={challengerWon ? "#00ff87" : "#ff4757"} headline={challengerWon ? "WIN" : "LOSS"} context="Head to head">
            <div className="text-center" style={{ marginBottom: 30 }}>
              <div className="font-display tracking-wide leading-tight" style={{ fontSize: 30, color: "#fff" }}>
                <span style={{ color: challengerWon ? "#00ff87" : "#fff" }}>{c.name}</span>
                <span style={{ color: "#8888aa", fontSize: 20 }}> {challengerWon ? "beat" : "lost to"} </span>
                <span style={{ color: !challengerWon ? "#00ff87" : "#fff" }}>{o.name}</span>
              </div>
              <div className="font-mono mt-2" style={{ fontSize: 13, color: "#8a8aa6", letterSpacing: "0.06em" }}>{m.challenger_strength} vs {m.opponent_strength}</div>
            </div>
            <SectionLabel>The line-ups</SectionLabel>
            <div className="grid grid-cols-2 gap-4" style={{ marginBottom: 30 }}>
              {[[c, m.challenger_strength, challengerWon], [o, m.opponent_strength, !challengerWon]].map(([team, str, winner], i) => {
                const t = team as TeamSnapshot;
                return (
                  <div key={i} className="rounded-2xl p-3" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-display" style={{ fontSize: 15, color: winner ? "#00ff87" : "#fff", letterSpacing: "0.03em" }}>{t.name}</span>
                      <span className="font-mono shrink-0" style={{ fontSize: 13, color: tierColor(t.projected?.tier ?? "Mid-table") }}>{str as number}</span>
                    </div>
                    <p className="mb-2 mt-0.5 truncate font-mono uppercase" style={{ fontSize: 8, letterSpacing: "0.1em", color: "#5a5a74" }}>{t.formation}</p>
                    <Pitch formation={t.formation} squad={t.squad} compact />
                  </div>
                );
              })}
            </div>
          </ScorecardShell>
        )}

        {cta}
      </div>
    </div>
  );
}
