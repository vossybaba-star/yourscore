"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { hasSeenTip, markTipSeen, resetTips, tourEligible } from "@/lib/tips";

interface Step {
  route: string;
  selectors: string[];
  title: string;
  body: string;
  /** Only shown to a signed-in user — guests are never navigated to /profile,
   *  which would just bounce them off the sign-in redirect. */
  signedInOnly?: boolean;
  /** Bottom-nav href to put a pulsing beacon on ("the tab you're talking
   *  about"), resolved against the real rendered nav regardless of which
   *  BottomNav variant (guest/signed-in) is showing. */
  navHref?: string;
}

// Real content this build actually renders, tagged with data-tour in the
// pages themselves (GamesNav, versus/page, matchweek/page, profile/page,
// play/page's featured tile). The final step targets today's featured quiz
// directly, falling back to the games row if it isn't rendered — by the time
// it's reached the tour is already on /play, so "Let's go" ends the tour
// without a further navigation.
const STEPS: Step[] = [
  {
    route: "/play",
    selectors: ['[data-tour="games"]'],
    navHref: "/play",
    title: "The Play tab",
    body: "This is the Play tab — every game lives here. Quiz, 38-0, Perfect 10, Higher or Lower and Guess the Player. Switch games from the top row.",
  },
  {
    // Both audiences see the REAL action cards: signed-in gets the live ones,
    // guests get the same cards in the /versus preview (taps route to
    // sign-in) — both carry data-tour="versus-actions".
    route: "/versus",
    selectors: ['[data-tour="versus-actions"]'],
    navHref: "/versus",
    title: "Versus",
    body: "This is where you play your friends — send a challenge in any game, winner takes the bragging rights.",
  },
  {
    route: "/matchweek",
    selectors: ['[data-tour="pl-sections"]'],
    navHref: "/matchweek",
    title: "Premier League",
    body: "Your PL week in one place — fixtures, the live table, and halftime quizzes while the matches are on.",
  },
  {
    route: "/profile",
    selectors: ['[data-tour="rank"]'],
    navHref: "/profile",
    title: "Your rank",
    body: "Every game feeds your score. This is where you climb.",
    signedInOnly: true,
  },
  {
    // Ends on Home at the Today's Game hero — both audiences render it
    // (Dashboard for signed-in, MarketingLanding's acquisition surface for
    // guests), so "Let's go" leaves them one tap from today's game.
    route: "/",
    selectors: ['[data-tour="todays-game"]'],
    navHref: "/",
    title: "Start here",
    body: "Today's game is live — play it now and set your first score.",
  },
];

