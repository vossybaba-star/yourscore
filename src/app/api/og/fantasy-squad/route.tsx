/**
 * /api/og/fantasy-squad — link-preview card for a shared SQUAD.
 *
 * This unfurls on X while someone scrolls, so it is a faithful copy of the in-app
 * tactical pitch (SquadBoard + PlayerMarker + PitchSurface): the SAME green-black
 * field with mow stripes and teal markings, and each player a real PORTRAIT with
 * their club crest bottom-left, laid out top-down FWD → GK. The captain carries a
 * gold ring and armband; nothing else is gold (house rule — gold is for what you
 * win). It has to read as a team from a feed thumbnail, so it draws the team.
 *
 * Query: ?xi=POS~Name~Club~faceUrl~priceTenths|…&cap=Haaland&val=1000&name=Zed&gw=1
 * (the share route bakes each player's headshot + price into the chunk so this
 * edge route needs no pool/faces import — it just renders what it is given.)
 *
 * Satori rules apply and they bite: EVERY div with >1 child needs display:flex,
 * and the response must have exactly ONE root child, or it renders a 0-byte PNG
 * (the 38-0 lesson). The pitch art is one absolute <img> data-URI SVG so the
 * markings render identically regardless of Satori's gradient support.
 */
import { ImageResponse } from "next/og";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import { avatarPalette, avatarInitial } from "@/lib/avatar";

export const runtime = "edge";

// Straight from components/fantasy/shared.tsx, so the card matches the app exactly.
const GOLD = "#ffc233";
const TEAL = "#00d8c0";
const INK = "#eef2f0";
const MUTED = "#8a948f";

// Top-down: forwards attack the top of the card, keeper at the back.
const ROWS = ["FWD", "MID", "DEF", "GK"] as const;

// The pitch art — the exact PitchSurface field (mow stripes + teal markings),
// stretched to the landscape card. One SVG so it renders whatever Satori supports.
// resvg (Satori's rasteriser) ignores fill-opacity/stroke-opacity presentation
// attrs on an <img> SVG, so alpha is carried by GROUP `opacity`, which it honours.
const STRIPES = Array.from({ length: 7 }, (_, i) =>
  `<rect x='0' y='${i * 90}' width='1200' height='45'/>`).join("");
const PITCH_ART =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 630' preserveAspectRatio='none'>` +
      `<g fill='#ffffff' opacity='0.028'>${STRIPES}</g>` +
      `<g fill='none' stroke='${TEAL}' stroke-width='2' opacity='0.22'>` +
      `<rect x='24' y='12' width='1152' height='606'/>` +
      `<line x1='24' y1='315' x2='1176' y2='315'/>` +
      `<circle cx='600' cy='315' r='84'/>` +
      `<rect x='300' y='12' width='600' height='96'/><rect x='444' y='12' width='312' height='48'/>` +
      `<rect x='300' y='522' width='600' height='96'/><rect x='444' y='570' width='312' height='48'/>` +
      `</g>` +
      `<circle cx='600' cy='315' r='4' fill='${TEAL}' opacity='0.35'/>` +
    `</svg>`,
  );

