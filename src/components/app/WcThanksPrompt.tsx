"use client";

/**
 * WC Thanks — a one-time thank-you for the 198-user World Cup Mastermind
 * cohort seeded in migration 100 (played more than 10 ranked days). Two
 * asks, in order, each fired once and never re-armed:
 *   1. "What would you like to see on YourScore?" — free-text feedback.
 *   2. An App Store review ask, deferred until the user has scrolled around
 *      a bit post-feedback (never fired on a cold landing).
 * Mirrors ClubPrompt (modal shape, pathname suppression, dev preview) and
 * AppMomentPrompt (native-review-first-then-card, isAppleMobile UA check).
 * Self-hides: signed out, not in the cohort, or both steps already done.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { isNative } from "@/lib/native";
import { APP_STORE_REVIEW_URL } from "@/lib/appStore";

const LIME = "#aeea00";
const SCROLL_THRESHOLD = 600; // cumulative px before the review ask can fire

type Stage = "feedback" | "review" | null;

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

// Apple's inline star popup, guarded so a build predating the plugin just
// reports back that it didn't fire instead of throwing. See AppMomentPrompt.
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

async function postAction(body: { action: string; body?: string }): Promise<void> {
  try {
    await fetch("/api/wc-thanks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // best-effort — nothing to recover here, worst case it's asked again
  }
}

export function WcThanksPrompt() {
  const pathname = usePathname();
  const { user, loading: userLoading } = useUser();

  const [stage, setStage] = useState<Stage>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [thanks, setThanks] = useState(false);

  const [scrolledEnough, setScrolledEnough] = useState(false);
  const [reviewCard, setReviewCard] = useState(false);

  const fetchedRef = useRef(false);
  const reviewFiredRef = useRef(false);
  const scrollAccumRef = useRef(0);
  const lastScrollYRef = useRef(0);

  /**
   * DEV-ONLY: `?preview=wc-thanks` renders the feedback modal as the cohort
   * would see it; `?preview=wc-review` renders the App Store review card.
   * Compiled out of production; nothing is ever written.
   */
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p === "wc-thanks") setPreview(true);
    if (p === "wc-review") { setPreview(true); setStage("review"); setReviewCard(true); }
  }, []);

  // One GET, once, for a signed-in user — no network at all while signed out.
  useEffect(() => {
    if (preview || fetchedRef.current) return;
    if (userLoading || !user) return;
    fetchedRef.current = true;
    fetch("/api/wc-thanks", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setStage((j as { stage: Stage }).stage))
      .catch(() => {
        // transient network error — stays hidden, tries again next visit
      });
  }, [preview, userLoading, user]);

  // Never over the auth screens or Settings — same exclusions as ClubPrompt.
  const suppressed = pathname?.startsWith("/auth") || pathname?.startsWith("/settings");

  async function submitFeedback(withBody: boolean) {
    if (preview) {
      setStage("review");
      return;
    }
    setPosting(true);
    const trimmed = text.trim();
    await postAction(
      withBody && trimmed ? { action: "feedback", body: trimmed } : { action: "feedback" }
    );
    setPosting(false);
    if (withBody && trimmed) {
      setThanks(true);
      setTimeout(() => {
        setThanks(false);
        setStage("review");
      }, 1200);
    } else {
      setStage("review");
    }
  }

  // Review stage: wait for real engagement (scroll) before asking anything.
  useEffect(() => {
    if (stage !== "review" || preview || typeof window === "undefined") return;
    lastScrollYRef.current = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      scrollAccumRef.current += Math.abs(y - lastScrollYRef.current);
      lastScrollYRef.current = y;
      if (scrollAccumRef.current >= SCROLL_THRESHOLD) {
        setScrolledEnough(true);
        window.removeEventListener("scroll", onScroll);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [stage, preview]);

  useEffect(() => {
    if (!scrolledEnough || reviewFiredRef.current || preview) return;
    reviewFiredRef.current = true;
    (async () => {
      let shown = false;
      if (isNative()) {
        const fired = await fireNativeReview();
        if (!fired) setReviewCard(true);
        shown = true;
      } else if (isAppleMobile()) {
        setReviewCard(true);
        shown = true;
      }
      // Desktop web can't leave an App Store review — leave the ask
      // UNSTAMPED so it still fires on a future phone visit. Only an
      // actually-shown ask consumes the once-ever.
      if (shown) await postAction({ action: "review" });
    })();
  }, [scrolledEnough, preview]);

  if (!preview) {
    if (!user || suppressed) return null;
  }

  if ((stage === "feedback" || preview) && stage !== "review") {
    return (
      <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.72)" }}>
        <div
          className="w-full max-w-md rounded-3xl overflow-hidden mb-4 sm:mb-0"
          style={{ background: "#12121a", border: `1px solid ${LIME}38` }}
        >
          {thanks ? (
            <div className="px-5 py-10 text-center">
              <p className="font-display text-white" style={{ fontSize: 26, letterSpacing: "-0.015em" }}>
                Thanks — noted.
              </p>
            </div>
          ) : (
            <>
              <div className="px-5 pt-5 pb-4">
                <p className="font-display text-[10px] tracking-widest mb-2" style={{ color: LIME }}>
                  WORLD CUP MASTERMIND
                </p>
                <p className="font-display text-white" style={{ fontSize: 28, lineHeight: 1.05, letterSpacing: "-0.015em" }}>
                  What would you like to see on <span style={{ color: LIME }}>YourScore</span>?
                </p>
                <p className="font-body text-sm mt-2" style={{ color: "#8a8a94" }}>
                  You played the whole World Cup with us. New games, features, anything — you tell us, we build it.
                </p>
              </div>

              <div className="px-5 pb-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={2000}
                  placeholder="I'd love to see…"
                  disabled={posting}
                  rows={4}
                  className="w-full rounded-xl px-3.5 py-3 font-body text-sm text-white resize-none outline-none"
                  style={{ background: "#1a1a24", border: "1px solid rgba(255,255,255,0.08)" }}
                />
              </div>

              <div className="px-5 pb-5">
                <button
                  onClick={() => submitFeedback(true)}
                  disabled={posting || !text.trim()}
                  className="w-full rounded-xl py-3 font-display text-sm tracking-wide transition-opacity"
                  style={{ background: LIME, color: "#0a0a0f", opacity: posting || !text.trim() ? 0.5 : 1 }}
                >
                  {posting ? "Sending…" : "Send it"}
                </button>
                <button
                  onClick={() => submitFeedback(false)}
                  disabled={posting}
                  className="w-full mt-2.5 py-2 font-body text-xs"
                  style={{ color: "#63636f" }}
                >
                  Maybe later
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (reviewCard) {
    return (
      <div className="fixed left-4 right-4 bottom-4 z-[90] mx-auto max-w-md rounded-2xl p-4" style={{ background: "#12121a", border: `1px solid ${LIME}38` }}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm tracking-wide text-white leading-tight">Enjoying YourScore?</p>
            <p className="font-body text-xs mt-1 leading-relaxed" style={{ color: "#8a8a94" }}>
              Leave us a review on the App Store.
            </p>
          </div>
          <button
            onClick={() => setReviewCard(false)}
            aria-label="Dismiss"
            className="font-body text-sm px-1"
            style={{ color: "#63636f" }}
          >
            ✕
          </button>
        </div>
        <a
          href={APP_STORE_REVIEW_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setReviewCard(false)}
          className="block w-full text-center rounded-xl py-2.5 mt-3 font-display text-sm tracking-widest"
          style={{ background: LIME, color: "#0a0a0f" }}
        >
          Rate YourScore
        </a>
      </div>
    );
  }

  return null;
}
