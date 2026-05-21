"use client";

import Link from "next/link";

const STATS = [
  { label: "Matches", value: "8", sub: "scheduled", color: "#00ff87", href: "/admin/matches" },
  { label: "Questions", value: "24", sub: "approved", color: "#ffb800", href: "/admin/matches" },
  { label: "Active Rooms", value: "3", sub: "live now", color: "#ff4757", href: "/admin/rooms" },
  { label: "Players", value: "47", sub: "total", color: "#a78bfa", href: "/admin/rooms" },
];

const QUICK_ACTIONS = [
  { label: "Generate questions", desc: "Use AI to create questions for a match", href: "/admin/matches", icon: "✨" },
  { label: "Fire question", desc: "Send a question to a live room", href: "/admin/rooms", icon: "🔥" },
  { label: "Add match", desc: "Schedule a new fixture", href: "/admin/matches", icon: "🏟️" },
];

export default function AdminDashboard() {
  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-4xl text-white tracking-wide">DASHBOARD</h1>
        <p className="font-body text-sm text-text-muted mt-1">2026 FIFA World Cup — Live Quiz Admin</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-8 lg:grid-cols-4">
        {STATS.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-2xl p-5 hover:opacity-90 transition-opacity"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p className="font-display text-3xl leading-none" style={{ color: s.color }}>{s.value}</p>
            <p className="font-body text-sm font-semibold text-white mt-2">{s.label}</p>
            <p className="font-body text-xs text-text-muted">{s.sub}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mb-6">
        <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Quick actions</p>
        <div className="space-y-2">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.label}
              href={a.href}
              className="flex items-center gap-4 px-5 py-4 rounded-2xl hover:opacity-90 transition-opacity"
              style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <span className="text-2xl flex-shrink-0">{a.icon}</span>
              <div>
                <p className="font-body text-sm font-semibold text-white">{a.label}</p>
                <p className="font-body text-xs text-text-muted">{a.desc}</p>
              </div>
              <span className="ml-auto font-body text-text-muted text-xs">→</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
