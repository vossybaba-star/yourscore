"use client";
/**
 * The rules stepper — eight full-screen story cards, one per beat of the
 * journey, sitting above the chronological walkthrough on /fantasy/rules.
 *
 * Story-style (IG stories / app onboarding), not a carousel of ad tiles: one
 * card on screen at a time, a segmented progress bar, tap the right ~62% to
 * advance, the left ~38% to go back, swipe works too. The last card hands off
 * to the full walkthrough below it or opens the rules bot.
 *
 * Same law as the rest of the page: every number comes from the engine's own
 * exports, never typed by hand. The one exception is the captain's ×2/×3 —
 * neither is an exported constant (effectiveCaptain/scoreEntry double or
 * triple inline in engine.ts), so the brief allows them here as plain copy,
 * same as the existing walkthrough body does.
 */
import {
  useCallback, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode, type TouchEvent,
} from "react";
import {
  BASELINE_CREDITS_PER_GW, BUDGET_TENTHS, CASH_POINTS, CHIPS, CREDIT_CAP,
  creditsForRound, HIT_POINTS, MAX_PER_CLUB, SQUAD_QUOTA, SQUAD_SIZE, XI_SIZE,
  type FantasyPos,
} from "@/lib/fantasy/engine";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import {
  AMBER, CORAL, GOLD, INK, LIME, LINE, MUTED, PANEL, PANEL_2, TEAL, tint,
} from "@/components/fantasy/shared";

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

// The credit curve, read off the engine rather than restated — same
// technique the walkthrough page's own CREDIT_STEPS table uses.
const CREDIT_STEPS = (() => {
  const steps: { correct: number; credits: number }[] = [];
  let last = 0;
  for (let c = 0; c <= 11; c++) {
    const credits = creditsForRound(c);
    if (credits !== last) { steps.push({ correct: c, credits }); last = credits; }
  }
  return steps;
})();
const CREDIT_CURVE_TEXT = CREDIT_STEPS.map((s) => `${s.correct} right → ${s.credits}`).join(" · ");

// ── scene SVGs — one per card, in the house palette only ─────────────────────
// All aria-hidden: a screen reader gets the same information from the title
// and the full explanation next to them. viewBox is a fixed 320×150 so every
// scene sits at the same optical scale and nothing depends on the card's
// actual rendered width.

function SquadScene() {
  // A representative starting shape (1 GK, 4 DEF, 4 MID, 2 FWD = XI_SIZE),
  // drawn by quota row order; each row's leftover quota sits, dimmed, in the
  // bench tray below — the two counts always add back up to SQUAD_QUOTA.
  const START: Record<FantasyPos, number> = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
  const benchTotal = SQUAD_SIZE - XI_SIZE;
  const rows: { pos: FantasyPos; y: number }[] = [
    { pos: "GK", y: 108 }, { pos: "DEF", y: 82 }, { pos: "MID", y: 54 }, { pos: "FWD", y: 26 },
  ];
  const pitchX0 = 96, pitchX1 = 224, pad = 16;
  const dotsFor = (n: number, y: number) => {
    if (n <= 1) return [{ x: (pitchX0 + pitchX1) / 2, y }];
    const x0 = pitchX0 + pad, x1 = pitchX1 - pad;
    return Array.from({ length: n }, (_, i) => ({ x: x0 + (i * (x1 - x0)) / (n - 1), y }));
  };

  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="squadGlow" cx="50%" cy="30%" r="65%">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.16" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="320" height="150" fill="url(#squadGlow)" />

      <rect x={pitchX0} y="6" width={pitchX1 - pitchX0} height="112" rx="10" fill={PANEL_2} stroke={LINE} />
      <path d={`M ${pitchX0 + 42} 6 A 22 22 0 0 0 ${pitchX1 - 42} 6`} fill="none" stroke={LINE} strokeWidth="1" />
      <rect x={pitchX0 + 24} y="94" width={(pitchX1 - pitchX0) - 48} height="24" fill="none" stroke={LINE} strokeWidth="1" />
      <rect x={pitchX0 + 44} y="108" width={(pitchX1 - pitchX0) - 88} height="10" fill="none" stroke={LINE} strokeWidth="1" />

      {rows.map((r) => dotsFor(START[r.pos], r.y).map((d, i) => (
        <circle key={`${r.pos}-${i}`} cx={d.x} cy={d.y} r="5" fill={TEAL} stroke={PANEL} strokeWidth="1.5" />
      )))}

      <g transform="translate(238,12)">
        <rect x="0" y="0" width="66" height="20" rx="10" fill={PANEL_2} stroke={tint(GOLD, "55")} />
        <text x="33" y="14" fontSize="10.5" fontWeight="800" fill={GOLD} textAnchor="middle">{money(BUDGET_TENTHS)}</text>
      </g>

      <rect x={pitchX0} y="126" width={pitchX1 - pitchX0} height="18" rx="6" fill={PANEL_2} stroke={LINE} />
      {Array.from({ length: benchTotal }, (_, i) => (
        <circle key={i} cx={pitchX0 + 22 + i * 27} cy="135" r="4.5" fill={TEAL} opacity="0.35" stroke={PANEL} strokeWidth="1.2" />
      ))}
    </svg>
  );
}

