"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { DiscussionThread } from "@/components/debate/DiscussionThread";

// Today's debate — one subjective football question a day, no right answer.
// Tap an option, watch the community split land. The payoff is disagreement:
// the card is deliberately loudest when the room is divided.
//
// NO ACCOUNT NEEDED to vote (founder, Jul 5): guests vote under a per-device
// key and their vote is remembered locally; sign-up is the gate for the
// argument (comments), not the ballot.

const GOLD = "#ffc233";

const VOTER_KEY = "ys:debate:voter";
const VOTED_KEY = "ys:debate:voted";

/** Stable per-device key for anonymous votes. */
function voterKey(): string {
  try {
    let k = localStorage.getItem(VOTER_KEY);
    if (!k) {
      k = crypto.randomUUID();
      localStorage.setItem(VOTER_KEY, k);
    }
    return k;
  } catch {
    return "no-storage-" + Math.random().toString(36).slice(2, 12);
  }
}

/** Guests' own votes, remembered on the device: { [debateId]: optionIdx }. */
function localVotes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VOTED_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function rememberVote(debateId: string, idx: number) {
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify({ ...localVotes(), [debateId]: idx }));
  } catch { /* fine — they can vote again elsewhere */ }
}

interface TodayPayload {
  debate: { id: string; question: string; options: string[] } | null;
  counts: number[];
  total: number;
  yourVote: number | null;
}

