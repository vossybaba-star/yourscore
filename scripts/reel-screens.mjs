// Generates the 38-0 World Cup Daily reel screens as 1080x1920 PNGs.
// Engine: satori (layout -> SVG) + resvg (SVG -> PNG) — the same stack the app
// uses for share graphics. Fonts: Bebas Neue (display) + DM Sans (body) via @fontsource.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "marketing", "reels", "screens");
mkdirSync(OUT, { recursive: true });

const W = 1080, H = 1920;

// ── Brand palette (from src/app/globals.css) ──────────────────────────────────
const C = {
  bg: "#0a0a0f", surface: "#0e1611", surface2: "#12121e", surface3: "#0d0d14",
  lime: "#aeea00", teal: "#00d8c0", gold: "#ffb800", goldBright: "#ffc233",
  danger: "#ff4757", green: "#00ff87", white: "#ffffff",
  text: "#eef2f0", sub: "#c4ccc6", muted: "#8a948f", faint: "#6a6a82",
  line: "rgba(255,255,255,0.07)",
};

const F = (p) => readFileSync(join(ROOT, "node_modules/@fontsource", p));
const fonts = [
  { name: "Bebas", data: F("bebas-neue/files/bebas-neue-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "DM", data: F("dm-sans/files/dm-sans-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "DM", data: F("dm-sans/files/dm-sans-latin-500-normal.woff"), weight: 500, style: "normal" },
  { name: "DM", data: F("dm-sans/files/dm-sans-latin-700-normal.woff"), weight: 700, style: "normal" },
];

// ── tiny hyperscript helper (satori takes React-element-shaped objects) ────────
const h = (type, props = {}, children) => ({ type, props: { ...props, ...(children !== undefined ? { children } : {}) } });
const div = (style, children) => h("div", { style: { display: "flex", ...style } }, children);
const col = (style, children) => div({ flexDirection: "column", ...style }, children);
const row = (style, children) => div({ flexDirection: "row", alignItems: "center", ...style }, children);
const txt = (style, s) => h("div", { style: { display: "flex", fontFamily: "DM", ...style } }, s);
const disp = (style, s) => txt({ fontFamily: "Bebas", letterSpacing: 1, ...style }, s);

// ── simple inline-SVG icons (satori renders <svg>) ────────────────────────────
function star(size, fill) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24" },
    h("polygon", { points: "12,2 15,9 22.5,9.3 16.5,14 18.7,21.3 12,17 5.3,21.3 7.5,14 1.5,9.3 9,9", fill }));
}
function clock(size, fill) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24" }, [
    h("circle", { cx: 12, cy: 13, r: 8.5, fill: "none", stroke: fill, strokeWidth: 2 }),
    h("path", { d: "M12 8.5 V13 L15.5 15", fill: "none", stroke: fill, strokeWidth: 2, strokeLinecap: "round" }),
    h("path", { d: "M9 2.5 h6", stroke: fill, strokeWidth: 2, strokeLinecap: "round" }),
  ]);
}
function lock(size, fill) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24" }, [
    h("rect", { x: 4, y: 10, width: 16, height: 11, rx: 2.5, fill }),
    h("path", { d: "M7.5 10 V7 a4.5 4.5 0 0 1 9 0 V10", fill: "none", stroke: fill, strokeWidth: 2.2 }),
  ]);
}
function arrow(size, fill) {
  return h("svg", { width: size, height: size * 0.62, viewBox: "0 0 26 16" },
    h("path", { d: "M2 8 H22 M16 2 L22 8 L16 14", fill: "none", stroke: fill, strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }));
}
function ball(size) {
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24" }, [
    h("circle", { cx: 12, cy: 12, r: 10.5, fill: C.white, stroke: "#0a0a0f", strokeWidth: 1 }),
    h("polygon", { points: "12,7 15.2,9.3 14,13 10,13 8.8,9.3", fill: "#0a0a0f" }),
    h("circle", { cx: 5.5, cy: 11, r: 1.4, fill: "#0a0a0f" }),
    h("circle", { cx: 18.5, cy: 11, r: 1.4, fill: "#0a0a0f" }),
    h("circle", { cx: 9, cy: 18, r: 1.4, fill: "#0a0a0f" }),
    h("circle", { cx: 15, cy: 18, r: 1.4, fill: "#0a0a0f" }),
  ]);
}

