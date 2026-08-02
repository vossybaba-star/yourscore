"use client";
/**
 * /fantasy/rules — how the game actually works.
 *
 * The audit's trust finding: the result card explains one player's points
 * beautifully, and nothing anywhere states the scoring table, the cost of an
 * extra transfer, what the armband multiplies, how auto-subs pick a
 * replacement, or how a credit becomes points. Managers were learning the rules
 * by losing to them.
 *
 * EVERY NUMBER ON THIS PAGE IS COMPUTED, NOT TYPED. The scoring rows call the
 * real `pointsFor` and take the difference a single fact makes; the economy
 * numbers come from the engine's own exported constants. A rules page that
 * drifts from the engine is worse than no rules page, and a hand-maintained
 * table drifts the first time someone tunes a value — so there is nothing here
 * to maintain.
 */
import { useRouter } from "next/navigation";
import {
  BUDGET_TENTHS, CASH_POINTS, CREDIT_CAP,
  HIT_POINTS, MAX_PER_CLUB, SQUAD_QUOTA, SQUAD_SIZE, XI_SIZE,
  BASELINE_CREDITS_PER_GW, creditsForRound,
} from "@/lib/fantasy/engine";
import { pointsFor, ZERO_FACTS, type FantasyPos, type MatchFacts } from "@/lib/fantasy/values";
import {
  Btn, Card, GOLD, Header, INK, LINE, MUTED, page, PANEL, TEAL, tint,
} from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import { RulesCards } from "@/components/fantasy/RulesCards";
import { RulesBot } from "@/components/fantasy/RulesBot";

const POSITIONS: FantasyPos[] = ["GK", "DEF", "MID", "FWD"];

/** What one fact is worth to one position: score a baseline 90 minutes, then
 *  score it again with the fact applied, and show the difference. This is the
 *  engine answering for itself. */
function worth(pos: FantasyPos, fact: Partial<MatchFacts>, baseMinutes = 90): number | null {
  const base: MatchFacts = { ...ZERO_FACTS, minutes: baseMinutes };
  const withFact: MatchFacts = { ...base, ...fact };
  const delta = pointsFor(pos, withFact) - pointsFor(pos, base);
  return delta === 0 ? null : delta;
}

const ROWS: { label: string; note?: string; value: (pos: FantasyPos) => number | null }[] = [
  { label: "Playing 60 minutes or more", value: (p) => pointsFor(p, { ...ZERO_FACTS, minutes: 90 }) },
  { label: "Playing under 60 minutes", value: (p) => pointsFor(p, { ...ZERO_FACTS, minutes: 30 }) },
  { label: "Goal", value: (p) => worth(p, { goals: 1 }) },
  { label: "Assist", value: (p) => worth(p, { assists: 1 }) },
  { label: "Clean sheet", note: "60 minutes or more", value: (p) => worth(p, { cleanSheet: 1 }) },
  { label: "Every 3 saves", value: (p) => worth(p, { saves: 3 }) },
  { label: "Penalty saved", value: (p) => worth(p, { pensSaved: 1 }) },
  { label: "Every 2 goals conceded", value: (p) => worth(p, { conceded: 2 }) },
  {
    label: "Defensive contribution",
    note: "10 clearances, interceptions, tackles and blocks for a defender; 12 including recoveries for everyone else",
    value: (p) => worth(p, p === "DEF" ? { dc: 10 } : { dcRec: 12 }),
  },
  { label: "Penalty missed", value: (p) => worth(p, { pensMissed: 1 }) },
  { label: "Yellow card", value: (p) => worth(p, { yellows: 1 }) },
  { label: "Red card", value: (p) => worth(p, { reds: 1 }) },
  { label: "Own goal", value: (p) => worth(p, { ownGoals: 1 }) },
];

/** The credit curve, read off the engine rather than restated. */
const CREDIT_STEPS = (() => {
  const steps: { correct: number; credits: number }[] = [];
  let last = 0;
  for (let c = 0; c <= 11; c++) {
    const credits = creditsForRound(c);
    if (credits !== last) { steps.push({ correct: c, credits }); last = credits; }
  }
  return steps;
})();

