"use client";
/**
 * The rules bot — a floating "ask me" button on /fantasy/rules for the
 * question the eight cards and the walkthrough did not answer directly.
 *
 * Two tiers:
 *   1. A tap on a suggested pill, or typed text that IS one of the canned
 *      questions (normalized substring), answers INSTANTLY from FAQ in
 *      rulesFaq.ts — zero network, full confidence. Only a handful of pills
 *      show (founder, 2 Aug: listing all of them read as a wall).
 *   2. Everything else goes to POST /api/fantasy/rules-qa — the grounded
 *      model decides the right answer (founder, 2 Aug), rather than a local
 *      text match guessing which canned answer is close enough.
 *
 * Every failure mode degrades to the canned-only notice rather than crashing
 * or showing a raw error: no key, a non-200, a thrown fetch, a 401/404/429/500
 * from withFantasyUser, or an explicit { fallback: true } all land here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FAQ, type FaqItem } from "@/lib/fantasy/rulesFaq";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";

const MAX_QUESTION = 300;
const FALLBACK_NOTICE = "I can only answer from the saved questions right now, friend. Tap one below.";
const RATE_LIMIT_NOTICE = "One moment, friend, you are asking faster than I can answer.";

/** When the grounded model is unreachable, answer with the nearest canned
 *  answer PLAINLY — no hedging preamble (founder, 2 Aug: "the closest saved
 *  answer I have" read terribly). The confidence is paid for by a stricter
 *  match threshold in nearestFaq; a weak match gets the generic notice
 *  instead of a confidently wrong answer. */
function rescue(question: string): string {
  return nearestFaq(question)?.a ?? FALLBACK_NOTICE;
}

interface Msg { role: "user" | "bot"; text: string }

/** Strip punctuation, lowercase, collapse whitespace — for the rescue tier's
 *  loose match against the canned questions, not a real NLP pass. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** The handful of suggestions shown as pills — the questions new managers
 *  actually ask first. The rest of FAQ still exists for the rescue tier and
 *  the model's grounding doc; it just is not a wall of eighteen buttons. */
const SUGGESTED = [
  "How many players do I pick, and what is my budget?",
  "How does the captain work?",
  `How do I earn extra transfers with ${KNOWLEDGE_NAME}?`,
  "What is the deadline, and what happens if I miss it?",
  "When is my score final?",
];
const PILLS: FaqItem[] = SUGGESTED
  .map((q) => FAQ.find((f) => f.q === q))
  .filter((f): f is FaqItem => Boolean(f));

/** A typed question that IS a canned question (normalized substring either
 *  way) answers instantly and plainly — no model round trip for a question we
 *  hold the exact answer to. Anything looser goes to the model, which decides. */
function exactMatch(input: string): FaqItem | null {
  const norm = normalize(input);
  if (!norm) return null;
  return FAQ.find((f) => {
    const nq = normalize(f.q);
    return nq.includes(norm) || norm.includes(nq);
  }) ?? null;
}

/** The rescue tier, used ONLY when the grounded model is unavailable: the
 *  closest canned question by shared significant words. Threshold is three
 *  shared words, not two — rescue answers speak with full confidence now, so
 *  a near miss must fail to the generic notice, never to a wrong answer. */
// Words that carry no meaning for matching a rules question — every canned
// question contains them, so they only manufacture false overlap. ("what"
// appearing twice in one canned question once pushed a keeper-injury question
// to the deadline answer.)
const STOP = new Set(["what", "when", "does", "happens", "happen", "will", "gets", "have", "much", "many", "with", "there"]);
const significant = (s: string) =>
  new Set(normalize(s).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));

function nearestFaq(input: string): FaqItem | null {
  const exact = exactMatch(input);
  if (exact) return exact;
  const inputWords = significant(input);
  if (!inputWords.size) return null;
  let best: FaqItem | null = null;
  let bestScore = 0;
  for (const f of FAQ) {
    let overlap = 0;
    significant(f.q).forEach((w) => { if (inputWords.has(w)) overlap++; });
    if (overlap > bestScore) { bestScore = overlap; best = f; }
  }
  return bestScore >= 2 ? best : null;
}