// ── reusable chunks ───────────────────────────────────────────────────────────
function frame(children, bg = C.bg) {
  return div({ width: W, height: H, background: bg, flexDirection: "column", padding: 64, position: "relative" }, children);
}
function pill(label, fg, bg, bd) {
  return txt({ fontWeight: 700, fontSize: 26, color: fg, background: bg, border: `2px solid ${bd ?? bg}`, borderRadius: 999, padding: "8px 22px", letterSpacing: 1 }, label);
}
function kicker(label, color = C.gold) {
  return disp({ fontSize: 34, color, letterSpacing: 4 }, label);
}
// rating chip used in slates / cards
function ratingChip(n, color, size = 96) {
  return txt({ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 22, fontFamily: "Bebas", fontSize: size * 0.6, color: "#0a0a0f", background: color }, String(n));
}
function progressBar(pct, color = C.lime) {
  return div({ width: "100%", height: 16, background: "rgba(255,255,255,0.08)", borderRadius: 999 },
    div({ width: `${pct}%`, height: 16, background: color, borderRadius: 999 }));
}

// caption strip at the very bottom — the on-screen text for the reel
function caption(line, accent = C.gold) {
  return div({ position: "absolute", left: 0, bottom: 0, width: W, padding: "0 64px 70px", flexDirection: "column" }, [
    div({ width: 90, height: 8, background: accent, borderRadius: 999, marginBottom: 26 }),
    txt({ fontWeight: 700, fontSize: 50, color: C.white, lineHeight: 1.15 }, line),
  ]);
}

// ── a mini formation pitch (simple dots) ──────────────────────────────────────
function pitch(filled = 11, strong = false) {
  const rows = [
    [["GK", strong ? 89 : null]],
    [["LB", null], ["CB", strong ? 90 : null], ["CB", null], ["RB", null]],
    [["CM", strong ? 91 : null], ["CM", null], ["CM", null]],
    [["LW", null], ["ST", strong ? 93 : null], ["RW", null]],
  ];
  let idx = 0;
  return col({ width: "100%", background: "linear-gradient(180deg,#0f1c14,#0a140e)", border: "2px solid rgba(174,234,0,0.18)", borderRadius: 28, padding: "44px 30px", gap: 40 },
    rows.map((r) => row({ justifyContent: "space-around", width: "100%" },
      r.map((p) => {
        const on = idx++ < filled;
        const c = p[1] != null ? C.lime : on ? "rgba(174,234,0,0.55)" : "rgba(255,255,255,0.14)";
        return col({ alignItems: "center", gap: 8 }, [
          div({ width: 56, height: 56, borderRadius: 999, background: on ? c : "transparent", border: `3px solid ${c}`, alignItems: "center", justifyContent: "center" },
            p[1] != null ? txt({ fontFamily: "Bebas", fontSize: 30, color: "#0a0a0f" }, String(p[1])) : txt({ fontSize: 0 }, "")),
          txt({ fontSize: 18, color: C.muted, fontWeight: 500 }, p[0]),
        ]);
      })
    ))
  );
}

// ── SCREENS ───────────────────────────────────────────────────────────────────
const screens = {};

// 01 — Classic 38-0: luck of the draw (spin reel)
screens["01-luck"] = () => frame([
  row({ justifyContent: "space-between" }, [kicker("38-0 · CLASSIC", C.lime), pill("SPIN", "#062013", C.lime)]),
  col({ marginTop: 60, gap: 22 }, [
    txt({ fontSize: 30, color: C.muted, fontWeight: 500, letterSpacing: 2 }, "DEALING YOUR SQUAD…"),
    col({ gap: 18 },
      [[78, "rgba(174,234,0,0.45)"], [84, C.lime], [71, "rgba(174,234,0,0.30)"]].map(([n, c], i) =>
        row({ background: C.surface, border: `2px solid ${i === 1 ? C.lime : C.line}`, borderRadius: 22, padding: 26, gap: 26, opacity: i === 1 ? 1 : 0.5 }, [
          ratingChip(n, c, 88),
          col({ gap: 8 }, [
            txt({ fontFamily: "Bebas", fontSize: 52, color: C.white, letterSpacing: 1 }, i === 1 ? "RANDOM LEGEND" : "· · · · · ·"),
            txt({ fontSize: 24, color: C.muted }, i === 1 ? "spun across FIFA eras" : ""),
          ]),
        ])
      )
    ),
  ]),
  caption("You've seen 38-0 go viral —\nbut it's just luck of the draw.", C.lime),
]);