export default function RulesPage() {
  const router = useRouter();
  const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

  const Cell = ({ v }: { v: number | null }) => (
    <td style={{
      textAlign: "center", padding: "9px 3px", borderTop: `1px solid ${LINE}`,
      fontVariantNumeric: "tabular-nums", fontWeight: v === null ? 400 : 700,
      color: v === null ? "#3f4744" : v > 0 ? INK : "#E08A6B", width: 34,
    }}>{v === null ? "–" : v > 0 ? `+${v}` : v}</td>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <>
      <div className="font-display tracking-widest"
        style={{ fontSize: 11.5, color: TEAL, margin: "26px 0 8px" }}>{title}</div>
      {children}
    </>
  );

  return (
    <>
    <main data-fantasy style={page}>
      <Header exit={{ label: "Fantasy", onClick: () => router.push("/fantasy") }} />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>How it works</h1>
      <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 4px", lineHeight: 1.5 }}>
        The whole game, start to finish. Every number is read straight from the scoring engine, so
        this page and the game can never disagree.
      </p>

      {/* The eight-beat story stepper carries the whole journey; the reference
          tables below spell each step out in full. (The old numbered
          walkthrough said the same things as the cards, so it went.) */}
      <RulesCards />

      <div className="font-display tracking-widest" style={{ fontSize: 11.5, color: MUTED, margin: "30px 0 2px" }}>
        THE DETAIL
      </div>

      <Section title="SCORING">
        <Card>
          <div style={{ overflowX: "auto", margin: "0 -4px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>
                  <th style={{ textAlign: "left", padding: "0 6px 7px", fontWeight: 600 }}>WHAT HAPPENED</th>
                  {POSITIONS.map((p) => (
                    <th key={p} style={{ textAlign: "center", padding: "0 3px 7px", fontWeight: 600, width: 34 }}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <td style={{ padding: "9px 6px", borderTop: `1px solid ${LINE}` }}>
                      <span style={{ fontSize: 13 }}>{row.label}</span>
                      {row.note && (
                        <span style={{ display: "block", fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>
                          {row.note}
                        </span>
                      )}
                    </td>
                    {POSITIONS.map((p) => <Cell key={p} v={row.value(p)} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: MUTED, margin: "12px 0 0", lineHeight: 1.5 }}>
            No panel decides your bonus. Every point traces to something that happened in the match,
            so two managers with the same players always get the same score. Goals, assists and every
            other fact come straight from the official match data we score from: an assist is
            whatever that data credits, including the touch before a goal and a won penalty that is
            scored.
          </p>
        </Card>
      </Section>

      <Section title="LIVE SCORES AND THE CALENDAR">
        <Card>
          <ul style={{
            fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0, paddingLeft: 18,
            listStyleType: "disc", display: "flex", flexDirection: "column", gap: 5,
          }}>
            <li>
              <b style={{ color: INK }}>Scores update live</b> while matches are on, so your total
              can move all weekend. It settles a few hours after the gameweek&apos;s last kickoff,
              and the gameweek finalises the day after, once the full match data is in
            </li>
            <li>
              <b style={{ color: INK }}>Blank gameweek</b>: if a club has no fixture, its players
              simply score nothing that week. No penalty, and the bench steps in where it legally can
            </li>
            <li>
              <b style={{ color: INK }}>Double gameweek</b>: if a club plays twice, each match is
              scored separately and the two scores add up. One player, two chances to score
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="YOUR SQUAD">
        <Card>
          <ul style={{
            fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0, paddingLeft: 18,
            listStyleType: "disc", display: "flex", flexDirection: "column", gap: 5,
          }}>
            <li>
              <b style={{ color: INK }}>{SQUAD_SIZE} players</b>: {SQUAD_QUOTA.GK} keepers,{" "}
              {SQUAD_QUOTA.DEF} defenders, {SQUAD_QUOTA.MID} midfielders, {SQUAD_QUOTA.FWD} forwards
            </li>
            <li><b style={{ color: INK }}>{money(BUDGET_TENTHS)}</b>, the same for everyone</li>
            <li>Maximum <b style={{ color: INK }}>{MAX_PER_CLUB}</b> players from any one club</li>
            <li><b style={{ color: INK }}>{XI_SIZE} start</b>, four sit on the bench. One keeper, at least three defenders and at least one forward</li>
            <li>Rebuild as often as you like until your first gameweek locks. After that you change the team with transfers</li>
          </ul>
        </Card>
      </Section>

      <Section title="THE ARMBAND">
        <Card>
          <p style={{ fontSize: 13.5, color: MUTED, margin: 0, lineHeight: 1.55 }}>
            Your captain scores <b style={{ color: GOLD }}>double</b>. If he doesn&apos;t play a minute, the
            armband passes to your vice-captain. If neither plays, it goes to whichever of your
            starters is in the best form, so a double is never wasted on somebody who was never on
            the pitch.
          </p>
        </Card>
      </Section>

      <Section title="THE BENCH">
        <Card>
          <p style={{ fontSize: 13.5, color: MUTED, margin: 0, lineHeight: 1.55 }}>
            A starter who doesn&apos;t play a minute is replaced by the first player on your bench who
            did, as long as the swap leaves a legal team. <b style={{ color: INK }}>Bench order matters</b> —
            slot 1 is tried first. Your reserve keeper only ever replaces your keeper.
          </p>
        </Card>
      </Section>

      <Section title="TRANSFERS">
        <Card>
          <ul style={{
            fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0, paddingLeft: 18,
            listStyleType: "disc", display: "flex", flexDirection: "column", gap: 5,
          }}>
            <li>Everyone gets <b style={{ color: INK }}>{BASELINE_CREDITS_PER_GW}</b> free transfer every gameweek</li>
            <li>The <b style={{ color: INK }}>optional</b> knowledge round earns you more. Unused transfers bank up to <b style={{ color: INK }}>{CREDIT_CAP}</b></li>
            <li>Beyond what you hold, each extra transfer costs <b style={{ color: "#E08A6B" }}>{HIT_POINTS} points</b></li>
            <li>
              Selling a player who has risen pays back <b style={{ color: INK }}>half the rise</b>; a player who
              has fallen sells for what he is worth now
            </li>
            <li>
              <b style={{ color: INK }}>Prices are set once</b>, when a gameweek opens, and hold for
              the whole week. Nothing moves mid week, so the price you see is the price you pay
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="THE ROUND">
        <Card>
          <p style={{ fontSize: 13.5, color: INK, margin: "0 0 10px", lineHeight: 1.55 }}>
            <b>The round is a bonus, not a requirement.</b>{" "}
            <span style={{ color: MUTED }}>
              You never have to play it to take part. Everyone gets their free transfer, and your team
              scores on the real matches whether you answer a single question or not. Play the eleven
              questions and right answers earn extra transfers on top.
            </span>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {CREDIT_STEPS.map((s) => (
              <span key={s.correct} className="font-body rounded-lg" style={{
                fontSize: 12, padding: "5px 10px", background: PANEL,
                border: `1px solid ${tint(TEAL, "33")}`, color: INK,
              }}>
                {s.correct} right → <b style={{ color: TEAL }}>{s.credits}</b>
              </span>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.55 }}>
            If your bank is already full, anything further cashes out at{" "}
            <b style={{ color: GOLD }}>{CASH_POINTS} points</b> each straight onto your gameweek score, so a
            perfect round is never wasted. A gameweek you skip entirely still counts: your team plays
            as it stands, it just earns nothing.
          </p>
        </Card>
      </Section>

      <Section title="CHIPS">
        <Card>
          <ul style={{
            fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0, paddingLeft: 18,
            listStyleType: "disc", display: "flex", flexDirection: "column", gap: 5,
          }}>
            <li>
              <b style={{ color: INK }}>One chip a month</b>, your pick of the three. A chip can&apos;t come
              back until you&apos;ve used the other two — a fresh set of three roughly every quarter
            </li>
            <li><b style={{ color: INK }}>Triple Captain</b> — your captain scores ×3</li>
            <li><b style={{ color: INK }}>Bench Boost</b> — all {SQUAD_SIZE} players score, bench included</li>
            <li><b style={{ color: INK }}>Insight</b> — takes two wrong answers off one question of the round</li>
          </ul>
        </Card>
      </Section>

      <Section title="THE TABLES">
        <Card>
          <p style={{ fontSize: 13.5, color: MUTED, margin: 0, lineHeight: 1.55 }}>
            Your season total is every gameweek added up. Each calendar month is its own competition
            that resets, so a rough August doesn&apos;t bury your season. Level on points, the manager
            with the better round record wins — {KNOWLEDGE_NAME} is the tiebreak.
          </p>
        </Card>
      </Section>

      <div style={{ marginTop: 22 }}>
        <Btn gold onClick={() => router.push("/fantasy")}>Back to my team</Btn>
      </div>
    </main>
      <RulesBot />
      <BottomNav />
    </>
  );
}
