"use client";
/** League table — season + monthly mini-season, invite, join, manage. Auth is
 *  optional server-side (link-viewable): a guest sees the full table and a JOIN
 *  card that routes through sign-in and back here on a 401. */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Btn, Card, Chip, GOLD, Header, INK, LINE, MUTED, page, PANEL,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

interface LeagueRow {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; points: number; played: number; lastGwPoints: number | null; isMe: boolean;
}
interface LeagueDetail {
  league: {
    id: string; name: string; code: string; memberCount: number;
    isPublic: boolean; isMember: boolean; isOwner: boolean;
  };
  season: LeagueRow[];
  month: { key: string; label: string; gws: number[]; rows: LeagueRow[] };
  lastMonth: {
    key: string; label: string;
    winner: { userId: string; username: string | null; displayName: string | null; points: number };
  } | null;
}

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

const nameOf = (r: { username: string | null; displayName: string | null }) =>
  r.displayName ?? (r.username ? `@${r.username}` : "Player");

function TableRows({ rows, onPeek }: { rows: LeagueRow[]; onPeek?: (r: LeagueRow) => void }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>No members yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.userId} onClick={() => onPeek?.(r)} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10,
          background: r.isMe ? "rgba(227,181,76,0.12)" : PANEL, border: `1px solid ${r.isMe ? GOLD : LINE}`,
          cursor: onPeek ? "pointer" : "default",
        }}>
          <span style={{
            width: 20, textAlign: "center", fontSize: 13, fontWeight: 700,
            color: r.rank === 1 ? GOLD : MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0,
          }}>{r.rank}</span>
          <PlayerAvatar seed={r.userId} name={nameOf(r)} avatarUrl={r.avatarUrl} size={30} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {nameOf(r)}{r.isMe ? " (you)" : ""}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: r.played === 0 ? MUTED : INK, textAlign: "right", flexShrink: 0 }}>
            {r.played === 0 ? "0 · no gameweek scored yet" : `${r.points} pts`}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LeaguePage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();

  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<"season" | "month">("season");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  interface Run {
    gw: number; name: string; correct: number; total: number;
    questions: { prompt: string; picked: string | null; answer: string; right: boolean }[];
  }
  const [run, setRun] = useState<Run | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiRaw<LeagueDetail>(`leagues/${code}`);
      setDetail(d);
    } catch (e) {
      if ((e as { status?: number }).status === 404) setNotFound(true);
      else setErr((e as Error).message);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    const url = `${window.location.origin}/fantasy/leagues/${code}`;
    const text = `Join my YourScore Fantasy league "${detail?.league.name ?? ""}" — code ${code}`;
    if (navigator.share) { navigator.share({ title: "YourScore Fantasy league", text, url }).catch(() => {}); return; }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — nothing more we can do */ }
  };

  const join = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await apiRaw("leagues/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      await load();
    } catch (e) {
      if ((e as { status?: number }).status === 401) router.push(`/auth/sign-in?next=/fantasy/leagues/${code}`);
      else setErr((e as Error).message);
    }
    setBusy(false);
  };

  /** Tap a league-mate → their completed round, if the server says it's time.
   *  The refusal message IS the feature copy ("runs open up after the deadline"). */
  const peek = async (r: LeagueRow) => {
    setRunNote(null); setRun(null);
    try { setRun(await apiRaw<Run>(`leagues/${code}/run?user=${r.userId}`)); }
    catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 401) router.push(`/auth/sign-in?next=/fantasy/leagues/${code}`);
      else setRunNote((e as Error).message);
    }
  };

  const rename = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      await apiRaw(`leagues/${code}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName.trim() }),
      });
      setRenaming(false);
      await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const setVisibility = async (isPublic: boolean) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await apiRaw(`leagues/${code}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isPublic }),
      });
      await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const leaveOrDelete = async (mode: "leave" | "delete") => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await apiRaw(`leagues/${code}?mode=${mode}`, { method: "DELETE" });
      router.push("/fantasy/leagues");
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  if (notFound) return (
    <main style={page}>
      <Header />
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>League not found</div>
        <Btn onClick={() => router.push("/fantasy/leagues")}>← Back to leagues</Btn>
      </Card>
    </main>
  );
  if (!detail) return <main style={page}><Header /><p style={{ color: MUTED }}>Loading…</p></main>;

  const { league, season, month, lastMonth } = detail;
  const rows = tab === "season" ? season : month.rows;
  const monthUnstarted = tab === "month" && month.rows.every((r) => r.played === 0);
  const firstGw = month.gws.length ? Math.min(...month.gws) : null;

  return (
    <main style={page}>
      <Header right={<Btn small onClick={() => router.push("/fantasy/leagues")}>← Leagues</Btn>} />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        {renaming ? (
          <div style={{ flex: 1 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value.slice(0, 40))} maxLength={40} autoFocus
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, fontSize: 18, fontWeight: 700, background: PANEL, color: INK, border: `1px solid ${GOLD}`, outline: "none" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <Btn small gold disabled={busy || !newName.trim()} onClick={rename}>Save</Btn>
              <Btn small onClick={() => setRenaming(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700, lineHeight: 1.2 }}>{league.name}</h1>
        )}
        {league.isOwner && !renaming && (
          <Btn small onClick={() => { setNewName(league.name); setRenaming(true); }}>Rename</Btn>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Chip gold>{code}</Chip>
        <Chip>{league.memberCount} member{league.memberCount === 1 ? "" : "s"}</Chip>
        {league.isPublic && <Chip>Public</Chip>}
        <Btn small onClick={invite}>{copied ? "Link copied" : "Invite friends"}</Btn>
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 12px" }}>{err}</p>}

      {!league.isMember && (
        <Card style={{ marginBottom: 14, border: `1px solid ${GOLD}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>Fancy your chances?</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 10px", lineHeight: 1.45 }}>
            Join in and your gameweek points go straight on the table.
          </p>
          <Btn gold disabled={busy} onClick={join}>{busy ? "…" : "JOIN THIS LEAGUE"}</Btn>
        </Card>
      )}

      {/* Segment tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["season", "month"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "9px 4px", borderRadius: 9, fontSize: 13, fontWeight: 700,
            cursor: "pointer", background: tab === t ? GOLD : PANEL, color: tab === t ? "#2A1F00" : INK,
            border: `1px solid ${tab === t ? GOLD : LINE}`,
          }}>{t === "season" ? "Season" : "This month"}</button>
        ))}
      </div>

      {tab === "month" && (
        <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8 }}>{month.label}</div>
      )}

      {monthUnstarted ? (
        <Card style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            {firstGw != null
              ? `First deadline of ${month.label} is GW ${firstGw} — the table fills in once it's scored.`
              : "No gameweeks in this month yet."}
          </p>
        </Card>
      ) : (
        <TableRows rows={rows} onPeek={detail.league.isMember ? peek : undefined} />
      )}

      {runNote && <p style={{ fontSize: 12.5, color: MUTED, margin: "8px 0 0" }}>{runNote}</p>}

      {/* A friend's run — right/wrong per question, after the deadline only */}
      {run && (
        <div onClick={() => setRun(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 40,
          display: "flex", alignItems: "flex-end", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 560, maxHeight: "82dvh", overflowY: "auto",
            background: "#132b1e", borderRadius: "16px 16px 0 0", border: `1px solid ${GOLD}`,
            padding: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>
                {run.name} — {run.correct}/{run.total} in Gameweek {run.gw}
              </span>
              <Btn small onClick={() => setRun(null)}>Close</Btn>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {run.questions.map((q, i) => (
                <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 11px" }}>
                  <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "pre-line", lineHeight: 1.4 }}>{q.prompt}</div>
                  <div style={{ fontSize: 13, marginTop: 5, fontWeight: 600, color: q.right ? "#7BC98B" : "#E08A6B" }}>
                    {q.right ? "✓" : "✗"} {q.picked ?? "ran out of time"}
                    {!q.right && <span style={{ color: MUTED, fontWeight: 400 }}> — it was {q.answer}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "month" && lastMonth && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED }}>
          {lastMonth.label} winner: <b style={{ color: GOLD }}>{nameOf(lastMonth.winner)}</b> — {lastMonth.winner.points} pts
        </div>
      )}

      {league.isMember && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          {league.isOwner && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["Private", "Public"] as const).map((label, i) => {
                const wantsPublic = i === 1;
                const active = wantsPublic === league.isPublic;
                return (
                  <button key={label} disabled={busy} onClick={() => setVisibility(wantsPublic)} style={{
                    flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                    cursor: "pointer", background: active ? GOLD : PANEL, color: active ? "#2A1F00" : INK,
                    border: `1px solid ${active ? GOLD : LINE}`,
                  }}>{label}</button>
                );
              })}
            </div>
          )}
          {confirmLeave ? (
            <Card style={{ border: "1px solid #B85C38" }}>
              <p style={{ fontSize: 13, color: "#E08A6B", margin: "0 0 10px" }}>
                {league.isOwner ? "Delete this league for everyone? This can't be undone." : "Leave this league?"}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small disabled={busy} onClick={() => leaveOrDelete(league.isOwner ? "delete" : "leave")}>
                  {league.isOwner ? "Delete league" : "Leave"}
                </Btn>
                <Btn small onClick={() => setConfirmLeave(false)}>Cancel</Btn>
              </div>
            </Card>
          ) : (
            <button onClick={() => setConfirmLeave(true)} style={{
              background: "none", border: "none", color: MUTED, fontSize: 12.5, cursor: "pointer", padding: 0, textDecoration: "underline",
            }}>{league.isOwner ? "Delete league" : "Leave league"}</button>
          )}
        </div>
      )}
    </main>
  );
}
