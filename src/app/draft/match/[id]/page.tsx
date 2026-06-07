/**
 * /draft/match/[id] — public, server-rendered H2H result. Reads the snapshotted
 * match from draft_matches and sets og:image → /api/draft/og so pasted links
 * unfurl as a broadcast graphic (the growth loop). Framed from the challenger's
 * perspective (the sharer). Fails soft if the match isn't found / DB not live.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Pitch } from "@/components/draft/Pitch";
import { createDraftDb, type TeamSnapshot } from "@/lib/draft/server";
import { tierColor } from "@/lib/draft/ui";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

type Match = {
  challenger_team: TeamSnapshot;
  opponent_team: TeamSnapshot;
  challenger_strength: number;
  opponent_strength: number;
  challenger_id: string | null;
  winner_id: string;
};

async function getMatch(id: string): Promise<Match | null> {
  try {
    const db = createDraftDb();
    const { data, error } = await db
      .from("draft_matches")
      .select("challenger_team, opponent_team, challenger_strength, opponent_strength, challenger_id, winner_id")
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
  const challengerWon = m.winner_id === m.challenger_id;
  const og = new URLSearchParams({
    result: challengerWon ? "win" : "loss",
    tier: m.challenger_team.projected?.tier ?? "Champions",
    formation: m.challenger_team.formation,
    you: m.challenger_team.name,
    youStr: String(m.challenger_strength),
    opp: m.opponent_team.name,
    oppStr: String(m.opponent_strength),
  });
  const image = `${BASE}/api/draft/og?${og.toString()}`;
  const title = `${m.challenger_team.name} ${challengerWon ? "beat" : "lost to"} ${m.opponent_team.name} — Draft XI`;
  const description = `${m.challenger_strength} vs ${m.opponent_strength}. Build your all-time Premier League XI and take them on.`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function MatchPage({ params }: { params: { id: string } }) {
  const m = await getMatch(params.id);

  if (!m) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-display tracking-wide" style={{ fontSize: 28, color: "#fff" }}>RESULT NOT FOUND</div>
          <Link href="/draft" className="inline-block mt-4 font-body" style={{ color: "#00ff87" }}>← Play Draft XI</Link>
        </div>
      </div>
    );
  }

  const challengerWon = m.winner_id === m.challenger_id;
  const c = m.challenger_team;
  const o = m.opponent_team;

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
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

        <Link href="/draft" className="block w-full rounded-2xl py-4 mt-7 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
          BUILD YOUR OWN XI →
        </Link>
      </div>
    </div>
  );
}
