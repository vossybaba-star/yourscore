"use client";
/**
 * YourScore Fantasy Football — shared client theme + primitives + fetch helpers.
 *
 * ON THE HOUSE SYSTEM (rebuilt 22 Jul — founder: "it looks old and bland;
 * follow the Premier League tab"). These screens had drifted onto a bespoke
 * palette AND a bespoke font stack ('Avenir Next'), so Bebas/DM Sans never
 * loaded here — which is most of why it read as a different, older app.
 *
 * Colour semantics come from tailwind.config.ts, not from taste:
 *   lime = 38-0 / energy      teal = QUIZ + KNOWLEDGE      gold = WINS ONLY
 * Fantasy is the knowledge game, so TEAL is its accent — the same choice the
 * reference screen made (the PL tab's fantasy pitch). Gold is
 * rationed to things you WON: a gameweek total, top of a table, a month title.
 * Spending gold on every button is what made it mean nothing.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { faceFor } from "@/lib/fantasy/faces";

/** Reward only — a score, a winner, rank 1. Never a default button. */
export const GOLD = "#ffc233";
/** The fantasy accent: knowledge. Primary actions, live state, section marks. */
export const TEAL = "#00d8c0";
export const PITCH = "#080d0a";   // bg
export const PANEL = "#0e1611";   // surface
export const PANEL_2 = "#15211a"; // surface-2, for raised rows
export const LINE = "rgba(255,255,255,0.07)";
export const INK = "#eef2f0";
export const MUTED = "#8a948f";
// Role colours for the Fantasy identity (founder, 25 Jul): lime = the ONE
// primary action + live positive; gold (above) = earned power / captaincy;
// teal = structure. Amber = doubts, coral = unavailable / negative.
export const LIME = "#aeea00";
export const AMBER = "#f4a63a";
export const CORAL = "#e0653c";
/** Accent tint helpers — the reference's hex+alpha idiom (bg 12%, border 28%). */
export const tint = (hex: string, a = "1e") => `${hex}${a}`;

export type Pos = "GK" | "DEF" | "MID" | "FWD";
export type ChipName = "triple_captain" | "bench_boost" | "insight" | "second_chance";
export interface ClientPoolPlayer {
  id: number; name: string; club: string; clubId: number; pos: Pos; price: number;
  avatarUrl?: string | null; // SportMonks headshot, baked by pool id (~99% coverage); falls back to faceFor()
}
export interface FantasyState {
  gw: { gw: number; season: string; mode: string; status: string; deadline: string | null };
  season: { gw: number; total: number; finalised: number };
  poolVersion: string;
  openForEdits: boolean;
  /** The weekly quiz's own gate: openForEdits AND (live only) gameday reached. */
  roundOpen: boolean;
  roundOpensAt: string | null;
  canRebuild: boolean;
  squad: {
    picks: { id: number; pos: Pos; clubId: number; buyTenths: number }[];
    bankTenths: number; credits: number; xi: number[]; bench: number[];
    captain: number; vice: number; version: number;
    /** The pending tray: transfers earned THIS gameweek for NEXT gameweek.
     *  Visible now, spendable when the next gameweek opens. */
    earnedForNextGw: number; earnedSource: string | null;
  } | null;
  chips: {
    /** The chips playable right now (monthly rotation): the current set-of-three
     *  minus what's used, or empty once this month's one chip is spent. */
    available: ChipName[]; playedThisMonth: boolean;
    playedThisGw: ChipName | null;
  } | null;
  entry: {
    status: string;
    round: { answered: number; correct: number; creditsEarned: number; done: boolean };
    transfers: number; hits: number; lockedAt: string | null;
    result: {
      points: number;
      breakdown: { id: number; points: number; captain: boolean; subbedIn: boolean; facts?: MatchFacts }[];
      autosubs: { out: number; in: number }[]; captainUsed: number;
      /** True while the matches are still on and the tick is re-scoring. */
      provisional: boolean;
      scoredAt: string;
      /** Pool ids whose fixture the feed has reported — everyone else is still to come. */
      reported: number[];
    } | null;
  } | null;
}

