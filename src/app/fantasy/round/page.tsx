"use client";
/** The weekly knowledge round — 11 questions, right answers earn transfer credits. */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, GOLD, Header, INK, LINE, MUTED, page, PANEL,
} from "@/components/fantasy/shared";

interface Clues { nationality?: string; flag?: string; jersey?: number }
interface Served { idx: number; format: string; prompt: string; options: { id: number; label: string }[]; position: string; clues?: Clues }
interface StartRes { questions: Served[]; answered: number; correct: number; done: boolean; creditsEarned: number }
interface StepRes { correct: boolean; answerId: number; correctCount: number; answered: number; done: boolean; creditsEarned: number | null }

const TIMER_SECONDS = 20; // uniform, display-only (anti-look-up; never scored)
/** Credit curve: 3 correct → 1 transfer, 5 → 2, 7 → 3, 9 → 4. */
const THRESHOLDS = [3, 5, 7, 9];
const creditsAt = (correct: number) => THRESHOLDS.filter((t) => correct >= t).length;

export default function RoundPage() {
  const router = useRouter();
  const [round, setRound] = useState<StartRes | null>(null);
  const [k, setK] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [reveal, setReveal] = useState<StepRes | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [secs, setSecs] = useState(TIMER_SECONDS);
  const [timedOut, setTimedOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answering = useRef(false);

  useEffect(() => {
    api<StartRes>("round/start").then((r) => {
      setRound(r); setK(r.answered); setCorrectCount(r.correct);
    }).catch((e) => {
      if ((e as { status?: number }).status === 401) router.replace("/auth/sign-in?next=/fantasy");
      else if ((e as { code?: string }).code === "no-squad") router.replace("/fantasy/build");
      else setErr((e as Error).message);
    });
  }, [router]);

  useEffect(() => {
    if (reveal || !round || round.done) return;
    setSecs(TIMER_SECONDS);
    const t = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [k, reveal, round]);

  // Running out of time submits the question as unanswered and moves you on —
  // the server takes optionId: null and grades it wrong. Without this the timer
  // just sat at 0s and the round stalled.
  useEffect(() => {
    if (secs > 0 || reveal || !round || round.done || answering.current) return;
    setTimedOut(true);
    void submit(null);
    // submit is stable for the current k; re-running on every dep would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secs, reveal, round]);

  const submit = async (optionId: number | null) => {
    if (answering.current || reveal) return;
    answering.current = true;
    setPicked(optionId);
    try {
      const r = await api<StepRes>("round/step", { k, optionId });
      setReveal(r); setCorrectCount(r.correctCount);
      if (r.done) setRound((prev) => prev && ({ ...prev, done: true, creditsEarned: r.creditsEarned ?? 0, correct: r.correctCount, answered: r.answered }));
    } catch (e) { setErr((e as Error).message); }
    answering.current = false;
  };

  if (err) return <main style={page}><Header /><p style={{ color: "#E08A6B" }}>{err}</p></main>;
  if (!round) return <main style={page}><Header /><p style={{ color: MUTED }}>Loading…</p></main>;

  const finished = round.done || k >= round.questions.length;
  const q = round.questions[k];

  const answer = (optionId: number) => void submit(optionId);
  const next = () => { setReveal(null); setPicked(null); setTimedOut(false); setK(k + 1); };

  // Did THIS answer just tip us over a credit threshold? That's a moment worth
  // marking — the founder shouldn't have to wait until the round ends to learn
  // he's earned a transfer.
  const justEarned = !!reveal && reveal.correct && THRESHOLDS.includes(reveal.correctCount);

  if (finished) {
    const credits = round.creditsEarned;
    const got = correctCount || round.correct;
    // Curve: 3→1, 5→2, 7→3, 9→4. Show progress to the NEXT credit.
    const THRESHOLDS = [3, 5, 7, 9];
    const nextAt = THRESHOLDS.find((t) => got < t);
    return (
      <main style={page}>
        <Header right={<Chip gold>✓ {got}/11</Chip>} />
        <Card style={{ border: `1px solid ${GOLD}`, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 13, letterSpacing: "0.1em", color: GOLD, fontWeight: 700 }}>ROUND COMPLETE</div>
          <div style={{ fontSize: 44, fontWeight: 700, margin: "6px 0" }}>
            {credits > 0 ? `+${credits} transfer${credits === 1 ? "" : "s"}` : "No transfers"}
          </div>
          <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 8px", lineHeight: 1.5 }}>
            {got}/11 correct.{" "}
            {credits === 0
              ? "You need 3 right to earn your first transfer."
              : nextAt
                ? `${nextAt - got} more next time would've earned another.`
                : "Top of the curve — the most a round can earn."}
          </p>
          <p style={{ fontSize: 11.5, color: MUTED, margin: "0 0 16px" }}>
            How it works: 3 correct = 1 transfer · 5 = 2 · 7 = 3 · 9 = 4. Transfers bank up to five.
          </p>
          <Btn gold onClick={() => router.push("/fantasy")}>Back to my squad</Btn>
        </Card>
      </main>
    );
  }

  return (
    <main style={page}>
      <Header right={<>
        <Chip>Q {k + 1}/11</Chip>
        <Chip gold>✓ {correctCount}</Chip>
        <Chip>{secs}s</Chip>
      </>} />
      <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>
        {q.position} QUESTION
      </div>

      {/* Who-am-I clue badges. The generator keeps nationality + shirt number OUT
          of the prompt text so they can be shown as visuals — without these the
          question reads "I'm a midfielder. I'm 32." and can't be answered. */}
      {q.clues && (q.clues.flag || q.clues.jersey) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {q.clues.flag && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 11px 6px 7px",
              borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.clues.flag} alt="" width={22} height={16}
                style={{ width: 22, height: 16, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{q.clues.nationality}</span>
            </span>
          )}
          {q.clues.jersey !== undefined && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px",
              borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`,
            }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, borderRadius: 5, background: GOLD, color: "#2A1F00",
                fontSize: 12, fontWeight: 800,
              }}>{q.clues.jersey}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: MUTED }}>shirt</span>
            </span>
          )}
        </div>
      )}

      <h2 style={{ fontSize: 19, lineHeight: 1.4, margin: "0 0 16px", whiteSpace: "pre-line", fontWeight: 600 }}>
        {q.prompt}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {q.options.map((o) => {
          const isPicked = picked === o.id;
          // Only colour after the server reveals — before that a picked option
          // shows a NEUTRAL "selected" state (was flashing red pre-answer).
          const isAnswer = !!reveal && o.id === reveal.answerId;
          const isWrongPick = !!reveal && isPicked && !reveal.correct;
          const pendingPick = isPicked && !reveal;
          return (
            <button key={o.id} onClick={() => answer(o.id)} disabled={!!reveal} style={{
              padding: "13px 14px", borderRadius: 12, fontSize: 14.5, fontWeight: 600,
              textAlign: "left", cursor: reveal ? "default" : "pointer", color: INK,
              background: isAnswer ? "#1E3B2A" : isWrongPick ? "#3A2320" : pendingPick ? "#233B2C" : PANEL,
              border: `1.5px solid ${isAnswer ? GOLD : isWrongPick ? "#B85C38" : pendingPick ? GOLD : LINE}`,
              opacity: reveal && !isAnswer && !isPicked ? 0.55 : 1,
              transition: "background 120ms, border-color 120ms",
            }}>
              {o.label}{isAnswer ? "  ✓" : isWrongPick ? "  ✕" : ""}
            </button>
          );
        })}
      </div>
      {reveal && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13.5, color: reveal.correct ? GOLD : MUTED, margin: "0 0 10px", fontWeight: 600 }}>
            {reveal.correct ? "Correct." : timedOut ? "Out of time." : "Not this time."}
          </p>

          {/* The transfer is the whole point of the round — mark it the moment it's earned. */}
          {justEarned && (
            <div style={{
              background: "#233B2C", border: `1px solid ${GOLD}`, borderRadius: 12,
              padding: "11px 13px", marginBottom: 10,
            }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: GOLD }}>
                You&apos;ve earned a transfer
              </div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                {reveal.correctCount} correct — that&apos;s {creditsAt(reveal.correctCount)} transfer
                {creditsAt(reveal.correctCount) === 1 ? "" : "s"} this week.
                {reveal.correctCount < 9 && ` Get to ${THRESHOLDS.find((t) => reveal.correctCount < t)} for another.`}
              </div>
            </div>
          )}

          <Btn gold onClick={next}>{k === 10 ? "Finish round" : "Next question"}</Btn>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: MUTED, marginTop: 16, lineHeight: 1.4 }}>
        The timer is a guide, not a score — speed never earns anything here.
      </p>
    </main>
  );
}
