"use client";

/**
 * Native-only "update for notifications" nudge. Push only works from iOS build
 * 1.0.2 (7) onward (the AppDelegate APNs-forwarding fix), so anyone on an older
 * installed build can't receive ANY push until they update. This floats a
 * dismissible banner pointing them at the latest App Store build — the highest-
 * leverage way to grow the opted-in/token audience as 1.0.2 rolls out.
 *
 * Hidden when: not native, App Store URL not configured, already on a
 * push-capable build, no newer build is live on the App Store yet, or dismissed
 * this session. Mirrors AppStoreBanner (the
 * web "download" banner) in placement + styling; the two never coexist (one is
 * web-only, the other native-only).
 */

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";

const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL;
const DISMISS_KEY = "ys:update-banner:dismissed";

// First iOS build with working push (AppDelegate APNs forwarding). Bump these
// if a later fix raises the floor.
const MIN_VERSION = "1.0.2";
const MIN_BUILD = 7;

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function needsUpdate(version: string, build: string): boolean {
  const c = cmpVersion(version, MIN_VERSION);
  if (c < 0) return true; // older version
  if (c > 0) return false; // newer version
  return (parseInt(build, 10) || 0) < MIN_BUILD; // same version, older build
}

export function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!IOS_APP_URL || !isNative()) return;
    try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch { /* ignore */ }
    let cancelled = false;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        if (cancelled) return;
        // Only nudge users who don't yet have working push.
        if (!needsUpdate(info.version, info.build)) return;
        // ...and only when a newer build actually exists on the App Store, so we
        // never dead-end them on "Update" before the new version is approved.
        const res = await fetch("/api/ios-version");
        const { version: storeVersion } = (await res.json()) as { version: string | null };
        if (cancelled || !storeVersion) return;
        if (cmpVersion(storeVersion, info.version) > 0) setShow(true);
      } catch { /* network/getInfo failure → don't nag */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  function dismiss(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  }

  return (
    <div className="fixed left-0 right-0 z-[55] px-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)", pointerEvents: "none" }}>
      <div className="max-w-lg mx-auto flex items-center gap-3 rounded-2xl px-3 py-2.5"
        style={{ background: "rgba(18,18,30,0.97)", border: "1px solid rgba(174,234,0,0.4)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", pointerEvents: "auto" }}>
        <div className="flex-shrink-0 flex items-center justify-center rounded-xl" style={{ width: 38, height: 38, background: "rgba(174,234,0,0.15)" }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#aeea00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-body text-sm font-bold text-white leading-tight">Turn on notifications</div>
          <div className="font-body text-xs leading-tight" style={{ color: "#8a948f" }}>Update to get pinged the moment the daily Mastermind drops.</div>
        </div>
        <a href={IOS_APP_URL} target="_blank" rel="noopener noreferrer"
          className="flex-shrink-0 flex items-center rounded-xl px-3 py-2 font-body text-xs font-bold active:scale-[0.97] transition-transform"
          style={{ background: "#aeea00", color: "#0a0a0f" }}>
          Update
        </a>
        <button onClick={dismiss} aria-label="Dismiss"
          className="flex-shrink-0 flex items-center justify-center" style={{ width: 22, height: 22, color: "#8a948f", fontSize: 20, lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}