/** Routes that read rather than mutate. Everything else defaults to POST — a GET
 *  route missing from this set silently 405s. */
const GET_PATHS = new Set(["pool", "state", "form", "ledger", "squad-update", "squad-rating"]);

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, body === undefined
    ? { method: (GET_PATHS.has(path) || path.startsWith("player/")) ? "GET" : "POST" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

/** No fontFamily here on purpose: the root layout's Bebas/DM Sans vars then
 *  apply, which they never did while this set its own stack. */
export const page: CSSProperties = {
  minHeight: "100dvh", background: PITCH, color: INK,
  // Top: clear the iPhone status bar (viewport-fit=cover draws under it) so the
  // header/back control isn't behind the clock. Bottom: clear the fixed
  // BottomNav (~58px) + the home-indicator safe area.
  padding:
    "calc(16px + env(safe-area-inset-top)) 16px calc(88px + env(safe-area-inset-bottom))",
  maxWidth: 512, margin: "0 auto",
};

export function Header({ right, exit }: { right?: ReactNode; exit?: { label: string; onClick: () => void } }) {
  // Wraps, because the right slot outgrew the row: on a 375px phone the hub's
  // three chips plus a button ran off the edge, taking the last chip and the
  // button off-screen entirely with no scrollbar to hint they were there.
  //
  // `exit` is the get-me-out control. Every screen that can trap you needs one:
  // the native app has no URL bar and no browser back, so a screen without a
  // visible way out is a screen you can only leave by killing the app.
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: 8, marginBottom: 14,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {exit && (
          <button onClick={exit.onClick} aria-label={exit.label}
            className="font-body rounded-full"
            style={{
              background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
              fontSize: 12.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer", flexShrink: 0,
            }}>← {exit.label}</button>
        )}
        <span className="font-display tracking-widest" style={{ fontSize: 15, color: TEAL }}>
          YOURSCORE FANTASY
        </span>
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{right}</span>
    </div>
  );
}

/** THE number in a fantasy game: when this gameweek stops accepting changes.
 *
 *  It was returned by /api/fantasy/state from the first day and rendered nowhere
 *  — the squad home, the builder, the transfer screen and the round all left it
 *  out, and the only copy that gestured at it hard-coded "the Saturday deadline"
 *  (gameweek 1's is a Friday). Without a date, a time and a zone there is no
 *  urgency, and urgency is the whole loop.
 *
 *  Rendered in the VIEWER's timezone with the zone named, not London's: a
 *  manager in Lagos or New York needs to know when it closes for them. It only
 *  renders once the deadline has been fetched, so there is no server/client
 *  formatting mismatch to hydrate around. */
export function Deadline({ iso, compact = false }: { iso: string | null; compact?: boolean }) {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  const left = at - Date.now();
  const past = left <= 0;
  const hours = left / 3_600_000;
  // Escalate only inside the last six hours — a countdown that shouts for a
  // fortnight teaches you to ignore it.
  const urgent = !past && hours <= 6;

  // `hour: "numeric"` not "2-digit" — "6:30 PM" reads like a kickoff time,
  // "06:30 PM" reads like a train timetable.
  const when = new Date(at).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  const away = past
    ? "closed"
    : hours < 1 ? `in ${Math.max(1, Math.round(left / 60_000))} min`
    : hours < 24 ? `in ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`
    : `in ${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"}`;

  const accent = urgent ? GOLD : past ? MUTED : TEAL;
  return (
    <div className="font-body rounded-xl" style={{
      display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
      padding: compact ? "7px 11px" : "9px 13px",
      marginBottom: compact ? 10 : 12,
      background: PANEL, border: `1px solid ${urgent ? tint(GOLD, "55") : LINE}`,
      fontSize: compact ? 12 : 12.5,
    }}>
      <span className="font-display tracking-widest" style={{ fontSize: 10.5, color: accent }}>
        {past ? "DEADLINE PASSED" : "DEADLINE"}
      </span>
      <span style={{ color: INK, fontWeight: 600 }}>{when}</span>
      <span style={{ color: urgent ? GOLD : MUTED, fontWeight: urgent ? 700 : 400 }}>{away}</span>
    </div>
  );
}