// 02 — World Cup mode: built for real fans (mode picker / Today's Run)
screens["02-worldcup"] = () => frame([
  row({ justifyContent: "space-between" }, [disp({ fontSize: 64, color: C.white }, "WORLD CUP"), pill("38-0", C.gold, "rgba(255,184,0,0.12)", "rgba(255,184,0,0.45)")]),
  txt({ fontSize: 30, color: C.sub, marginTop: 14, lineHeight: 1.3, fontWeight: 500 }, "Build a World XI, then play a World Cup run — group, then knockouts, all the way to the final."),
  col({ marginTop: 50, gap: 24 }, [
    row({ gap: 16, marginBottom: 4 }, [disp({ fontSize: 30, color: C.gold }, "WORLD CUP MASTERMIND"), txt({ fontSize: 22, color: C.muted }, "· answer to build a stronger XI")]),
    col({ background: C.surface, border: "2px solid rgba(255,184,0,0.5)", borderRadius: 30, padding: 40, gap: 16 }, [
      row({ justifyContent: "space-between" }, [disp({ fontSize: 56, color: C.gold }, "TODAY'S RUN"), pill("RANKED", "#1a1300", C.gold)]),
      txt({ fontSize: 28, color: C.sub, lineHeight: 1.35, fontWeight: 500 }, "One go a day. Today's questions, on the clock. Your result climbs the season board — get closest to 8-0-0."),
    ]),
    col({ background: C.surface, border: "2px solid rgba(255,184,0,0.22)", borderRadius: 30, padding: 40, gap: 12, opacity: 0.85 }, [
      disp({ fontSize: 50, color: "#ffd27a" }, "PRACTICE"),
      txt({ fontSize: 26, color: C.sub, fontWeight: 500 }, "Sharpen up with questions from past days. Unlimited goes."),
    ]),
  ]),
  caption("We built a World Cup version, for\nreal fans who know their stuff.", C.gold),
]);

// 03 — Title card: here's how it works
screens["03-howitworks"] = () => frame([
  col({ flex: 1, justifyContent: "center", alignItems: "flex-start" }, [
    disp({ fontSize: 40, color: C.gold, letterSpacing: 6 }, "WORLD CUP DAILY"),
    disp({ fontSize: 150, color: C.white, lineHeight: 0.92, marginTop: 20 }, "HERE'S\nHOW IT\nWORKS"),
    div({ width: 220, height: 12, background: C.gold, borderRadius: 999, marginTop: 40 }),
  ]),
]);

// 04 — Question with 25s timer
screens["04-question"] = () => frame([
  row({ justifyContent: "space-between" }, [row({ gap: 16 }, [ball(44), disp({ fontSize: 34, color: C.gold }, "ANSWER TO SCOUT")]), txt({ fontSize: 24, color: C.muted }, "Get it right for better players")]),
  col({ marginTop: 36, gap: 16 }, [
    row({ justifyContent: "flex-end", gap: 12 }, [clock(40, C.gold), disp({ fontSize: 36, color: C.gold }, "25s")]),
    progressBar(100, C.gold),
  ]),
  txt({ fontSize: 50, color: C.white, fontWeight: 700, marginTop: 50, lineHeight: 1.25 }, "Who scored the first goal of the 2026 World Cup?"),
  col({ marginTop: 44, gap: 22 },
    ["A.  Kylian Mbappé", "B.  Jude Bellingham", "C.  Vinícius Júnior", "D.  Lautaro Martínez"].map((o) =>
      txt({ fontSize: 36, color: C.white, fontWeight: 500, background: "rgba(255,255,255,0.05)", border: "2px solid rgba(255,255,255,0.12)", borderRadius: 22, padding: "30px 34px" }, o)
    )
  ),
  caption("Behind every draft is a question\non the World Cup so far.", C.gold),
]);

