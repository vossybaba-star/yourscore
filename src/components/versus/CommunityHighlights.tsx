"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// Community Highlights — a feed of what's actually happening in the game:
// recent finished matches (who beat who, at what, by how much) followed by
// the standing highlights (top-ranked player, busiest player, hottest quiz).
// Every card says WHICH game it's about and gives a one-tap way in. All data
// is real, from /api/versus/activity + the global rank board; cards with no
// data simply don't render.

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const GOLD = "#ffc233";

interface FeedSide { id: string | null; name: string; avatarUrl: string | null; score: number }
interface FeedItem {
  game: "quiz" | "38-0";
  when: string;
  packId: string | null;
  packName: string | null;
  a: FeedSide;
  b: FeedSide;
  shadow: boolean;
}
interface Activity {
  trending: { packId: string; name: string; cover: string | null; attempts: number } | null;
  mostActive: { userId: string; name: string; avatarUrl: string | null; plays: number } | null;
  feed?: FeedItem[];
}
interface LbRow { user_id: string; display_name: string; avatar_url: string | null; overall_score: number; overall_rank: number }

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function GameChip({ game }: { game: "quiz" | "38-0" }) {
  const c = game === "38-0" ? LIME : TEAL;
  return (
    <span className="font-body text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md flex-shrink-0" style={{ background: `${c}1f`, color: c, border: `1px solid ${c}44` }}>
      {game === "38-0" ? "38-0" : "Quiz Battle"}
    </span>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="font-body text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md flex-shrink-0" style={{ background: `${color}1f`, color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  );
}

/** A finished match: who beat who, where, by how much — with a way in. */
function ResultCard({ f }: { f: FeedItem }) {
  const c = f.game === "38-0" ? LIME : TEAL;
  const draw = f.a.score === f.b.score;
  const verb = draw ? "drew with" : "beat";
  const bLabel = f.shadow ? `${f.b.name}’s run` : f.b.name;
  const scoreline = f.game === "38-0"
    ? `${f.a.score} – ${f.b.score}`
    : `${f.a.score.toLocaleString()} – ${f.b.score.toLocaleString()}`;
  const href = f.game === "38-0" ? "/versus/find?game=38-0" : f.packId ? `/versus/find?game=quiz&pack=${f.packId}` : "/versus/find?game=quiz";
  return (
    <div className="rounded-2xl p-3.5 flex-shrink-0 flex flex-col" style={{ width: 230, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between mb-2.5">
        <GameChip game={f.game} />
        <span className="font-body text-[10px]" style={{ color: "#586058" }}>{timeAgo(f.when)}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex -space-x-2 flex-shrink-0">
          <PlayerAvatar seed={f.a.id ?? f.a.name} name={f.a.name} avatarUrl={f.a.avatarUrl} size={30} ring={GOLD} />
          <PlayerAvatar seed={f.b.id ?? f.b.name} name={f.b.name} avatarUrl={f.b.avatarUrl} size={30} ring="rgba(255,255,255,0.15)" />
        </div>
        <p className="font-body text-xs text-white leading-snug min-w-0">
          <span className="font-bold">{f.a.name}</span> {verb} <span className="font-bold">{bLabel}</span>
        </p>
      </div>
      <p className="font-display text-xl leading-none" style={{ color: c }}>{scoreline}</p>
      <p className="font-body text-[11px] text-text-muted mt-1 truncate flex-1">
        {f.game === "38-0" ? "Live 38-0 match" : f.packName ?? "Quiz Battle"}
      </p>
      <Link href={href} className="mt-3 block text-center font-display text-[10px] tracking-widest py-2 rounded-lg active:scale-[0.97] transition-transform" style={{ background: `${c}14`, color: c, border: `1px solid ${c}44` }}>
        {f.game === "38-0" ? "PLAY 38-0 →" : "PLAY THIS QUIZ →"}
      </Link>
    </div>
  );
}

export function CommunityHighlights() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [spotlights, setSpotlights] = useState<React.ReactNode[]>([]);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const [{ data: auth }, activity, lbRes] = await Promise.all([
        sb.auth.getUser(),
        fetch("/api/versus/activity").then((r) => r.json()).catch(() => null) as Promise<Activity | null>,
        fetch("/api/leaderboard/yourscore").then((r) => r.json()).catch(() => ({ rows: [] })),
      ]);
      const uid = auth.user?.id;
      setFeed((activity?.feed ?? []).slice(0, 6));

      const out: React.ReactNode[] = [];

      // Standing highlights — who's on top, who's grinding, what's hot.
      const top = ((lbRes.rows ?? []) as LbRow[]).find((r) => r.user_id !== uid && (r.overall_score ?? 0) > 0);
      if (top) {
        out.push(
          <div key="top" className="rounded-2xl p-3.5 flex-shrink-0 flex flex-col" style={{ width: 230, background: "#0e1611", border: `1px solid ${GOLD}33` }}>
            <div className="flex items-center justify-between mb-2.5">
              <Chip label={`No.${top.overall_rank ?? 1} ranked`} color={GOLD} />
            </div>
            <div className="flex items-center gap-2.5 mb-2">
              <PlayerAvatar seed={top.user_id} name={top.display_name} avatarUrl={top.avatar_url} size={36} ring={GOLD} />
              <div className="min-w-0">
                <p className="font-body text-xs font-semibold text-white truncate">{top.display_name}</p>
                <p className="font-display text-lg leading-none mt-0.5" style={{ color: GOLD }}>{(top.overall_score ?? 0).toLocaleString()} <span className="font-body text-[9px] uppercase" style={{ color: "#8a948f" }}>pts</span></p>
              </div>
            </div>
            <p className="font-body text-[11px] text-text-muted flex-1">Top of the YourScore rankings. Beat one of their quiz runs.</p>
            <Link href={`/versus/shadow/${top.user_id}`} className="mt-3 block text-center font-display text-[10px] tracking-widest py-2 rounded-lg active:scale-[0.97] transition-transform" style={{ background: GOLD, color: "#10160c" }}>
              TRY TO BEAT →
            </Link>
          </div>
        );
      }

      if (activity?.mostActive && activity.mostActive.userId !== uid) {
        const m = activity.mostActive;
        out.push(
          <div key="active" className="rounded-2xl p-3.5 flex-shrink-0 flex flex-col" style={{ width: 230, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-2.5">
              <Chip label="On fire today" color={TEAL} />
            </div>
            <div className="flex items-center gap-2.5 mb-2">
              <PlayerAvatar seed={m.userId} name={m.name} avatarUrl={m.avatarUrl} size={36} ring={TEAL} />
              <div className="min-w-0">
                <p className="font-body text-xs font-semibold text-white truncate">{m.name}</p>
                <p className="font-display text-lg leading-none mt-0.5" style={{ color: TEAL }}>{m.plays} <span className="font-body text-[9px] uppercase" style={{ color: "#8a948f" }}>quizzes in 24h</span></p>
              </div>
            </div>
            <p className="font-body text-[11px] text-text-muted flex-1">The busiest player on YourScore right now. Fancy it?</p>
            <Link href={`/versus/quiz?to=${m.userId}`} className="mt-3 block text-center font-display text-[10px] tracking-widest py-2 rounded-lg active:scale-[0.97] transition-transform" style={{ background: TEAL, color: "#04231f" }}>
              CHALLENGE THEM →
            </Link>
          </div>
        );
      }

      if (activity?.trending) {
        const t = activity.trending;
        out.push(
          <div key="hot" className="rounded-2xl p-3.5 flex-shrink-0 flex flex-col" style={{ width: 230, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-2.5">
              <Chip label="Hottest quiz" color={TEAL} />
            </div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-9 h-9 rounded-xl overflow-hidden grid place-items-center flex-shrink-0" style={{ background: `${TEAL}14`, border: `1px solid ${TEAL}33` }}>
                {t.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={t.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <span className="font-display text-lg" style={{ color: TEAL }}>{(t.name[0] ?? "?").toUpperCase()}</span>}
              </span>
              <p className="font-body text-xs font-semibold text-white leading-snug line-clamp-2 min-w-0">{t.name}</p>
            </div>
            <p className="font-body text-[11px] text-text-muted flex-1">{t.attempts} plays in the last 24h — the quiz everyone&rsquo;s on.</p>
            <Link href={`/versus/find?game=quiz&pack=${t.packId}`} className="mt-3 block text-center font-display text-[10px] tracking-widest py-2 rounded-lg active:scale-[0.97] transition-transform" style={{ background: TEAL, color: "#04231f" }}>
              PLAY IT NOW →
            </Link>
          </div>
        );
      }
      setSpotlights(out);
    })();
  }, []);

  if (feed.length === 0 && spotlights.length === 0) return null;

  return (
    <div>
      <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>Community highlights</p>
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
        {feed.map((f, i) => <ResultCard key={`${f.when}:${i}`} f={f} />)}
        {spotlights}
      </div>
    </div>
  );
}