/**
 * A bottom sheet that assistive technology can actually see.
 *
 * The chip confirm and the friend's-run overlay were both plain `<div>`s: no
 * dialog role, no `aria-modal`, no focus trap, no Escape, and no focus
 * restoration. A screen reader announced nothing when they opened, and a
 * keyboard user tabbed straight past the dialog into the page behind it — which
 * on the chip sheet meant tabbing into controls that were meant to be blocked by
 * a decision they hadn't made yet.
 *
 * `labelledBy` points at the id of the sheet's own heading, so the announcement
 * is the question being asked rather than the word "dialog".
 */
export function Sheet({ onClose, labelledBy, children }: {
  onClose: () => void; labelledBy: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  // Portal to <body>: every fantasy route sets `main[data-fantasy] > * { z-index:1 }`,
  // which traps a fixed overlay in that stacking context BELOW the z-50 BottomNav,
  // clipping the sheet's bottom controls (the composer's Post button). Rendering
  // at the document root frees the z-60 overlay to sit above the nav everywhere.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Visual-viewport rect, so the sheet can dodge the on-screen keyboard (see below).
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null);

  // Latest onClose without making it an effect dependency. Callers often pass an
  // inline arrow (e.g. the composer's `() => { reset(); onClose() }`) that is a new
  // reference every render; if the focus effect below depended on it, it would
  // re-run on EVERY keystroke and steal focus back to the first control, so you
  // could never type past one character in a field that isn't the first one (the
  // poll inputs). Read it through a ref instead.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Lock the page scroll while the sheet is up. Without this the feed keeps
  // scrolling underneath every drag that starts on the sheet, which reads as
  // a jumpy, broken background (founder, 6 Aug). Restore on close.
  useEffect(() => {
    if (!mounted) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyTouch = document.body.style.touchAction;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    // <html> is the actual scroller on mobile Safari/Chrome — locking body
    // alone still lets the page pan underneath the sheet.
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.touchAction = prevBodyTouch;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [mounted]);

  const focusables = useCallback((): HTMLElement[] => {
    if (!ref.current) return [];
    return Array.from(ref.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    // Wait for the portal to mount so ref.current (and its fields) exist. Runs
    // once — never on a keystroke — so focus is set on open and then left alone.
    if (!mounted) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    // Focus the first real control, or the sheet itself if it has none.
    const first = focusables()[0] ?? ref.current;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      // Wrap at both ends — that IS the trap.
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Put focus back where the user left it, not at the top of the document.
      returnTo.current?.focus?.();
    };
  }, [mounted, focusables]);

  // Track the VISUAL viewport so the bottom-anchored sheet sits above the iOS
  // on-screen keyboard instead of behind it. A `position:fixed` element is
  // pinned to the LAYOUT viewport, which the keyboard does not shrink, so
  // without this the field a user is typing into is hidden under the keyboard
  // until some reflow (pressing return) nudges it up. Following visualViewport's
  // offsetTop/height keeps the sheet in the visible band the whole time.
  useEffect(() => {
    if (!mounted) return;
    const visual = window.visualViewport;
    if (!visual) return;
    const update = () => setVv({ top: visual.offsetTop, height: visual.height });
    update();
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  }, [mounted]);

  const overlay = (
    <div onClick={onClose}
      style={{
        // z-60 above the BottomNav (z-50); portaled to <body> so main's stacking
        // context can't sink it below the nav. Sized to the visual viewport (see
        // above) so flex-end lands the sheet just above the keyboard.
        position: "fixed", left: 0, right: 0,
        top: vv ? vv.top : 0, height: vv ? vv.height : "100%",
        zIndex: 60, background: "rgba(4,8,6,0.72)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "14px 14px calc(14px + env(safe-area-inset-bottom)) 14px",
      }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl"
        style={{
          // Glassy surface (founder, 6 Aug): translucent panel over a heavy
          // backdrop blur, a hairline top highlight for the glossy edge, and a
          // deep soft shadow so the sheet reads as a floating pane of glass
          // rather than a flat card.
          background: "rgba(14,22,17,0.82)",
          backdropFilter: "blur(24px) saturate(1.3)",
          WebkitBackdropFilter: "blur(24px) saturate(1.3)",
          border: `1px solid rgba(255,255,255,0.10)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px ${tint(TEAL, "14")}`,
          padding: 18,
          width: "100%", maxWidth: 480, maxHeight: "100%", overflowY: "auto",
          overscrollBehavior: "contain",
        }}>
        {children}
      </div>
    </div>
  );

  return mounted ? createPortal(overlay, document.body) : null;
}

/** The player card — who they are and everything a pick turns on, in one place.
 *
 *  The audit's gap was that a squad was picked on price alone. Tapping a player
 *  now opens this: position, club, price, availability, their next fixtures and,
 *  where a gameweek has scored, what they've actually returned in OUR points. It's
 *  a Sheet (not a route) so it opens over the pick surface without losing your
 *  place mid-decision, and it closes back to exactly where you were. */
export function PlayerDetailSheet({
  player, fixtures, doubt, form, formGws, ownership, action, onClose,
}: {
  player: { id: number; name: string; club: string; clubId: number; pos: Pos; price: number; avatarUrl?: string | null };
  fixtures?: ContextFixture[];
  doubt?: string;
  /** Recent YourScore points, oldest gameweek first. Empty pre-season. */
  form?: number[];
  formGws?: number[];
  /** The player's relationship to the viewer's squad, for the honest CTA. */
  ownership?: "owned" | "affordable" | "too-expensive";
  action?: { label: string; onClick: () => void };
  onClose: () => void;
}) {
  const total = (form ?? []).reduce((a, b) => a + b, 0);
  return (
    <Sheet onClose={onClose} labelledBy="player-detail-title">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl ?? faceFor(player.name)} size={56} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div id="player-detail-title" className="font-display" style={{ fontSize: 22, lineHeight: 1.05 }}>
            {player.name}
          </div>
          <div className="font-body" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: MUTED, marginTop: 3 }}>
            <Crest club={player.club} size={15} />
            <PosTag pos={player.pos} /> · {player.club} · £{player.price.toFixed(1)}m
          </div>
        </div>
        {doubt && <DoubtFlag reason={doubt} />}
      </div>

      {doubt && (
        <div style={{ background: "rgba(184,92,56,0.10)", border: "1px solid #B85C38", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, color: "#E08A6B", lineHeight: 1.45 }}>{doubt}</span>
        </div>
      )}

      {/* Next fixtures — the thing you plan around. */}
      <div style={{ marginBottom: fixtures?.length ? 14 : 0 }}>
        <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "#586058", marginBottom: 6 }}>
          NEXT FIXTURES
        </div>
        {fixtures?.length
          ? <FixtureRun cells={fixtures} max={5} />
          : <span style={{ fontSize: 12.5, color: MUTED }}>No fixtures scheduled in range.</span>}
      </div>

      {/* What they've actually returned, once anything has scored. */}
      {form && form.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "#586058", marginBottom: 6 }}>
            RECENT RETURNS · {total} PTS
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {form.map((pts, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{
                  minWidth: 30, padding: "5px 0", borderRadius: 6, fontSize: 13, fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  background: pts >= 8 ? GOLD : pts >= 4 ? "#2E4A38" : PANEL_2,
                  color: pts >= 8 ? "#2A1F00" : pts >= 4 ? INK : MUTED,
                  border: `1px solid ${pts >= 8 ? GOLD : LINE}`,
                }}>{pts}</div>
                {formGws?.[i] !== undefined && (
                  <div style={{ fontSize: 9, color: "#586058", marginTop: 3 }}>GW{formGws[i]}</div>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: MUTED, margin: "8px 0 0" }}>YourScore points, not FPL&apos;s.</p>
        </div>
      )}

      {ownership && (
        <p style={{ fontSize: 12.5, color: ownership === "owned" ? TEAL : MUTED, margin: "12px 0 0", fontWeight: ownership === "owned" ? 600 : 400 }}>
          {ownership === "owned" ? "In your squad." : ownership === "affordable" ? "You can afford this player." : "Out of your budget right now."}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {action && <div style={{ flex: 1 }}><Btn gold onClick={action.onClick}>{action.label}</Btn></div>}
        <div style={{ flex: action ? "0 0 auto" : 1 }}><Btn onClick={onClose}>Close</Btn></div>
      </div>
    </Sheet>
  );
}

