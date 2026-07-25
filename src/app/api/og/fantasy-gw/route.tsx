/**
 * /api/og/fantasy-gw — link-preview card for a shared fantasy gameweek result.
 *
 * Gold on deep pitch (the fantasy identity): the score, the gameweek, who wore
 * the armband and the week's top scorer, and the hook. The job is the same as
 * every share card here: pull a scroller out of the chat and into the game.
 *
 * Query: ?gw=3&pts=122&name=Zed&cap=Saka~24&top=Haaland~31
 * Satori rules apply: every multi-child div is display:flex, and the response
 * has ONE root child (the 38-0 lesson — more than one renders a 0-byte PNG).
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const PITCH = "#0d1f16";
const PANEL = "#132b1e";
const GOLD = "#e3b341";
const INK = "#f2efe6";
const MUTED = "#8fa396";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const gw = q.get("gw") ?? "?";
  const pts = q.get("pts") ?? "0";
  const name = (q.get("name") ?? "").slice(0, 24);
  const [capName, capPts] = (q.get("cap") ?? "").split("~");
  const [topName, topPts] = (q.get("top") ?? "").split("~");

  const line = (label: string, player?: string, value?: string) =>
    player ? (
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, color: MUTED }}>
        <span>{label}</span>
        <span style={{ color: INK, fontWeight: 700 }}>{player}</span>
        {value ? <span style={{ color: GOLD, fontWeight: 700 }}>{value} pts</span> : null}
      </div>
    ) : null;

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: PITCH, padding: 56, fontFamily: "sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={44} height={44} alt="" />
          <span style={{ fontSize: 28, color: GOLD, letterSpacing: 4, fontWeight: 700 }}>
            YOURSCORE FANTASY FOOTBALL
          </span>
        </div>

        <div style={{
          display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center",
          background: PANEL, borderRadius: 24, border: `2px solid ${GOLD}`,
          marginTop: 36, padding: "40px 48px", gap: 18,
        }}>
          <span style={{ fontSize: 26, color: MUTED, letterSpacing: 3 }}>
            {`GAMEWEEK ${gw}${name ? ` · ${name.toUpperCase()}` : ""}`}
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <span style={{ fontSize: 132, fontWeight: 800, color: GOLD, lineHeight: 1 }}>{pts}</span>
            <span style={{ fontSize: 44, color: INK, fontWeight: 700 }}>points</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {line("Captain", capName, capPts)}
            {line("Top scorer", topName, topPts)}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32 }}>
          <span style={{ fontSize: 28, color: INK }}>Your knowledge earns your transfers.</span>
          <span style={{
            fontSize: 26, fontWeight: 800, color: "#2A1F00", background: GOLD,
            padding: "14px 28px", borderRadius: 999,
          }}>BUILD YOUR SQUAD →</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