const AV = 60; // XI portrait diameter — 4 rows + a bench strip fit the card at this size.
const AV_B = 46; // bench portrait diameter — a touch smaller than the XI.

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const q = new URL(req.url).searchParams;
  const name = (q.get("name") ?? "").slice(0, 24);
  const cap = (q.get("cap") ?? "").trim();
  const gw = q.get("gw");
  const valTenths = Number(q.get("val") ?? "0");
  const val = valTenths <= 0 ? null
    : valTenths >= 1000 ? "Every penny of £100.0m spent"
    : `£${(valTenths / 10).toFixed(1)}m of £100.0m spent`;

  const parseChunks = (raw: string) => raw
    .split("|")
    .map((chunk) => {
      const [pos, player, club, face, priceTenths] = chunk.split("~");
      return { pos: pos ?? "", name: player ?? "", club: club ?? "", face: face || "", priceTenths: Number(priceTenths || 0) };
    })
    .filter((p) => p.name);
  const players = parseChunks(q.get("xi") ?? "");
  const bench = parseChunks(q.get("bench") ?? "");

  // Surname only: eleven full names on a pitch wrap and the shape breaks.
  const short = (full: string) => {
    const parts = full.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : full;
  };
  const capShort = cap ? short(cap) : "";
  const crestUrl = (club: string) => {
    const path = getTeamBadgeUrlSync(club);
    return path ? `${origin}${path}` : null;
  };

  const rows = ROWS
    .map((pos) => ({ pos, list: players.filter((p) => p.pos === pos) }))
    .filter((r) => r.list.length > 0);

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "linear-gradient(180deg, #0c1a13 0%, #0a1710 55%, #091510 100%)",
        fontFamily: "sans-serif", position: "relative",
      }}>
        {/* The pitch field — stripes + teal markings, exactly the in-app art. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PITCH_ART} width={1200} height={630} alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

        {/* Header — brand + whose squad this is. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "34px 56px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={38} height={38} alt="" />
            <span style={{ fontSize: 23, color: TEAL, letterSpacing: 3, fontWeight: 700 }}>
              YOURSCORE FANTASY FOOTBALL
            </span>
          </div>
          <span style={{ fontSize: 23, color: INK, fontWeight: 700 }}>
            {name ? `${name}'s squad` : "My squad"}{gw ? ` · GW${gw}` : ""}
          </span>
        </div>

        {/* The pitch — four bands, forwards at the top, keeper at the back. */}
        <div style={{
          display: "flex", flexDirection: "column", flex: 1,
          justifyContent: "space-between", padding: "10px 48px",
        }}>
          {rows.map((row) => (
            <div key={row.pos} style={{ display: "flex", justifyContent: "center", gap: 26 }}>
              {row.list.map((p, i) => {
                const isCap = capShort && short(p.name) === capShort;
                const crest = crestUrl(p.club);
                const pal = avatarPalette(p.name);
                const price = p.priceTenths > 0 ? `£${(p.priceTenths / 10).toFixed(1)}` : "";
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 132 }}>
                    <div style={{ display: "flex", position: "relative" }}>
                      {/* Portrait — headshot over a stable gradient monogram, like PlayerAvatar. */}
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: AV, height: AV, borderRadius: AV, overflow: "hidden",
                        border: `3px solid ${isCap ? GOLD : "rgba(255,255,255,0.16)"}`,
                        background: `linear-gradient(140deg, ${pal.from}, ${pal.to})`, color: pal.fg,
                      }}>
                        <span style={{ fontSize: AV * 0.44, fontWeight: 800, lineHeight: 1 }}>{avatarInitial(p.name)}</span>
                        {p.face ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.face} width={AV} height={AV} alt=""
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : null}
                      </div>
                      {/* Club crest, bottom-left of the face. */}
                      {crest ? (
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          position: "absolute", bottom: -4, left: -4, width: 30, height: 30, borderRadius: 30,
                          background: "#0a1710", border: "2px solid #0a1710",
                        }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={crest} width={24} height={24} alt="" style={{ objectFit: "contain" }} />
                        </div>
                      ) : null}
                      {/* Captain armband, top-right. */}
                      {isCap ? (
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          position: "absolute", top: -4, right: -4, width: 26, height: 26, borderRadius: 26,
                          background: GOLD, color: "#3a2600", fontSize: 15, fontWeight: 800,
                        }}>C</div>
                      ) : null}
                    </div>
                    <span style={{
                      marginTop: 7, fontSize: 20, fontWeight: 700, color: isCap ? GOLD : INK,
                      textShadow: "0 1px 2px rgba(0,0,0,0.7)", whiteSpace: "nowrap",
                    }}>{short(p.name)}</span>
                    {price ? (
                      <span style={{ fontSize: 15, color: MUTED, lineHeight: 1.1 }}>{price}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* The bench — the four subs, so the card shows the full fifteen, not just
            the eleven. A compact strip under the pitch, "BENCH" on the left. */}
        {bench.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "0 56px 4px" }}>
            <span style={{ fontSize: 18, color: MUTED, fontWeight: 800, letterSpacing: 3 }}>BENCH</span>
            <div style={{ display: "flex", gap: 30, flex: 1, justifyContent: "flex-start" }}>
              {bench.map((p, i) => {
                const crest = crestUrl(p.club);
                const pal = avatarPalette(p.name);
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 116 }}>
                    <div style={{ display: "flex", position: "relative" }}>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: AV_B, height: AV_B, borderRadius: AV_B, overflow: "hidden",
                        border: "3px solid rgba(255,255,255,0.16)",
                        background: `linear-gradient(140deg, ${pal.from}, ${pal.to})`, color: pal.fg,
                      }}>
                        <span style={{ fontSize: AV_B * 0.44, fontWeight: 800, lineHeight: 1 }}>{avatarInitial(p.name)}</span>
                        {p.face ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.face} width={AV_B} height={AV_B} alt=""
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : null}
                      </div>
                      {crest ? (
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          position: "absolute", bottom: -3, left: -3, width: 24, height: 24, borderRadius: 24,
                          background: "#0a1710", border: "2px solid #0a1710",
                        }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={crest} width={18} height={18} alt="" style={{ objectFit: "contain" }} />
                        </div>
                      ) : null}
                    </div>
                    <span style={{ marginTop: 5, fontSize: 17, fontWeight: 700, color: INK, textShadow: "0 1px 2px rgba(0,0,0,0.7)", whiteSpace: "nowrap" }}>{short(p.name)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer — the challenge and the spend. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 56px 26px",
        }}>
          <span style={{ fontSize: 30, color: TEAL, fontWeight: 800 }}>
            Think you can pick better?
          </span>
          {val ? <span style={{ fontSize: 23, color: MUTED, fontWeight: 600 }}>{val}</span> : null}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