function RulesSheet({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  // A beat of "thinking" before every answer, even the instant canned ones —
  // a reply that lands in the same frame as the tap reads as a lookup table,
  // not a helper (founder, 2 Aug).
  const THINK_MS = 500;
  const think = (fn: () => void) => {
    setThinking(true);
    setTimeout(() => { setThinking(false); fn(); }, THINK_MS);
  };

  const tapPill = (f: FaqItem) => {
    if (thinking) return;
    setMessages((m) => [...m, { role: "user", text: f.q }]);
    think(() => setMessages((m) => [...m, { role: "bot", text: f.a }]));
  };

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim().slice(0, MAX_QUESTION);
    if (!question) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");

    // A question we hold verbatim answers from the canned set, full
    // confidence, after the same beat of thinking as everything else.
    const exact = exactMatch(question);
    if (exact) {
      think(() => setMessages((m) => [...m, { role: "bot", text: exact.a }]));
      return;
    }

    setThinking(true);
    const minThink = new Promise((r) => setTimeout(r, THINK_MS));
    try {
      const res = await fetch("/api/fantasy/rules-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      await minThink;
      if (res.status === 429) {
        setMessages((m) => [...m, { role: "bot", text: RATE_LIMIT_NOTICE }]);
        return;
      }
      if (!res.ok) {
        setMessages((m) => [...m, { role: "bot", text: rescue(question) }]);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (json?.fallback || typeof json?.answer !== "string" || !json.answer) {
        setMessages((m) => [...m, { role: "bot", text: rescue(question) }]);
        return;
      }
      setMessages((m) => [...m, { role: "bot", text: json.answer }]);
    } catch {
      await minThink.catch(() => undefined);
      setMessages((m) => [...m, { role: "bot", text: rescue(question) }]);
    } finally {
      setThinking(false);
    }
  }, []);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(4,8,6,0.72)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "0 0 env(safe-area-inset-bottom)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-bot-title"
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl"
        style={{
          width: "100%", maxWidth: 512, maxHeight: "75dvh",
          background: PANEL, border: `1px solid ${tint(TEAL, "44")}`, borderBottom: "none",
          display: "flex", flexDirection: "column",
          animation: "slideUp 0.22s ease",
        }}
      >
        <div style={{ padding: "18px 18px 10px", flexShrink: 0 }}>
          <div className="rounded-full" style={{ width: 36, height: 4, background: LINE, margin: "0 auto 14px" }} />
          <div id="rules-bot-title" className="font-display" style={{ fontSize: 19, fontWeight: 700, color: INK }}>
            Ask about the rules
          </div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "3px 0 0" }}>
            Tap a question, or type your own.
          </p>
        </div>

        <div ref={listRef} className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "0 18px" }}>
          {messages.length === 0 && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, paddingBottom: 6 }}>
                {PILLS.map((f) => (
                  <button
                    key={f.q}
                    type="button"
                    onClick={() => tapPill(f)}
                    className="font-body rounded-full"
                    style={{
                      fontSize: 12, padding: "7px 12px", textAlign: "left",
                      background: PANEL_2, border: `1px solid ${LINE}`, color: INK, cursor: "pointer",
                    }}
                  >
                    {f.q}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: MUTED, margin: "4px 2px 10px", lineHeight: 1.4 }}>
                Or ask anything about the rules in your own words below.
              </p>
            </>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div className="rounded-2xl" style={{
                maxWidth: "82%", padding: "9px 13px", fontSize: 13, lineHeight: 1.5,
                background: m.role === "user" ? tint(TEAL, "1c") : PANEL_2,
                border: `1px solid ${m.role === "user" ? tint(TEAL, "44") : LINE}`,
                color: INK,
              }}>
                {m.text}
              </div>
            </div>
          ))}

          {thinking && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
              <div className="rounded-2xl" style={{
                padding: "9px 13px", fontSize: 13, background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
              }}>
                One moment...
              </div>
            </div>
          )}

          {messages.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0 10px" }}>
              {PILLS.slice(0, 3).map((f) => (
                <button
                  key={f.q}
                  type="button"
                  onClick={() => tapPill(f)}
                  className="font-body rounded-full"
                  style={{
                    fontSize: 11, padding: "5px 10px",
                    background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer",
                  }}
                >
                  {f.q}
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (!thinking) ask(input); }}
          style={{
            display: "flex", gap: 8, padding: "10px 18px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
            borderTop: `1px solid ${LINE}`, flexShrink: 0,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_QUESTION}
            placeholder="Ask a question about the rules"
            aria-label="Ask a question about the rules"
            className="font-body rounded-xl"
            style={{
              flex: 1, minWidth: 0, padding: "10px 13px", fontSize: 13.5,
              background: PANEL_2, border: `1px solid ${LINE}`, color: INK,
            }}
          />
          <button
            type="submit"
            disabled={thinking || !input.trim()}
            aria-label="Send"
            className="font-body rounded-xl"
            style={{
              flexShrink: 0, padding: "10px 16px", fontSize: 13.5, fontWeight: 700,
              background: TEAL, color: "#03211d", border: `1px solid ${TEAL}`,
              opacity: thinking || !input.trim() ? 0.45 : 1,
              cursor: thinking || !input.trim() ? "default" : "pointer",
            }}
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}

export function RulesBot() {
  const [open, setOpen] = useState(false);

  // The rules stepper's last card has an "Ask a question" button — it has no
  // reference to this component's state, so it reaches it via a window event
  // instead. Anything else on the page could open the sheet the same way.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("rules-bot-open", onOpen);
    return () => window.removeEventListener("rules-bot-open", onOpen);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Ask about the rules"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", right: 16,
          // Clears the fixed BottomNav (measured 80px on web, icons + labels
          // + padding, NOT the 58 first assumed) plus the home-indicator safe
          // area, with a 14px breathing gap.
          bottom: "calc(80px + env(safe-area-inset-bottom) + 14px)",
          zIndex: 45,
          width: 48, height: 48, borderRadius: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: tint(TEAL, "22"), border: `1px solid ${tint(TEAL, "66")}`,
          color: TEAL, fontSize: 20, fontWeight: 800, cursor: "pointer",
          boxShadow: "0 6px 18px -6px rgba(0,216,192,0.45)",
        }}
      >
        ?
      </button>
      {open && <RulesSheet onClose={() => setOpen(false)} />}
    </>
  );
}
