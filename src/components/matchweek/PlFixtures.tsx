"use client";

/**
 * Matchweek → PL → Fixtures. This gameweek's Premier League matches, each with
 * its halftime quiz attached (the same data powers the Live Quiz rail). Reads
 * /api/pl/fixtures, which projects halftime_releases — so a fixture and its quiz
 * are never out of sync, and the quiz link only appears once the pack is live.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crest } from "@/components/clubs/Crest";

const TEAL = "#00d8c0";

interface Fixture {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  state: string;
  quiz: { live: boolean; pack_id: string | null; slug: string | null };
}

/** "Sat 15:00" — day + time in UK time, the way a fixture list reads. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London", hour12: false,
  });
}

export function PlFixtures() {
  const [round, setRound] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/pl/fixtures")
      .then((r) => r.json())
      .then((d) => { if (live) { setRound(d.round ?? null); setFixtures(d.fixtures ?? []); } })
      .catch(() => { if (live) setFixtures([]); });
    return () => { live = false; };
  }, []);

  if (fixtures === null) return null; // loading — the tab shows nothing rather than a flash
  if (fixtures.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-4">
        <EmptyCard title="No fixtures scheduled" body="The next gameweek's matches will appear here once they're confirmed." />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      {round && (
        <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#586058" }}>
          GAMEWEEK {round}
        </p>
      )}
      <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {fixtures.map((f, i) => (
          <div
            key={f.fixture_id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: i ? "1px solid rgba(255,255,255,0.05)" : "none" }}
          >
            {/* Teams */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Crest name={f.home} size={22} />
              <span className="font-body text-sm text-white truncate">{f.home}</span>
            </div>
            <span className="font-display text-[11px] flex-shrink-0" style={{ color: "#586058" }}>v</span>
            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              <span className="font-body text-sm text-white truncate text-right">{f.away}</span>
              <Crest name={f.away} size={22} />
            </div>

            {/* Quiz status / kickoff */}
            <div className="flex-shrink-0 w-[92px] text-right">
              {f.quiz.live && f.quiz.slug ? (
                <Link
                  href={`/challenges/${f.quiz.slug}?pid=${f.quiz.pack_id}`}
                  className="inline-block rounded-lg px-2.5 py-1 active:scale-[0.97] transition-transform"
                  style={{ background: "rgba(0,216,192,0.15)", border: `1px solid ${TEAL}55` }}
                >
                  <span className="font-display text-[10px] tracking-wide" style={{ color: TEAL }}>PLAY →</span>
                </Link>
              ) : (
                <span className="font-body text-xs" style={{ color: "#8a948f" }}>{whenLabel(f.kickoff_at)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="font-body text-xs mt-3 px-1" style={{ color: "#586058" }}>
        A quiz drops for each match at the half-time whistle.
      </p>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl p-6 bg-surface text-center" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <p className="font-display text-sm text-white mb-1">{title}</p>
      <p className="font-body text-xs" style={{ color: "#8a948f" }}>{body}</p>
    </div>
  );
}
