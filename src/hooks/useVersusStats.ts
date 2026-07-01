"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Aggregates the signed-in user's head-to-head history across BOTH versus games
// — Quiz Battle (h2h_challenges) and live 38-0 (draft_matches) — into a single
// record + a per-opponent rivalry table. Everything is normalised to "my"
// perspective so the hub can render win/loss/rivalry without re-deriving sides.

export type Game = "quiz" | "38-0";
export type Outcome = "win" | "loss" | "draw";

interface Match {
  game: Game;
  opponentId: string | null;
  outcome: Outcome;
  at: string; // ISO timestamp
}

export interface Rivalry {
  opponentId: string;
  name: string;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  lead: number; // wins - losses (positive = you lead)
  lastOutcome: Outcome;
  lastAt: string;
}

export interface VersusRecord {
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // % of decisive games won (draws excluded)
  streak: number; // length of current win/loss run
  streakType: Outcome | null;
}

export interface VersusStats {
  record: VersusRecord;
  rivalries: Rivalry[];
  loading: boolean;
}

const EMPTY_RECORD: VersusRecord = { wins: 0, losses: 0, draws: 0, winRate: 0, streak: 0, streakType: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function useVersusStats(): VersusStats {
  const [record, setRecord] = useState<VersusRecord>(EMPTY_RECORD);
  const [rivalries, setRivalries] = useState<Rivalry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setLoading(false); return; }

      const [h2h, draft] = await Promise.all([
        sb.from("h2h_challenges")
          .select("challenger_id, challenger_score, opponent_id, opponent_score, created_at")
          .eq("status", "complete").or(`challenger_id.eq.${uid},opponent_id.eq.${uid}`)
          .order("created_at", { ascending: false }).limit(200),
        sb.from("draft_matches")
          .select("challenger_id, opponent_id, winner_id, played_at")
          .or(`challenger_id.eq.${uid},opponent_id.eq.${uid}`)
          .order("played_at", { ascending: false }).limit(200),
      ]);

      const matches: Match[] = [];

      for (const r of (h2h.data ?? []) as Row[]) {
        const iAmChallenger = r.challenger_id === uid;
        const opponentId = iAmChallenger ? r.opponent_id : r.challenger_id;
        const my = iAmChallenger ? r.challenger_score : r.opponent_score;
        const their = iAmChallenger ? r.opponent_score : r.challenger_score;
        if (my == null || their == null) continue;
        matches.push({
          game: "quiz",
          opponentId: opponentId ?? null,
          outcome: my === their ? "draw" : my > their ? "win" : "loss",
          at: r.created_at ?? "",
        });
      }

      for (const r of (draft.data ?? []) as Row[]) {
        const iAmChallenger = r.challenger_id === uid;
        const opponentId = iAmChallenger ? r.opponent_id : r.challenger_id;
        matches.push({
          game: "38-0",
          opponentId: opponentId ?? null,
          outcome: r.winner_id == null ? "draw" : r.winner_id === uid ? "win" : "loss",
          at: r.played_at ?? "",
        });
      }

      matches.sort((a, b) => b.at.localeCompare(a.at));

      // ── Record ────────────────────────────────────────────────────────────
      let wins = 0, losses = 0, draws = 0;
      for (const m of matches) {
        if (m.outcome === "win") wins++;
        else if (m.outcome === "loss") losses++;
        else draws++;
      }
      const decisive = wins + losses;
      const winRate = decisive ? Math.round((wins / decisive) * 100) : 0;
      // Current run: leading matches sharing the newest outcome (draws break it).
      let streak = 0;
      let streakType: Outcome | null = null;
      if (matches.length && matches[0].outcome !== "draw") {
        streakType = matches[0].outcome;
        for (const m of matches) { if (m.outcome === streakType) streak++; else break; }
      }
      setRecord({ wins, losses, draws, winRate, streak, streakType });

      // ── Rivalries (per opponent) ──────────────────────────────────────────
      const byOpp = new Map<string, { wins: number; losses: number; draws: number; lastOutcome: Outcome; lastAt: string }>();
      for (const m of matches) {
        if (!m.opponentId) continue;
        const cur = byOpp.get(m.opponentId) ?? { wins: 0, losses: 0, draws: 0, lastOutcome: m.outcome, lastAt: m.at };
        if (m.outcome === "win") cur.wins++;
        else if (m.outcome === "loss") cur.losses++;
        else cur.draws++;
        if (m.at > cur.lastAt || cur.wins + cur.losses + cur.draws === 1) { /* keep newest */ }
        byOpp.set(m.opponentId, cur);
      }
      // matches are newest-first, so the first time we see an opponent is their
      // latest result — capture it before tallies overwrite lastOutcome.
      const seen = new Set<string>();
      for (const m of matches) {
        if (!m.opponentId || seen.has(m.opponentId)) continue;
        seen.add(m.opponentId);
        const cur = byOpp.get(m.opponentId);
        if (cur) { cur.lastOutcome = m.outcome; cur.lastAt = m.at; }
      }

      const oppIds = Array.from(byOpp.keys());
      const profiles: Record<string, { name: string; avatarUrl: string | null }> = {};
      if (oppIds.length) {
        const { data: profs } = await supabase
          .from("profiles").select("id, display_name, avatar_url").in("id", oppIds);
        (profs ?? []).forEach((p: { id: string; display_name: string | null; avatar_url: string | null }) => {
          profiles[p.id] = { name: p.display_name ?? "Player", avatarUrl: p.avatar_url ?? null };
        });
      }

      const rivals: Rivalry[] = oppIds.map((id) => {
        const t = byOpp.get(id)!;
        const total = t.wins + t.losses + t.draws;
        return {
          opponentId: id,
          name: profiles[id]?.name ?? "Player",
          avatarUrl: profiles[id]?.avatarUrl ?? null,
          wins: t.wins, losses: t.losses, draws: t.draws,
          total, lead: t.wins - t.losses,
          lastOutcome: t.lastOutcome, lastAt: t.lastAt,
        };
      }).sort((a, b) => b.total - a.total || b.lastAt.localeCompare(a.lastAt));

      setRivalries(rivals);
      setLoading(false);
    })();
  }, []);

  return { record, rivalries, loading };
}
