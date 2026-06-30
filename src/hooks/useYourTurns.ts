"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// The async-challenge inbox for the signed-in user, split into the three sections
// the Your-Turns home renders. Scores are normalised to "my" perspective so the
// UI can show win/loss without re-deriving sides.

export interface InboxChallenge {
  id: string;
  kind: "1v1" | "group";
  packName: string;
  status: string; // awaiting_opponent | complete | expired | open
  iAmChallenger: boolean;
  myScore: number | null; // null until I've played
  theirScore: number | null; // null until they've played (1v1 only)
  otherName: string; // the other player, or "<creator>'s board" for a group
  invitedUserId: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  groupPlayers?: number; // group only — total participants
  groupPlayed?: number; // group only — how many have a score
}

export interface YourTurns {
  yourTurn: InboxChallenge[]; // challenges aimed at me, awaiting my play
  waiting: InboxChallenge[]; // I created, awaiting the opponent
  results: InboxChallenge[]; // completed, either side
  loading: boolean;
  refresh: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function useYourTurns(): YourTurns {
  const [yourTurn, setYourTurn] = useState<InboxChallenge[]>([]);
  const [waiting, setWaiting] = useState<InboxChallenge[]>([]);
  const [results, setResults] = useState<InboxChallenge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setLoading(false); return; }

    const cols = "id, quiz_pack_name, status, challenger_id, challenger_name, challenger_score, opponent_id, opponent_score, invited_user_id, created_at, expires_at";
    const [incoming, outgoing, done] = await Promise.all([
      sb.from("h2h_challenges").select(cols).eq("invited_user_id", uid).eq("status", "awaiting_opponent").order("created_at", { ascending: false }),
      sb.from("h2h_challenges").select(cols).eq("challenger_id", uid).eq("status", "awaiting_opponent").order("created_at", { ascending: false }),
      sb.from("h2h_challenges").select(cols).eq("status", "complete").or(`challenger_id.eq.${uid},opponent_id.eq.${uid}`).order("created_at", { ascending: false }).limit(15),
    ]);

    const rows: Row[] = [...(incoming.data ?? []), ...(outgoing.data ?? []), ...(done.data ?? [])];

    // Resolve names we don't already have on the row (invited friend, opponent).
    const needIds = new Set<string>();
    for (const r of rows) {
      if (r.challenger_id === uid && r.invited_user_id) needIds.add(r.invited_user_id);
      if (r.challenger_id === uid && r.opponent_id) needIds.add(r.opponent_id);
    }
    const names: Record<string, string> = {};
    if (needIds.size) {
      const { data: profs } = await supabase
        .from("profiles").select("id, display_name").in("id", Array.from(needIds));
      (profs ?? []).forEach((p: { id: string; display_name: string | null }) => { names[p.id] = p.display_name ?? "Player"; });
    }

    const shape = (r: Row): InboxChallenge => {
      const iAmChallenger = r.challenger_id === uid;
      const otherName = iAmChallenger
        ? (r.opponent_id ? (names[r.opponent_id] ?? "Player") : r.invited_user_id ? (names[r.invited_user_id] ?? "Player") : "Open challenge")
        : (r.challenger_name ?? "Player");
      return {
        id: r.id,
        kind: "1v1",
        packName: r.quiz_pack_name,
        status: r.status,
        iAmChallenger,
        myScore: iAmChallenger ? r.challenger_score : r.opponent_score,
        theirScore: iAmChallenger ? r.opponent_score : r.challenger_score,
        otherName,
        invitedUserId: r.invited_user_id ?? null,
        createdAt: r.created_at ?? null,
        expiresAt: r.expires_at ?? null,
      };
    };

    // ── Group challenges ──────────────────────────────────────────────────────
    // My participant rows, joined to the board. Classify each (exclusive):
    //   open + I haven't scored → your turn · open + I've scored → waiting ·
    //   complete/expired → results.
    const { data: myParts } = await sb
      .from("group_challenge_participants")
      .select("score, challenge:group_challenges(id, quiz_pack_name, creator_id, creator_name, status, expires_at, created_at)")
      .eq("user_id", uid);

    const gParts = (myParts ?? []).filter((p: Row) => p.challenge);
    // Player + played counts per board (one query over all my boards).
    const gIds = gParts.map((p: Row) => p.challenge.id);
    const counts: Record<string, { players: number; played: number }> = {};
    if (gIds.length) {
      const { data: allParts } = await sb
        .from("group_challenge_participants").select("challenge_id, score").in("challenge_id", gIds);
      (allParts ?? []).forEach((p: Row) => {
        const c = counts[p.challenge_id] ?? { players: 0, played: 0 };
        c.players += 1; if (p.score !== null) c.played += 1;
        counts[p.challenge_id] = c;
      });
    }

    const shapeGroup = (p: Row): InboxChallenge => {
      const c = p.challenge;
      return {
        id: c.id,
        kind: "group",
        packName: c.quiz_pack_name,
        status: c.status,
        iAmChallenger: c.creator_id === uid,
        myScore: p.score,
        theirScore: null,
        otherName: `${c.creator_name ?? "Someone"}'s board`,
        invitedUserId: null,
        createdAt: c.created_at ?? null,
        expiresAt: c.expires_at ?? null,
        groupPlayers: counts[c.id]?.players ?? 1,
        groupPlayed: counts[c.id]?.played ?? 0,
      };
    };

    const gTurn: InboxChallenge[] = [], gWait: InboxChallenge[] = [], gDone: InboxChallenge[] = [];
    for (const p of gParts) {
      const open = p.challenge.status === "open" && new Date(p.challenge.expires_at) > new Date();
      if (!open) gDone.push(shapeGroup(p));
      else if (p.score === null) gTurn.push(shapeGroup(p));
      else gWait.push(shapeGroup(p));
    }

    const byNewest = (a: InboxChallenge, b: InboxChallenge) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    setYourTurn([...(incoming.data ?? []).map(shape), ...gTurn].sort(byNewest));
    setWaiting([...(outgoing.data ?? []).map(shape), ...gWait].sort(byNewest));
    setResults([...(done.data ?? []).map(shape), ...gDone].sort(byNewest).slice(0, 15));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { yourTurn, waiting, results, loading, refresh: load };
}
