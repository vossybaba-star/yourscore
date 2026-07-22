"use client";

/**
 * "Pick a username" — the public identity, like any game. Shown once per session to a
 * signed-in user who hasn't set a username yet; skippable. Checks availability live
 * (case-insensitive, unique via migration 47). On save we set BOTH `username` and
 * `display_name = username` so every existing surface (leaderboards, leagues, cards,
 * which read display_name) shows the handle without rewiring them.
 *
 * Replaces the real-name display-name prompt — a chosen handle sidesteps the privacy
 * issue of dragging people's first + last name from Google/email signup.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useOnErrorRoute } from "@/components/app/errorRoute";
import { createClient } from "@/lib/supabase/client";

const SKIP_KEY = "ys:username-prompt:skipped"; // session-scoped: re-nudges next visit
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

type Status = "idle" | "short" | "checking" | "available" | "taken" | "saving";

export function UsernamePrompt() {
  const pathname = usePathname();
  const onErrorRoute = useOnErrorRoute();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const seq = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SKIP_KEY)) return;
    if (pathname?.startsWith("/auth") || pathname?.startsWith("/settings")) return;
    if (onErrorRoute) return; // never over a 404 or a crash screen
    let alive = true;
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user || !alive) return;
      const { data } = await sb.from("profiles").select("username").eq("id", user.id).single();
      if (!alive) return;
      if (!((data?.username ?? "").trim())) setOpen(true); // only when none set
    })();
    return () => { alive = false; };
  }, [pathname, onErrorRoute]);

  // Debounced availability check.
  useEffect(() => {
    if (value.length === 0) { setStatus("idle"); return; }
    if (value.length < 3) { setStatus("short"); return; }
    setStatus("checking");
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const sb = createClient();
        const { data } = await sb.from("profiles").select("id").ilike("username", value).limit(1);
        if (mine !== seq.current) return;
        setStatus(data && data.length ? "taken" : "available");
      } catch { if (mine === seq.current) setStatus("available"); }
    }, 400);
    return () => clearTimeout(t);
  }, [value]);

  function skip() { try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* ignore */ } setOpen(false); }

  async function save() {
    if (status !== "available") return;
    setStatus("saving");
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { skip(); return; }
      const { error } = await sb.from("profiles").update({ username: value, display_name: value }).eq("id", user.id);
      if (error) { setStatus("taken"); return; } // unique-index race → taken
      try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* ignore */ }
      setOpen(false);
    } catch { setStatus("available"); }
  }

  if (!open || onErrorRoute) return null;

  const hint =
    status === "available" ? { t: "✓ available", c: "#00ff87" }
    : status === "taken" ? { t: "✗ taken — try another", c: "#ff7a88" }
    : status === "short" ? { t: "at least 3 characters", c: "#8888aa" }
    : status === "checking" ? { t: "checking…", c: "#8888aa" }
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div className="w-full max-w-md rounded-3xl p-6" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="text-center">
          <div style={{ fontSize: 34 }}>🎮</div>
          <h2 className="font-display tracking-wide mt-1" style={{ fontSize: 22, color: "#fff" }}>PICK YOUR USERNAME</h2>
          <p className="font-body mt-2" style={{ fontSize: 13.5, color: "#9a9ab0", lineHeight: 1.5 }}>
            This is your name across YourScore — leaderboards, leagues and shared cards. Pick a handle (no spaces); you can change it later in Settings.
          </p>
        </div>
        <div className="flex items-center gap-1 mt-5 rounded-xl px-4 py-3" style={{ background: "#0a0a0f", border: `1px solid ${status === "taken" ? "rgba(255,71,87,0.5)" : status === "available" ? "rgba(0,255,135,0.5)" : "rgba(255,255,255,0.14)"}` }}>
          <span className="font-body" style={{ fontSize: 16, color: "#8888aa" }}>@</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(clean(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="username"
            className="flex-1 font-body text-white bg-transparent outline-none placeholder:text-white/20"
            style={{ fontSize: 16 }}
          />
        </div>
        <div className="h-5 mt-1.5 px-1">{hint && <span className="font-body" style={{ fontSize: 12, color: hint.c }}>{hint.t}</span>}</div>
        <button onClick={save} disabled={status !== "available"}
          className="w-full mt-2 rounded-2xl py-3.5 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-40"
          style={{ background: "#aeea00", color: "#0a0a0f", fontSize: 17 }}>
          {status === "saving" ? "SAVING…" : "SET USERNAME"}
        </button>
        <button onClick={skip} className="w-full mt-2 font-body" style={{ fontSize: 13, color: "#8888aa" }}>
          I&apos;ll do this later
        </button>
      </div>
    </div>
  );
}