// ── decision context: fixtures + availability ────────────────────────────────
export type Difficulty = "kind" | "medium" | "tough";
export interface ContextFixture {
  gw: number; opp: string; oppShort: string; home: boolean; difficulty: Difficulty;
}
/** FPL availability letter: a=available, d=doubt, i=injured, s=suspended, u=unavailable. */
export type FplStatus = "a" | "d" | "i" | "s" | "u";
export interface FantasyContext {
  gw: number;
  fixtures: Record<number, ContextFixture[]>;
  doubts: Record<number, string>;
  /** pool id → FPL status letter (absent = available). The real injury signal. */
  status: Record<number, FplStatus>;
  teamNewsAt: string | null;
}
export const EMPTY_CONTEXT: FantasyContext = { gw: 0, fixtures: {}, doubts: {}, status: {}, teamNewsAt: null };

/** Difficulty as colour. Deliberately desaturated: this sits behind three-letter
 *  opponent codes on a dark ground, and a saturated traffic-light row would shout
 *  louder than the player's own name. */
const DIFF_BG: Record<Difficulty, string> = {
  kind: "rgba(0,216,192,0.16)",
  medium: "rgba(255,255,255,0.06)",
  tough: "rgba(227,82,64,0.18)",
};
const DIFF_FG: Record<Difficulty, string> = { kind: TEAL, medium: MUTED, tough: "#E08A6B" };

