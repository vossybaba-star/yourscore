"use client";

import { useEffect } from "react";

const KEY = "ys:acq";

// Map a utm_source (preferred) or referrer domain to a coarse platform label,
// so `source` is a clean, groupable value (x / meta / tiktok / google / …).
function classify(utmSource: string, referrer: string): string {
  const s = utmSource.toLowerCase();
  if (s) {
    if (s === "x" || s.includes("twitter")) return "x";
    if (s.includes("facebook") || s.includes("instagram") || s.includes("meta") || s === "fb" || s === "ig") return "meta";
    if (s.includes("tiktok")) return "tiktok";
    if (s.includes("google")) return "google";
    if (s.includes("snap")) return "snapchat";
    if (s.includes("reddit")) return "reddit";
    return s; // keep whatever the campaign tagged
  }
  const r = referrer.toLowerCase();
  if (!r) return "";
  if (r.includes("t.co") || r.includes("twitter") || r.includes("//x.com")) return "x";
  if (r.includes("facebook") || r.includes("instagram") || r.includes("fb.")) return "meta";
  if (r.includes("tiktok")) return "tiktok";
  if (r.includes("google")) return "google";
  if (r.includes("reddit")) return "reddit";
  return "referral";
}

/**
 * First-touch acquisition capture. On the first page a visitor lands on, stash
 * the UTM params + external referrer in localStorage — only when there's real
 * signal, and only once (first touch wins). `SignupPixel` reads this at
 * registration and persists it to the user's profile, so retained players can
 * be attributed to the platform/campaign that acquired them. Never overwrites.
 */
export function AcquisitionCapture() {
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return; // first touch already captured

      const p = new URLSearchParams(window.location.search);
      const utm_source = p.get("utm_source") ?? "";
      const utm_medium = p.get("utm_medium") ?? "";
      const utm_campaign = p.get("utm_campaign") ?? "";
      // Ignore our own domain as a referrer (internal navigation ≠ acquisition).
      const rawRef = document.referrer ?? "";
      const referrer = rawRef.includes("yourscore.app") ? "" : rawRef;

      const source = classify(utm_source, referrer);
      if (!source && !utm_source) return; // no signal — let a later visit win

      localStorage.setItem(
        KEY,
        JSON.stringify({ source, utm_source, utm_medium, utm_campaign, referrer }),
      );
    } catch {
      /* storage blocked — skip capture */
    }
  }, []);

  return null;
}
