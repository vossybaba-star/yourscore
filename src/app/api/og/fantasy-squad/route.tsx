/**
 * /api/og/fantasy-squad — link-preview card for a shared SQUAD.
 *
 * A faithful, blown-up copy of the in-app tactical board (SquadBoard +
 * PlayerMarker + PitchSurface + BenchStrip): the SAME green-black field with mow
 * stripes and teal markings, big PORTRAIT markers with the club crest bottom-left
 * and a POSITION-COLOURED name plate (GK amber, DEF teal, MID lime, FWD coral),
 * the XI laid out top-down FWD → GK, and the four subs down a labelled DUGOUT on
 * the right — exactly where they sit in the app, not a strip under the pitch. The
 * captain carries a gold ring and armband; nothing else is gold (house rule —
 * gold is for what you win). It has to read as a team from a feed thumbnail, so
 * it draws the team, just bigger.
 *
 * Query: ?xi=POS~Name~Club~faceUrl~priceTenths|…&bench=…&cap=Haaland&val=1000&name=Zed&gw=1
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
// The position palette that plates each name in the app — the pitch reads by role.
const POS_COLOR: Record<string, string> = { GK: "#f4a63a", DEF: "#00d8c0", MID: "#8ad14f", FWD: "#ff7a85" };

// Top-down: forwards attack the top of the card, keeper at the back.
const ROWS = ["FWD", "MID", "DEF", "GK"] as const;

// The pitch art — the exact PitchSurface field (mow stripes + teal markings). One
// SVG stretched to fill just the pitch area (the dugout has its own dark wash), so
// the centre circle sits on the middle of the FIELD, not the whole card.
// resvg (Satori's rasteriser) ignores fill-opacity/stroke-opacity presentation
// attrs on an <img> SVG, so alpha is carried by GROUP `opacity`, which it honours.
const STRIPES = Array.from({ length: 8 }, (_, i) =>
  `<rect x='0' y='${i * 80}' width='1000' height='40'/>`).join("");
const PITCH_ART =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 630' preserveAspectRatio='none'>` +
      `<g fill='#ffffff' opacity='0.028'>${STRIPES}</g>` +
      `<g fill='none' stroke='${TEAL}' stroke-width='2' opacity='0.22'>` +
      `<rect x='20' y='12' width='960' height='606'/>` +
      `<line x1='20' y1='315' x2='980' y2='315'/>` +
      `<circle cx='500' cy='315' r='84'/>` +
      `<rect x='250' y='12' width='500' height='96'/><rect x='370' y='12' width='260' height='48'/>` +
      `<rect x='250' y='522' width='500' height='96'/><rect x='370' y='570' width='260' height='48'/>` +
      `</g>` +
      `<circle cx='500' cy='315' r='4' fill='${TEAL}' opacity='0.35'/>` +
    `</svg>`,
  );

const AV = 80;   // XI portrait diameter — big, like the app pitch uses the space.
const AV_B = 56; // dugout portrait diameter — the subs, a touch smaller.

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

  type P = { pos: string; name: string; club: string; face: string; priceTenths: number };

  // One marker, drawn the app way: portrait (headshot over a stable monogram) +
  // crest bottom-left. `size` scales the whole thing so the XI and the dugout
  // share one look at two sizes. The name plate is drawn by the caller (below).
  const Marker = (p: P, size: number, isCap: boolean) => {
    const pal = avatarPalette(p.name);
    const crest = crestUrl(p.club);
    const crestBox = Math.round(size * 0.42);
    const capBox = Math.round(size * 0.34);
    return (
      <div style={{ display: "flex", position: "relative" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: size, height: size, borderRadius: size, overflow: "hidden",
          border: `3px solid ${isCap ? GOLD : "rgba(255,255,255,0.18)"}`,
          background: `linear-gradient(140deg, ${pal.from}, ${pal.to})`, color: pal.fg,
        }}>
          <span style={{ fontSize: size * 0.44, fontWeight: 800, lineHeight: 1 }}>{avatarInitial(p.name)}</span>
          {p.face ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.face} width={size} height={size} alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : null}
        </div>
        {crest ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "absolute", bottom: -3, left: -3, width: crestBox, height: crestBox, borderRadius: crestBox,
            background: "#0a1710", border: "2px solid #0a1710",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={crest} width={crestBox - 8} height={crestBox - 8} alt="" style={{ objectFit: "contain" }} />
          </div>
        ) : null}
        {isCap ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "absolute", top: -3, right: -3, width: capBox, height: capBox, borderRadius: capBox,
            background: GOLD, color: "#3a2600", fontSize: capBox * 0.6, fontWeight: 800,
            border: "1px solid #ffdf9e",
          }}>C</div>
        ) : null}
      </div>
    );
  };

  // A position-coloured name plate, exactly like PlayerMarker's — the single most
  // "app" thing on the card.
  const Plate = (label: string, posC: string, big: boolean) => (
    <div style={{
      display: "flex", marginTop: big ? 7 : 6,
      padding: big ? "2px 10px" : "2px 8px", borderRadius: 7,
      background: `${posC}33`, border: `1px solid ${posC}cc`,
    }}>
      <span style={{
        fontSize: big ? 20 : 16, fontWeight: 700, color: INK, whiteSpace: "nowrap",
        textShadow: "0 1px 2px rgba(0,0,0,0.7)",
      }}>{label}</span>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "linear-gradient(180deg, #0c1a13 0%, #0a1710 55%, #091510 100%)",
        fontFamily: "sans-serif", position: "relative",
      }}>
        {/* Header — brand + whose squad this is. The logo is the YOURSCORE
            wordmark (360x97, ~3.7:1), so keep its aspect (never a square) and let
            it stand in for the name — the adjacent text is just the product. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 56px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_DATA_URI} width={130} height={35} alt="" style={{ objectFit: "contain" }} />
            <span style={{ fontSize: 23, color: TEAL, letterSpacing: 3, fontWeight: 700 }}>
              FANTASY FOOTBALL
            </span>
          </div>
          <span style={{ fontSize: 23, color: INK, fontWeight: 700 }}>
            {name ? `${name}'s squad` : "My squad"}{gw ? ` · GW${gw}` : ""}
          </span>
        </div>

        {/* Body — the pitch (XI) on the left, the dugout (subs) down the right,
            exactly the in-app board just scaled up. */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, padding: "8px 56px 6px", gap: 14 }}>
          {/* The field: four bands, forwards at the top, keeper at the back. */}
          <div style={{
            flex: 1, minWidth: 0, position: "relative", display: "flex",
            borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PITCH_ART} alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              justifyContent: "space-between", padding: "14px 36px",
            }}>
              {rows.map((row) => (
                <div key={row.pos} style={{ display: "flex", justifyContent: "center", gap: 16 }}>
                  {row.list.map((p, i) => {
                    const isCap = !!capShort && short(p.name) === capShort;
                    return (
                      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 138 }}>
                        {Marker(p, AV, isCap)}
                        {Plate(short(p.name), POS_COLOR[p.pos] ?? MUTED, true)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* The dugout — the four subs down the touchline, off the field, in a
              labelled column. Matches BenchStrip: dashed teal edge, dark wash. */}
          {bench.length > 0 && (
            <div style={{
              width: 206, flexShrink: 0, display: "flex", flexDirection: "column",
              alignItems: "stretch", padding: "16px 14px", gap: 12,
              borderRadius: 16, background: "rgba(0,0,0,0.30)",
              border: `1px solid ${TEAL}22`, borderLeft: `2px dashed ${TEAL}44`,
            }}>
              <span style={{ fontSize: 15, color: "#6a746e", fontWeight: 800, letterSpacing: 4, textAlign: "center" }}>
                DUGOUT
              </span>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-around" }}>
              {bench.map((p, i) => {
                const posC = POS_COLOR[p.pos] ?? MUTED;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {Marker(p, AV_B, false)}
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 4 }}>
                      <span style={{ fontSize: 19, fontWeight: 700, color: INK, whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,0.7)" }}>
                        {short(p.name)}
                      </span>
                      <div style={{ display: "flex" }}>
                        <span style={{
                          fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: posC,
                          padding: "2px 7px", borderRadius: 6, background: `${posC}22`, border: `1px solid ${posC}66`,
                        }}>{p.pos}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          )}
        </div>

        {/* Footer — the challenge and the spend. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "2px 56px 20px",
        }}>
          <span style={{ fontSize: 30, color: TEAL, fontWeight: 800 }}>
            Think you can pick better?
          </span>
          {val ? <span style={{ fontSize: 22, color: MUTED, fontWeight: 600 }}>{val}</span> : null}
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      // Cache the rendered card at the edge. Satori rendering is ~4s CPU a hit, so
      // an unfurl bot crawling the same URL 30+ times in a burst (Vercel usage
      // alert, 4 Aug) must not re-render each time. s-maxage collapses a burst to
      // one render; stale-while-revalidate keeps it warm; the 10-min window still
      // reflects a squad change on the next share soon enough.
      headers: {
        "cache-control": "public, no-transform, max-age=300, s-maxage=600, stale-while-revalidate=3600",
      },
    },
  );
}