/** A player's next fixtures: "ARS · bou · WHU", caps for home, tinted by how hard
 *  it is for THEM. Empty when the club has no fixture in range — a blank gameweek
 *  says so by being blank, which is the honest rendering. */
export function FixtureRun({ cells, max = 3 }: { cells?: ContextFixture[]; max?: number }) {
  if (!cells?.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {cells.slice(0, max).map((c, i) => (
        <span key={`${c.gw}-${i}`}
          title={`GW${c.gw}: ${c.home ? "home to" : "away at"} ${c.opp} (${c.difficulty})`}
          style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: "0.02em",
            padding: "2px 4px", borderRadius: 3, minWidth: 26, textAlign: "center",
            background: DIFF_BG[c.difficulty], color: DIFF_FG[c.difficulty],
            // Caps = home, lower = away. The ticker's own convention, kept.
            textTransform: c.home ? "uppercase" : "lowercase",
          }}>{c.oppShort}</span>
      ))}
    </span>
  );
}

/** The availability flag. Worded as a DOUBT, never as an injury: the source is a
 *  predicted-lineup diff, not a medical report, and overstating it would be the
 *  kind of confident wrongness the tips layer exists to avoid. */
export function DoubtFlag({ reason }: { reason?: string }) {
  if (!reason) return null;
  return (
    <span title={reason}
      style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
        padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap",
        color: "#E08A6B", border: "1px solid #B85C38",
      }}>DOUBT</span>
  );
}

/** A loading placeholder shaped like the thing that's coming.
 *
 *  Every fantasy screen used to render the bare string "Loading…", so the layout
 *  jumped once when content arrived and the wait read as a stall rather than
 *  progress. A skeleton the size of the real content holds the space and shimmers,
 *  so the screen looks like it's filling in, not frozen. Honours reduced-motion:
 *  the shimmer is decoration, and some people it makes ill. */
