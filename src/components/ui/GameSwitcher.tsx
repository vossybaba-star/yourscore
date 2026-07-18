"use client";

import Link from "next/link";

// The Play tab's game switcher — Quiz and 38-0 are sibling games under the one
// bottom-nav Play tab (founder call, 2026-07-18). Each game keeps its own
// frozen route (/play, /38-0), so switching is a navigation, not local state.
export function GameSwitcher({ active }: { active: "quiz" | "draft" }) {
  return (
    <div
      className="flex gap-1 p-1 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <Link
        href="/play"
        className="flex-1 py-2 rounded-xl font-body text-xs font-semibold text-center transition-all"
        style={active === "quiz"
          ? { background: "#00d8c0", color: "#0a0a0f" }
          : { background: "transparent", color: "#8a948f" }}
      >
        Quiz
      </Link>
      <Link
        href="/38-0"
        className="flex-1 py-2 rounded-xl font-body text-xs font-semibold text-center transition-all"
        style={active === "draft"
          ? { background: "#aeea00", color: "#062013" }
          : { background: "transparent", color: "#8a948f" }}
      >
        38-0
      </Link>
    </div>
  );
}
