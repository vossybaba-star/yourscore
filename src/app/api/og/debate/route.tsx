/**
 * /api/og/debate — the link-preview image for /debate (1200x630).
 *
 * The unfurl carries today's actual question so the share bait is the debate
 * itself, not a generic brand card. Rotates with the daily pick; edge runtime
 * can't use the server Supabase helpers, so it reads via PostgREST directly
 * (debates are world-readable by RLS).
 */

import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GOLD = "#ffc233";

async function todaysQuestion(): Promise<{ question: string; options: string[] } | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  const res = await fetch(
    `${base}/rest/v1/debates?active=eq.true&select=question,options&order=created_at.asc`,
    { headers: { apikey: key, authorization: `Bearer ${key}` }, next: { revalidate: 3600 } }
  ).catch(() => null);
  if (!res?.ok) return null;
  const rows: { question: string; options: string[] }[] = await res.json().catch(() => []);
  if (!rows.length) return null;
  const uk = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const day = Math.floor(Date.parse(`${uk}T00:00:00Z`) / 86_400_000);
  return rows[day % rows.length];
}

export async function GET() {
  const debate = await todaysQuestion();
  const question = debate?.question ?? "One football debate a day. Settle it.";
  const fontSize = question.length > 60 ? 52 : 64;

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(150deg, #0a0a0f 0%, #14110a 55%, #0b0d08 100%)", fontFamily: "sans-serif", position: "relative", padding: "60px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_DATA_URI} width={260} height={70} alt="YourScore" style={{ display: "flex" }} />

        <div style={{ display: "flex", marginTop: 40, padding: "10px 30px", borderRadius: 999, background: "rgba(255,194,51,0.1)", border: `1px solid ${GOLD}55` }}>
          <span style={{ display: "flex", color: GOLD, fontSize: 28, fontWeight: 800, letterSpacing: 4 }}>TODAY&apos;S DEBATE</span>
        </div>

        <span style={{ display: "flex", fontSize, fontWeight: 900, color: "#fff", lineHeight: 1.15, marginTop: 32, textAlign: "center", maxWidth: 1000 }}>{question}</span>

        <span style={{ display: "flex", fontSize: 30, color: "#c4ccc6", fontWeight: 600, marginTop: 36 }}>Vote. See the split. Argue it out.</span>

        <span style={{ display: "flex", fontSize: 28, color: GOLD, fontWeight: 800, marginTop: 32 }}>yourscore.app/debate</span>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 12, background: GOLD }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
