"use client";

/**
 * Matchweek → PL → Fixtures. This gameweek's Premier League matches, each with
 * its halftime quiz attached (the same data powers the Live Quiz rail). Reads
 * /api/pl/fixtures, which projects halftime_releases — so a fixture and its quiz
 * are never out of sync, and the quiz link only appears once the pack is live.
 *
 * Grouped by DAY under the gameweek (founder, 2026-07-16). A gameweek is not one
 * block of matches — it's a Friday night, a Saturday, a Sunday — and a flat list
 * of ten hid that entirely.
 *
 * The action is "Notify me", not "Play": a pack only exists from its own
 * half-time whistle, so for every fixture that hasn't kicked off there is nothing
 * to play, and offering it would be a dead button. PLAY appears on a row the
 * moment that match's pack goes live.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crest } from "@/components/clubs/Crest";
import { NotifyButton } from "./NotifyButton";
import { useReminders } from "./useReminders";

const TEAL = "#00d8c0";

interface Fixture {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  state: string;
  quiz: { live: boolean; pack_id: string | null; slug: string | null };
}

/** "20:00" — kick-off in UK time. */
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London", hour12: false });

/** "Friday 21 August" — the day subheading. */
const dayHeading = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

/** Stable per-day key in UK time (not the UTC date — a 20:00 BST kick-off must
 *  not slide into the next day). */
const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

export function PlFixtures() {
  const [round, setRound] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const reminders = useReminders();

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

  // Group by day, chronologically. A Map keeps first-seen order, and the API
  // already returns fixtures in kickoff order.
  const byDay = new Map<string, Fixture[]>();
  for (const f of [...fixtures].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))) {
    const k = dayKey(f.kickoff_at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(f);
  }
  const days = Array.from(byDay.entries());

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      {round && (
        <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#586058" }}>
          GAMEWEEK {round}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {days.map(([key, dayFixtures]) => (
          <div key={key}>
            {/* Day subheading */}
            <p className="font-body text-xs font-semibold mb-2 px-1" style={{ color: TEAL }}>
              {dayHeading(dayFixtures[0].kickoff_at)}
            </p>

            <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              {dayFixtures.map((f, i) => (
                <div key={f.fixture_id} className="px-4 py-3" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Crest name={f.home} size={22} />
                      <span className="font-body text-sm text-white truncate">{f.home}</span>
                    </div>
                    <span className="font-display text-[11px] flex-shrink-0" style={{ color: "#586058" }}>v</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                      <span className="font-body text-sm text-white truncate text-right">{f.away}</span>
                      <Crest name={f.away} size={22} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <span className="font-body text-xs" style={{ color: "#586058" }}>
                      {timeLabel(f.kickoff_at)} kick-off
                    </span>
                    {f.quiz.live && f.quiz.slug ? (
                      <Link
                        href={`/challenges/${f.quiz.slug}?pid=${f.quiz.pack_id}`}
                        className="inline-block rounded-full px-3 py-1.5 active:scale-[0.97] transition-transform"
                        style={{ background: "rgba(0,216,192,0.15)", border: `1px solid ${TEAL}55` }}
                      >
                        <span className="font-display text-[10px] tracking-wide" style={{ color: TEAL }}>PLAY →</span>
                      </Link>
                    ) : (
                      <NotifyButton fixtureId={f.fixture_id} reminders={reminders} />
                    )}
                  </div>
                </div>
              ))}
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
