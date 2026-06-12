"use client";

/**
 * /38-0/match/pens — the interactive shootout for a drawn solo match.
 *
 * Local mode (guest quick match): kicks resolve on-device with the stored seed —
 * you shoot round r, then dive against the CPU's round r, alternating. Inputs are
 * persisted as they're taken, so an abandoned shootout resumes (and ultimately
 * auto-completes seeded) instead of erasing a result.
 *
 * Server mode (ranked / challenge): every action POSTs to /api/draft/match/pens,
 * which resolves the kick with a peppered seed and returns it — the client never
 * computes an outcome, so it can't pick-and-choose.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadLastMatch, saveLastMatch, loadTeam, saveTeam, recordWin, recordLoss,
  type LocalMatch,
} from "@/lib/draft/local";
import { resolveRound, shootoutStatus, type PenColumn, type PenKick, type PenZone } from "@/lib/draft/pens";
import { PenaltyShootout, type PensView } from "@/components/draft/PenaltyShootout";

const BG = "#0a0a0f";

/** Replay a local shootout from its stored inputs: my kicks vs the AI keeper, the
 *  CPU's kicks vs my dives, alternating, stopping where the next input is missing. */
function replayLocal(seed: string, shots: PenZone[], dives: PenColumn[]): { a: PenKick[]; b: PenKick[] } {
  const a: PenKick[] = [];
  const b: PenKick[] = [];
  for (;;) {
    const st = shootoutStatus(a, b, "alternating");
    if (st.decided || !st.next) break;
    if (st.next === "a") {
      const shot = shots[a.length];
      if (shot === undefined) break;
      a.push(resolveRound(seed, "a", a.length + 1, { shot }));
    } else {
      const dive = dives[b.length];
      if (dive === undefined) break;
      b.push(resolveRound(seed, "b", b.length + 1, { dive }));
    }
  }
  return { a, b };
}

type ServerState = {
  myKicks: PenKick[];
  oppKicks: PenKick[];
  role: "shoot" | "dive" | "done";
  suddenDeath: boolean;
  final: { outcome: "you" | "opp"; pens: { you: number; opp: number } } | null;
};

export default function PensPage() {
  const router = useRouter();
  const [m, setM] = useState<LocalMatch | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const posting = useRef(false);
  const finalized = useRef(false);

  useEffect(() => {
    const lm = loadLastMatch();
    if (!lm) { router.replace("/38-0"); return; }
    if (!lm.pensPending) { router.replace("/38-0/match/result"); return; }
    setM(lm);
    if (lm.pensPending.mode === "server") {
      fetch(`/api/draft/match/pens?matchId=${encodeURIComponent(lm.id)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((s: ServerState) => setServer(s))
        .catch(() => setError("Couldn't load the shootout — check your connection."));
    }
  }, [router]);

  // ── Derive the view ──────────────────────────────────────────────────────────
  const settled = !!m && !m.pensPending && !!m.pensKicks; // finalized this session
  const local = m?.pensPending?.mode === "local";
  const seed = m?.pensPending?.seed ?? "";
  const kicks = settled
    ? { a: m.pensKicks!.you, b: m.pensKicks!.opp }
    : local
    ? replayLocal(seed, m!.pensPending!.shots, m!.pensPending!.dives)
    : { a: server?.myKicks ?? [], b: server?.oppKicks ?? [] };
  const st = shootoutStatus(kicks.a, kicks.b, "alternating");
  const decided = settled || (local ? st.decided : server?.role === "done");
  const winner = settled
    ? (m.outcome === "you" ? "a" : "b")
    : local ? st.winner : server?.final ? (server.final.outcome === "you" ? "a" : "b") : null;

  const view: PensView = {
    myKicks: kicks.a,
    oppKicks: kicks.b,
    suddenDeath: local ? st.suddenDeath : server?.suddenDeath ?? false,
    role: decided ? "done" : local ? (st.next === "a" ? "shoot" : "dive") : server ? server.role : "waiting",
    result: decided && winner ? (winner === "a" ? "win" : "loss") : null,
  };

  // ── Finalize once decided (local mode persists outcome + streak) ─────────────
  useEffect(() => {
    if (!m || !decided || finalized.current) return;
    if (local) {
      if (!st.winner) return;
      finalized.current = true;
      const settled: LocalMatch = {
        ...m,
        outcome: st.winner === "a" ? "you" : "opp",
        pens: { you: st.aGoals, opp: st.bGoals },
        pensKicks: { you: kicks.a, opp: kicks.b },
        pensPending: undefined,
      };
      saveLastMatch(settled);
      const team = loadTeam();
      if (team) saveTeam(settled.outcome === "you" ? recordWin(team) : recordLoss(team));
      setM(settled);
    } else if (server?.final) {
      finalized.current = true;
      const settled: LocalMatch = {
        ...m,
        outcome: server.final.outcome,
        pens: server.final.pens,
        pensKicks: { you: server.myKicks, opp: server.oppKicks },
        pensPending: undefined,
      };
      saveLastMatch(settled);
      const team = loadTeam();
      if (team) saveTeam(settled.outcome === "you" ? recordWin(team) : recordLoss(team));
      setM(settled);
    }
  }, [m, decided, local, st, kicks.a, kicks.b, server]);

  // ── Inputs ───────────────────────────────────────────────────────────────────
  const act = useCallback(
    async (action: "shot" | "dive", zone: number) => {
      if (!m) return;
      if (local) {
        const pending = m.pensPending!;
        const next: LocalMatch = {
          ...m,
          pensPending: {
            ...pending,
            shots: action === "shot" ? [...pending.shots, zone as PenZone] : pending.shots,
            dives: action === "dive" ? [...pending.dives, zone as PenColumn] : pending.dives,
          },
        };
        saveLastMatch(next);
        setM(next);
        return;
      }
      if (posting.current) return;
      posting.current = true;
      try {
        const res = await fetch("/api/draft/match/pens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: m.id, action, zone }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setServer((await res.json()) as ServerState);
      } catch {
        setError("Kick didn't go through — tap to retry.");
      } finally {
        posting.current = false;
      }
    },
    [m, local]
  );

  if (!m) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: BG, color: "#8888aa" }}>Loading…</div>;
  }

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: BG, color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-4 pt-10">
        <p className="text-center font-display tracking-wide mb-1" style={{ fontSize: 13, color: "#ffb800", letterSpacing: 1 }}>
          LEVEL AFTER 90 — PENALTIES
        </p>
        <p className="text-center font-display tabular-nums mb-4" style={{ fontSize: 22 }}>
          {m.goals.you} – {m.goals.opp}
        </p>

        <PenaltyShootout
          view={view}
          myName="You"
          oppName={m.opp.name}
          onShoot={(z) => act("shot", z)}
          onDive={(c) => act("dive", c)}
        />

        {error && (
          <button onClick={() => { setError(null); }} className="mt-3 w-full text-center font-body" style={{ fontSize: 12, color: "#ff5c7a" }}>
            {error}
          </button>
        )}

        {decided && (
          <button
            onClick={() => router.replace("/38-0/match/result")}
            className="mt-4 w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#00ff87", color: "#062013", fontSize: 18 }}
          >
            SEE RESULT →
          </button>
        )}
      </div>
    </div>
  );
}