// 05 — Correct → stronger player
screens["05-correct"] = () => frame([
  row({ justifyContent: "space-between" }, [disp({ fontSize: 34, color: C.green }, "CORRECT"), pill("STREAK ×3", C.gold, "rgba(255,184,0,0.12)", "rgba(255,184,0,0.5)")]),
  col({ marginTop: 40, background: "rgba(0,255,135,0.10)", border: "3px solid rgba(0,255,135,0.55)", borderRadius: 30, padding: 44, gap: 28 }, [
    txt({ fontSize: 30, color: C.green, fontWeight: 700, letterSpacing: 1 }, "ELITE PLAYER UNLOCKED"),
    row({ gap: 30 }, [
      ratingChip(93, C.lime, 150),
      col({ gap: 10 }, [
        disp({ fontSize: 72, color: C.white }, "TOP STRIKER"),
        txt({ fontSize: 28, color: C.sub, fontWeight: 500 }, "World-class · ST"),
      ]),
    ]),
  ]),
  col({ marginTop: 50, gap: 18 }, [
    txt({ fontSize: 26, color: C.muted, fontWeight: 500, letterSpacing: 2 }, "YOUR OVERALL CLIMBS"),
    row({ gap: 28, alignItems: "center" }, [disp({ fontSize: 80, color: C.muted }, "82"), arrow(64, C.muted), disp({ fontSize: 120, color: C.lime }, "88")]),
    progressBar(72),
  ]),
  caption("Get it right —\nyou get a stronger player.", C.green),
]);

// 06 — Wrong → mid pick
screens["06-wrong"] = () => frame([
  row({ justifyContent: "space-between" }, [disp({ fontSize: 34, color: C.danger }, "NOT QUITE"), pill("STREAK RESET", C.danger, "rgba(255,71,87,0.12)", "rgba(255,71,87,0.5)")]),
  col({ marginTop: 40, background: "rgba(255,71,87,0.08)", border: "3px solid rgba(255,71,87,0.45)", borderRadius: 30, padding: 44, gap: 28 }, [
    txt({ fontSize: 30, color: "#ff8a3d", fontWeight: 700, letterSpacing: 1 }, "A THINNER POOL THIS PICK"),
    row({ gap: 30 }, [
      ratingChip(74, "#7c8a6a", 150),
      col({ gap: 10 }, [
        disp({ fontSize: 72, color: C.white }, "SQUAD PLAYER"),
        txt({ fontSize: 28, color: C.sub, fontWeight: 500 }, "Mid pick · CM"),
      ]),
    ]),
  ]),
  txt({ fontSize: 34, color: C.sub, fontWeight: 500, marginTop: 50, lineHeight: 1.3 }, "Don't know your football? You'll be building your XI out of mid picks."),
  caption("Get it wrong —\nyou end up with a mid pick.", C.danger),
]);

// 07 — Tournament bracket overview (Road to the Final)
screens["07-tournament"] = () => frame([
  kicker("ROAD TO THE FINAL", C.gold),
  disp({ fontSize: 80, color: C.white, marginTop: 8 }, "THE WORLD CUP"),
  col({ marginTop: 44, gap: 22 },
    [["GROUP", "active"], ["ROUND OF 16", ""], ["QUARTER-FINAL", ""], ["SEMI-FINAL", ""], ["FINAL", "gold"]].map(([s, st]) =>
      row({ justifyContent: "space-between", background: st === "active" ? "rgba(255,184,0,0.10)" : C.surface, border: `2px solid ${st === "active" ? "rgba(255,184,0,0.5)" : st === "gold" ? "rgba(255,194,51,0.4)" : C.line}`, borderRadius: 22, padding: "30px 36px" }, [
        disp({ fontSize: 48, color: st === "gold" ? C.goldBright : C.white }, s),
        txt({ fontSize: 26, color: st === "active" ? C.gold : C.muted, fontWeight: 700 }, st === "active" ? "NOW PLAYING" : st === "gold" ? "8-0-0" : "LOCKED"),
      ])
    )
  ),
  caption("Then you play the\nWorld Cup tournament.", C.gold),
]);

