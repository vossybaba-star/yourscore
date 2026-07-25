/**
 * /api/og/fantasy-squad — link-preview card for a shared SQUAD.
 *
 * The gameweek card can only exist once a gameweek has scored, which for a new
 * manager is weeks away. This is the pre-season half of the loop: the eleven you
 * picked, laid out by position so it reads as a team rather than a list, with the
 * armband marked and the money spent. Teal rather than gold — nothing has been
 * won yet, and gold is reserved for what you win (house rule).
 *
 * Query: ?xi=GK~Raya~Arsenal|DEF~Saliba~Arsenal|…&cap=Haaland&val=1000&name=Zed&gw=1
 *
 * Satori rules apply, and they bite here: EVERY div with more than one child
 * needs display:flex, and the response must have exactly ONE root child. More
 * than one root renders a 0-byte PNG (the 38-0 lesson, learned the hard way).
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const PITCH = "#0d1f16";
const PANEL = "#132b1e";
const TEAL = "#43d6c0";
const GOLD = "#e3b341";
const INK = "#f2efe6";
const MUTED = "#8fa396";

const ROWS = ["GK", "DEF", "MID", "FWD"] as const;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = (q.get("name") ?? "").slice(0, 24);
  const cap = (q.get("cap") ?? "").trim();
  const gw = q.get("gw");
  const valTenths = Number(q.get("val") ?? "0");
  // "£100.0m spent of £100.0m" is what a full squad produced, which reads like a
  // rounding error rather than a flex.
  const val = valTenths <= 0 ? null
    : valTenths >= 1000 ? "Every penny of £100.0m spent"
    : `£${(valTenths / 10).toFixed(1)}m of £100.0m spent`;

  const players = (q.get("xi") ?? "")
    .split("|")
    .map((chunk) => {
      const [pos, player, club] = chunk.split("~");
      return { pos: pos ?? "", name: player ?? "", club: club ?? "" };
    })
    .filter((p) => p.name);

  // Surname only: eleven full names at this size wrap and the card stops
  // reading as a team sheet.
  const short = (full: string) => {
    const parts = full.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : full;
  };

  const rows = ROWS
    .map((pos) => ({ pos, names: players.filter((p) => p.pos === pos) }))
    .filter((r) => r.names.length > 0);

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: PITCH, padding: 56, fontFamily: "sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={44} height={44} alt="" />
          <span style={{ fontSize: 28, color: TEAL, letterSpacing: 4, fontWeight: 700 }}>
            YOURSCORE FANTASY FOOTBALL
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
          <span style={{ fontSize: 30, color: MUTED }}>
            {name ? `${name}'s squad` : "My squad"}{gw ? ` · Gameweek ${gw}` : ""}
          </span>
          <span style={{ fontSize: 66, color: INK, fontWeight: 800, letterSpacing: -1, marginTop: 4 }}>
            This is my eleven.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 28 }}>
          {rows.map((row) => (
            <div key={row.pos} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 74, height: 40, borderRadius: 8, background: PANEL,
                color: MUTED, fontSize: 22, fontWeight: 700, letterSpacing: 2,
              }}>{row.pos}</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {row.names.map((p, i) => {
                  const isCap = cap && (p.name === cap || short(p.name) === short(cap));
                  return (
                    <span key={i} style={{
                      display: "flex", alignItems: "center",
                      padding: "7px 15px", borderRadius: 8,
                      background: isCap ? "rgba(227,179,65,0.14)" : PANEL,
                      border: `1px solid ${isCap ? GOLD : "rgba(255,255,255,0.07)"}`,
                      color: isCap ? GOLD : INK, fontSize: 25, fontWeight: 600,
                    }}>{short(p.name)}{isCap ? " (C)" : ""}</span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: "auto" }}>
          <span style={{ fontSize: 28, color: TEAL, fontWeight: 700 }}>
            Think you can pick better?
          </span>
          {val ? <span style={{ fontSize: 26, color: MUTED }}>{val}</span> : null}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
