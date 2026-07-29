"use client";

/**
 * /admin/scout-picks — the approve list for Scout's Four Picks (Stage 4).
 *
 * Shows every fact + reason the pick will render with (never a summary of
 * them — an admin approving a pick they can't fully read is the whole gate
 * failing). Draft -> Approve or Reject; Approved -> Publish or Reject.
 * Publishing supersedes whatever was previously live for that (gw, category) —
 * see the route's own comment for why that has to happen server-side.
 */

import { useState, useEffect, useCallback } from "react";
import { BackPill } from "@/components/ui/BackPill";

type ScoutCategory = "safe" | "form" | "value" | "gamble";
type PickStatus = "draft" | "approved" | "published" | "rejected" | "superseded";

interface PickFacts {
  player: string; club: string; position: string; priceM: number;
  availability: string; chanceOfPlaying: number | null;
  fixture: { opponent: string; homeOrAway: "home" | "away" }[] | null;
  seasonPointsPerAppearance: number | null; recentFormPoints: number | null;
  nailedStarts: number | null; fplProjection: number | null; ownershipPercent: number | null;
}
interface BackupCandidate {
  playerId: number; name: string; club: string; pos: string; priceTenths: number;
  facts: PickFacts; reasons: string[]; risk?: string;
}
interface PickRow {
  id: string; gw: number; category: ScoutCategory; status: PickStatus;
  player_id: number; facts: PickFacts; reasons: string[]; risk: string | null;
  signal: string; copy_source: "model" | "mechanical";
  data_cutoff: string; generated_at: string; expires_at: string;
  rejected_reason: string | null; backups: BackupCandidate[];
}

const CATEGORY_LABEL: Record<ScoutCategory, string> = {
  safe: "Safe", form: "Form", value: "Value", gamble: "Scout's Gamble",
};
const STATUS_COLOUR: Record<PickStatus, string> = {
  draft: "#8a948f", approved: "#00d8c0", published: "#aeea00",
  rejected: "#ff4757", superseded: "#5a6058",
};

const cardStyle = { background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" } as const;

function FactsBlock({ f }: { f: PickFacts }) {
  const rows: [string, string][] = [
    ["Position", f.position], ["Price", `£${f.priceM.toFixed(1)}m`],
    ["Availability", f.availability],
    ["Chance of playing", f.chanceOfPlaying === null ? "—" : `${f.chanceOfPlaying}%`],
    ["Fixture", f.fixture?.length ? f.fixture.map((x) => `${x.homeOrAway === "home" ? "vs" : "@"} ${x.opponent}`).join(", ") : "—"],
    ["Season PPG", f.seasonPointsPerAppearance === null ? "—" : f.seasonPointsPerAppearance.toFixed(1)],
    ["Recent form pts", f.recentFormPoints === null ? "—" : String(f.recentFormPoints)],
    ["Nailed starts", f.nailedStarts === null ? "—" : String(f.nailedStarts)],
    ["FPL ep_next", f.fplProjection === null ? "—" : f.fplProjection.toFixed(1)],
    ["Ownership", f.ownershipPercent === null ? "—" : `${f.ownershipPercent.toFixed(1)}%`],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-body text-xs" style={{ color: "#8a948f" }}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span>{k}</span><span style={{ color: "#eef2f0" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function PickCard({ row, onAction }: { row: PickRow; onAction: (id: string, action: string, reason?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (action: string) => {
    setBusy(true);
    try { await onAction(row.id, action, action === "reject" ? reason : undefined); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={cardStyle}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="font-display tracking-wide text-lg" style={{ color: "#eef2f0" }}>
            {CATEGORY_LABEL[row.category]} &middot; {row.facts.player}
          </p>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>
            {row.facts.club} &middot; GW{row.gw} &middot; {row.signal === "season_ppg" ? "season signal" : "FPL projection (cold start)"} &middot; copy: {row.copy_source}
          </p>
        </div>
        <span className="font-body text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ color: STATUS_COLOUR[row.status], border: `1px solid ${STATUS_COLOUR[row.status]}55` }}>
          {row.status.toUpperCase()}
        </span>
      </div>

      <FactsBlock f={row.facts} />

      <div>
        <p className="font-body text-xs font-bold mb-1" style={{ color: "#586058" }}>REASONS</p>
        <ul className="font-body text-sm space-y-1" style={{ color: "#eef2f0" }}>
          {row.reasons.map((r, i) => <li key={i}>&bull; {r}</li>)}
        </ul>
      </div>

      {row.risk && (
        <div>
          <p className="font-body text-xs font-bold mb-1" style={{ color: "#586058" }}>RISK</p>
          <p className="font-body text-sm" style={{ color: "#E08A6B" }}>{row.risk}</p>
        </div>
      )}

      {row.backups.length > 0 && (
        <div>
          <p className="font-body text-xs font-bold mb-1" style={{ color: "#586058" }}>BACKUPS</p>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>
            {row.backups.map((b) => b.name).join(" then ")}
          </p>
        </div>
      )}

      {row.status === "rejected" && row.rejected_reason && (
        <p className="font-body text-xs" style={{ color: "#ff4757" }}>Rejected: {row.rejected_reason}</p>
      )}

      {(row.status === "draft" || row.status === "approved") && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {row.status === "draft" && (
            <button disabled={busy} onClick={() => run("approve")}
              className="font-body text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: "rgba(0,216,192,0.12)", color: "#00d8c0" }}>Approve</button>
          )}
          {row.status === "approved" && (
            <button disabled={busy} onClick={() => run("publish")}
              className="font-body text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00" }}>Publish</button>
          )}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reject reason (optional)"
            className="font-body text-xs rounded-lg px-2 py-2 outline-none"
            style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", minWidth: 180 }} />
          <button disabled={busy} onClick={() => run("reject")}
            className="font-body text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
            style={{ background: "rgba(255,71,87,0.1)", color: "#ff4757" }}>Reject</button>
        </div>
      )}
    </div>
  );
}

