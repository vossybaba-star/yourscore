"use client";

/**
 * /38-0/teams — your saved-team library. Save many XIs, then load one back to play
 * (USE writes it to local play state and opens the team screen). Separate from the
 * single active team that matchmaking uses. Fails soft before the migration.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";
import { DraftHeader } from "@/components/draft/DraftHeader";
import { useUser } from "@/hooks/useUser";
import { hydrateSavedTeam, saveTeam } from "@/lib/draft/local";
import { asLeague, type Formation, type League, type PlacedPlayer } from "@/lib/draft/types";

type SavedTeam = {
  id: string;
  name: string;
  formation: Formation;
  squad: PlacedPlayer[];
  strength_rating: number;
  competition?: string | null;
  updated_at: string | null;
};

export default function MyTeams() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [fetched, setFetched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [competition, setCompetition] = useState<League>("PL");
  useEffect(() => { setCompetition(asLeague(new URLSearchParams(window.location.search).get("competition"))); }, []);

  const load = useCallback(() => {
    fetch("/api/draft/teams")
      .then((r) => r.json())
      .then((d) => setTeams(d.teams ?? []))
      .catch(() => {})
      .finally(() => setFetched(true));
  }, []);

  useEffect(() => { if (user) load(); else if (!loading) setFetched(true); }, [user, loading, load]);

  function use(t: SavedTeam) {
    // Load this saved XI into local play state, then open the team screen.
    saveTeam(hydrateSavedTeam(t.formation, t.squad, asLeague(t.competition)));
    router.push("/38-0/team");
  }

  async function remove(id: string) {
    setBusy(id); setErr(null);
    try {
      const r = await fetch(`/api/draft/teams?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Could not delete"); setBusy(null); return; }
      setTeams((prev) => prev.filter((t) => t.id !== id));
    } catch { setErr("Network error"); }
    setBusy(null);
  }

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <DraftHeader competition={competition} />
        <h1 className="font-display tracking-wide leading-none" style={{ fontSize: 44, color: "#fff" }}>
          MY <span style={{ color: "#aeea00" }}>TEAMS</span>
        </h1>
        <p className="font-body mt-1 mb-5" style={{ fontSize: 13, color: "#8a948f" }}>
          Save as many XIs as you like — load one back any time to play it.
        </p>

        {err && <div className="rounded-xl px-4 py-2 mb-3 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{err}</div>}

        {!user && !loading ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>SIGN IN TO SAVE TEAMS</div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#8a948f" }}>Build an XI and save it to your library to come back to it.</p>
            <Button href="/auth/sign-in" variant="primary" tone="lime" size="md" className="inline-flex mt-4">SIGN IN →</Button>
          </div>
        ) : !fetched ? (
          <div className="font-body text-center py-10" style={{ color: "#8a948f", fontSize: 13 }}>Loading…</div>
        ) : teams.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#fff" }}>NO SAVED TEAMS YET</div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#8a948f" }}>Build an XI, then tap Save to add it here.</p>
            <Button href="/38-0" variant="primary" tone="lime" size="md" className="inline-flex mt-4">BUILD AN XI →</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {teams.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="grid place-items-center rounded-xl flex-shrink-0" style={{ width: 52, height: 52, background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.2)" }}>
                  <span className="font-display" style={{ fontSize: 22, color: "#aeea00", lineHeight: 1 }}>{t.strength_rating}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-body truncate" style={{ fontSize: 15, color: "#fff" }}>{t.name}</div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{t.formation} · {t.squad.length}/11 · Strength {t.strength_rating}</div>
                </div>
                <Button variant="primary" tone="lime" size="sm" onClick={() => use(t)}>USE</Button>
                <button onClick={() => remove(t.id)} disabled={busy === t.id} aria-label="Delete team" className="rounded-xl px-3 py-2.5 active:scale-95 transition-transform disabled:opacity-50" style={{ background: "rgba(255,71,87,0.1)", color: "#ff4757", fontSize: 15, border: "1px solid rgba(255,71,87,0.25)" }}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
