"use client";
/**
 * The three-card "how it works" beat on /fantasy/rate, shown between "Grade
 * my team" and the result reveal — same story-card look and interaction as
 * RulesCards.tsx (segmented progress bar, tap the right ~62% to advance, the
 * left ~38% to go back, swipe works too), reusing its slide-in CSS classes
 * verbatim. Unlike RulesCards this is a fixed three-card set that SELLS the
 * game (leagues, the monthly prize, earning transfers) rather than teaching
 * its rules, and it has nowhere to hand off to — finishing the third card
 * (tap/swipe past it, or the "See my rating" button) calls `onDone`, which
 * the page uses to reveal the score once the rating has landed.
 *
 * Each card's scene is a small, tasteful motif built from real app tokens
 * and components (PlayerAvatar, MovesBank, Chip) — never a redrawn cartoon.
 */
import {
  useCallback, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent,
} from "react";
import {
  Chip, GOLD, INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { MovesBank } from "@/components/fantasy/MovesBank";
import { BASELINE_CREDITS_PER_GW, CREDIT_CAP } from "@/lib/fantasy/engine";

interface CardDef { eyebrow: string; title: string; body: string; Scene: () => ReactNode }

/** Card 1 — a small stacked chat thread, the league group chat the copy
 *  promises. Sample names/lines, not a claim about any real league. */
function ChatScene() {
  const rows: { name: string; text: string; me: boolean }[] = [
    { name: "Alex M", text: "Bruno's a lock this week.", me: false },
    { name: "You", text: "Saka's my captain, no debate.", me: true },
    { name: "Priya S", text: "Bold. I'm going Haaland.", me: false },
  ];
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: r.me ? "flex-end" : "flex-start", gap: 3 }}>
          {!r.me && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PlayerAvatar name={r.name} size={18} />
              <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>{r.name}</span>
            </div>
          )}
          <div style={{
            maxWidth: "80%", padding: "8px 12px", lineHeight: 1.4, fontSize: 12.5, color: INK,
            borderRadius: r.me ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
            background: r.me ? tint(TEAL, "20") : PANEL_2,
            border: `1px solid ${r.me ? tint(TEAL, "55") : LINE}`,
          }}>{r.text}</div>
        </div>
      ))}
    </div>
  );
}

const MONTH_ROWS: { rank: number; name: string; points: number; isMe: boolean }[] = [
  { rank: 1, name: "Jordan K", points: 214, isMe: false },
  { rank: 2, name: "You", points: 201, isMe: true },
  { rank: 3, name: "Marcus O", points: 188, isMe: false },
];

/** Card 2 — a mini month table, this calendar month's name pulled live so
 *  the sample never reads as a stale screenshot. Sample rank/points. */
function MonthScene() {
  const monthLabel = new Date().toLocaleString("en-GB", { month: "long" }).toUpperCase();
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="font-body" style={{ fontSize: 10, letterSpacing: "0.1em", color: MUTED }}>MONTHLY TABLE</span>
        <Chip gold>{monthLabel}</Chip>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {MONTH_ROWS.map((r) => (
          <div key={r.rank} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 10,
            background: r.isMe ? tint(TEAL, "18") : PANEL_2,
            border: `1px solid ${r.isMe ? tint(TEAL, "66") : LINE}`,
          }}>
            <span style={{ width: 16, textAlign: "center", fontWeight: 800, fontSize: 11, color: r.rank === 1 ? GOLD : MUTED }}>{r.rank}</span>
            <PlayerAvatar name={r.name} size={19} />
            <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: INK, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}{r.isMe && <span style={{ color: TEAL, fontWeight: 700 }}> · you</span>}
            </span>
            <span style={{ fontWeight: 800, fontSize: 11.5, color: INK }}>{r.points}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card 3 — the real Transfer Bank component, one credit held of the real
 *  cap, so "earn more transfers" is shown by the actual credits pill rather
 *  than a redrawn stand-in. */
function MovesScene() {
  return (
    <div style={{ width: "100%" }}>
      <MovesBank held={BASELINE_CREDITS_PER_GW} cap={CREDIT_CAP} roundEarns />
    </div>
  );
}

const CARDS: CardDef[] = [
  {
    eyebrow: "LEAGUES",
    title: "Every league has a chat",
    body: "Start a league with your friends and the group chat runs all season. Team talk, results, and the banter when a captain blanks.",
    Scene: ChatScene,
  },
  {
    eyebrow: "EVERY MONTH",
    title: "A fresh prize every month",
    body: "Each month is its own competition with real prizes. Finish top of the monthly table and it is yours, then everyone starts level again on the first.",
    Scene: MonthScene,
  },
  {
    eyebrow: "EARN YOUR MOVES",
    title: "Know your football, earn more transfers",
    body: "You get one transfer a week for free. Answer the gameday questions right and you earn more, so what you know changes your team.",
    Scene: MovesScene,
  },
];

export function RateIntroCards({ onDone }: { onDone: () => void }) {
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const isLast = index === CARDS.length - 1;
  const card = CARDS[index];

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= CARDS.length - 1) { onDone(); return i; }
      setDir("next");
      return i + 1;
    });
  }, [onDone]);
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

  return (
    <div
      tabIndex={0}
      role="group"
      aria-roledescription="story"
      aria-label={`How YourScore leagues work, card ${index + 1} of ${CARDS.length}: ${card.title}`}
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
          minHeight: 440, width: "100%",
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
          {card.eyebrow}
        </div>
        <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4, lineHeight: 1.15 }}>
          {card.title}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: "16px 0" }}>
          <card.Scene />
        </div>

        <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0 }}>{card.body}</p>

        {isLast ? (
          <div style={{ marginTop: 16, position: "relative", zIndex: 3 }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDone(); }}
              className="font-body rounded-xl"
              style={{
                width: "100%", padding: "13px 16px", fontSize: 14.5, fontWeight: 700,
                background: TEAL, color: "#03211d", border: `1px solid ${TEAL}`, cursor: "pointer",
              }}
            >
              See my rating
            </button>
          </div>
        ) : (
          <div className="font-body" style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: MUTED }}>
            Tap to continue
          </div>
        )}

        <div aria-hidden onClick={goBack}
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "38%", zIndex: 2, cursor: "pointer" }} />
        <div aria-hidden onClick={goNext}
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "62%", zIndex: 2, cursor: "pointer" }} />
      </div>
    </div>
  );
}