// Only fire on top-level hub pages. The nav also renders on deep surfaces (a
// pack mid-play, a lobby) where a takeover overlay would interrupt a game —
// there the tour just waits for the user's next hub visit.
const HUB_PATHS = new Set(["/", "/play", "/versus", "/38-0", "/matchweek", "/profile"]);
const MOUNT_DELAY_MS = 600; // let the page's own entrance layout settle before the first spotlight
const TARGET_WAIT_MS = 3000; // give a step this long to find its target before silently skipping
const POLL_MS = 100;
const SPOTLIGHT_PAD = 8;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function findTarget(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

// The nav renders one of two variants (guest/signed-in) from BottomNav, but
// both share the same fixed-bottom container and both carry a real <a href>
// for every tab a given step cares about (guests just don't have /profile —
// that step is signedInOnly, so it never looks for a guest-nav match).
function findNavTarget(navHref?: string): HTMLElement | null {
  if (!navHref) return null;
  return document.querySelector<HTMLElement>(`.fixed.bottom-0.left-0.right-0.z-50 a[href="${navHref}"]`);
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

// First-launch guided tour: navigates the real app (next/navigation) and
// spotlights the real, already-rendered content on each page — not a fake
// walkthrough of static copy. Mounted once in the root layout so it survives
// route changes instead of dying with whatever nav component happened to
// render it.
export function SpotlightTour() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useUser();

  const [active, setActive] = useState(false);
  const [stepList, setStepList] = useState<Step[]>([]);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null); // null while navigating/waiting for the target
  const [beaconRect, setBeaconRect] = useState<Rect | null>(null); // the nav tab the step is "talking about"
  const forcedRef = useRef(false);
  const startedRef = useRef(false); // arms at most once per mount (once per app session)
  const runIdRef = useRef(0); // invalidates in-flight seek/poll loops on Skip/Next/finish
  const lastAutoScrollRef = useRef(0); // throttles pull-back scrolls when a target leaves the viewport

  // Dev QA helper — wired unconditionally (not gated on eligibility) so a dev
  // whose flag is already set can still call it to replay the tour.
  // Non-production only.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as { __resetTips?: () => void }).__resetTips = resetTips;
    }
  }, []);

  const finish = useCallback(() => {
    runIdRef.current++; // abort any in-flight poll
    if (!forcedRef.current) markTipSeen("app-tour");
    setActive(false);
    setRect(null);
    setBeaconRect(null);
  }, []);

  // Skip: same as finish but semantically distinct (Escape maps here too) —
  // both end the tour without a further navigation, staying on whatever
  // page the user reached.
  const skip = finish;

  // Navigate to (if needed) and poll for a step's target, up to TARGET_WAIT_MS.
  // Found → scrollIntoView, settle, measure, show. Not found in time → skip
  // this step silently and recurse into the next one. Each call bumps
  // runIdRef so a superseding Next/Skip/finish invalidates any older loop.
  const seek = useCallback(
    (list: Step[], stepIndex: number) => {
      if (stepIndex >= list.length) {
        finish();
        return;
      }
      const step = list[stepIndex];
      const myRun = ++runIdRef.current;
      setIdx(stepIndex);
      setRect(null); // dimmed "…" state until the target is found
      setBeaconRect(null);

      if (window.location.pathname !== step.route) {
        router.push(step.route);
      }

      const deadline = Date.now() + TARGET_WAIT_MS;

      const poll = () => {
        if (runIdRef.current !== myRun) return; // superseded — abandon this loop
        const el = findTarget(step.selectors);
        if (el) {
          // "auto" (instant), never "smooth": smooth programmatic scrolls
          // silently no-op in some webviews/automation contexts, leaving the
          // spotlight measuring an off-screen target. The overlay dim + the
          // spotlight's own 0.25s transition carry the polish instead.
          el.scrollIntoView({ block: "center", behavior: "auto" });
          window.setTimeout(() => {
            if (runIdRef.current !== myRun) return;
            setRect(rectOf(el));
            const navEl = findNavTarget(step.navHref);
            setBeaconRect(navEl ? rectOf(navEl) : null);
          }, 350);
          return;
        }
        if (Date.now() >= deadline) {
          seek(list, stepIndex + 1); // silent skip
          return;
        }
        window.setTimeout(poll, POLL_MS);
      };
      poll();
    },
    [router, finish]
  );

  // Arm: once auth has resolved and we're on a hub page, decide whether to
  // start. Fires at most once per mount — the tour doesn't re-arm on a later
  // hub visit within the same app session, whether it finished, was
  // skipped, or the gate simply failed.
  useEffect(() => {
    if (startedRef.current || loading) return;
    if (!HUB_PATHS.has(pathname)) return;

    const isForced = new URLSearchParams(window.location.search).get("tour") === "1";
    // New-users-only gate: post-epoch accounts, or fresh native installs —
    // never current customers (see tourEligible in lib/tips).
    const eligible = isForced || (tourEligible(user) && !hasSeenTip("app-tour"));
    if (!eligible) return;

    startedRef.current = true;
    forcedRef.current = isForced;
    setStepList(STEPS.filter((s) => !s.signedInOnly || Boolean(user)));

    const t = window.setTimeout(() => setActive(true), MOUNT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [loading, pathname, user]);

  // Kick off step 0 once armed.
  useEffect(() => {
    if (!active) return;
    seek(stepList, 0);
    // Only re-run when the tour actually engages — stepList/seek are stable
    // for the lifetime of a single tour run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Escape ends the tour, same as Skip.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, skip]);

  // Track the current target (and its nav beacon) while showing: late-loading
  // content (feed images, fonts) shifts layout AFTER the initial measure, and
  // a rotation/resize moves everything — so keep re-measuring on a short
  // interval and follow the element. The 0.25s transition turns corrections
  // into glides.
  useEffect(() => {
    if (!active || !rect) return;
    const step = stepList[idx];
    const remeasure = () => {
      const el = findTarget(step.selectors);
      if (!el) {
        // The target vanished from under us (route changed, content
        // unmounted) rather than just moving — e.g. a fallback selector that
        // only ever matched a transient DOM from the page we navigated away
        // from. Re-running seek for this same step re-navigates if needed
        // and gives it a fresh TARGET_WAIT_MS before silently advancing, the
        // same recovery the very first search gets — instead of leaving a
        // spotlight glued to a stale, now-meaningless rect. seek() clears
        // rect synchronously, which flips this effect's `rect === null` dep
        // and tears the interval down before it can fire again.
        seek(stepList, idx);
        return;
      }
      const next = rectOf(el);
      // The page can scroll the target fully out of view after our initial
      // scrollIntoView (e.g. a landing page resetting scroll on hydration) —
      // a spotlight the user can't see is a broken step, so pull it back.
      // Throttled so it can't fight a user actively scrolling mid-step.
      const outOfView = next.top > window.innerHeight || next.top + next.height < 0;
      if (outOfView && Date.now() - lastAutoScrollRef.current > 1500) {
        lastAutoScrollRef.current = Date.now();
        el.scrollIntoView({ block: "center", behavior: "auto" }); // instant on purpose — see seek()
      }
      setRect((cur) => (cur && sameRect(cur, next) ? cur : next));
      const navEl = findNavTarget(step.navHref);
      if (navEl) {
        const nextBeacon = rectOf(navEl);
        setBeaconRect((cur) => (cur && sameRect(cur, nextBeacon) ? cur : nextBeacon));
      } else {
        setBeaconRect(null);
      }
    };
    const t = window.setInterval(remeasure, 250);
    window.addEventListener("resize", remeasure);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", remeasure);
    };
    // rect is deliberately NOT a dep — the interval re-arms per step, not per
    // measurement (that would tear down/recreate it 4x a second).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx, stepList, rect === null]);

  if (!active) return null;
  const step = stepList[idx];
  if (!step) return null;

  const reduced = reducedMotion();
  const isLast = idx === stepList.length - 1;

  // Spotlight box-shadow trick makes the giant shadow itself the dimmed
  // backdrop, leaving only the boxed-out target undimmed. Before a target is
  // found, dim the whole screen instead — no flash of undimmed app while
  // navigating/waiting.
  const spotlightStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
        borderRadius: 14,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
        transition: reduced ? "none" : "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
      }
    : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)" };

  // Tooltip flips sides based on which half of the viewport the target sits
  // in, so it's never pushed off-screen or overlapping the target itself.
  // While waiting for a target, it just centers.
  let tooltipStyle: React.CSSProperties;
  if (rect) {
    const targetMidY = rect.top + rect.height / 2;
    tooltipStyle =
      targetMidY < window.innerHeight / 2
        ? { top: rect.top + rect.height + SPOTLIGHT_PAD + 12, left: "50%", transform: "translateX(-50%)" }
        : { bottom: window.innerHeight - (rect.top - SPOTLIGHT_PAD) + 12, left: "50%", transform: "translateX(-50%)" };
  } else {
    tooltipStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .yst-spotlight, .yst-tooltip { transition: none !important; }
        }
        @keyframes yst-beacon-ping {
          0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0.85; }
          70%, 100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
        }
      `}</style>

      {/* Clicking anywhere here (spotlight or backdrop) has no handler —
          nothing happens. Skip/Next/Escape are the only ways out. */}
      <div className="yst-spotlight" style={spotlightStyle} />

      {/* Pulsing beacon on "the tab you're talking about" — the box-shadow
          spotlight trick only cuts ONE hole, so the nav tab itself would stay
          dimmed if a step's real target is mid-page. Rendered on top of the
          dim (not as a second cutout) so it reads clearly regardless. */}
      {beaconRect && (
        <div
          className="fixed pointer-events-none"
          style={{ top: beaconRect.top + beaconRect.height / 2, left: beaconRect.left + beaconRect.width / 2 }}
        >
          <span
            className="absolute rounded-full"
            style={{
              top: -11,
              left: -11,
              width: 22,
              height: 22,
              border: "2px solid #aeea00",
              opacity: reduced ? 0.6 : undefined,
              animation: reduced ? "none" : "yst-beacon-ping 1.2s ease-out infinite",
            }}
          />
          <span
            className="absolute rounded-full"
            style={{ top: -5, left: -5, width: 10, height: 10, background: "#aeea00", boxShadow: "0 0 6px rgba(174,234,0,0.9)" }}
          />
        </div>
      )}

      <div
        className="yst-tooltip fixed rounded-2xl px-4 py-4"
        style={{
          ...tooltipStyle,
          width: "min(92vw, 340px)",
          background: "rgba(8,13,10,0.97)",
          border: "1px solid rgba(255,255,255,0.1)",
          transition: reduced ? "none" : "top 0.25s ease, bottom 0.25s ease",
        }}
      >
        <p className="font-body text-[11px] font-bold uppercase tracking-[0.18em] mb-1.5" style={{ color: "#aeea00" }}>
          {step.title}
        </p>
        <p className="font-body text-sm leading-snug mb-3.5" style={{ color: rect ? "#e8ece9" : "#8a948f" }}>
          {rect ? step.body : "…"}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {stepList.map((_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{ width: 6, height: 6, background: i === idx ? "#aeea00" : "rgba(255,255,255,0.18)" }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={skip} className="font-body text-xs font-semibold px-3 py-2" style={{ color: "#8a948f" }}>
              Skip
            </button>
            <button
              onClick={() => seek(stepList, idx + 1)}
              className="font-display text-xs tracking-wide px-4 py-2 rounded-full"
              style={{ background: "#aeea00", color: "#13200a" }}
            >
              {isLast ? "Let's go" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
