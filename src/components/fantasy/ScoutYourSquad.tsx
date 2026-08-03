"use client";
/**
 * The Scout tab's "Your Squad" section (founder, 2 Aug): show the manager's own
 * fifteen ON THE PITCH first, then the Scout's per-player updates (injuries,
 * doubts, blanks) beneath. Same board the rest of the app uses, so this reads as
 * "here's your team, here's what the Scout knows about it".
 *
 * The squad row (id/pos/club) comes from `state`; names, faces and prices resolve
 * from the `pool` (same build as the planner). Doubts come from `context`, so the
 * amber dots on the pitch match the cards below.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, ErrorState, Loading, SectionLabel,
  EMPTY_CONTEXT, INK, MUTED,
  type ClientPoolPlayer, type FantasyContext, type FantasyState,
} from "./shared";
import { SquadBoard } from "./SquadBoard";
import { SquadRating } from "./SquadRating";
import { SquadUpdate } from "./SquadUpdate";
import { pitchName, type BoardPlayer } from "@/lib/fantasy/board";
import { faceFor } from "@/lib/fantasy/faces";

export function ScoutYourSquad() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [signedOut, setSignedOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null); setSignedOut(false);
    try {
      setState(await api<FantasyState>("state"));
    } catch (e) {
      if ((e as { status?: number }).status === 401) { setSignedOut(true); return; }
      setErr(e instanceof Error ? e.message : "Couldn't load your squad.");
    }
  }, []);

  useEffect(() => {
    void load();
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) => setPool(p.players)).catch(() => {});
    fetch("/api/fantasy/context").then((r) => (r.ok ? r.json() : null)).then((c: FantasyContext | null) => { if (c) setCtx(c); }).catch(() => {});
  }, [load]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const board = useMemo(() => {
    const sq = state?.squad;
    if (!sq) return null;
    const players: BoardPlayer[] = sq.picks.map((pk) => {
      const p = byId.get(pk.id);
      return {
        id: pk.id, name: p?.name ?? `#${pk.id}`, label: pitchName(p?.name ?? `#${pk.id}`),
        pos: p?.pos ?? pk.pos, club: p?.club, avatarUrl: p ? (p.avatarUrl ?? faceFor(p.name)) : undefined, price: p?.price,
      };
    });
    return { players, xi: sq.xi, bench: sq.bench, captain: sq.captain, vice: sq.vice };
  }, [state, byId]);

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {/* The pitch first — their team as a team sheet. SquadUpdate (below) owns the
          signed-out door, so here we only draw the board when we actually have one. */}
      {!signedOut && !err && state && (
        board ? (
          <div>
            <SectionLabel>YOUR SQUAD</SectionLabel>
            <SquadBoard mode="complete" players={board.players} xi={board.xi} bench={board.bench}
              captain={board.captain} vice={board.vice} doubts={ctx.doubts} />
          </div>
        ) : (
          <Card>
            <div className="font-body" style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 6 }}>You haven&apos;t picked a squad yet</div>
            <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
              Build your fifteen and the Scout will track injuries, doubts and blanks for them here.
            </p>
            <Btn gold onClick={() => router.push("/fantasy/build")}>Build my squad</Btn>
          </Card>
        )
      )}
      {err && !state && <ErrorState message={err} onRetry={() => void load()} />}
      {!signedOut && !err && !state && <Loading label="Loading your squad" />}

      <SquadRating />
      <SquadUpdate />
    </section>
  );
}