export default function AdminScoutPicksPage() {
  const [gw, setGw] = useState("");
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyGenerate, setBusyGenerate] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = gw.trim() ? `?gw=${encodeURIComponent(gw.trim())}` : "";
      const r = await fetch(`/api/admin/scout-picks${qs}`);
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Could not load");
      else setPicks(d.picks ?? []);
    } catch {
      setErr("Network error");
    }
    setLoading(false);
  }, [gw]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setBusyGenerate(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/scout-picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate", gw: gw.trim() ? Number(gw.trim()) : undefined }),
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.error ?? "Could not generate");
      else {
        setMsg(`Generated GW${d.gw}: ${d.generated.join(", ")}${d.skipped?.length ? ` (skipped: ${d.skipped.join(", ")})` : ""}`);
        await load();
      }
    } catch {
      setMsg("Network error");
    }
    setBusyGenerate(false);
  };

  const onAction = async (id: string, action: string, reason?: string) => {
    const r = await fetch("/api/admin/scout-picks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, id, reason }),
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error ?? `Could not ${action}`);
    else { setMsg(null); await load(); }
  };

  return (
    <main className="min-h-dvh bg-bg px-5 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <BackPill href="/admin" label="Admin" tone="neutral" />
          <h1 className="font-display text-3xl text-white tracking-wide mt-2">Scout&apos;s Four Picks</h1>
          <p className="font-body text-sm mt-1" style={{ color: "#8a948f" }}>
            Mechanically ranked. Approve before a pick can be published; only published rows ever reach a user.
          </p>
        </div>

        <div className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={cardStyle}>
          <input value={gw} onChange={(e) => setGw(e.target.value)} placeholder="GW (blank = current)"
            className="font-body text-sm rounded-lg px-3 py-2 outline-none"
            style={{ background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", width: 180 }} />
          <button onClick={() => void load()} className="font-body text-xs font-bold px-3 py-2 rounded-lg"
            style={{ background: "rgba(255,255,255,0.06)", color: "#eef2f0" }}>Reload</button>
          <button disabled={busyGenerate} onClick={() => void generate()}
            className="font-body text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
            style={{ background: "rgba(0,216,192,0.12)", color: "#00d8c0" }}>
            {busyGenerate ? "Generating…" : "Generate drafts"}
          </button>
          {msg && <span className="font-body text-xs" style={{ color: msg.toLowerCase().includes("error") ? "#ff4757" : "#aeea00" }}>{msg}</span>}
        </div>

        {err && <p className="font-body text-sm" style={{ color: "#ff4757" }}>{err}</p>}
        {loading ? (
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>Loading…</p>
        ) : picks.length === 0 ? (
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>No picks yet — generate drafts above.</p>
        ) : (
          <div className="space-y-3">
            {picks.map((p) => <PickCard key={p.id} row={p} onAction={onAction} />)}
          </div>
        )}
      </div>
    </main>
  );
}
