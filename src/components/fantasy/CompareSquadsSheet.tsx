"use client";
/**
 * Squad vs squad, facts only (Phase 1B) — captain, vice, points, who's shared
 * and who's a differential. No recommendations: the founder's call was that
 * this is banter fuel ("you started HIM?"), not an advisor tool.
 *
 * Sourced from GET /api/fantasy/leagues/[code]/squad?user=<id>, called once
 * for the viewer and once for the target. That route (not the round/quiz
 * "run" route) is deliberate — a manager's picked SQUAD is public the moment
 * it's submitted (profileTeams.ts's own note, founder 30 Jul), so there is no
 * deadline gate to honour here; only "do you two share a league" applies.
 * Either side renders its own honest empty state (no squad yet / not
 * available) rather than a broken pane — this never assumes both sides loaded.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GOLD, INK, LINE, MUTED, PANEL_2, POS_COLOR, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import type { BoardPlayer } from "@/lib/fantasy/board";
import { trackCompareSquadsOpened, trackMemberActionSelected } from "@/lib/analytics/trackSocial";

interface Team {
  gw: number; label: string; current: boolean;
  xi: number[]; bench: number[]; captain: number | null; vice: number | null; points: number | null;
}
interface SquadResult { team: Team | null; players: BoardPlayer[] }
type Side = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: SquadResult };

async function fetchSquad(code: string, userId: string): Promise<Side> {
  try {
    const res = await fetch(`/api/fantasy/leagues/${code}/squad?user=${userId}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { status: "error", message: j.error ?? "Not available." };
    return { status: "ok", data: j as SquadResult };
  } catch (e) { return { status: "error", message: (e as Error).message }; }
}

/** A compact "POS Name" row — deliberately not a full SquadBoard pitch (too
 *  heavy for two columns in one sheet), just enough to read the XI at a
 *  glance. `mark` flags a captain/vice/shared badge. */
function CompactRow({ p, mark }: { p: BoardPlayer; mark?: "C" | "V" }) {
  const c = POS_COLOR[p.pos] ?? MUTED;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 0" }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, color: c, width: 26, flexShrink: 0 }}>{p.pos}</span>
      <span style={{ fontSize: 12.5, color: INK, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      {mark && (
        <span aria-label={mark === "C" ? "Captain" : "Vice captain"} style={{
          fontSize: 9.5, fontWeight: 800, width: 15, height: 15, borderRadius: 999, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: mark === "C" ? GOLD : tint(TEAL, "33"), color: mark === "C" ? "#3a2600" : TEAL,
        }}>{mark}</span>
      )}
    </div>
  );
}

function SideEmpty({ label, note }: { label: string; note: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.45 }}>{note}</p>
    </div>
  );
}

function SideColumn({ label, avatarUrl, seed, side }: {
  label: string; avatarUrl: string | null; seed: string; side: Side;
}) {
  if (side.status === "loading") return <SideEmpty label={label} note="Loading…" />;
  if (side.status === "error") return <SideEmpty label={label} note={side.message} />;
  const { team, players } = side.data;
  if (!team || team.xi.length === 0) return <SideEmpty label={label} note="No squad this gameweek." />;
  const byId = new Map(players.map((p) => [p.id, p]));
  const xi = team.xi.map((id) => byId.get(id)).filter((p): p is BoardPlayer => !!p);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <PlayerAvatar seed={seed} name={label} avatarUrl={avatarUrl} size={26} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
          <div style={{ fontSize: 11, color: team.points != null ? GOLD : MUTED, fontWeight: 700 }}>
            {team.points != null ? `${team.points} pts` : "Not scored yet"}
          </div>
        </div>
      </div>
      <div>
        {xi.map((p) => (
          <CompactRow key={p.id} p={p} mark={team.captain === p.id ? "C" : team.vice === p.id ? "V" : undefined} />
        ))}
      </div>
    </div>
  );
}

export function CompareSquadsSheet({ leagueCode, viewerId, target, onClose }: {
  leagueCode: string;
  viewerId: string;
  target: { userId: string; name: string; avatarUrl: string | null; username: string | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const [me, setMe] = useState<Side>({ status: "loading" });
  const [them, setThem] = useState<Side>({ status: "loading" });

  useEffect(() => {
    trackCompareSquadsOpened();
    let live = true;
    fetchSquad(leagueCode, viewerId).then((s) => { if (live) setMe(s); });
    fetchSquad(leagueCode, target.userId).then((s) => { if (live) setThem(s); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueCode, viewerId, target.userId]);

  // Shared vs differential — computed off the full squad (XI + bench), not
  // just the XI, so a player benched on one side still counts as "shared".
  const idsFor = (s: Side): Set<number> => {
    if (s.status !== "ok" || !s.data.team) return new Set();
    return new Set([...s.data.team.xi, ...s.data.team.bench]);
  };
  const meIds = idsFor(me);
  const themIds = idsFor(them);
  const shared = Array.from(meIds).filter((id) => themIds.has(id));
  const onlyMe = Array.from(meIds).filter((id) => !themIds.has(id));
  const onlyThem = Array.from(themIds).filter((id) => !meIds.has(id));
  const namesFor = (s: Side, ids: number[]): string[] => {
    if (s.status !== "ok") return [];
    const byId = new Map(s.data.players.map((p) => [p.id, p.name]));
    return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
  };
  const hasBothSquads = me.status === "ok" && !!me.data.team && them.status === "ok" && !!them.data.team;

  const mentionInChat = () => {
    if (!target.username) return;
    trackMemberActionSelected("compare_mention");
    router.push(`/fantasy/leagues/${leagueCode}?t=chat&mention=${encodeURIComponent(target.username)}`);
    onClose();
  };

  return (
    <Sheet onClose={onClose} labelledBy="compare-title">
      <div id="compare-title" className="font-display" style={{ fontSize: 17, color: INK, marginBottom: 4 }}>Compare squads</div>
      <p style={{ fontSize: 12, color: MUTED, margin: "0 0 14px" }}>This gameweek, facts only.</p>

      <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
        <SideColumn label="You" avatarUrl={null} seed={viewerId} side={me} />
        <div style={{ width: 1, background: LINE, flexShrink: 0 }} />
        <SideColumn label={target.name} avatarUrl={target.avatarUrl} seed={target.userId} side={them} />
      </div>

      {hasBothSquads && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
          <div>
            <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>
              SHARED · {shared.length}
            </div>
            <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.5 }}>
              {shared.length ? namesFor(me, shared).join(", ") : "No players in common."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>ONLY YOU</div>
              <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.5 }}>
                {onlyMe.length ? namesFor(me, onlyMe).join(", ") : "None."}
              </p>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>{`ONLY ${target.name.toUpperCase()}`}</div>
              <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.5 }}>
                {onlyThem.length ? namesFor(them, onlyThem).join(", ") : "None."}
              </p>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Link href={`/profile/${target.userId}#fantasy-xi`} onClick={onClose} style={{
          flex: 1, textAlign: "center", padding: "11px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700,
          background: PANEL_2, border: `1px solid ${LINE}`, color: INK, textDecoration: "none",
        }}>View full squad</Link>
        {target.username && (
          <button onClick={mentionInChat} style={{
            flex: 1, textAlign: "center", padding: "11px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: tint(TEAL, "18"), border: `1px solid ${tint(TEAL, "55")}`, color: TEAL,
          }}>Mention in chat</button>
        )}
      </div>
    </Sheet>
  );
}