export function Skel({ w = "100%", h = 14, r = 6, style }: {
  w?: number | string; h?: number; r?: number; style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className="ys-skel"
      style={{ display: "block", width: w, height: h, borderRadius: r, background: PANEL_2, ...style }}
    />
  );
}

/** Full-screen loading state for a fantasy route. `label` is announced to screen
 *  readers (which can't see a skeleton) via an off-screen live region. */
export function Loading({ label = "Loading", children }: { label?: string; children?: ReactNode }) {
  return (
    <div>
      <span role="status" aria-live="polite" className="sr-only">{label}…</span>
      {children ?? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={120} r={16} />
          <Skel h={64} r={16} />
          <Skel w="60%" />
          <Skel w="80%" />
        </div>
      )}
    </div>
  );
}

/** The consistent error state: what went wrong, and a way to try again. Replaces
 *  a raw server string that only the hub bothered to make retryable. Distinguishes
 *  "you're offline" from a real server error, because the fix is different. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <Card style={{ marginTop: 12 }}>
      <div className="font-body" style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: INK }}>
        {offline ? "You're offline" : "That didn't load"}
      </div>
      <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
        {offline
          ? "Check your connection and try again — nothing you've done is lost."
          : message || "Something went wrong on our side."}
      </p>
      {onRetry && <Btn onClick={onRetry}>Try again</Btn>}
    </Card>
  );
}

/** Status pill. `gold` marks a REWARD (credits in hand, a win); default is quiet. */
export function Chip({ children, gold = false, teal = false }: {
  children: ReactNode; gold?: boolean; teal?: boolean;
}) {
  const accent = gold ? GOLD : teal ? TEAL : null;
  return (
    <span className="font-body rounded-full whitespace-nowrap"
      style={{
        fontSize: 11.5, fontWeight: 600, padding: "4px 10px",
        background: accent ? tint(accent) : PANEL_2,
        color: accent ?? MUTED,
        border: `1px solid ${accent ? tint(accent, "44") : LINE}`,
      }}>{children}</span>
  );
}

/** `gold` = the screen's primary action. Kept as the prop name so every call
 *  site still reads right, but it paints TEAL — actions are knowledge-coloured
 *  here; gold is reserved for what you've won. */
export function Btn({ children, onClick, gold = false, lime = false, disabled = false, small = false, glow = false }: {
  children: ReactNode; onClick?: () => void; gold?: boolean;
  /** The Fantasy primary. `lime` is the ONE action a screen is for; it wins over
   *  `gold` (kept for back-compat callers that pass it as "the filled button"). */
  lime?: boolean;
  disabled?: boolean; small?: boolean;
  /** Breathe. Reserve it for the ONE thing a screen wants you to do — if two
   *  buttons pulse, neither reads as the answer. */
  glow?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`font-body rounded-xl transition-opacity${glow && !disabled ? " animate-fantasy-glow" : ""}`}
      style={{
        padding: small ? "9px 14px" : "14px 18px",
        fontSize: small ? 13 : 15, fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        background: lime ? LIME : gold ? TEAL : PANEL_2,
        color: lime ? "#12200a" : gold ? "#03211d" : INK,
        border: `1px solid ${lime ? LIME : gold ? TEAL : LINE}`,
        opacity: disabled ? 0.4 : 1,
        width: small ? undefined : "100%",
      }}>{children}</button>
  );
}

export function Card({ children, style, onClick }: {
  children: ReactNode; style?: CSSProperties; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className="rounded-2xl"
      style={{ background: PANEL, border: `1px solid ${LINE}`, padding: 16, ...style }}>
      {children}
    </div>
  );
}

