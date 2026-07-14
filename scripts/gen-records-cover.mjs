/**
 * gen-records-cover.mjs — 1080×1080 cover for an ALL-TIME / END-OF-SEASON records
 * quiz, in the founder-locked no-logo cover style. Each topic gets its own themed
 * poster (trophy / derby / shootout / relegation …) so the art matches the quiz —
 * the model draws trophies + iconography (fine), never club crests (which come out
 * wrong; a single club crest is composited from public/badges/ where one applies).
 *
 * Usage: node --env-file=.env.local scripts/gen-records-cover.mjs --name "Champions League Records" [--out /tmp] [--quality high] [--reuse-bg]
 * Prints: COVER=<path>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { slugify, ACCENT_HEX } from "./lib/quiz-launch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS = join(__dirname, "assets", "fonts");
const ROOT = join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const NAME = flag("--name");
const OUT = flag("--out") || "/tmp";
const QUALITY = flag("--quality") || "high";
const REUSE_BG = args.includes("--reuse-bg");
if (!NAME) { console.error('Usage: gen-records-cover.mjs --name "Champions League Records"'); process.exit(1); }
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("Missing OPENAI_API_KEY"); process.exit(1); }

const NO_TEXT = `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO club badges, NO crests, NO watermarks anywhere. Keep the upper-left third calmer, darker negative space for a title to be added later. This is ASSOCIATION FOOTBALL (soccer) ONLY: any ball must be a round soccer ball with classic panels — NEVER an American football, NO egg-shaped balls, NO gridiron, NO helmets, NO shoulder pads.`;

// Per-topic themes: first matching test wins. `subject` describes the poster art;
// `crest` (optional) composites one real club crest (single-club topics only).
const THEMES = [
  { test: /champions league/i, label: "CHAMPIONS LEAGUE · ALL-TIME", palette: "midnight navy, bright silver and cream", subject: "A large silver European cup with tall curved handles as the bold central motif under a night sky patterned with the starball motif, dramatic floodlight rays, halftone crowd along the lower edge." },
  { test: /euro(pean)? championship/i, label: "EURO CHAMPIONSHIP · ALL-TIME", palette: "royal blue, silver and cream", subject: "A gleaming continental championship trophy as the central motif, rows of stylised European bunting, floodlight rays, halftone crowd." },
  { test: /premier league/i, label: "PREMIER LEAGUE · ALL-TIME", palette: "deep royal purple, rich gold and cream", subject: "A gleaming domestic league trophy with ribbons as the central motif, a bold heraldic lion silhouette, floodlight rays, halftone English crowd." },
  { test: /golden boot|individual awards/i, label: "INDIVIDUAL AWARDS · ALL-TIME", palette: "near-black, rich gold and cream", subject: "A golden football boot on a trophy plinth as the central motif, gilded laurel wreath, a single spotlight beam, halftone crowd." },
  { test: /manager/i, label: "ICONIC MANAGERS · ALL-TIME", palette: "charcoal grey, chalk white and one warm amber accent", subject: "A touchline scene: the silhouette of a manager in a long coat beside a dugout, a tactics chalkboard with arrows and circles, floodlights overhead." },
  { test: /legendary club seasons|club seasons/i, label: "CLUB SEASONS · ALL-TIME", palette: "deep bottle green, gold and cream", subject: "A glowing trophy cabinet stacked with silverware as the central motif, falling confetti, floodlight rays, halftone crowd." },
  { test: /penalty shootout|shootout/i, label: "PENALTY SHOOTOUT · ALL-TIME", palette: "near-black, cream and one bold red accent", subject: "A tense penalty-spot scene: a round soccer ball on the penalty spot in the foreground, a goalkeeper diving across the goalmouth in silhouette, packed halftone crowd, floodlights." },
  { test: /derbies|derby/i, label: "DERBIES · BY THE NUMBERS", palette: "split pillar-box red and royal blue with cream", subject: "A split-pitch derby composition: the field divided by a bold diagonal into two rival colour halves, clashing pennants meeting in the middle, a roaring halftone crowd, floodlights." },
  { test: /transfer/i, label: "TRANSFERS · ALL-TIME", palette: "emerald green, gold and cream", subject: "A transfer-market motif: a round soccer ball rising along a bold ascending bar-chart of value, stylised contract-and-pen shapes, a city stadium skyline behind — all stylised, no real logos." },
  { test: /world cup immortals|world cup records|world cup history/i, label: "WORLD CUP · ALL-TIME", palette: "deep navy, rich gold and cream", subject: "The golden World Cup trophy as a towering central motif amid gold confetti and floodlights, a ring of stylised national bunting, halftone crowd." },
  // End of season 2025/26
  { test: /are champions/i, label: "END OF SEASON · 2025/26", crest: NAME ? NAME.replace(/\s+are champions.*/i, "").trim() : null, palette: "bright pillar-box red, white and gold", subject: "A title-winning celebration: a league trophy lifted high amid red-and-white confetti and streamers, floodlight rays, a jubilant halftone crowd." },
  { test: /farewell tour/i, label: "END OF SEASON · 2025/26", palette: "warm amber, deep claret and cream", subject: "An emotional send-off: a lone player silhouette applauding all four stands under floodlights, raised scarves, drifting confetti, halftone crowd." },
  { test: /race for europe/i, label: "END OF SEASON · 2025/26", palette: "royal blue, gold and cream", subject: "A final-day race motif: a rising ladder of league positions climbing toward a golden European star at the top, floodlights, tense halftone crowd." },
  { test: /relegation/i, label: "END OF SEASON · 2025/26", palette: "deep red, charcoal and cream", subject: "A relegation-drama motif: a trapdoor opening beneath the pitch with a bold descending arrow, brooding storm clouds over the stadium, an anxious halftone crowd, floodlights." },
  { test: /world cup countdown|countdown/i, label: "COUNTDOWN · WORLD CUP 2026", palette: "deep navy, rich gold and cream", subject: "A countdown motif: the golden World Cup trophy glowing on the horizon with a runway of stadium floodlights leading toward it, a subtle clock/calendar hint, halftone crowd." },
];
const DEFAULT = { label: "ALL-TIME RECORDS", palette: "deep green, rich gold and cream", subject: "A gleaming football trophy as the bold central motif amid confetti and floodlight rays, halftone crowd along the lower edge." };

