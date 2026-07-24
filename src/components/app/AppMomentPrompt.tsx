"use client";

/**
 * AppMomentPrompt — the right ask at the right moment, shown when a player
 * finishes a Game. Two mutually-exclusive asks, by surface:
 *   • Native app user  → ask them to RATE YourScore on the App Store.
 *   • Web on an iPhone → nudge them to DOWNLOAD the app.
 * (Web non-Apple / desktop → nothing.)
 *
 * It used to fire only after a WIN (points gained), gated on a localStorage
 * stamp with a 45-day cooldown. Both are gone:
 *
 *   • Any finished Game counts now. Requiring a win skipped anyone having a bad
 *     run, and — because "gained" needs a prior on-device rank snapshot — it
 *     could never fire on a returning player's first Game back on a new phone,
 *     which is exactly who we most want to ask.
 *
 *   • Eligibility is decided server-side (/api/review-prompt) and every ask
 *     SHOWN is recorded. A device stamp left no trace and reset on reinstall,
 *     so we could not count our own asks at all.
 *
 * The rating ask is ALWAYS our own card, never Apple's native star popup. The
 * popup converts better, but Apple never reports who rated through it, so a
 * player who rated would be asked forever. A tap on our card is observable, so
 * "once they rate we stop" is a promise we can actually keep. The server owns
 * the schedule; see /api/review-prompt.
 */

import { useEffect, useRef, useState } from "react";
import { isNative } from "@/lib/native";

// Links live in lib/appStore so the server-side halftime email can share them.
import { APP_STORE_URL, APP_STORE_REVIEW_URL as REVIEW_URL } from "@/lib/appStore";

const DL_KEY = "ys:dl-prompt:v1";
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

function openReviewPage(): void {
  try { window.open(REVIEW_URL, "_blank", "noopener"); } catch { /* ignore */ }
}

async function logShown(variant: string): Promise<string | null> {
  try {
    const res = await fetch("/api/review-prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface: "post-game", variant }),
    });
    const { id } = (await res.json()) as { id?: string };
    return id ?? null;
  } catch {
    return null; // best-effort — a missed log must never break a game-end screen
  }
}

function logOutcome(id: string | null, outcome: "acted" | "dismissed"): void {
  if (!id) return;
  try {
    void fetch("/api/review-prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, outcome }),
    });
  } catch { /* ignore */ }
}

export function AppMomentPrompt() {
  const [mode, setMode] = useState<null | "rate" | "download">(null);
  const promptIdRef = useRef<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    let cancelled = false;

    (async () => {
      if (isNative()) {
        // Server owns the whole schedule and the record.
        let decision: { ask?: boolean } = {};
        try {
          decision = await (await fetch("/api/review-prompt")).json();
        } catch {
          return; // offline or signed out — say nothing
        }
        if (!decision.ask || cancelled) return;

        promptIdRef.current = await logShown("card");
        if (!cancelled) setMode("rate");
        return;
      }

      if (isAppleMobile()) {
        // The download nudge keeps its light device-local cooldown — it isn't a
        // review ask and Apple's cap doesn't apply — but it's logged now so the
        // whole prompt surface is countable.
        if (recently(DL_KEY, DL_COOLDOWN)) return;
        stamp(DL_KEY);
        promptIdRef.current = await logShown("download");
        if (!cancelled) setMode("download");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (!mode) return null;

  const rate = mode === "rate";

  function act() {
    if (!rate) stamp(DL_KEY);
    logOutcome(promptIdRef.current, "acted");
  }
  function dismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!rate) stamp(DL_KEY);
    logOutcome(promptIdRef.current, "dismissed");
    setMode(null);
  }

  return (
    <div className="rounded-2xl p-4 mt-3" style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.12), rgba(10,10,15,0.5))", border: "1px solid rgba(174,234,0,0.35)" }}>
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 40, height: 40, background: "rgba(174,234,0,0.18)" }}>
          <span className="text-lg" aria-hidden>{rate ? "⭐" : "📲"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base tracking-wide text-white leading-tight">
            {rate ? "Help us before the Premier League starts" : "Get the app"}
          </p>
          <p className="font-body text-xs text-text-muted mt-1 leading-relaxed">
            {rate
              ? "We'd really appreciate a rating. It puts YourScore in front of more football fans, and more players means better competition for you."
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