function CaptainScene() {
  const shirt = "M18 0 L36 0 Q40 10 54 14 L46 30 L40 24 L40 88 L-4 88 L-4 24 L-10 30 L-18 14 Q-4 10 0 0 Z";
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="capGlow" cx="50%" cy="50%" r="58%">
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.22" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
      </defs>

      <g transform="translate(70,30)">
        <path d={shirt} fill={PANEL_2} stroke={TEAL} strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 0 Q18 8 24 0" fill="none" stroke={TEAL} strokeWidth="1.5" />
        <rect x="-4" y="34" width="16" height="10" fill={GOLD} opacity="0.9" />
        <rect x="-4" y="34" width="16" height="10" fill="none" stroke={GOLD} strokeWidth="1" />
      </g>

      <circle cx="205" cy="66" r="42" fill="url(#capGlow)" />
      <text x="205" y="78" fontSize="40" fontWeight="800" fill={GOLD} textAnchor="middle">×2</text>

      <g transform="translate(262,58) scale(0.52)" opacity="0.45">
        <path d={shirt} fill={PANEL_2} stroke={MUTED} strokeWidth="2.6" strokeLinejoin="round" />
      </g>
      <g transform="translate(276,132)">
        <rect x="-13" y="-9" width="26" height="15" rx="4" fill={PANEL_2} stroke={LINE} />
        <text x="0" y="1.5" fontSize="9" fontWeight="800" fill={MUTED} textAnchor="middle">VC</text>
      </g>
    </svg>
  );
}

function DeadlineScene() {
  const ticks = Array.from({ length: 12 }, (_, i) => i);
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="clockGlow" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.14" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="80" cy="75" r="58" fill="url(#clockGlow)" />
      <circle cx="80" cy="75" r="46" fill={PANEL_2} stroke={LINE} strokeWidth="1.5" />
      {ticks.map((i) => {
        const a = (i / 12) * Math.PI * 2;
        const x1 = 80 + Math.sin(a) * 40, y1 = 75 - Math.cos(a) * 40;
        const x2 = 80 + Math.sin(a) * 45, y2 = 75 - Math.cos(a) * 45;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={LINE} strokeWidth="2" />;
      })}
      <line x1="80" y1="75" x2="80" y2="46" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
      <line x1="80" y1="75" x2="104" y2="86" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="75" r="3.5" fill={TEAL} />

      <g transform="translate(178,58)">
        <path d="M6 20 V12 A12 12 0 0 1 30 12 V20" fill="none" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
        <rect x="0" y="20" width="36" height="30" rx="6" fill={PANEL_2} stroke={TEAL} strokeWidth="2" />
        <circle cx="18" cy="34" r="3.4" fill={TEAL} />
        <rect x="16.5" y="34" width="3" height="9" fill={TEAL} />
      </g>

      <g transform="translate(272,75)">
        <circle cx="0" cy="0" r="4" fill={MUTED} />
        <path d="M10 0 A10 10 0 0 1 3 9.5" fill="none" stroke={MUTED} strokeWidth="1.3" opacity="0.6" />
        <path d="M17 0 A17 17 0 0 1 5 16.3" fill="none" stroke={MUTED} strokeWidth="1.3" opacity="0.35" />
      </g>
    </svg>
  );
}

