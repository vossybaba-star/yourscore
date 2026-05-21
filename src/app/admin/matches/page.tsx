/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  status: string;
}

const MOCK_MATCHES: Match[] = [
  { id: "m1", home_team: "England", away_team: "France", match_date: "2026-06-15T19:00:00Z", status: "upcoming" },
  { id: "m2", home_team: "Brazil", away_team: "Argentina", match_date: "2026-06-18T20:00:00Z", status: "upcoming" },
  { id: "m3", home_team: "Germany", away_team: "Spain", match_date: "2026-06-21T17:00:00Z", status: "upcoming" },
  { id: "m4", home_team: "Portugal", away_team: "Netherlands", match_date: "2026-06-24T19:00:00Z", status: "upcoming" },
];

const STATUS_COLOR: Record<string, string> = {
  upcoming: "#8888aa",
  live: "#00ff87",
  half_time: "#ffb800",
  completed: "#555566",
};

export default function AdminMatches() {
  const [matches, setMatches] = useState<Match[]>(MOCK_MATCHES);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ home_team: "", away_team: "", match_date: "", match_time: "19:00" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase
        .from("matches")
        .select("id, home_team, away_team, match_date, status")
        .order("match_date", { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) setMatches(data as Match[]);
        });
    });
  }, []);

  async function handleAdd() {
    if (!form.home_team || !form.away_team || !form.match_date) return;
    setSaving(true);
    const dateTime = `${form.match_date}T${form.match_time}:00Z`;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setMatches((prev) => [...prev, { id: `m${Date.now()}`, home_team: form.home_team, away_team: form.away_team, match_date: dateTime, status: "upcoming" }]);
      setShowAdd(false);
      setSaving(false);
      return;
    }
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("matches")
      .insert({ home_team: form.home_team, away_team: form.away_team, match_date: dateTime })
      .select()
      .single();
    if (!error && data) setMatches((prev) => [...prev, data as Match]);
    setSaving(false);
    setShowAdd(false);
    setForm({ home_team: "", away_team: "", match_date: "", match_time: "19:00" });
  }

  return (
    <main className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">MATCHES</h1>
          <p className="font-body text-sm text-text-muted mt-1">{matches.length} fixtures scheduled</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-5 py-2.5 rounded-xl font-body text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,255,135,0.12)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}
        >
          + Add match
        </button>
      </div>

      <div className="space-y-2">
        {matches.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-4 px-5 py-4 rounded-2xl"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex-1">
              <p className="font-body text-sm font-semibold text-white">
                {m.home_team} <span className="text-text-muted font-normal">vs</span> {m.away_team}
              </p>
              <p className="font-body text-xs text-text-muted mt-0.5">
                {new Date(m.match_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                {" · "}
                {new Date(m.match_date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <span
              className="px-2.5 py-1 rounded-full font-body text-xs font-semibold uppercase tracking-wider"
              style={{ background: `${STATUS_COLOR[m.status]}18`, color: STATUS_COLOR[m.status], border: `1px solid ${STATUS_COLOR[m.status]}30` }}
            >
              {m.status.replace("_", " ")}
            </span>
            <Link
              href={`/admin/questions/${m.id}`}
              className="px-4 py-2 rounded-xl font-body text-xs font-semibold hover:opacity-80 transition-opacity"
              style={{ background: "rgba(255,255,255,0.05)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Questions →
            </Link>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md mx-4 rounded-3xl p-6" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)" }}>
            <h2 className="font-display text-2xl text-white mb-5">ADD MATCH</h2>
            <div className="space-y-3">
              {[
                { label: "Home team", key: "home_team", placeholder: "e.g. England" },
                { label: "Away team", key: "away_team", placeholder: "e.g. France" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <p className="font-body text-xs text-text-muted mb-1.5">{label}</p>
                  <input
                    type="text"
                    placeholder={placeholder}
                    value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl font-body text-sm text-white placeholder:text-text-muted outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                </div>
              ))}
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="font-body text-xs text-text-muted mb-1.5">Date</p>
                  <input
                    type="date"
                    value={form.match_date}
                    onChange={(e) => setForm((f) => ({ ...f, match_date: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl font-body text-sm text-white outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", colorScheme: "dark" }}
                  />
                </div>
                <div className="w-28">
                  <p className="font-body text-xs text-text-muted mb-1.5">Time (UTC)</p>
                  <input
                    type="time"
                    value={form.match_time}
                    onChange={(e) => setForm((f) => ({ ...f, match_time: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl font-body text-sm text-white outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", colorScheme: "dark" }}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 py-3 rounded-xl font-body text-sm text-text-muted hover:text-white transition-colors"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex-1 py-3 rounded-xl font-body text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: "rgba(0,255,135,0.12)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}
              >
                {saving ? "Saving…" : "Add match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
