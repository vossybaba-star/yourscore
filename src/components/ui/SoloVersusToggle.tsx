"use client";

import { useRouter } from "next/navigation";

/**
 * The Play-tab mode switch — Solo (the games) vs Versus (head-to-head), pinned
 * to the top of every Play-tab surface (founder, 25 Jul: it must persist even
 * inside an individual game). It lives in the global games bar (GamesNav) on the
 * game routes and in the Versus page's own header, so it's always in the same
 * place. A persistent bar can't swap the page beneath it, so each side is a
 * navigation: Solo → /play, Versus → /versus.
 */
export function SoloVersusToggle({ mode }: { mode: "solo" | "versus" }) {
  const router = useRouter();
  const cls = "flex-1 py-2 rounded-xl font-body text-xs font-semibold transition-all";
  const on = { background: "#00d8c0", color: "#0a0a0f" };
  const off = { background: "transparent", color: "#8a948f" };
  return (
    <div className="flex gap-1 p-1 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <button onClick={() => router.push("/play")} className={cls} style={mode === "solo" ? on : off}>Solo</button>
      <button onClick={() => router.push("/versus")} className={cls} style={mode === "versus" ? on : off}>Versus</button>
    </div>
  );
}
