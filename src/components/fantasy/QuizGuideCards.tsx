"use client";
/**
 * The weekly-quiz explainer as a tappable card story (founder, 2 Aug) — same
 * shape as the How It Works cards: one card at a time, a segmented progress bar,
 * tap the right ~62% to advance and the left ~38% to go back, or swipe. Each card
 * carries a small VISUAL of the idea (a question answered right, the round, the
 * gameday quiz, the free baseline) rather than words alone. No CTAs on purpose.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
import { Crest, GOLD, INK, LIME, LINE, MUTED, PANEL, PANEL_2, PITCH, TEAL, tint } from "@/components/fantasy/shared";

function SceneFrame({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden style={{ pointerEvents: "none", width: "100%", height: "100%", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14, border: `1px solid ${LINE}`, background: PITCH, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
        <div style={{ width: "100%", transform: "scale(0.94)" }}>{children}</div>
      </div>
    </div>
  );
}

const Check = ({ c = GOLD }: { c?: string }) => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
);

// 1 — a question answered right, and the reward lands.
function EarnScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 11px" }}>
          <div className="font-display tracking-widest" style={{ fontSize: 9, color: MUTED, marginBottom: 6 }}>QUESTION 3 OF 11</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginBottom: 9, lineHeight: 1.35 }}>Who won the Premier League Golden Boot last season?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ padding: "8px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: MUTED, background: PANEL, border: `1px solid ${LINE}` }}>Mohamed Salah</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: INK, background: "#1E3B2A", border: `1.5px solid ${GOLD}` }}>
              Erling Haaland <Check />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "center", padding: "8px 13px", borderRadius: 999, background: tint(TEAL, "1e"), border: `1px solid ${tint(TEAL, "66")}` }}>
          <Check c={TEAL} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL }}>You&apos;ve earned a transfer</span>
        </div>
      </div>
    </SceneFrame>
  );
}

// 2 — the gameweek round, inside Fantasy.
function RoundScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="font-display tracking-widest" style={{ fontSize: 9, color: TEAL }}>YOUR ROUND</span>
          <span style={{ fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>6 / 11</span>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {Array.from({ length: 11 }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 5, borderRadius: 2, background: i < 6 ? TEAL : LINE }} />
          ))}
        </div>
        <div style={{ background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 11px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK, marginBottom: 8, lineHeight: 1.35 }}>Which club has never been relegated from the Premier League?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ padding: "7px 9px", borderRadius: 8, fontSize: 11, color: MUTED, background: PANEL, border: `1px solid ${LINE}` }}>Everton</div>
            <div style={{ padding: "7px 9px", borderRadius: 8, fontSize: 11, color: MUTED, background: PANEL, border: `1px solid ${LINE}` }}>Arsenal</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 11px", borderRadius: 10, background: tint(GOLD, "12"), border: `1px solid ${tint(GOLD, "40")}` }}>
          <span style={{ fontSize: 11.5, color: MUTED }}>Banked for next week</span>
          <span className="font-display" style={{ fontSize: 15, fontWeight: 800, color: GOLD }}>+3</span>
        </div>
      </div>
    </SceneFrame>
  );
}

// 3 — the gameday quiz, in the Play tab: a fixture promo (11 questions, crests).
function TeamBadge({ club, code }: { club: string; code: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <Crest club={club} size={50} />
      <div className="font-display" style={{ fontSize: 12, fontWeight: 700, color: INK, marginTop: 5, letterSpacing: "0.02em" }}>{code}</div>
    </div>
  );
}
function GamedayScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%", borderRadius: 14, overflow: "hidden", border: `1px solid ${tint(LIME, "44")}`, background: `linear-gradient(160deg, ${tint(LIME, "22")}, ${PANEL})`, padding: "13px 14px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span className="font-display tracking-widest" style={{ fontSize: 9.5, color: LIME }}>GAMEDAY QUIZ</span>
          <span style={{ fontSize: 9, fontWeight: 800, color: LIME, border: `1px solid ${tint(LIME, "55")}`, borderRadius: 999, padding: "3px 9px", letterSpacing: "0.06em" }}>FRI 21 AUG</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 13 }}>
          <TeamBadge club="Arsenal" code="ARS" />
          <span className="font-display" style={{ fontSize: 15, fontWeight: 700, color: MUTED }}>v</span>
          <TeamBadge club="Coventry City" code="COV" />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "9px", borderRadius: 11, background: "rgba(0,0,0,0.28)", border: `1px solid ${tint(LIME, "2a")}` }}>
          <span className="font-display" style={{ fontSize: 18, fontWeight: 800, color: LIME }}>11</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>questions · earn transfers</span>
        </div>
      </div>
    </SceneFrame>
  );
}

// 4 — the free baseline: you play regardless.
function BaselineScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="font-display" style={{ fontSize: 46, lineHeight: 1, color: TEAL }}>1</span>
          <span className="font-display" style={{ fontSize: 16, color: TEAL, opacity: 0.85 }}>free transfer</span>
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, textAlign: "center" }}>every gameweek, quiz or no quiz</div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, background: PANEL_2, border: `1px solid ${LINE}` }}>
          <span style={{ fontSize: 11, color: MUTED }}>Quiz skipped</span>
          <Check c={TEAL} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: INK }}>Still playing</span>
        </div>
      </div>
    </SceneFrame>
  );
}

interface CardDef { step: string; title: string; body: string; Scene: () => ReactNode }
const CARDS: CardDef[] = [
  { step: "HOW IT PAYS", title: "Right answers earn transfers", body: "Answer football questions and every one you get right banks an extra transfer. It never costs you anything to try, and the reward is real: more moves for your squad.", Scene: EarnScene },
  { step: "OPTION 1", title: "The gameweek round", body: "Eleven questions each gameweek, right here in Fantasy. Answer any time before the deadline. The more you get right, the more transfers you bank for next week.", Scene: RoundScene },
  { step: "OPTION 2", title: "The gameday quiz", body: "On matchdays, an 11-question quiz built around the day's fixtures drops in the Play tab. Play it for more transfer credit toward your team. Same reward, a different moment to grab it.", Scene: GamedayScene },
  { step: "NO PRESSURE", title: "It only ever adds", body: "You always get one transfer a gameweek, whether you touch the quiz or not. Skip it and your squad still plays. Come back whenever you want the extra edge.", Scene: BaselineScene },
];

export function QuizGuideCards() {
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const card = CARDS[index];

  const goNext = useCallback(() => { setDir("next"); setIndex((i) => Math.min(CARDS.length - 1, i + 1)); }, []);
  const goBack = useCallback(() => { setDir("back"); setIndex((i) => Math.max(0, i - 1)); }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  };
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartX.current; touchStartX.current = null;
    if (start === null) return;
    const delta = (e.changedTouches[0]?.clientX ?? start) - start;
    if (delta <= -40) goNext(); else if (delta >= 40) goBack();
  };

  return (
    <div
      tabIndex={0} role="group" aria-roledescription="story"
      aria-label={`The weekly quiz, card ${index + 1} of ${CARDS.length}: ${card.title}`}
      onKeyDown={onKeyDown} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ outline: "none" }}
    >
      <div key={index} className={dir === "next" ? "rules-card-in-next" : "rules-card-in-back"}
        style={{ position: "relative", overflow: "hidden", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 20, height: "64dvh", minHeight: 420, maxHeight: 560, width: "100%", display: "flex", flexDirection: "column", padding: "16px 18px 18px" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {CARDS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= index ? TEAL : LINE, opacity: i === index ? 0.55 : 1 }} />
          ))}
        </div>
        <div className="font-body" style={{ textAlign: "right", fontSize: 11, color: MUTED, marginTop: 6 }}>{index + 1} of {CARDS.length}</div>

        <div className="font-display tracking-widest" style={{ fontSize: 11, color: TEAL, marginTop: 14 }}>{card.step}</div>
        <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4, lineHeight: 1.15 }}>{card.title}</div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: "10px 0" }}>
          <card.Scene />
        </div>

        <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0 }}>{card.body}</p>

        {index === 0 && (
          <div className="font-body" style={{ marginTop: "auto", paddingTop: 10, textAlign: "center", fontSize: 11, color: MUTED }}>Tap to continue</div>
        )}

        <div aria-hidden onClick={goBack} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "38%", zIndex: 2, cursor: "pointer" }} />
        <div aria-hidden onClick={goNext} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "62%", zIndex: 2, cursor: "pointer" }} />
      </div>
    </div>
  );
}
