/**
 * /api/og/fantasy-league — link-preview card for a LEAGUE INVITE.
 *
 * The invite link IS the growth loop, so the card is a matchday poster, not a
 * table: the full-bleed PITCH behind everything, the YourScore wordmark
 * top-left, the league big on the left — name up top, display picture large
 * beneath (shield monogram fallback), the member pull under it — and the sell
 * on the right in BEBAS NEUE, the app's own display face: FANTASY PREMIER
 * LEAGUE stacked huge in gold (founder's spec — the one card where gold is the
 * headline, not a prize), ON YOURSCORE in teal, the selling points as clean
 * condensed lines and a gold button CTA. The font ships with the route (TTF in
 * this directory, fetched via import.meta.url) because Satori can't reach
 * Google Fonts at request time.
 *
 * Query: ?name=The+Founder+League&img=<url>&members=79
 * (the league layout bakes the public fields in — this edge route renders what
 * it is given and never touches the DB.)
 *
 * Satori rules apply: every div with >1 child needs display:flex, ONE root
 * child or it's a 0-byte PNG, group opacity not fill-opacity in <img> SVGs,
 * and unfurls crop ~40px off each side so nothing critical sits outside
 * x=56..1144.
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

export const runtime = "edge";

const GOLD = "#ffc233";
const TEAL = "#00d8c0";
const INK = "#eef2f0";

// Bebas is uppercase-only by design — these render as caps, which is the point.
const SELLING_POINTS = [
  "Pick fifteen Premier League stars with £100m",
  "Your football knowledge earns your moves",
  "Take on your friends every gameweek",
];

const bebas = fetch(new URL("./BebasNeue-Regular.ttf", import.meta.url))
  .then((res) => res.arrayBuffer());

// The pitch, full bleed — mow stripes plus the teal markings, drawn for a wide
// card: goalmouths left and right, halfway line down the middle, so the league
// sits in its own half and the sell in the other.
const STRIPES = Array.from({ length: 12 }, (_, i) =>
  `<rect x='${i * 100}' y='0' width='50' height='630'/>`).join("");
const PITCH_ART =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 630' preserveAspectRatio='none'>` +
      `<g fill='#ffffff' opacity='0.035'>${STRIPES}</g>` +
      `<g fill='none' stroke='${TEAL}' stroke-width='3' opacity='0.28'>` +
      `<rect x='14' y='14' width='1172' height='602'/>` +
      `<line x1='600' y1='14' x2='600' y2='616'/>` +
      `<circle cx='600' cy='315' r='120'/>` +
      `<rect x='14' y='150' width='150' height='330'/><rect x='14' y='240' width='62' height='150'/>` +
      `<rect x='1036' y='150' width='150' height='330'/><rect x='1124' y='240' width='62' height='150'/>` +
      `</g>` +
      `<circle cx='600' cy='315' r='6' fill='${TEAL}' opacity='0.4'/>` +
    `</svg>`,
  );

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = (q.get("name") ?? "Your league").slice(0, 40);
  const img = q.get("img") || "";
  const members = Number(q.get("members") ?? "0");
  const initial = (name.trim()[0] ?? "Y").toUpperCase();
  const pull = members > 1 ? `${members} members waiting for you` : "You are invited";

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "linear-gradient(160deg, #123423 0%, #0c2418 45%, #071510 100%)",
        fontFamily: "Bebas", position: "relative",
      }}>
        {/* The pitch, then the light: warm wash behind the headline, teal wash
            behind the league. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PITCH_ART} alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          background: "radial-gradient(circle at 78% 22%, rgba(255,194,51,0.18) 0%, rgba(255,194,51,0) 46%)",
        }} />
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          background: "radial-gradient(circle at 18% 72%, rgba(0,216,192,0.14) 0%, rgba(0,216,192,0) 48%)",
        }} />

        {/* Wordmark top-left (360x97 source — never square). */}
        <div style={{ display: "flex", padding: "30px 56px 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={182} height={49} alt="" style={{ objectFit: "contain" }} />
        </div>

        {/* The match: league in the left half, the sell in the right. */}
        <div style={{
          flex: 1, minHeight: 0, display: "flex", alignItems: "center",
          padding: "0 56px 30px", gap: 54,
        }}>
          {/* LEFT — the league, big. Name on top, picture beneath, pull under. */}
          <div style={{
            width: 430, flexShrink: 0, display: "flex", flexDirection: "column",
            alignItems: "center", gap: 16,
          }}>
            <span style={{
              fontSize: 64, color: INK, textAlign: "center", lineHeight: 0.98,
              maxWidth: 430, letterSpacing: 1, textShadow: "0 3px 16px rgba(0,0,0,0.7)",
            }}>{name}</span>
            <div style={{
              width: 295, height: 295, borderRadius: 42, overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `5px solid ${GOLD}`, background: "rgba(0,216,192,0.12)",
              boxShadow: `0 0 0 4px rgba(0,0,0,0.35), 0 22px 60px rgba(0,0,0,0.6), 0 0 80px rgba(255,194,51,0.25)`,
            }}>
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} width={295} height={295} alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 170, color: TEAL, textShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
                  {initial}
                </span>
              )}
            </div>
            <div style={{
              display: "flex", padding: "7px 24px 5px", borderRadius: 999,
              background: "rgba(9,21,16,0.78)", border: `2px solid ${TEAL}88`,
              boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
            }}>
              <span style={{ fontSize: 27, color: TEAL, letterSpacing: 1.5 }}>{pull}</span>
            </div>
          </div>

          {/* RIGHT — the sell: the stacked gold headline, the teal kicker, the
              selling points as clean condensed lines, and a button CTA. */}
          <div style={{
            flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
            justifyContent: "center",
          }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{
                fontSize: 106, color: GOLD, lineHeight: 0.86, letterSpacing: 1,
                textShadow: "0 4px 0 rgba(110,74,0,0.65), 0 14px 40px rgba(0,0,0,0.75)",
              }}>Fantasy</span>
              <span style={{
                fontSize: 106, color: GOLD, lineHeight: 0.92, letterSpacing: 1,
                textShadow: "0 4px 0 rgba(110,74,0,0.65), 0 14px 40px rgba(0,0,0,0.75)",
              }}>Premier League</span>
            </div>
            <span style={{
              fontSize: 40, color: TEAL, letterSpacing: 9, marginTop: 8,
              textShadow: "0 2px 12px rgba(0,0,0,0.65)",
            }}>On YourScore</span>

            <div style={{
              display: "flex", flexDirection: "column", gap: 8, marginTop: 26,
              borderLeft: `4px solid ${GOLD}`, paddingLeft: 20,
            }}>
              {SELLING_POINTS.map((point, i) => (
                <span key={i} style={{
                  fontSize: 33, color: INK, lineHeight: 1.1, letterSpacing: 1,
                  textShadow: "0 2px 10px rgba(0,0,0,0.7)",
                }}>{point}</span>
              ))}
            </div>

            <div style={{
              display: "flex", alignSelf: "flex-start", marginTop: 30,
              padding: "12px 34px 8px", borderRadius: 999, background: GOLD,
              boxShadow: "0 10px 34px rgba(255,194,51,0.35), 0 6px 18px rgba(0,0,0,0.5)",
            }}>
              <span style={{ fontSize: 33, color: "#231700", letterSpacing: 2 }}>
                Free to play · Tap to join
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      fonts: [{ name: "Bebas", data: await bebas, style: "normal", weight: 400 }],
    },
  );
}
