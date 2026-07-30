"use client";
/**
 * Scout · Shortlist — the saved players.
 *
 * The read side of the shortlist star: the players you saved on the Players
 * browser gather here as rows, in the same visual language (avatar, name, doubt,
 * club/pos, fixture run, price/fit pill) so a player reads identically wherever
 * you meet them. Tapping a row opens the existing <PlayerProfile> in a Sheet —
 * research only, no buy/sell. Each row's gold star removes it.
 *
 * Shares its saved-ids with the star and the Briefing preview via useShortlist,
 * so removing here un-stars there and vice versa. Player detail (name, club,
 * price, fixtures, doubt) comes from the same pool + context reads the Players
 * browser makes.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api, Crest, DoubtFlag, EMPTY_CONTEXT, FixtureRun, INK, LINE, MUTED, PANEL,
  TEAL, tint, Sheet, Loading, ErrorState,
  type ClientPoolPlayer, type FantasyContext,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";
import { PlayerProfile } from "@/components/fantasy/PlayerProfile";
import { StarButton } from "@/components/fantasy/ScoutPlayersBrowser";
import { PlayerComparison, CompareButton } from "@/components/fantasy/PlayerComparison";
import { useShortlist } from "@/components/fantasy/useShortlist";

export function ShortlistView() {
  const shortlist = useShortlist();
  const [pool, setPool] = useState<ClientPoolPlayer[] | null>(null);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [detailFor, setDetailFor] = useState<number | null>(null);
  const [compareOne, setCompareOne] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    let live = true;
    setErr(null);
    api<{ players: ClientPoolPlayer[] }>("pool")
      .then((p) => { if (live) setPool(p.players); })
      .catch((e) => { if (live) setErr((e as Error).message || "Couldn't load players."); });
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (live && c) setCtx(c); })
      .catch(() => {});
    return () => { live = false; };
  }, [reload]);

  const byId = useMemo(() => {
    const m = new Map<number, ClientPoolPlayer>();
    for (const p of pool ?? []) m.set(p.id, p);
    return m;
  }, [pool]);

  // Preserve the store's newest-first order; drop any saved id no longer in the
  // pool (a player who left the league) rather than render a broken row.
  const rows = useMemo(
    () => shortlist.ids.map((id) => byId.get(id)).filter((p): p is ClientPoolPlayer => !!p),
    [shortlist.ids, byId],
  );

  if (err && !pool) return <ErrorState message={err} onRetry={() => setReload((n) => n + 1)} />;
  // Hold the skeleton until both the pool and the initial shortlist load land, so
  // an empty flash never shows before saved players arrive.
  if (!pool || !shortlist.ready) return <Loading label="Loading your shortlist" />;

  if (!rows.length) {
    return (
      <div style={{
        background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12,
        padding: "24px 16px", textAlign: "center",
      }}>
        <div className="font-display tracking-widest" style={{ color: INK, fontSize: 15 }}>
          BUILD YOUR SHORTLIST
        </div>
        <p className="font-body" style={{ color: MUTED, fontSize: 13, lineHeight: 1.5, margin: "8px 0 16px" }}>
          Save players you may want to investigate or compare later.
        </p>
        <Link href="/fantasy/scout/players" style={{ textDecoration: "none" }}>
          <span style={{
            display: "inline-block", background: tint(TEAL, "16"), color: TEAL,
            border: `1px solid ${tint(TEAL, "66")}`, borderRadius: 999,
            padding: "9px 16px", fontSize: 13, fontWeight: 600,
          }}>Browse players</span>
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11.5, color: MUTED }}>
        {rows.length} saved {rows.length === 1 ? "player" : "players"}
      </div>
      {rows.map((p) => {
        const doubtful = !!ctx.doubts[p.id];
        return (
          <div key={p.id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "13px 14px", borderRadius: 14,
              background: PANEL, color: INK, border: `1px solid ${LINE}`,
            }}>
            <button onClick={() => setDetailFor(p.id)}
              aria-label={`${p.name} — view profile`}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0,
                background: "transparent", color: "inherit", border: "none", padding: 0,
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={56} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</span>
                    <DoubtFlag reason={ctx.doubts[p.id]} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                    <Crest club={p.club} size={14} />
                    <span style={{ fontSize: 12.5, color: MUTED }}>{p.club} · {p.pos}</span>
                    <FixtureRun cells={ctx.fixtures[p.clubId]} max={2} />
                  </span>
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>£{p.price.toFixed(1)}m</span>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 999,
                  color: doubtful ? "#E08A6B" : TEAL,
                  border: `1px solid ${doubtful ? "#B85C38" : tint(TEAL, "55")}`,
                  background: doubtful ? "rgba(184,92,56,0.10)" : tint(TEAL, "12"),
                }}>{doubtful ? "DOUBT" : "FIT"}</span>
              </span>
            </button>
            {/* Saved → gold star; tapping removes (star-off). */}
            <StarButton saved onToggle={() => void shortlist.remove(p.id)} />
            <CompareButton label={`Compare ${p.name}`}
              onClick={() => { setCompareOne(p.id); setComparing(true); }} />
          </div>
        );
      })}

      {detailFor !== null && (
        <Sheet onClose={() => setDetailFor(null)} labelledBy="fantasy-player-profile-name">
          <PlayerProfile playerId={detailFor} onClose={() => setDetailFor(null)} />
        </Sheet>
      )}

      {comparing && (
        <PlayerComparison initialOneId={compareOne} onClose={() => setComparing(false)} />
      )}

      <Link href="/fantasy/scout/players"
        style={{
          marginTop: 8, textAlign: "center", textDecoration: "none",
          background: PANEL, color: INK, border: `1px solid ${LINE}`,
          borderRadius: 12, padding: "12px 16px", fontSize: 14, fontWeight: 600,
        }}>Browse more players</Link>
    </div>
  );
}
