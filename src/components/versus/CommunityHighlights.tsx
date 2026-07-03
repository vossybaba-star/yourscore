"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// Community Highlights — the compact swipeable module from the founder's
// carousel mockup: trending player (TRY TO BEAT → their shadow library),
// most-active player (CHALLENGE), rising quiz (PLAY NOW). All real data from
// /api/versus/activity + the global rank board; cards with no data simply
// don't render.

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const GOLD = "#ffc233";

interface Activity {
  trending: { packId: string; name: string; cover: string | null; attempts: number } | null;
  mostActive: { userId: string; name: string; avatarUrl: string | null; plays: number } | null;
}
interface LbRow { user_id: string; display_name: string; avatar_url: string | null; overall_score: number; overall_rank: number }

interface Card {
  key: string;
  badge: string;
  badgeColor: string;
  body: React.ReactNode;
  cta: string;
  href: string;
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="font-body text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md" style={{ background: `${color}1f`, color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  );
}

export function CommunityHighlights() {
  const [cards, setCards] = useState<Card[]>([]);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const [{ data: auth }, activity, lbRes] = await Promise.all([
        sb.auth.getUser(),
        fetch("/api/versus/activity").then((r) => r.json()).catch(() => null) as Promise<Activity | null>,
        fetch("/api/leaderboard/yourscore").then((r) => r.json()).catch(() => ({ rows: [] })),
      ]);
      const uid = auth.user?.id;
      const out: Card[] = [];

      // Trending player = the top-ranked player who isn't you → beat their runs.
      const top = ((lbRes.rows ?? []) as LbRow[]).find((r) => r.user_id !== uid && (r.overall_score ?? 0) > 0);
      if (top) {
        out.push({
          key: "trending", badge: "Trending", badgeColor: LIME,
          body: (
            <div className="flex flex-col items-center text-center gap-1.5 pt-1">
              <PlayerAvatar seed={top.user_id} name={top.display_name} avatarUrl={top.avatar_url} size={40} ring={LIME} />
              <p className="font-body text-xs font-semibold text-white truncate w-full">{top.display_name}</p>
              <p className="font-display text-lg leading-none" style={{ color: LIME }}>{(top.overall_score ?? 0).toLocaleString()} <span className="font-body text-[9px] uppercase" style={{ color: "#8a948f" }}>pts</span></p>
            </div>
          ),
          cta: "TRY TO BEAT", href: `/versus/shadow/${top.user_id}`,
        });
      }

      if (activity?.mostActive && activity.mostActive.userId !== uid) {
        const m = activity.mostActive;
        out.push({
          key: "active", badge: "Most active", badgeColor: TEAL,
          body: (
            <div className="flex flex-col items-center text-center gap-1.5 pt-1">
              <PlayerAvatar seed={m.userId} name={m.name} avatarUrl={m.avatarUrl} size={40} ring={TEAL} />
              <p className="font-body text-xs font-semibold text-white truncate w-full">{m.name}</p>
              <p className="font-display text-lg leading-none" style={{ color: TEAL }}>{m.plays} <span className="font-body text-[9px] uppercase" style={{ color: "#8a948f" }}>today</span></p>
            </div>
          ),
          cta: "CHALLENGE", href: `/versus/quiz?to=${m.userId}`,
        });
      }

      if (activity?.trending) {
        const t = activity.trending;
        out.push({
          key: "rising", badge: "Rising star", badgeColor: GOLD,
          body: (
            <div className="flex flex-col items-center text-center gap-1.5 pt-1">
              <span className="w-10 h-10 rounded-xl overflow-hidden grid place-items-center" style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}33` }}>
                {t.cover
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={t.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
                  : <span className="font-display text-lg" style={{ color: GOLD }}>{(t.name[0] ?? "?").toUpperCase()}</span>}
              </span>
              <p className="font-body text-xs font-semibold text-white w-full leading-snug line-clamp-2">{t.name}</p>
              <p className="font-display text-lg leading-none" style={{ color: GOLD }}>{t.attempts} <span className="font-body text-[9px] uppercase" style={{ color: "#8a948f" }}>plays today</span></p>
            </div>
          ),
          cta: "PLAY NOW", href: "/versus/quiz",
        });
      }
      setCards(out);
    })();
  }, []);

  if (cards.length === 0) return null;

  return (
    <div>
      <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>Community highlights</p>
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
        {cards.map((c) => (
          <div key={c.key} className="rounded-2xl p-3 flex-shrink-0 flex flex-col" style={{ width: 140, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="mb-2"><Chip label={c.badge} color={c.badgeColor} /></div>
            <div className="flex-1">{c.body}</div>
            <Link href={c.href} className="mt-3 block text-center font-display text-[10px] tracking-widest py-2 rounded-lg active:scale-[0.97] transition-transform" style={{ background: c.badgeColor, color: "#10160c" }}>
              {c.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