export function DebateCard({
  withDiscussion = true,
  signInNext = "/debate",
  initialPick = null,
  withSignUpPitch = true,
}: {
  /** Render the debate's own comment thread beneath the card. On by default —
   * pass false only where another thread already owns the page (quiz room). */
  withDiscussion?: boolean;
  signInNext?: string;
  /** Share-link pre-pick (/debate?pick=N): auto-casts once signed in and
   * unvoted; signed-out visitors see the option highlighted, and their tap
   * rides through sign-in via signInNext. */
  initialPick?: number | null;
  /** The "prove it, play on YourScore" footer. Only earns its place where the
   * card is the whole visit (the public /debate landing). Pass false inside the
   * app — they're already here, and it would flash while the session loads. */
  withSignUpPitch?: boolean;
}) {
  const { user } = useUser();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/debate/today").then((r) => r.json()).then((d: TodayPayload) => {
      // Guests: the server can't know their vote — the device does.
      if (d?.debate && d.yourVote === null) {
        const mine = localVotes()[d.debate.id];
        if (mine !== undefined) d = { ...d, yourVote: mine };
      }
      setData(d);
    }).catch(() => setData(null));
  }, []);

  // Share-link pre-pick (?pick=N): the tap they made on X WAS the vote —
  // cast it on landing, signed in or not. Fires once per mount.
  const autoCastRef = useRef(false);
  useEffect(() => {
    if (initialPick === null || autoCastRef.current) return;
    if (!data?.debate) return;
    autoCastRef.current = true;
    if (data.yourVote !== null) return; // already had their say
    if (initialPick < 0 || initialPick >= data.debate.options.length) return;
    const debate = data.debate;
    (async () => {
      const res = await fetch("/api/debate/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ debateId: debate.id, optionIdx: initialPick, ...(user ? {} : { voterKey: voterKey() }) }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        if (!user) rememberVote(debate.id, initialPick);
        setData({ debate, counts: body.counts, total: body.total, yourVote: body.yourVote });
      }
    })();
  }, [initialPick, user, data]);

  if (!data?.debate) return null;
  const { debate, counts, total, yourVote } = data;
  const voted = yourVote !== null;

  async function vote(idx: number) {
    if (pending !== null) return;
    setPending(idx);
    try {
      const res = await fetch("/api/debate/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ debateId: debate!.id, optionIdx: idx, ...(user ? {} : { voterKey: voterKey() }) }),
      });
      const body = await res.json();
      if (res.ok) {
        if (!user) rememberVote(debate!.id, idx);
        setData({ debate, counts: body.counts, total: body.total, yourVote: body.yourVote });
      }
    } finally {
      setPending(null);
    }
  }

  const card = (
    <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(160deg, rgba(255,194,51,0.08), #0e1611)", border: `1px solid ${GOLD}33` }}>
      <div className="px-5 pt-4 pb-1 flex items-center justify-between">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: GOLD }}>Today&rsquo;s debate</p>
        {total > 0 && (
          <p className="font-body text-[10px]" style={{ color: "#586058" }}>{total.toLocaleString()} vote{total === 1 ? "" : "s"}</p>
        )}
      </div>
      <p className="px-5 pt-1 pb-1 font-display text-xl text-white leading-tight">{debate.question}</p>
      {!voted && (
        <p className="px-5 pb-3 font-body text-[11px]" style={{ color: "#8a948f" }}>
          Tap one — that&rsquo;s your vote, done.
        </p>
      )}
      {/* The payoff for voting: where the room stands right now */}
      {voted && (
        <p className="px-5 pb-3 font-body text-[11px]" style={{ color: "#8a948f" }}>
          The split so far —
        </p>
      )}

      <div className="px-5 pb-4 space-y-2">
        {debate.options.map((label, i) => {
          const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
          const mine = yourVote === i;
          if (!voted) {
            // Share-link arrivals see their picked side highlighted; the tap
            // (and the sign-in it may route through) completes that vote.
            const prePicked = !user && initialPick === i;
            return (
              <button
                key={i}
                onClick={() => vote(i)}
                disabled={pending !== null}
                className="w-full flex items-center gap-3 text-left rounded-xl py-3 px-4 font-body text-sm font-bold active:scale-[0.99] transition-transform"
                style={{
                  background: pending === i || prePicked ? `${GOLD}2b` : "rgba(255,255,255,0.05)",
                  color: "#eef2f0",
                  border: `1px solid ${prePicked ? `${GOLD}66` : "rgba(255,255,255,0.12)"}`,
                }}
              >
                {/* empty tick circle: this is a one-tap ballot, not a link */}
                <span className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ width: 20, height: 20, border: `1.5px solid ${pending === i || prePicked ? GOLD : "rgba(255,255,255,0.3)"}` }}>
                  {pending === i && <span className="rounded-full" style={{ width: 10, height: 10, background: GOLD }} />}
                </span>
                <span className="min-w-0">{label}</span>
              </button>
            );
          }
          // Voted: split bars, yours gets the gold tick.
          return (
            <div key={i} className="relative rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${mine ? `${GOLD}66` : "rgba(255,255,255,0.08)"}` }}>
              <div
                className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
                style={{ width: `${pct}%`, background: mine ? `${GOLD}2e` : "rgba(255,255,255,0.06)" }}
              />
              <div className="relative flex items-center gap-3 py-3 px-4">
                {mine ? (
                  <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 20, height: 20, background: GOLD }}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6.5L4.8 9L10 3.5" stroke="#10160c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : (
                  <span className="flex-shrink-0" style={{ width: 20 }} />
                )}
                <p className="font-body text-sm font-bold flex-1 min-w-0" style={{ color: mine ? GOLD : "#eef2f0" }}>{label}</p>
                <p className="font-display text-base flex-shrink-0" style={{ color: mine ? GOLD : "#8a948f" }}>{pct}%</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comments live INSIDE the debate card, not in a card of their own —
          they're the same conversation, so they read as one block. */}
      {withDiscussion && (
        <DiscussionThread
          embedded
          subjectType="debate"
          subjectId={debate.id}
          title="Comments"
          accent={GOLD}
          signInNext={signInNext}
          canPost={voted}
          lockedHint="Vote first, then have your say"
        />
      )}

      {/* Voting is free; the pitch after it is the games. */}
      {withSignUpPitch && voted && !user && (
        <div className="px-5 py-3.5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)" }}>
          <p className="font-body text-[11px] text-center" style={{ color: "#8a948f" }}>
            Vote counted. Reckon you actually know your football?{" "}
            <Link href="/" className="font-bold" style={{ color: GOLD }}>
              Prove it, play on YourScore →
            </Link>
          </p>
        </div>
      )}
    </div>
  );

  // Comments are PUBLIC to read whether you voted or not (founder, Jul 23) —
  // seeing the argument is the draw. Posting is what voting buys you.
  return card;
}
