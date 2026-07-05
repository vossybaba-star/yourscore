/**
 * /api/og/debate — the link-preview image for /debate (1200x630).
 *
 * A pixel-copy of the in-app Daily Debate tile: gold header, the question,
 * and the two UNVOTED option buttons with tick circles. On a Twitter/X feed
 * it reads as a votable poll — the whole card is one tap-through to
 * yourscore.app/debate where the vote really is one tap. Founder call (Jul 5):
 * show the buttons, not the live split — "I want my say" pulls more taps.
 *
 * Rotates with the daily pick; edge runtime can't use the server Supabase
 * helpers, so it reads via PostgREST directly (debates are world-readable).
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GOLD = "#ffc233";

async function todaysDebate(): Promise<{ question: string; options: string[] } | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  // Same date-schedule rule as src/lib/debate.ts: today's dated debate, else
  // the most recent past one. no-store: the durable data cache once pinned a
  // stale bank forever.
  const uk = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const res = await fetch(
    `${base}/rest/v1/debates?active=eq.true&day=lte.${uk}&select=question,options&order=day.desc&limit=1`,
    { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" }
  ).catch(() => null);
  if (!res?.ok) return null;
  const rows: { question: string; options: string[] }[] = await res.json().catch(() => []);
  return rows[0] ?? null;
}

export async function GET() {
  const debate = await todaysDebate();
  const question = debate?.question ?? "One football debate a day. Settle it.";
  const options = (debate?.options ?? ["Have your say", "See the split"]).slice(0, 3);
  const qSize = question.length > 90 ? 40 : question.length > 55 ? 48 : 56;

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0f", fontFamily: "sans-serif", position: "relative", padding: "44px 90px" }}>
        {/* The tile — same surface, border and layout as the in-app card */}
        <div style={{ display: "flex", flexDirection: "column", width: "100%", borderRadius: 28, padding: "36px 44px 40px", background: "linear-gradient(160deg, rgba(255,194,51,0.09), #0e1611)", border: `2px solid rgba(255,194,51,0.35)` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ display: "flex", color: GOLD, fontSize: 22, fontWeight: 800, letterSpacing: 6 }}>TODAY&apos;S DEBATE</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={150} height={40} alt="YourScore" style={{ display: "flex" }} />
          </div>

          <span style={{ display: "flex", fontSize: qSize, fontWeight: 900, color: "#fff", lineHeight: 1.14, marginTop: 22 }}>{question}</span>

          <span style={{ display: "flex", fontSize: 22, color: "#8a948f", marginTop: 12 }}>Tap one — that&apos;s your vote, done.</span>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 26, gap: 14 }}>
            {options.map((label, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 20, borderRadius: 18, padding: "20px 26px", background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.14)" }}>
                {/* empty tick circle — reads as a ballot, not a link */}
                <div style={{ display: "flex", width: 34, height: 34, borderRadius: 999, border: "2.5px solid rgba(255,255,255,0.35)" }} />
                <span style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#eef2f0" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <span style={{ display: "flex", fontSize: 26, color: GOLD, fontWeight: 800, marginTop: 26 }}>Vote now at yourscore.app/debate</span>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: GOLD }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