// 08 — Group round + points
screens["08-group"] = () => frame([
  row({ justifyContent: "space-between" }, [kicker("GROUP STAGE", C.gold), pill("3 GAMES", C.gold, "rgba(255,184,0,0.12)", "rgba(255,184,0,0.45)")]),
  col({ marginTop: 44, gap: 22 },
    [["MATCH 1", "WON", "2 – 0", C.green], ["MATCH 2", "WON", "1 – 0", C.green], ["MATCH 3", "DREW", "1 – 1", C.gold]].map(([m, r, sc, c]) =>
      row({ justifyContent: "space-between", background: C.surface, border: `2px solid ${C.line}`, borderRadius: 22, padding: "30px 36px" }, [
        col({ gap: 6 }, [disp({ fontSize: 40, color: C.white }, m), txt({ fontSize: 24, color: c, fontWeight: 700 }, r)]),
        disp({ fontSize: 56, color: c }, sc),
      ])
    )
  ),
  row({ marginTop: 40, justifyContent: "space-between", background: "rgba(0,255,135,0.08)", border: "2px solid rgba(0,255,135,0.4)", borderRadius: 24, padding: "34px 40px" }, [
    col({ gap: 6 }, [disp({ fontSize: 44, color: C.white }, "GROUP POINTS"), txt({ fontSize: 26, color: C.muted, fontWeight: 500 }, "4+ go through · 3 = play-off")]),
    row({ gap: 16, alignItems: "baseline" }, [disp({ fontSize: 120, color: C.green }, "7"), disp({ fontSize: 44, color: C.green }, "PTS")]),
  ]),
  txt({ fontSize: 32, color: C.green, fontWeight: 700, marginTop: 28, textAlign: "center" }, "QUALIFIED — into the knockouts"),
  caption("First up is the group round.", C.gold),
]);

// 09 — Knockout: draft one new player
screens["09-upgrade"] = () => frame([
  row({ justifyContent: "space-between" }, [kicker("ROUND OF 16", C.gold), pill("+1 DRAFT", C.lime, "rgba(174,234,0,0.12)", "rgba(174,234,0,0.4)")]),
  txt({ fontSize: 38, color: C.white, fontWeight: 700, marginTop: 30, lineHeight: 1.3 }, "Before each knockout, draft one new player into your XI."),
  col({ marginTop: 30 }, [pitch(11, true)]),
  row({ marginTop: 40, gap: 20, background: C.surface, border: "2px solid rgba(174,234,0,0.35)", borderRadius: 24, padding: 34 }, [
    ball(48),
    txt({ fontSize: 32, color: C.sub, fontWeight: 500, flex: 1 }, "Answer correctly to draft them — get it wrong and you stick with what you've got."),
  ]),
  caption("Before each knockout stage,\nyou draft one new player.", C.gold),
]);

// 10 — Win / champions / 8-0-0
screens["10-champions"] = () => frame([
  col({ flex: 1, justifyContent: "center", alignItems: "center", gap: 30 }, [
    star(150, C.goldBright),
    disp({ fontSize: 60, color: C.gold, letterSpacing: 6 }, "WORLD CUP WON"),
    disp({ fontSize: 320, color: C.goldBright, lineHeight: 0.85 }, "8-0-0"),
    txt({ fontSize: 40, color: C.white, fontWeight: 700, letterSpacing: 2 }, "PERFECT RUN · UNBEATEN"),
    row({ gap: 18, marginTop: 6 }, [star(40, C.gold), star(40, C.gold), star(40, C.gold)]),
  ]),
  caption("Go the whole tournament unbeaten\n— and you get the big 8-0-0.", C.goldBright),
], "linear-gradient(180deg,#1a1400,#0a0a0f)");

