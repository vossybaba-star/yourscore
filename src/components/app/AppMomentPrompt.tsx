"use client";

/**
 * AppMomentPrompt — the right ask at the right moment, fired only after a GOOD
 * game (the player gained points), so it lands when they've just had a positive
 * experience. Two mutually-exclusive asks, by surface:
 *   • Native app user  → ask them to RATE YourScore on the App Store.
 *   • Web on an iPhone → nudge them to DOWNLOAD the app.
 * (Web non-Apple / desktop → nothing.)
 *
 * Frequency-gated per device so we ask sparingly. Renders nothing unless it's a
 * good moment AND the cooldown has passed.
 *
 * Upgrade path: for the native rate ask we currently open the App Store review
 * page (works in the live build, opt-in tap). Adding @capacitor-community/
 * in-app-review in a future native build lets us swap this for the in-app star
 * popup (SKStoreReviewController) — see requestRate().
 */

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";

const APP_STORE_URL = "https://apps.apple.com/gb/app/yourscore/id6773626424";
const REVIEW_URL = "https://apps.apple.com/app/id6773626424?action=write-review";

const RATE_KEY = "ys:rate-prompt:v1";
const DL_KEY = "ys:dl-prompt:v1";
const RATE_COOLDOWN = 45 * 86_400_000; // ask to rate at most every ~45 days
const DL_COOLDOWN = 7 * 86_400_000; // nudge a download at most weekly

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as "Macintosh"; a touch iPad still counts.
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

function recently(key: string, cooldownMs: number): boolean {
  try { return Date.now() - Number(localStorage.getItem(key) || 0) < cooldownMs; }
  catch { return true; } // storage blocked → fail closed (don't nag)
}
function stamp(key: string): void {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
}

// Fire Apple's inline review popup (SKStoreReviewController) via the native
// plugin. Guarded with isPluginAvailable so a build that predates the plugin
// (i.e. the current live one, until the next rebuild) doesn't throw — it just
// reports back that it didn't fire, and we fall back to the soft card.
// Returns whether the native popup was shown.
async function fireNativeReview(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isPluginAvailable("InAppReview")) return false;
    const { InAppReview } = await import("@capacitor-community/in-app-review");
    await InAppReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
function openReviewPage(): void {
  try { window.open(REVIEW_URL, "_blank", "noopener"); } catch { /* ignore */ }
}

export function AppMomentPrompt({ success }: { success: boolean }) {
  const [mode, setMode] = useState<null | "rate" | "download">(null);

  useEffect(() => {
    if (!success) return;
    let cancelled = false;
    if (isNative()) {
      if (recently(RATE_KEY, RATE_COOLDOWN)) return;
      stamp(RATE_KEY); // asked once — respect the cooldown whether native popup or card
      // Prefer Apple's inline star popup; if this build predates the plugin,
      // fall back to a soft card that links to the review page.
      fireNativeReview().then((fired) => { if (!fired && !cancelled) setMode("rate"); });
    } else if (isAppleMobile()) {
      if (recently(DL_KEY, DL_COOLDOWN)) return;
      stamp(DL_KEY);
      setMode("download");
    }
    return () => { cancelled = true; };
  }, [success]);

  if (!mode) return null;

  const rate = mode === "rate";
  const key = rate ? RATE_KEY : DL_KEY;

  function act() { stamp(key); }
  function dismiss(e: React.MouseEvent) { e.preventDefault(); e.stopPropagation(); stamp(key); setMode(null); }

  return (
    <div className="rounded-2xl p-4 mt-3" style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.12), rgba(10,10,15,0.5))", border: "1px solid rgba(174,234,0,0.35)" }}>
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 40, height: 40, background: "rgba(174,234,0,0.18)" }}>
          <span className="text-lg" aria-hidden>{rate ? "⭐" : "📲"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base tracking-wide text-white leading-tight">
            {rate ? "Enjoying YourScore?" : "Get the app"}
          </p>
          <p className="font-body text-xs text-text-muted mt-1 leading-relaxed">
            {rate
              ? "A quick rating on the App Store genuinely helps us out — takes 10 seconds."
              : "Faster, full-screen, and notifications when it's your turn."}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        {rate ? (
          <button onClick={() => { act(); openReviewPage(); }}
            className="flex-1 text-center rounded-xl py-2.5 font-display text-sm tracking-widest active:scale-[0.97] transition-transform"
            style={{ background: "#aeea00", color: "#0a0a0f" }}>
            Rate us ⭐
          </button>
        ) : (
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={act}
            className="flex-1 text-center rounded-xl py-2.5 font-display text-sm tracking-widest active:scale-[0.97] transition-transform"
            style={{ background: "#aeea00", color: "#0a0a0f" }}>
            Download
          </a>
        )}
        <button onClick={dismiss}
          className="rounded-xl py-2.5 px-4 font-body text-sm text-text-muted hover:text-white transition-colors">
          Not now
        </button>
      </div>
    </div>
  );
}
