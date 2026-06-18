"use client";

/**
 * Persistent "Download on the App Store" banner for Apple-device visitors on the WEB.
 * Shows site-wide so iOS users always have the app a tap away. Hidden when:
 *  - not an Apple device (Android badge will be added once we're live on Google Play),
 *  - already inside the native app (isNative),
 *  - NEXT_PUBLIC_IOS_APP_URL isn't configured,
 *  - dismissed this session.
 * Floats above the bottom nav so it never covers it. Tapping fires the Download
 * (app-install intent) conversion via trackDownload, then opens the App Store.
 */

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { trackDownload } from "@/lib/analytics/trackGame";

const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL;
const DISMISS_KEY = "ys:appstore-banner:dismissed";

function isAppleDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as "Macintosh"; distinguish a touch iPad from a desktop Mac.
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

function AppleLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.36 12.78c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.75 2.28-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.29 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.12 2.78-2.23.88-1.28 1.24-2.52 1.26-2.58-.03-.01-2.41-.93-2.43-3.69M14.1 5.6c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.68 1.37-.59.67-1.1 1.76-.96 2.79 1.02.08 2.06-.52 2.7-1.26"/>
    </svg>
  );
}

export function AppStoreBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!IOS_APP_URL) return;
    if (isNative()) return;
    if (!isAppleDevice()) return;
    try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch { /* ignore */ }
    setShow(true);
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
        style={{ background: "rgba(18,18,30,0.97)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", pointerEvents: "auto" }}>
        <div className="flex-shrink-0 flex items-center justify-center rounded-xl" style={{ width: 38, height: 38, background: "#aeea00" }}>
          <span className="font-display" style={{ fontSize: 18, color: "#0a0a0f" }}>Y</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-body text-sm font-bold text-white leading-tight">Get YourScore</div>
          <div className="font-body text-xs leading-tight" style={{ color: "#8a948f" }}>Faster, with notifications when it&apos;s your turn.</div>
        </div>
        <a href={IOS_APP_URL} target="_blank" rel="noopener noreferrer"
          onClick={() => trackDownload({ source: "ios-banner" })}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 font-body text-xs font-bold active:scale-[0.97] transition-transform"
          style={{ background: "#fff", color: "#0a0a0f" }}>
          <AppleLogo /> App Store
        </a>
        <button onClick={dismiss} aria-label="Dismiss"
          className="flex-shrink-0 flex items-center justify-center" style={{ width: 22, height: 22, color: "#8a948f", fontSize: 20, lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}
