"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// Cold-start / discovery block for the Versus tab. Two parts:
//  • "Better with friends" promo — shown when you have few friends, nudging you
//    to add some (so the head-to-head loop actually has opponents).
//  • "Top players" rail — real active players from the global YourScore rank
//    (public), with their avatar + score + an Add button. Gives the tab life and
//    a way to build a friend list even before you know anyone in the app.

const TEAL = "#00d8c0";
const GOLD = "#ffc233";

interface Player { user_id: string; display_name: string; avatar_url: string | null; overall_score: number; overall_rank: number }
type AddState = "idle" | "requested" | "friends";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function VersusDiscovery({ promoOnly = false }: { promoOnly?: boolean } = {}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [state, setState] = useState<Record<string, AddState>>({});

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: auth } = await sb.auth.getUser();
      const uid = auth.user?.id;

      let friendIds = new Set<string>();
      if (uid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = sb as any;
        const { data: fr } = await db.from("friendships").select("user_id, friend_id, status").or(`user_id.eq.${uid},friend_id.eq.${uid}`);
        const accepted = ((fr ?? []) as Row[]).filter((r) => r.status === "accepted");
        friendIds = new Set(accepted.map((r) => (r.user_id === uid ? r.friend_id : r.user_id)));
        setFriendCount(friendIds.size);
      }

      try {
        const res = await fetch("/api/leaderboard/yourscore");
        const data = await res.json();
        const rows = (data.rows ?? []) as Player[];
        setPlayers(rows.filter((r) => r.user_id !== uid && !friendIds.has(r.user_id) && (r.overall_score ?? 0) > 0).slice(0, 6));
      } catch { /* leave empty */ }
    })();
  }, []);

  async function add(id: string) {
    if (state[id]) return;
    setState((s) => ({ ...s, [id]: "requested" }));
    try {
      const res = await fetch("/api/friends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ friendId: id }) });
      const data = await res.json();
      const st: AddState = data.status === "now_friends" || data.status === "already_friends" ? "friends" : "requested";
      setState((s) => ({ ...s, [id]: st }));
    } catch { setState((s) => ({ ...s, [id]: "idle" })); }
  }

  const showPromo = friendCount !== null && friendCount < 3;
  const showPlayers = !promoOnly && players.length > 0; // the Play tab shows highlights instead

  if (!showPromo && !showPlayers) return null;

  return (
    <>
      {showPromo && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5 mt-6" style={{ background: "linear-gradient(150deg, rgba(0,216,192,0.14), #0c1613)", border: "1px solid rgba(0,216,192,0.28)" }}>
          <div className="flex-1 min-w-0">
            <p className="font-display text-base text-white leading-none">Better with friends</p>
            <p className="font-body text-[11px] text-text-muted mt-1 leading-snug">Add friends to challenge — never miss a battle.</p>
          </div>
          <Link href="/versus?view=friends" className="font-display text-xs tracking-wide px-4 py-2.5 rounded-xl flex-shrink-0 active:scale-[0.97] transition-transform" style={{ background: TEAL, color: "#04231f" }}>ADD FRIENDS +</Link>
        </div>
      )}

      {showPlayers && (
        <>
          <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>Top players</p>
          <div className="space-y-2">
            {players.map((p) => {
              const st = state[p.user_id] ?? "idle";
              return (
                <div key={p.user_id} className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <span className="font-display text-sm w-6 text-center flex-shrink-0" style={{ color: p.overall_rank <= 3 ? GOLD : "#586058" }}>{p.overall_rank}</span>
                  <PlayerAvatar seed={p.user_id} name={p.display_name} avatarUrl={p.avatar_url} size={34} />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm font-semibold text-white truncate">{p.display_name}</p>
                    <p className="font-body text-xs text-text-muted">{(p.overall_score ?? 0).toLocaleString()} pts</p>
                  </div>
                  {st === "friends" ? (
                    <span className="font-body text-xs flex-shrink-0" style={{ color: "#586058" }}>Friends ✓</span>
                  ) : st === "requested" ? (
                    <span className="font-body text-xs flex-shrink-0" style={{ color: TEAL }}>Requested</span>
                  ) : (
                    <button onClick={() => add(p.user_id)} className="font-display text-[11px] tracking-wide px-3.5 py-1.5 rounded-lg flex-shrink-0" style={{ background: "rgba(0,216,192,0.15)", color: TEAL, border: `1px solid ${TEAL}33` }}>+ ADD</button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
