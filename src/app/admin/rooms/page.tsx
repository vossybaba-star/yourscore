"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Room {
  id: string;
  name: string;
  code: string;
  status: "lobby" | "live" | "completed";
  match_id: string | null;
  created_at: string;
  _playerCount?: number;
}

const STATUS_COLOR = { lobby: "#ffb800", live: "#aeea00", completed: "#586058" };

export default function AdminRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase
        .from("rooms")
        .select("id, name, code, status, match_id, created_at")
        .order("created_at", { ascending: false })
        .limit(100)
        .then(({ data }) => {
          if (data) setRooms(data as Room[]);
        });
    });
  }, []);

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-4xl text-white tracking-wide">LOBBIES</h1>
        <p className="font-body text-sm text-text-muted mt-1">{rooms.length} lobbies total</p>
      </div>

      <div className="space-y-2">
        {rooms.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-4 px-5 py-4 rounded-2xl"
            style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex-1">
              <p className="font-body text-sm font-semibold text-white">{r.name}</p>
              <p className="font-body text-xs text-text-muted mt-0.5">
                Code: <span className="font-display text-white">{r.code}</span>
                {r._playerCount != null && <> · {r._playerCount} players</>}
              </p>
            </div>
            <span
              className="px-2.5 py-1 rounded-full font-body text-xs font-semibold uppercase tracking-wider"
              style={{ background: `${STATUS_COLOR[r.status]}18`, color: STATUS_COLOR[r.status], border: `1px solid ${STATUS_COLOR[r.status]}30` }}
            >
              {r.status}
            </span>
            <Link
              href={`/admin/fire/${r.id}`}
              className="px-4 py-2 rounded-xl font-body text-xs font-semibold hover:opacity-80 transition-opacity flex items-center gap-1.5"
              style={{ background: "rgba(255,71,87,0.1)", color: "#ff4757", border: "1px solid rgba(255,71,87,0.2)" }}
            >
              🔥 Fire panel
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}
