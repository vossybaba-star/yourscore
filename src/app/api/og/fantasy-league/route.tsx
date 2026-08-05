/**
 * /api/og/fantasy-league — link-preview card for a LEAGUE INVITE.
 *
 * The invite link IS the growth loop, so the card sells the game, not the table:
 * LEFT is the league — its name up top and its display picture big beneath
 * (shield monogram fallback when the league never set one) with the member
 * count; RIGHT is the pitch: "Fantasy Premier League on YourScore" big, bold
 * and GOLD (founder's spec — the one card where gold is the headline, not a
 * prize), with the selling points as subheads underneath.
 *
 * Query: ?name=The+Founder+League&img=<url>&members=79
 * (the league layout bakes the public fields in — this edge route renders what
 * it is given and never touches the DB.)
 *
 * Satori rules apply: every div with >1 child needs display:flex, ONE root
 * child or it's a 0-byte PNG, and unfurls crop ~40px off each side so nothing
 * critical sits outside x=56..1144.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";

const GOLD = "#ffc233";
const TEAL = "#00d8c0";
const INK = "#eef2f0";
const MUTED = "#8a948f";

const SELLING_POINTS = [
  "Pick fifteen Premier League stars with £100m",
  "Your football knowledge earns your moves",
  "Take on your friends every gameweek",
];

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = (q.get("name") ?? "Your league").slice(0, 40);
  const img = q.get("img") || "";
  const members = Number(q.get("members") ?? "0");
  const initial = (name.trim()[0] ?? "Y").toUpperCase();

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex",
        background: "linear-gradient(180deg, #0c1a13 0%, #0a1710 55%, #091510 100%)",
        fontFamily: "sans-serif", padding: "48px 56px", gap: 48, alignItems: "center",
      }}>
        {/* LEFT — the league: name on top, picture beneath, members under that. */}
        <div style={{
          width: 420, flexShrink: 0, display: "flex", flexDirection: "column",
          alignItems: "center", gap: 22,
        }}>
          <span style={{
            fontSize: 40, fontWeight: 800, color: INK, textAlign: "center",
            lineHeight: 1.15, maxWidth: 420,
          }}>{name}</span>
          <div style={{
            width: 280, height: 280, borderRadius: 40, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `3px solid ${TEAL}55`, background: "rgba(0,216,192,0.10)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} width={280} height={280} alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: 130, fontWeight: 800, color: TEAL }}>{initial}</span>
            )}
          </div>
          {members > 1 ? (
            <div style={{
              display: "flex", padding: "6px 18px", borderRadius: 999,
              background: "rgba(0,216,192,0.12)", border: `1px solid ${TEAL}44`,
            }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: TEAL }}>
                {members} members waiting for you
              </span>
            </div>
          ) : (
            <div style={{
              display: "flex", padding: "6px 18px", borderRadius: 999,
              background: "rgba(0,216,192,0.12)", border: `1px solid ${TEAL}44`,
            }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: TEAL }}>
                You are invited
              </span>
            </div>
          )}
        </div>

        {/* RIGHT — the pitch: gold headline, selling points beneath. */}
        <div style={{
          flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
          justifyContent: "center", gap: 30,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 62, fontWeight: 800, color: GOLD, lineHeight: 1.05 }}>
              Fantasy Premier League
            </span>
            <span style={{ fontSize: 44, fontWeight: 800, color: GOLD, lineHeight: 1.1 }}>
              on YourScore
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {SELLING_POINTS.map((point, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  display: "flex", width: 10, height: 10, borderRadius: 10,
                  background: TEAL, flexShrink: 0,
                }} />
                <span style={{ fontSize: 27, fontWeight: 600, color: INK, lineHeight: 1.25 }}>
                  {point}
                </span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 22, color: MUTED, fontWeight: 600 }}>
            Free to play. Tap to join the league.
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
