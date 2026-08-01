"use client";
/**
 * The rules carousel — eight cards, one per beat of the journey, sitting above
 * the chronological walkthrough on /fantasy/rules. The walkthrough is the full
 * story top to bottom; this is the same story skimmable in eight swipes, for
 * someone who wants the shape before the detail.
 *
 * Same law as the rest of the page: every number comes from the engine's own
 * exports, never typed by hand. The one exception is the captain's ×2 — it is
 * not an exported constant (effectiveCaptain doubles inline in engine.ts), so
 * the brief allows it here as plain copy, same as the existing STEPS body does.
 *
 * No swipe library: a horizontal scroller with CSS scroll snap plus dot
 * indicators driven by scroll position. `no-scrollbar` is the house class for
 * hiding the native bar (see globals.css / VersusHub's rails) while keeping
 * real native scrolling, momentum and snap included for free.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BASELINE_CREDITS_PER_GW, BUDGET_TENTHS, CHIPS, CREDIT_CAP,
  HIT_POINTS, MAX_PER_CLUB, SQUAD_SIZE,
} from "@/lib/fantasy/engine";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import { GOLD, INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

// Card gap in px — read by both the flex CSS and the scroll-position math, so
// the two can never drift apart.
const GAP = 12;

// ── decorative glyphs, one per card, in the house palette only ───────────────
// All aria-hidden: they illustrate the card next to them, a screen reader
// already gets the same information from the title and body text.

function SquadGlyph() {
  // A tiny formation: SQUAD_SIZE dots on a pitch, not a hand-picked count.
  const cols = 5;
  const rows = Math.ceil(SQUAD_SIZE / cols);
  const w = 56, h = 38, pad = 5;
  const dx = cols > 1 ? (w - pad * 2) / (cols - 1) : 0;
  const dy = rows > 1 ? (h - pad * 2) / (rows - 1) : 0;
  const dots = Array.from({ length: SQUAD_SIZE }, (_, i) => ({
    x: pad + (i % cols) * dx, y: pad + Math.floor(i / cols) * dy,
  }));
  return (
    <svg aria-hidden width="56" height="38" viewBox={`0 0 ${w} ${h}`}>
      <rect x="0.5" y="0.5" width={w - 1} height={h - 1} rx="6" fill={PANEL_2} stroke={LINE} />
      <line x1={w / 2} y1="4" x2={w / 2} y2={h - 4} stroke={LINE} strokeWidth="1" />
      {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="2" fill={TEAL} />)}
    </svg>
  );
}

function ArmbandGlyph() {
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      <rect x="7" y="8" width="13" height="24" rx="3" fill="none" stroke={TEAL} strokeWidth="2" />
      <rect x="7" y="17" width="13" height="6" fill={TEAL} />
      <text x="34" y="25" fontSize="17" fontWeight="800" fill={GOLD}>×2</text>
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      <circle cx="26" cy="19" r="14" fill="none" stroke={TEAL} strokeWidth="2" />
      <line x1="26" y1="19" x2="26" y2="9" stroke={TEAL} strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="19" x2="33" y2="22" stroke={TEAL} strokeWidth="2" strokeLinecap="round" />
      <circle cx="26" cy="19" r="1.6" fill={TEAL} />
      <path d="M45 12 L49 12 M47 8 L47 16" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RoundGlyph() {
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      <rect x="1" y="10" width="16" height="18" rx="3" fill={PANEL_2} stroke={LINE} />
      <text x="9" y="23" fontSize="11" fontWeight="800" fill={MUTED} textAnchor="middle">?</text>
      <line x1="21" y1="19" x2="30" y2="19" stroke={TEAL} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="42" cy="19" r="11" fill="none" stroke={GOLD} strokeWidth="2" />
      <text x="42" y="23" fontSize="10.5" fontWeight="800" fill={GOLD} textAnchor="middle">
        {`+${BASELINE_CREDITS_PER_GW}`}
      </text>
    </svg>
  );
}

function BankGlyph() {
  // CREDIT_CAP coins stacked, then a dashed cap line above the top one — the
  // count is read off the engine, not chosen for how it looks.
  const coins = Array.from({ length: CREDIT_CAP });
  const baseY = 32;
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      {coins.map((_, i) => (
        <ellipse key={i} cx="26" cy={baseY - i * 4.5} rx="13" ry="4"
          fill={i === coins.length - 1 ? GOLD : TEAL}
          opacity={0.28 + (i / coins.length) * 0.6} />
      ))}
      <line x1="9" y1={baseY - coins.length * 4.5 - 3} x2="43" y2={baseY - coins.length * 4.5 - 3}
        stroke={MUTED} strokeWidth="1" strokeDasharray="3 2" />
      <text x="49" y="12" fontSize="9" fontWeight="700" fill="#E08A6B" textAnchor="end">
        {`-${HIT_POINTS}`}
      </text>
    </svg>
  );
}

function ChipGlyph() {
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      {CHIPS.map((_, i) => (
        <circle key={i} cx={13 + i * 15} cy="19" r="8.5" fill="none"
          strokeWidth="2" stroke={i === 0 ? GOLD : TEAL} opacity={i === 0 ? 1 : 0.6} />
      ))}
    </svg>
  );
}

function ScoreGlyph() {
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      <circle cx="16" cy="21" r="10" fill="none" stroke={TEAL} strokeWidth="2" />
      <path d="M16 13 L21 17 L19 23 L13 23 L11 17 Z" fill={TEAL} opacity="0.55" />
      <path d="M30 24 L45 24" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <path d="M32 24 L28 30" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      <text x="46" y="16" fontSize="10" fontWeight="800" fill={GOLD} textAnchor="end">pts</text>
    </svg>
  );
}

function TableGlyph() {
  const heights = [13, 21, 9];
  return (
    <svg aria-hidden width="56" height="38" viewBox="0 0 56 38">
      {heights.map((h, i) => (
        <rect key={i} x={7 + i * 16} y={32 - h} width="12" height={h} rx="2"
          fill={i === 1 ? GOLD : TEAL} opacity={i === 1 ? 1 : 0.5} />
      ))}
    </svg>
  );
}

interface CardDef { title: string; sub?: string; body: string; Glyph: () => ReactNode }

const CARDS: CardDef[] = [
  {
    title: "Build your squad",
    Glyph: SquadGlyph,
    body: `Pick ${SQUAD_SIZE} players for ${money(BUDGET_TENTHS)}, no more than ${MAX_PER_CLUB} from any one club. Rebuild as often as you like until your first gameweek locks.`,
  },
  {
    title: "Name your captain",
    Glyph: ArmbandGlyph,
    body: "One player wears the armband and scores double. If he does not play, it passes to your vice captain.",
  },
  {
    title: "Beat the deadline",
    Glyph: ClockGlyph,
    body: "Lock your team before the first match of the gameweek. Miss it and your team simply plays as it stands.",
  },
  {
    title: "Earn extra transfers",
    sub: `${KNOWLEDGE_NAME} round, optional`,
    Glyph: RoundGlyph,
    body: `Everyone gets ${BASELINE_CREDITS_PER_GW} free transfer every gameweek, no strings. Play the ${KNOWLEDGE_NAME} round and right answers earn more. Skip it and you still play the gameweek as normal.`,
  },
  {
    title: "Bank your moves",
    Glyph: BankGlyph,
    body: `Transfers you earn this gameweek apply to the next one, banking up to ${CREDIT_CAP}. Go beyond what you hold and each extra move costs points.`,
  },
  {
    title: "Play a chip",
    Glyph: ChipGlyph,
    body: "One chip a month, your pick of three. A chip cannot come back until you have used the other two.",
  },
  {
    title: "Score on real matches",
    Glyph: ScoreGlyph,
    body: "Every point traces to something that happened on the pitch, goals, assists, clean sheets, minutes. No panel decides your bonus.",
  },
  {
    title: "Climb the tables",
    Glyph: TableGlyph,
    body: `Your running season total, a fresh competition every month, and any leagues you join. ${KNOWLEDGE_NAME} is the tiebreak.`,
  },
];

export function RulesCards() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const cardW = (first?.offsetWidth ?? el.offsetWidth) + GAP;
    const idx = Math.round(el.scrollLeft / cardW);
    setActive(Math.min(CARDS.length - 1, Math.max(0, idx)));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  return (
    <div style={{ margin: "18px -16px 2px" }}>
      <div
        ref={scrollerRef}
        className="no-scrollbar"
        style={{
          display: "flex", gap: GAP, overflowX: "auto",
          scrollSnapType: "x mandatory", padding: "2px 16px 4px",
        }}
      >
        {CARDS.map((c) => (
          <div key={c.title} className="rounded-2xl" style={{
            flex: "0 0 85%", scrollSnapAlign: "center",
            background: PANEL, border: `1px solid ${LINE}`, padding: 16,
            display: "flex", flexDirection: "column", gap: 10, minHeight: 168,
          }}>
            <c.Glyph />
            <div>
              <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1.15 }}>
                {c.title}
              </div>
              {c.sub && (
                <div className="font-body tracking-widest" style={{ fontSize: 10, color: TEAL, marginTop: 3 }}>
                  {c.sub.toUpperCase()}
                </div>
              )}
            </div>
            <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>{c.body}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 6 }}>
        {CARDS.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to card ${i + 1} of ${CARDS.length}`}
            aria-current={i === active}
            onClick={() => goTo(i)}
            style={{
              width: i === active ? 16 : 6, height: 6, borderRadius: 999, padding: 0,
              background: i === active ? TEAL : tint(TEAL, "33"),
              border: "none", cursor: "pointer", transition: "width 0.18s ease, background 0.18s ease",
            }}
          />
        ))}
      </div>
      <div className="font-body" style={{ textAlign: "center", fontSize: 10.5, color: MUTED, marginTop: 4 }}>
        {active + 1} of {CARDS.length}
      </div>
    </div>
  );
}
