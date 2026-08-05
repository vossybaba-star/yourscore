"use client";

/**
 * /admin/reports — the moderation queue for Social Phase 5a reports (AC6).
 *
 * Newest first, subject preview so an admin never acts blind. Dismiss clears
 * a report with no other effect; Soft-hide subject applies the SAME hidden
 * flag a manager's own delete already uses (payload.deleted for a post,
 * deleted_at for a comment) — so a hidden post renders through the existing
 * "This post is unavailable" stub, nothing new to build for it. Gated by
 * requireAdmin (profiles.app_metadata.is_admin) on the API route, and by the
 * same check at the edge in middleware.ts for the page itself.
 */

import { useState, useEffect, useCallback } from "react";
import { BackPill } from "@/components/ui/BackPill";

interface ReportItem {
  id: string; subjectType: string; subjectId: string; reason: string | null;
  createdAt: string; reporterName: string; preview: string; alreadyHidden: boolean;
}

const cardStyle = { background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" } as const;

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/reports");
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Could not load");
      else setReports(d.reports ?? []);
    } catch {
      setErr("Network error");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: "dismiss" | "hide") => {
    setBusyId(id); setMsg(null);
    try {
      const r = await fetch("/api/admin/reports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error ?? `Could not ${action}`);
      else await load();
    } catch {
      setMsg("Network error");
    }
    setBusyId(null);
  };

  return (
    <main className="min-h-dvh bg-bg px-5 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <BackPill href="/admin" label="Admin" tone="neutral" />
          <h1 className="font-display text-3xl text-white tracking-wide mt-2">Reports</h1>
          <p className="font-body text-sm mt-1" style={{ color: "#8a948f" }}>
            Newest first. Dismiss clears a report with no other effect. Hide subject applies
            the same hidden flag a manager&apos;s own delete uses.
          </p>
        </div>

        {msg && <p className="font-body text-sm" style={{ color: "#ff4757" }}>{msg}</p>}
        {err && <p className="font-body text-sm" style={{ color: "#ff4757" }}>{err}</p>}

        {loading ? (
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>Loading…</p>
        ) : reports.length === 0 ? (
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>No open reports.</p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="rounded-2xl p-4 space-y-2" style={cardStyle}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-body text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ color: "#00d8c0", border: "1px solid rgba(0,216,192,0.35)" }}>
                    {r.subjectType.toUpperCase()}
                  </span>
                  <span className="font-body text-xs" style={{ color: "#586058" }}>
                    {new Date(r.createdAt).toLocaleString("en-GB")}
                  </span>
                </div>
                <p className="font-body text-sm" style={{ color: "#eef2f0" }}>{r.preview}</p>
                <p className="font-body text-xs" style={{ color: "#8a948f" }}>
                  Reported by {r.reporterName}{r.reason ? ` · ${r.reason}` : ""}{r.alreadyHidden ? " · already hidden" : ""}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button disabled={busyId === r.id} onClick={() => act(r.id, "dismiss")}
                    className="font-body text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#eef2f0" }}>
                    Dismiss
                  </button>
                  {r.subjectType !== "profile" && !r.alreadyHidden && (
                    <button disabled={busyId === r.id} onClick={() => act(r.id, "hide")}
                      className="font-body text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50"
                      style={{ background: "rgba(255,71,87,0.1)", color: "#ff4757" }}>
                      Hide subject
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
