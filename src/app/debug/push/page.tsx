"use client";

// Diagnostic for "the app-open opt-in prompt isn't showing". Reports the exact
// value of every gate PushPrePrompt checks, read on THIS device. A fresh route,
// so it's never served from a stale WebView cache. Safe to leave in prod.

import { useEffect, useState } from "react";
import { isNative, platform } from "@/lib/native";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { hasPromptedPush } from "@/lib/onboarding";

export default function PushDebug() {
  const { user, loading } = useUser();
  const [rawFlag, setRawFlag] = useState<string>("(reading…)");
  const [native, setNative] = useState<string>("(reading…)");
  const [plat, setPlat] = useState<string>("");
  const [prompted, setPrompted] = useState<string>("");
  const [optIn, setOptIn] = useState<string>("(not checked)");

  useEffect(() => {
    try { setNative(String(isNative())); } catch (e) { setNative("threw: " + String(e)); }
    try { setPlat(platform()); } catch { setPlat("?"); }
    try { setPrompted(String(hasPromptedPush())); } catch (e) { setPrompted("threw: " + String(e)); }
    try { setRawFlag(JSON.stringify(localStorage.getItem("yourscore:push-prompted:v1"))); }
    catch (e) { setRawFlag("localStorage THREW: " + String(e)); }
  }, []);

  useEffect(() => {
    if (!user) return;
    createClient().from("profiles").select("notifications_opt_in").eq("id", user.id).single()
      .then(({ data, error }) => setOptIn(error ? "error: " + error.message : String(data?.notifications_opt_in)));
  }, [user]);

  // The exact condition that makes the prompt SHOW.
  const wouldShow =
    native === "true" && prompted === "false" && !loading && !!user && optIn !== "true";

  const Row = ({ k, v, bad }: { k: string; v: string; bad?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #222" }}>
      <span style={{ color: "#8a8a9e" }}>{k}</span>
      <span style={{ color: bad ? "#ff4757" : "#aeea00", fontWeight: 600, textAlign: "right", maxWidth: "60%", wordBreak: "break-all" }}>{v}</span>
    </div>
  );

  function reset() {
    try { localStorage.removeItem("yourscore:push-prompted:v1"); } catch {}
    location.href = "/";
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0f", color: "#fff", padding: "60px 22px 40px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Push prompt — gate check</h1>
      <p style={{ color: "#8a8a9e", fontSize: 13, margin: "0 0 22px" }}>Each line is a gate PushPrePrompt checks. Red = the gate that&apos;s blocking it.</p>

      <Row k="isNative()" v={native} bad={native !== "true"} />
      <Row k="platform()" v={plat} />
      <Row k="useUser loading" v={String(loading)} bad={loading} />
      <Row k="signed in (user)" v={user ? "yes · " + user.id.slice(0, 8) + "…" : "NO"} bad={!user} />
      <Row k="hasPromptedPush()" v={prompted} bad={prompted !== "false"} />
      <Row k="raw push flag" v={rawFlag} />
      <Row k="notifications_opt_in" v={optIn} bad={optIn === "true"} />

      <div style={{ marginTop: 26, padding: 16, borderRadius: 14, background: wouldShow ? "rgba(174,234,0,0.12)" : "rgba(255,71,87,0.12)", border: `1px solid ${wouldShow ? "rgba(174,234,0,0.4)" : "rgba(255,71,87,0.4)"}` }}>
        <div style={{ fontSize: 13, color: "#8a8a9e" }}>Should the prompt show on this device?</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: wouldShow ? "#aeea00" : "#ff4757" }}>{wouldShow ? "YES" : "NO"}</div>
      </div>

      <button onClick={reset} style={{ marginTop: 22, width: "100%", padding: 16, borderRadius: 12, background: "#aeea00", color: "#0a0a0f", fontWeight: 700, fontSize: 15, border: 0 }}>
        Clear the flag & go home (re-trigger the prompt)
      </button>
    </div>
  );
}
