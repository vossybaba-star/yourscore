"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// "People ready to play" — compact rows (carousel mockup): avatar, name,
// record, PLAY. Suggested opponents (NOT friends): open-Lobby hosts you can
// join right now, plus active ranked players. Data from /api/versus/ready;
// self filtered out client-side (the route is a shared cached list).

const TEAL = "#00d8c0";
const LIME = "#aeea00";

interface ReadyPlayer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  game: "quiz" | "38-0";
  status: "In lobby" | "Online";
  record: string | null;
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
      setPlayers(((res.players ?? []) as ReadyPlayer[]).filter((p) => p.userId !== uid).slice(0, 5));
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
      <div className="space-y-2">
        {players.map((p) => {
          const c = p.game === "38-0" ? LIME : TEAL;
          return (
            <div key={p.userId} className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
              <PlayerAvatar seed={p.userId} name={p.name} avatarUrl={p.avatarUrl} size={36} />
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold text-white truncate">{p.name}</p>
                <p className="font-body text-[11px] truncate">
                  <span style={{ color: c }}>{p.game === "38-0" ? "38-0" : "Quiz Battle"}</span>
                  <span style={{ color: "#586058" }}> · {p.status}</span>
                </p>
              </div>
              {p.record && <span className="font-display text-sm flex-shrink-0" style={{ color: "#8a948f" }}>{p.record}</span>}
              <button onClick={() => play(p)} className="font-display text-[11px] tracking-wide px-4 py-2 rounded-lg flex-shrink-0 active:scale-[0.97] transition-transform" style={{ background: c, color: p.game === "38-0" ? "#13200a" : "#04231f" }}>
                {p.joinCode ? "JOIN" : "PLAY"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
