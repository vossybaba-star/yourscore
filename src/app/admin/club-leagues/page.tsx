"use client";

/**
 * /admin/club-leagues — provision and manage Club Leagues (partner-owned
 * branded leagues). Admin-only controls live here: create (with owner-by-email),
 * slug corrections, tier, and the is_active kill switch. Day-to-day running
 * (branding, events, announcements) is the partner's job on /l/[slug] → Manage.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { BackPill } from "@/components/ui/BackPill";

interface AdminLeague {
  id: string;
  slug: string;
  name: string;
  tier: string;
  owner_id: string;
  join_code: string;
  is_active: boolean;
  created_at: string;
  memberCount: number;
}

const TIERS = ["pub", "creator", "sponsor"] as const;

const inputStyle = {
  background: "#0a0a0f",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.12)",
} as const;

export default function AdminClubLeaguesPage() {
  const [leagues, setLeagues] = useState<AdminLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", slug: "", tier: "pub", ownerEmail: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/club-leagues");
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? "Could not load");
      } else {
        setLeagues(d.leagues ?? []);
      }
    } catch {
      setErr("Network error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/club-leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error ?? "Could not create");
      } else {
        setMsg(`Created ✓ — yourscore.app/l/${d.slug}`);
        setForm({ name: "", slug: "", tier: "pub", ownerEmail: "" });
        await load();
      }
    } catch {
      setMsg("Network error");
    }
    setBusy(false);
  }

  async function toggleActive(l: AdminLeague) {
    const r = await fetch("/api/admin/club-leagues", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: l.id, isActive: !l.is_active }),
    });
    if (r.ok) await load();
  }

  return (
    <main className="min-h-dvh bg-bg px-5 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <BackPill href="/admin" label="Admin" tone="neutral" />
          <h1 className="font-display text-3xl text-white tracking-wide mt-2">Club Leagues</h1>
          <p className="font-body text-sm mt-1" style={{ color: "#8a948f" }}>
            Provision branded leagues for pubs, creators, and sponsors. The partner manages
            everything else from their league&apos;s Manage tab.
          </p>
        </div>

        {/* Create */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.18)" }}>
          <p className="font-display tracking-wide" style={{ fontSize: 16, color: "#aeea00" }}>NEW CLUB LEAGUE</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60}
                placeholder="The Red Lion" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
            </label>
            <label className="block">
              <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Slug (yourscore.app/l/…)</span>
              <input value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                maxLength={40} placeholder="red-lion" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
            </label>
            <label className="block">
              <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Tier</span>
              <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle}>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Owner email (existing account)</span>
              <input value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} type="email"
                placeholder="landlord@redlion.pub" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
            </label>
          </div>
          {msg && <p className="font-body text-xs" style={{ color: msg.includes("✓") ? "#aeea00" : "#ff4757" }}>{msg}</p>}
          <button onClick={create} disabled={busy || !form.name.trim() || form.slug.length < 3 || !form.ownerEmail.trim()}
            className="rounded-xl px-6 py-3 font-display tracking-wide disabled:opacity-50"
            style={{ background: "#aeea00", color: "#062013", fontSize: 16 }}>
            {busy ? "CREATING…" : "CREATE"}
          </button>
        </div>

        {/* List */}
        {err && <p className="font-body text-sm" style={{ color: "#ff4757" }}>{err}</p>}
        {loading ? (
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>Loading…</p>
        ) : (
          <div className="space-y-2">
            {leagues.length === 0 && (
              <p className="font-body text-sm" style={{ color: "#8a948f" }}>No club leagues yet.</p>
            )}
            {leagues.map((l) => (
              <div key={l.id} className="flex items-center gap-4 rounded-2xl px-4 py-3"
                style={{ background: "#0e1611", border: `1px solid ${l.is_active ? "rgba(255,255,255,0.08)" : "rgba(255,71,87,0.25)"}` }}>
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-bold text-white truncate">
                    {l.name}
                    {!l.is_active && <span className="ml-2 font-normal" style={{ color: "#ff4757", fontSize: 11 }}>DEACTIVATED</span>}
                  </p>
                  <p className="font-body text-xs" style={{ color: "#8a948f" }}>
                    /l/{l.slug} · {l.tier} · {l.memberCount} member{l.memberCount === 1 ? "" : "s"} · code {l.join_code}
                  </p>
                </div>
                <Link href={`/l/${l.slug}`} className="font-body text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
                  style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00" }}>
                  View
                </Link>
                <button onClick={() => toggleActive(l)} className="font-body text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
                  style={l.is_active
                    ? { background: "rgba(255,71,87,0.1)", color: "#ff4757" }
                    : { background: "rgba(174,234,0,0.1)", color: "#aeea00" }}>
                  {l.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
