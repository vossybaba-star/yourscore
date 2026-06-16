"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "⚡" },
  { href: "/admin/matches", label: "Matches", icon: "🏟️" },
  { href: "/admin/rooms", label: "Lobbies", icon: "🚪" },
  { href: "/admin/challenges", label: "Challenges", icon: "★" },
  { href: "/admin/club-leagues", label: "Club Leagues", icon: "🍺" },
  { href: "/admin/club-preview", label: "League visuals", icon: "🎨" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-bg flex">
      {/* Sidebar */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col"
        style={{ background: "#080d0a", borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="px-5 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="font-display text-xl text-white tracking-widest">YOURSCORE</p>
          <p className="font-body text-xs mt-0.5" style={{ color: "#ff4757" }}>ADMIN</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-body text-sm transition-all"
                style={{
                  background: active ? "rgba(174,234,0,0.08)" : "transparent",
                  color: active ? "#aeea00" : "#8a948f",
                  border: active ? "1px solid rgba(174,234,0,0.12)" : "1px solid transparent",
                }}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="font-body text-xs text-text-muted">2026 FIFA World Cup</p>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