/** Section marker — the house pattern: tiny Bebas, wide tracking, dim. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: 8 }}>
      {children}
    </div>
  );
}

/** Club crest (local /badges/*.png). Silent if a club has no badge mapped.
 *  Moved to src/components/ui/Crest.tsx (comment-replies stage 1, so the
 *  debate/comment layer can use it without importing this whole file) — kept
 *  imported + re-exported here (not `export { Crest } from ...`, which would
 *  only re-export and not bind a local name) so both this file's own use
 *  above AND every existing external fantasy call site are untouched. */
export { Crest };

export interface MatchFacts {
  minutes: number; goals: number; assists: number; cleanSheet: number; conceded: number;
  saves: number; pensSaved: number; pensMissed: number; yellows: number; reds: number;
  ownGoals: number; dc: number; dcRec: number;
}

/** Plain-English summary of what a player did, for the result card.
 *  Returns "" when there's no fact data (e.g. an entry scored before facts were
 *  tracked) — the render skips the line rather than wrongly say "didn't play". */
export function factLine(pos: Pos, f?: MatchFacts): string {
  if (!f) return "";
  if (f.minutes === 0) return "Didn't play";
  const bits: string[] = [`${f.minutes}'`];
  if (f.goals) bits.push(`${f.goals} goal${f.goals > 1 ? "s" : ""}`);
  if (f.assists) bits.push(`${f.assists} assist${f.assists > 1 ? "s" : ""}`);
  if (f.cleanSheet && (pos === "GK" || pos === "DEF" || pos === "MID")) bits.push("clean sheet");
  if (pos === "GK" && f.saves >= 3) bits.push(`${f.saves} saves`);
  if (f.pensSaved) bits.push(`${f.pensSaved} pen saved`);
  if ((pos === "DEF" && f.dc >= 10) || (pos !== "DEF" && f.dcRec >= 12)) bits.push("defensive actions");
  if (f.yellows) bits.push("yellow");
  if (f.reds) bits.push("red card");
  if (f.ownGoals) bits.push("own goal");
  if (f.pensMissed) bits.push("pen missed");
  return bits.join(" · ");
}

/** Point drivers that DON'T get their own column in the result table — saves,
 *  cards, defensive actions, goals conceded. Without this line a GK's 12 points
 *  look unexplained: the table shows 90 minutes and a clean sheet, not the 6 saves.
 *  Returns "" when there's nothing extra to say. */
export function extrasLine(pos: Pos, f?: MatchFacts): string {
  if (!f || f.minutes === 0) return "";
  const bits: string[] = [];
  if (pos === "GK" && f.saves > 0) bits.push(`${f.saves} save${f.saves > 1 ? "s" : ""}`);
  if (f.pensSaved) bits.push(`${f.pensSaved} pen saved`);
  if ((pos === "GK" || pos === "DEF") && f.conceded >= 2) bits.push(`${f.conceded} conceded`);
  if ((pos === "DEF" && f.dc >= 10) || (pos !== "DEF" && f.dcRec >= 12)) bits.push("defensive actions");
  if (f.yellows) bits.push("yellow");
  if (f.reds) bits.push("red card");
  if (f.ownGoals) bits.push(`${f.ownGoals} own goal`);
  if (f.pensMissed) bits.push("pen missed");
  return bits.join(" · ");
}

export const fmtM = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;
export const POS_ORDER: Pos[] = ["GK", "DEF", "MID", "FWD"];
export const QUOTA: Record<Pos, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
/** The one canonical position palette — standard fantasy hues (GK amber, DEF teal,
 *  MID lime, FWD coral). The single source so the pitch, dugout, player lists and
 *  chips all colour a position the same way. */
export const POS_COLOR: Record<Pos, string> = { GK: "#f4a63a", DEF: "#00d8c0", MID: "#8ad14f", FWD: "#ff7a85" };

/** The position abbreviation, coloured by role — the one way to print a position
 *  in a list or meta line so GK/DEF/MID/FWD read at a glance everywhere. */
export function PosTag({ pos }: { pos: Pos | string }) {
  const c = POS_COLOR[pos as Pos] ?? MUTED;
  return <span style={{ color: c, fontWeight: 700 }}>{pos}</span>;
}