// 11 — Season board
screens["11-board"] = () => frame([
  disp({ fontSize: 70, color: C.gold }, h("span", {}, ["WORLD CUP ", h("span", { style: { color: C.white } }, "SEASON")])),
  txt({ fontSize: 28, color: "#9a9ab0", marginTop: 12, fontWeight: 500, lineHeight: 1.3 }, "One ranked run a day. Closest to a perfect 8-0-0 across the tournament wins."),
  col({ marginTop: 40, background: C.surface3, border: "2px solid rgba(255,255,255,0.08)", borderRadius: 26, overflow: "hidden" }, [
    row({ padding: "20px 30px", background: "rgba(255,255,255,0.03)" }, [
      txt({ width: 70, fontSize: 22, color: "#8888aa", fontWeight: 700 }, "#"),
      txt({ flex: 1, fontSize: 22, color: "#8888aa", fontWeight: 700 }, "PLAYER"),
      txt({ width: 70, fontSize: 22, color: "#8888aa", fontWeight: 700, justifyContent: "center" }, "W"),
      txt({ width: 70, fontSize: 22, color: "#8888aa", fontWeight: 700, justifyContent: "center" }, "D"),
      txt({ width: 70, fontSize: 22, color: "#8888aa", fontWeight: 700, justifyContent: "center" }, "L"),
      txt({ width: 110, fontSize: 22, color: "#cfcfe6", fontWeight: 700, justifyContent: "center" }, "PTS"),
    ]),
    ...[["1", "FootyBrain99", 7, 1, 0, 22, C.gold], ["2", "TikiTaka_Tom", 7, 0, 1, 21, "#cfcfe6"], ["3", "GafferJess", 6, 2, 0, 20, "#cfcfe6"], ["4", "you", 6, 1, 1, 19, C.white, true], ["5", "SundayLeaguer", 5, 2, 1, 17, "#8888aa"]].map(
      ([rk, name, w, d, l, pts, rc, me]) => row({ padding: "26px 30px", borderTop: "1px solid rgba(255,255,255,0.05)", background: me ? "rgba(255,184,0,0.08)" : "transparent" }, [
        txt({ width: 70, fontFamily: "Bebas", fontSize: 36, color: rc, justifyContent: "center" }, rk),
        txt({ flex: 1, fontSize: 30, color: C.white, fontWeight: 700 }, me ? "You" : name),
        txt({ width: 70, fontSize: 28, color: C.green, fontWeight: 700, justifyContent: "center" }, String(w)),
        txt({ width: 70, fontSize: 28, color: C.gold, fontWeight: 700, justifyContent: "center" }, String(d)),
        txt({ width: 70, fontSize: 28, color: C.danger, fontWeight: 700, justifyContent: "center" }, String(l)),
        txt({ width: 110, fontFamily: "Bebas", fontSize: 40, color: C.white, justifyContent: "center" }, String(pts)),
      ])
    ),
  ]),
  caption("Even if you don't, your points\ncount on the Daily leaderboard.", C.gold),
]);

// 12 — One go a day, resets
screens["12-daily"] = () => frame([
  col({ flex: 1, justifyContent: "center", alignItems: "center", gap: 40 }, [
    lock(170, C.gold),
    disp({ fontSize: 90, color: C.white, textAlign: "center", lineHeight: 0.95 }, "ONE GO\nA DAY"),
    txt({ fontSize: 34, color: C.sub, fontWeight: 500, textAlign: "center", lineHeight: 1.4 }, "Only your first try counts to the board."),
    row({ gap: 18, background: C.surface, border: "2px solid rgba(255,184,0,0.35)", borderRadius: 999, padding: "24px 44px" }, [
      clock(40, C.gold),
      disp({ fontSize: 40, color: C.gold }, "RESETS EVERY DAY · NEW QUESTIONS"),
    ]),
  ]),
  caption("Only your first try counts —\nand every day it resets.", C.gold),
]);

// 13 — End card / CTA
screens["13-endcard"] = () => frame([
  col({ flex: 1, justifyContent: "center", alignItems: "center", gap: 28 }, [
    disp({ fontSize: 120, color: C.white, letterSpacing: 2 }, "YOURSCORE"),
    div({ width: 360, height: 10, background: C.lime, borderRadius: 999 }),
    txt({ fontSize: 42, color: C.sub, fontWeight: 500, textAlign: "center" }, "Your football knowledge. Ranked."),
    txt({ marginTop: 30, fontSize: 40, color: "#0a0a0f", background: C.lime, fontWeight: 700, borderRadius: 999, padding: "26px 56px", letterSpacing: 1 }, "yourscore.app"),
  ]),
  div({ position: "absolute", left: 0, bottom: 0, width: W, padding: "0 64px 80px", justifyContent: "center" },
    txt({ fontSize: 34, color: C.muted, fontWeight: 500, textAlign: "center" }, "New squad every day. How far does your football brain get you?")),
], "linear-gradient(180deg,#0a0a0f,#0e1611)");

// ── render all ─────────────────────────────────────────────────────────────────
const order = ["01-luck","02-worldcup","03-howitworks","04-question","05-correct","06-wrong","07-tournament","08-group","09-upgrade","10-champions","11-board","12-daily","13-endcard"];
for (const key of order) {
  const svg = await satori(screens[key](), { width: W, height: H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  writeFileSync(join(OUT, `${key}.png`), png);
  console.log("✓", key);
}
console.log("\nAll screens written to", OUT);