const theme = THEMES.find((t) => t.test.test(NAME)) || DEFAULT;
const words = NAME.toUpperCase().split(/\s+/);
const bebas = readFileSync(join(FONTS, "BebasNeue-Regular.ttf"));
const dmBold = readFileSync(join(FONTS, "DMSans-Bold.ttf"));

function bgPrompt() {
  return `Flat graphic illustration in vintage football matchday-poster style: bold simplified geometric shapes, screen-print grain texture, limited palette of ${theme.palette}. ${theme.subject} Mid-century poster composition, thick shapes, no gradients, premium editorial finish. ${NO_TEXT}`;
}
async function genBackground(size) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1", prompt: bgPrompt(), size, quality: QUALITY, n: 1 }),
      });
      const j = await res.json();
      if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`gpt-image-1 ${res.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
      return Buffer.from(j.data[0].b64_json, "base64");
    } catch (e) { lastErr = e; if (attempt < 4) await new Promise((r) => setTimeout(r, 5000 * attempt)); }
  }
  throw lastErr;
}

const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } });
function overlayTree(W, H) {
  const pad = Math.round(W * 0.045);
  const subSize = Math.round(W * 0.022);
  const n = words.length;
  const shrink = n <= 2 ? 1 : n === 3 ? 0.9 : n === 4 ? 0.78 : n === 5 ? 0.66 : n === 6 ? 0.58 : 0.5;
  const titleSize = Math.round(W * 0.128 * shrink);
  const titleWidth = Math.round(W * 0.9);
  const titleWords = words.map((w, i) =>
    h("div", { style: { display: "flex", color: i === n - 1 ? ACCENT_HEX : "#ffffff",
      backgroundColor: "rgba(6,8,7,0.92)",
      paddingTop: Math.round(titleSize * 0.05), paddingBottom: Math.round(titleSize * 0.07),
      paddingLeft: Math.round(titleSize * 0.12), paddingRight: Math.round(titleSize * 0.12),
      marginRight: Math.round(titleSize * 0.07), marginBottom: Math.round(titleSize * 0.05) } }, w)
  );
  return h("div", { style: { width: W, height: H, display: "flex", flexDirection: "column",
    justifyContent: "flex-start", padding: pad, fontFamily: "Bebas Neue", position: "relative" } },
    h("div", { style: { display: "flex", flexWrap: "wrap", width: titleWidth, fontSize: titleSize, lineHeight: 0.9 } }, ...titleWords),
    h("div", { style: { display: "flex", alignItems: "center", alignSelf: "flex-start", marginTop: Math.round(H * 0.012),
      fontFamily: "DM Sans", fontWeight: 700, fontSize: subSize, letterSpacing: subSize * 0.3, color: ACCENT_HEX,
      backgroundColor: "rgba(6,8,7,0.92)",
      paddingTop: Math.round(subSize * 0.35), paddingBottom: Math.round(subSize * 0.35),
      paddingLeft: Math.round(subSize * 0.55), paddingRight: Math.round(subSize * 0.55) } },
      h("div", { style: { display: "flex", width: Math.round(W * 0.03), height: 3, backgroundColor: ACCENT_HEX, marginRight: subSize * 0.6 } }),
      h("div", { style: { display: "flex" } }, theme.label)
    )
  );
}
async function renderOverlay(W, H) {
  const svg = await satori(overlayTree(W, H), { width: W, height: H, fonts: [
    { name: "Bebas Neue", data: bebas, weight: 400, style: "normal" },
    { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
  ] });
  return new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
}
function grainLayer(W, H) {
  const buf = Buffer.allocUnsafe(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = 90 + Math.floor(Math.random() * 76); buf[i * 4] = v; buf[i * 4 + 1] = v; buf[i * 4 + 2] = v; buf[i * 4 + 3] = 28; }
  return sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

const W = 1080, H = 1080;
const slug = slugify(NAME);
const coverPath = join(OUT, `${slug}-cover.png`);
const bgCache = join(OUT, `${slug}-bg.png`);
let bg;
if (REUSE_BG && existsSync(bgCache)) bg = readFileSync(bgCache);
else { bg = await sharp(await genBackground("1024x1024")).resize(W, H, { fit: "cover", position: "centre" }).toBuffer(); writeFileSync(bgCache, bg); }

// Optional single composited crest (club EOS topics), lower-right, on a soft cream disc.
const composites = [{ input: await grainLayer(W, H), blend: "overlay" }];
if (theme.crest) {
  const cslug = slugify(theme.crest);
  const badge = join(ROOT, "public", "badges", `${cslug}.png`);
  if (existsSync(badge)) {
    const size = Math.round(W * 0.30);
    const crest = await sharp(badge).resize(size, size, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    const m = Math.round(W * 0.05);
    composites.push({ input: crest, top: H - size - m, left: W - size - m });
  }
}
composites.push({ input: await renderOverlay(W, H), top: 0, left: 0 });
await sharp(bg).composite(composites).png().toFile(coverPath);
console.error(`✓ ${NAME} → ${coverPath} (theme: ${theme.label})`);
console.log(`COVER=${coverPath}`);
