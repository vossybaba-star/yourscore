"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// "People ready to play" — suggested opponents (NOT friends): open-Lobby hosts
// you can join right now, plus active ranked players you can challenge. Data
// from /api/versus/ready; self is filtered out client-side (the route is a
// shared cached list).

const TEAL = "#00d8c0";
const LIME = "#aeea00";

interface ReadyPlayer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  game: "quiz" | "38-0";
  status: "In lobby" | "Online";
  joinCode: string | null;
}

export function ReadyToPlayRail() {
  const router = useRouter();
  const [players, setPlayers] = useState<ReadyPlayer[]>([]);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const [{ data: auth }, res] = await Promise.all([
        sb.auth.getUser(),
        fetch("/api/versus/ready").then((r) => r.json()).catch(() => ({ players: [] })),
      ]);
      const uid = auth.user?.id;
      setPlayers(((res.players ?? []) as ReadyPlayer[]).filter((p) => p.userId !== uid).slice(0, 8));
    })();
  }, []);

  if (players.length === 0) return null;

  const play = (p: ReadyPlayer) => {
    if (p.joinCode) router.push(`/play?join=${encodeURIComponent(p.joinCode)}`); // join their open Lobby
    else if (p.game === "quiz") router.push(`/versus/quiz?to=${p.userId}`);
    else router.push("/versus/38-0");
  };

  return (
    <div>
      <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>People ready to play</p>
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
        {players.map((p) => {
          const c = p.game === "38-0" ? LIME : TEAL;
          return (
            <div key={p.userId} className="rounded-2xl p-3.5 flex-shrink-0 flex flex-col" style={{ width: 150, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-2.5">
                <PlayerAvatar seed={p.userId} name={p.name} avatarUrl={p.avatarUrl} size={38} />
                <span className="flex items-center gap-1 font-body text-[10px]" style={{ color: p.status === "In lobby" ? LIME : "#8a948f" }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: p.status === "In lobby" ? LIME : "#5a655e" }} />
                  {p.status}
                </span>
              </div>
              <p className="font-body text-sm font-semibold text-white truncate">{p.name}</p>
              <p className="font-body text-[11px] mb-3" style={{ color: c }}>{p.game === "38-0" ? "38-0" : "Quiz Battle"}</p>
              <button onClick={() => play(p)} className="mt-auto w-full font-display text-xs tracking-wide py-2 rounded-lg active:scale-[0.98] transition-transform" style={{ background: `${c}1f`, color: c, border: `1px solid ${c}33` }}>
                {p.joinCode ? "JOIN →" : "PLAY"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
