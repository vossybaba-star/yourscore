"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { DiscussionThread } from "@/components/debate/DiscussionThread";

// Today's debate — one subjective football question a day, no right answer.
// Tap an option, watch the community split land. The payoff is disagreement:
// the card is deliberately loudest when the room is divided.

const GOLD = "#ffc233";

interface TodayPayload {
  debate: { id: string; question: string; options: string[] } | null;
  counts: number[];
  total: number;
  yourVote: number | null;
}

export function DebateCard({
  withDiscussion = false,
  signInNext = "/debate",
}: {
  /** Render the debate's own discussion thread beneath the card. */
  withDiscussion?: boolean;
  signInNext?: string;
}) {
  const { user } = useUser();
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/debate/today").then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

  if (!data?.debate) return null;
  const { debate, counts, total, yourVote } = data;
  const voted = yourVote !== null;

  async function vote(idx: number) {
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(signInNext)}`); return; }
    if (pending !== null) return;
    setPending(idx);
    try {
      const res = await fetch("/api/debate/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ debateId: debate!.id, optionIdx: idx }),
      });
      const body = await res.json();
      if (res.ok) {
        setData({ debate, counts: body.counts, total: body.total, yourVote: body.yourVote });
      }
    } finally {
      setPending(null);
    }
  }

  async function share() {
    const url = "https://yourscore.app/debate";
    const text = `${debate!.question} — settle it on YourScore`;
    if (navigator.share) await navigator.share({ title: "Today's debate", text, url }).catch(() => {});
    else await navigator.clipboard?.writeText(`${text} ${url}`).catch(() => {});
  }

  const card = (
    <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(160deg, rgba(255,194,51,0.08), #0e1611)", border: `1px solid ${GOLD}33` }}>
      <div className="px-5 pt-4 pb-1 flex items-center justify-between">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: GOLD }}>Today&rsquo;s debate</p>
        {total > 0 && (
          <p className="font-body text-[10px]" style={{ color: "#586058" }}>{total.toLocaleString()} vote{total === 1 ? "" : "s"}</p>
        )}
      </div>
      <p className="px-5 pt-1 pb-4 font-display text-xl text-white leading-tight">{debate.question}</p>

      <div className="px-5 pb-4 space-y-2">
        {debate.options.map((label, i) => {
          const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
          const mine = yourVote === i;
          if (!voted) {
            return (
              <button
                key={i}
                onClick={() => vote(i)}
                disabled={pending !== null}
                className="w-full text-left rounded-xl py-3 px-4 font-body text-sm font-bold active:scale-[0.99] transition-transform"
                style={{
                  background: pending === i ? `${GOLD}2b` : "rgba(255,255,255,0.05)",
                  color: "#eef2f0",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {label}
              </button>
            );
          }
          // Voted: split bars, yours in gold.
          return (
            <div key={i} className="relative rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${mine ? `${GOLD}66` : "rgba(255,255,255,0.08)"}` }}>
              <div
                className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
                style={{ width: `${pct}%`, background: mine ? `${GOLD}2e` : "rgba(255,255,255,0.06)" }}
              />
              <div className="relative flex items-center justify-between py-3 px-4">
                <p className="font-body text-sm font-bold" style={{ color: mine ? GOLD : "#eef2f0" }}>
                  {label}{mine ? " · you" : ""}
                </p>
                <p className="font-display text-base" style={{ color: mine ? GOLD : "#8a948f" }}>{pct}%</p>
              </div>
            </div>
          );
        })}
      </div>

      {voted && (
        <div className="px-5 pb-4">
          <button
            onClick={share}
            className="w-full rounded-xl py-3 font-display text-[12px] tracking-widest active:scale-[0.99] transition-transform"
            style={{ background: `${GOLD}14`, color: GOLD, border: `1px solid ${GOLD}44` }}
          >
            DRAG A FRIEND INTO IT →
          </button>
        </div>
      )}
    </div>
  );

  if (!withDiscussion) return card;
  return (
    <div className="space-y-2.5">
      {card}
      <DiscussionThread subjectType="debate" subjectId={debate.id} title="The argument" accent={GOLD} signInNext={signInNext} />
    </div>
  );
}
