"use client";

/**
 * One-time nudge to pick a public display name. Auto-derived names from Google/email
 * signup are the user's real "First Last", which is more exposing than people expect on
 * public leaderboards and shared cards. If a signed-in user's display name still looks
 * like a full name (has a space) and they haven't been prompted on this device, we offer
 * to set a nickname (pre-filled with their first name). They can also keep their name.
 *
 * Existing users only — new signups already default to first-name-only (migration 46).
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DISMISS_KEY = "ys:displayname-prompt:v1";

export function DisplayNamePrompt() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY)) return; // already handled on this device
    // Don't interrupt the auth flow or the settings screen (they can edit the name there).
    if (pathname?.startsWith("/auth") || pathname?.startsWith("/settings")) return;

    let alive = true;
    const sb = createClient();
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || !alive) return;
      const { data } = await sb.from("profiles").select("display_name").eq("id", user.id).single();
      const dn = (data?.display_name ?? "").trim();
      if (!alive) return;
      // Only nudge when the public name still looks like a real full name ("First Last").
      // Otherwise mark handled so we don't re-query on every navigation.
      if (!dn.includes(" ")) { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } return; }
      setCurrent(dn);
      setValue(dn.split(/\s+/)[0]); // pre-fill the first name
      setOpen(true);
    })();
    return () => { alive = false; };
  }, [pathname]);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setOpen(false);
  }

  async function save() {
    const name = value.trim().slice(0, 30);
    if (!name || saving) return;
    setSaving(true);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (user) await sb.from("profiles").update({ display_name: name }).eq("id", user.id);
    } catch { /* they can still change it in Settings */ }
    dismiss();
    setSaving(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.72)" }}>
      <div className="w-full max-w-md rounded-3xl p-6" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="text-center">
          <div style={{ fontSize: 34 }}>👋</div>
          <h2 className="font-display tracking-wide mt-1" style={{ fontSize: 22, color: "#fff" }}>CHOOSE YOUR DISPLAY NAME</h2>
          <p className="font-body mt-2" style={{ fontSize: 13.5, color: "#9a9ab0", lineHeight: 1.5 }}>
            This is how you appear to others on YourScore — leaderboards, leagues and shared cards. Use a nickname if you&apos;d rather not show your full name.
          </p>
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 30))}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Your display name"
          className="w-full mt-5 rounded-xl px-4 py-3 font-body text-white outline-none"
          style={{ background: "#0a0a0f", border: "1px solid rgba(255,255,255,0.14)", fontSize: 16 }}
        />
        <button onClick={save} disabled={saving || !value.trim()}
          className="w-full mt-3 rounded-2xl py-3.5 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-50"
          style={{ background: "#aeea00", color: "#0a0a0f", fontSize: 17 }}>
          {saving ? "SAVING…" : "SAVE"}
        </button>
        <button onClick={dismiss} className="w-full mt-2 font-body" style={{ fontSize: 13, color: "#8888aa" }}>
          Keep my current name
        </button>
      </div>
    </div>
  );
}