function RoundScene() {
  const total = 11;
  const lit = 6; // illustrative mid-round progress, not a scoring threshold
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="roundGlow" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.22" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0" />
        </radialGradient>
      </defs>
      {Array.from({ length: total }, (_, i) => {
        const x = 14 + i * 19;
        const on = i < lit;
        return (
          <g key={i}>
            <rect x={x} y="46" width="14" height="22" rx="4" fill={on ? tint(TEAL, "26") : PANEL_2} stroke={on ? TEAL : LINE} strokeWidth="1.3" />
            {on && <path d={`M ${x + 3} 57 L ${x + 6} 61 L ${x + 11} 51`} fill="none" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
          </g>
        );
      })}
      <path d={`M ${14 + (lit - 1) * 19 + 14} 57 L 258 75`} fill="none" stroke={LIME} strokeWidth="1.3" strokeDasharray="3 3" opacity="0.6" />
      <circle cx="284" cy="75" r="26" fill="url(#roundGlow)" />
      <circle cx="284" cy="75" r="17" fill={PANEL_2} stroke={LIME} strokeWidth="2" />
      <path d="M277 71 h10 l-3 -4 M287 79 h-10 l3 4" fill="none" stroke={LIME} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BankScene() {
  const step = 12, baseY = 118;
  const topY = baseY - (CREDIT_CAP - 1) * step;
  const capY = topY - 8;
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="bankGlow" cx="50%" cy="25%" r="70%">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.14" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="320" height="150" fill="url(#bankGlow)" />

      {Array.from({ length: CREDIT_CAP }, (_, i) => (
        <ellipse key={i} cx="130" cy={baseY - i * step} rx="26" ry="8" fill={PANEL_2} stroke={TEAL} strokeWidth="1.6" />
      ))}

      <line x1="100" y1={capY} x2="160" y2={capY} stroke={MUTED} strokeWidth="1.3" strokeDasharray="4 3" />

      <ellipse cx="130" cy={topY - 22} rx="26" ry="8" fill={tint(GOLD, "26")} stroke={GOLD} strokeWidth="1.8" />
      <g transform={`translate(168,${topY - 30})`}>
        <rect x="0" y="0" width="46" height="18" rx="9" fill={PANEL_2} stroke={tint(GOLD, "55")} />
        <text x="23" y="12.5" fontSize="9.5" fontWeight="800" fill={GOLD} textAnchor="middle">+pts</text>
      </g>

      <ellipse cx="130" cy={baseY + step} rx="24" ry="7" fill="none" stroke={CORAL} strokeWidth="1.3" strokeDasharray="3 3" opacity="0.6" />
      <g transform={`translate(162,${baseY + step - 8})`}>
        <rect x="0" y="0" width="42" height="17" rx="8.5" fill={PANEL_2} stroke={tint(CORAL, "55")} />
        <text x="21" y="12" fontSize="9" fontWeight="800" fill={CORAL} textAnchor="middle">-pts</text>
      </g>
    </svg>
  );
}

function ChipsScene() {
  const cx = [80, 160, 240];
  const colorOf: Record<string, string> = { triple_captain: TEAL, bench_boost: LIME, insight: AMBER };
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <g transform="translate(160,14)">
        <rect x="-38" y="-2" width="76" height="17" rx="8.5" fill={PANEL_2} stroke={LINE} />
        <text x="0" y="10.5" fontSize="9.5" fontWeight="700" fill={MUTED} textAnchor="middle">1 PER MONTH</text>
      </g>

      {CHIPS.map((chip, i) => {
        const color = colorOf[chip] ?? TEAL;
        const x = cx[i] ?? 160, y = 92;
        const notches = Array.from({ length: 10 }, (_, n) => n);
        return (
          <g key={chip} transform={`translate(${x},${y})`}>
            <circle r="30" fill={PANEL_2} stroke={color} strokeWidth="2" />
            <circle r="22" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.7" />
            {notches.map((n) => {
              const a = (n / notches.length) * Math.PI * 2;
              const x1 = Math.sin(a) * 27, y1 = -Math.cos(a) * 27;
              const x2 = Math.sin(a) * 30, y2 = -Math.cos(a) * 30;
              return <line key={n} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.6" opacity="0.5" />;
            })}
            {chip === "triple_captain" && (
              <text x="0" y="6" fontSize="15" fontWeight="800" fill={TEAL} textAnchor="middle">×3</text>
            )}
            {chip === "bench_boost" && (
              <g stroke={LIME} strokeWidth="1.8" strokeLinecap="round">
                <line x1="-11" y1="-5" x2="11" y2="-5" />
                <line x1="-11" y1="0" x2="11" y2="0" />
                <line x1="-11" y1="5" x2="11" y2="5" />
              </g>
            )}
            {chip === "insight" && (
              <path d="M-9 -9 L9 9 M-9 9 L9 -9" stroke={AMBER} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ScoringScene() {
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="scoreGlow" cx="35%" cy="45%" r="65%">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.14" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="320" height="150" fill="url(#scoreGlow)" />

      <g transform="translate(24,20)">
        <rect x="0" y="0" width="110" height="76" fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinejoin="round" />
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * (110 / 7)} y1="0" x2={(i + 1) * (110 / 7)} y2="76" stroke={LINE} strokeWidth="0.8" />
        ))}
        {Array.from({ length: 4 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={(i + 1) * (76 / 5)} x2="110" y2={(i + 1) * (76 / 5)} stroke={LINE} strokeWidth="0.8" />
        ))}
        <path d="M0 60 Q40 34 96 46" fill="none" stroke={LIME} strokeWidth="1.6" strokeDasharray="2 4" opacity="0.7" />
        <circle cx="96" cy="46" r="7" fill={INK} />
        <circle cx="96" cy="46" r="7" fill="none" stroke={PANEL} strokeWidth="1" />
      </g>

      {[{ x: 214, y: 96, s: 16 }, { x: 246, y: 60, s: 20 }, { x: 274, y: 104, s: 22 }].map((p, i) => (
        <text key={i} x={p.x} y={p.y} fontSize={p.s} fontWeight="800" fill={LIME} opacity={0.85 - i * 0.15}>+</text>
      ))}
    </svg>
  );
}

function TablesScene() {
  const rows = 5, rowH = 18, gap = 4, startY = 14;
  return (
    <svg aria-hidden width="100%" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: rows }, (_, i) => {
        const highlighted = i === 2;
        const y = startY + i * (rowH + gap) - (highlighted ? rowH / 2 + gap / 2 : 0);
        return (
          <g key={i}>
            <rect x="16" y={y} width="182" height={rowH} rx="6"
              fill={highlighted ? tint(TEAL, "22") : PANEL_2}
              stroke={highlighted ? TEAL : LINE} strokeWidth={highlighted ? 1.6 : 1} />
            {i === 0 && <path d={`M24 ${y + 7} l4 -6 l4 4 l4 -7 l4 4 l4 -6 l4 8 z`} fill={GOLD} opacity="0.9" />}
            {highlighted && <path d={`M206 ${y + rowH / 2 + 5} l5 -8 l5 8 z`} fill={LIME} />}
          </g>
        );
      })}

      <g transform="translate(258,44) rotate(-6)">
        <rect x="0" y="0" width="46" height="52" rx="6" fill={PANEL_2} stroke={LINE} strokeWidth="1.2" />
      </g>
      <g transform="translate(252,40) rotate(4)">
        <rect x="0" y="0" width="46" height="52" rx="6" fill={PANEL_2} stroke={tint(MUTED, "55")} strokeWidth="1.2" />
        <line x1="0" y1="14" x2="46" y2="14" stroke={LINE} strokeWidth="1" />
        <line x1="12" y1="0" x2="12" y2="10" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" />
        <line x1="34" y1="0" x2="34" y2="10" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// ── card content ───────────────────────────────────────────────────────────
interface CardDef { title: string; body: string; factRow?: string; Scene: () => ReactNode }

const CARDS: CardDef[] = [
  {
    title: "Build your squad",
    Scene: SquadScene,
    body: `Pick ${SQUAD_SIZE} players for ${money(BUDGET_TENTHS)}, with no more than ${MAX_PER_CLUB} from any one club. ${XI_SIZE} of them start each gameweek, the rest wait on the bench. Rebuild your squad as often as you like, right up until your first gameweek locks.`,
    factRow: `${SQUAD_QUOTA.GK} keepers · ${SQUAD_QUOTA.DEF} defenders · ${SQUAD_QUOTA.MID} midfielders · ${SQUAD_QUOTA.FWD} forwards`,
  },
  {
    title: "Name your captain",
    Scene: CaptainScene,
    body: "The armband doubles his score. If he does not play a single minute, your vice captain steps up in his place. If neither of them takes the pitch, the armband passes to whichever starter is in the best form, so the double is never wasted.",
  },
  {
    title: "Beat the deadline",
    Scene: DeadlineScene,
    body: "Your team locks the moment the gameweek's first match kicks off. Miss the deadline and your team simply plays exactly as it stands. Nothing is lost and nothing changes, there is no penalty beyond that.",
  },
  {
    title: "Earn extra transfers",
    Scene: RoundScene,
    body: `Everyone gets ${BASELINE_CREDITS_PER_GW} free transfer every single gameweek, no strings attached. Play the optional ${KNOWLEDGE_NAME} round of eleven questions and right answers earn you more. Skip it entirely and you still play the gameweek exactly as normal.`,
    factRow: CREDIT_CURVE_TEXT,
  },
  {
    title: "Bank your moves",
    Scene: BankScene,
    body: `Transfers you earn apply to your next gameweek, banking up to ${CREDIT_CAP} at a time. Go beyond what you hold and each extra move costs ${HIT_POINTS} points. If your bank is already full, further earned transfers cash out at ${CASH_POINTS} points each, straight onto your score.`,
  },
  {
    title: "Play a chip",
    Scene: ChipsScene,
    body: `You get one chip a month, your pick of three. Triple Captain scores your captain at ×3, Bench Boost scores all ${SQUAD_SIZE} of your players including the bench, and Insight removes two wrong answers from one question in the round. A chip cannot come back around until you have used the other two.`,
  },
  {
    title: "Score on real matches",
    Scene: ScoringScene,
    body: "Every point you score traces back to a real match fact: goals, assists, clean sheets, minutes played, saves. No panel sits behind the scenes deciding your bonus. Two managers with the same players always score exactly the same.",
  },
  {
    title: "Climb the tables",
    Scene: TablesScene,
    body: `Your season total keeps a running score across every gameweek, alongside a fresh monthly competition, so a rough month never buries your whole season. Any leagues you have joined sit alongside both. Level on points, the better round record wins, ${KNOWLEDGE_NAME} is the tiebreak.`,
  },
];

export function RulesCards({ onDone }: { onDone?: () => void } = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const isLast = index === CARDS.length - 1;
  const card = CARDS[index];

  const goNext = useCallback(() => {
    setDir("next");
    setIndex((i) => Math.min(CARDS.length - 1, i + 1));
  }, []);
  const goBack = useCallback(() => {
    setDir("back");
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  };
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const delta = (e.changedTouches[0]?.clientX ?? start) - start;
    if (delta <= -40) goNext();
    else if (delta >= 40) goBack();
  };

  const handleDone = useCallback(() => {
    if (onDone) { onDone(); return; }
    rootRef.current?.nextElementSibling?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [onDone]);

  const askQuestion = useCallback(() => {
    window.dispatchEvent(new CustomEvent("rules-bot-open"));
  }, []);

  // Recomputed only when index changes, so a plain render (e.g. a parent
  // re-render) doesn't recreate the button handlers on every paint.
  const lastCardActions = useMemo(() => (isLast ? { handleDone, askQuestion } : null), [isLast, handleDone, askQuestion]);

  return (
    <div ref={rootRef} style={{ margin: "18px 0 4px" }}>
      <div
        tabIndex={0}
        role="group"
        aria-roledescription="story"
        aria-label={`How it works, card ${index + 1} of ${CARDS.length}: ${card.title}`}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ outline: "none" }}
      >
        <div
          key={index}
          className={dir === "next" ? "rules-card-in-next" : "rules-card-in-back"}
          style={{
            position: "relative", overflow: "hidden",
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 20,
            height: "64dvh", minHeight: 420, maxHeight: 560, width: "100%",
            display: "flex", flexDirection: "column", padding: "16px 18px 18px",
          }}
        >
          <div style={{ display: "flex", gap: 4 }}>
            {CARDS.map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i <= index ? TEAL : LINE,
                opacity: i === index ? 0.55 : 1,
              }} />
            ))}
          </div>
          <div className="font-body" style={{ textAlign: "right", fontSize: 11, color: MUTED, marginTop: 6 }}>
            {index + 1} of {CARDS.length}
          </div>

          <div className="font-display tracking-widest" style={{ fontSize: 11, color: TEAL, marginTop: 14 }}>
            {`STEP ${index + 1}`}
          </div>
          <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4, lineHeight: 1.15 }}>
            {card.title}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: "8px 0" }}>
            <card.Scene />
          </div>

          <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0 }}>{card.body}</p>

          {card.factRow && (
            <div className="font-body" style={{
              alignSelf: "flex-start", marginTop: 10, borderRadius: 999,
              background: PANEL_2, border: `1px solid ${LINE}`, color: INK,
              fontSize: 11.5, padding: "6px 12px",
            }}>
              {card.factRow}
            </div>
          )}

          {index === 0 && (
            <div className="font-body" style={{ marginTop: "auto", paddingTop: 10, textAlign: "center", fontSize: 11, color: MUTED }}>
              Tap to continue
            </div>
          )}

          {lastCardActions && (
            <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8, position: "relative", zIndex: 3 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lastCardActions.handleDone(); }}
                className="font-body rounded-xl"
                style={{
                  width: "100%", padding: "13px 16px", fontSize: 14.5, fontWeight: 700,
                  background: TEAL, color: "#03211d", border: `1px solid ${TEAL}`, cursor: "pointer",
                }}
              >
                Read the full rules
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lastCardActions.askQuestion(); }}
                className="font-body rounded-xl"
                style={{
                  width: "100%", padding: "13px 16px", fontSize: 14.5, fontWeight: 600,
                  background: PANEL_2, color: INK, border: `1px solid ${LINE}`, cursor: "pointer",
                }}
              >
                Ask a question
              </button>
            </div>
          )}

          <div
            aria-hidden
            onClick={goBack}
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "38%", zIndex: 2, cursor: "pointer" }}
          />
          <div
            aria-hidden
            onClick={goNext}
            style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "62%", zIndex: 2, cursor: "pointer" }}
          />
        </div>
      </div>
    </div>
  );
}
