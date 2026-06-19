"use client";

/**
 * /admin/club-preview — Club League visual generator (admin-only, deploys with the
 * app). Paste a venue's domain → Claude reads their site → renders three screens
 * that mirror the real /l/[slug] pages, adapted to the brand's artwork (dark logos
 * get a light tile, transparent line-art headers get a cream band, monochrome
 * brands get a warm pub-gold accent) → downloads ONE side-by-side strip PNG for
 * outreach emails. Mirrors the standalone tool at ~/yourscore-club-preview.
 */

import { useEffect, useMemo, useState } from "react";
import { toPng } from "html-to-image";
import { BackPill } from "@/components/ui/BackPill";

type Kind = "pub" | "creator" | "sponsor";
interface Brand {
  name: string; color: string; logo: string; wallpaper: string;
  prize: string; winner: string; kind: Kind; logoDark: boolean; coverLight: boolean;
}
const EMPTY: Brand = { name: "Your Venue", color: "aeea00", logo: "", wallpaper: "", prize: "£50 bar tab", winner: "Dave K.", kind: "pub", logoDark: false, coverLight: false };
const AMBER = "d8a24a";
const ENRICH = "/api/admin/club-preview/enrich";
const PROXY = (u: string) => `/api/admin/club-preview/proxy?url=${encodeURIComponent(u)}`;

// ── sample data (mirrors the real BoardTab / event board) ───────────────────
const ROWS = [
  { i: "DK", n: "Dave K.", w: 9, d: 2, l: 1, g: 312, p: "14,820", bg: "#3a2f4a", fg: "#c7b3ff" },
  { i: "SM", n: "Sarah M.", w: 7, d: 4, l: 2, g: 588, p: "13,140", bg: "#1a4a2a", fg: "#4ade80" },
  { i: "TP", n: "Tom P.", w: 6, d: 5, l: 1, g: 921, p: "11,990", bg: "#1a2f4a", fg: "#60a5fa" },
  { i: "YO", n: "You", w: 6, d: 3, l: 3, g: 1440, p: "10,910", bg: "#4a2a1a", fg: "#fb923c", you: true },
  { i: "LH", n: "Liam H.", w: 5, d: 6, l: 1, g: 1610, p: "10,540", bg: "#2a3a4a", fg: "#7dd3fc" },
];
const eventRows = (b: Brand) => [
  { i: initials(b.winner), n: b.winner, c: 12, p: "9,240", bg: "#3a2f4a", fg: "#c7b3ff", win: true },
  { i: "SM", n: "Sarah M.", c: 11, p: "8,900", bg: "#1a4a2a", fg: "#4ade80" },
  { i: "TP", n: "Tom P.", c: 11, p: "8,420", bg: "#1a2f4a", fg: "#60a5fa" },
  { i: "LH", n: "Liam H.", c: 10, p: "7,650", bg: "#2a3a4a", fg: "#7dd3fc" },
  { i: "PS", n: "Priya S.", c: 9, p: "6,980", bg: "#4a1a2a", fg: "#f87171" },
];

function hexRgb(h: string) { h = (h || "aeea00").replace(/^#/, ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
function vars(b: Brand) {
  const c = hexRgb(b.color); const a = (o: number) => `rgba(${c.r},${c.g},${c.b},${o})`;
  return { accent: `rgb(${c.r},${c.g},${c.b})`, a, dim: a(0.16), b11: a(0.07), b33: a(0.22), b44: a(0.28), b55: a(0.34), tile: b.logoDark ? "#f4efe3" : "#0e1611", tileBorder: b.logoDark ? "rgba(0,0,0,0.15)" : a(0.34) };
}
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m] as string));
const initial = (b: Brand) => (b.name.trim()[0] || "Y").toUpperCase();
function initials(s: string) { return (String(s).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "W"); }
const num = (n: number) => n.toLocaleString();
type V = ReturnType<typeof vars>;

const topbar = `<div class="cpv-topbar"><img src="/logo-mark.png" alt="YourScore" crossorigin="anonymous" /></div>`;
function coverHeader(b: Brand, V: V) {
  let cover: string, ov: string;
  if (b.wallpaper && b.coverLight) {
    cover = `background:#efe7d6 center/contain no-repeat url('${PROXY(b.wallpaper)}')`;
    ov = `background:linear-gradient(180deg, rgba(239,231,214,0) 40%, #0a0a0f 88%)`;
  } else if (b.wallpaper) {
    cover = `background-image:url('${PROXY(b.wallpaper)}')`;
    ov = `background:linear-gradient(180deg, transparent 20%, #0a0a0f 100%)`;
  } else {
    cover = `background:linear-gradient(135deg, ${V.dim} 0%, #0e1611 80%)`;
    ov = `background:linear-gradient(180deg, transparent 20%, #0a0a0f 100%)`;
  }
  const logoInner = b.logo
    ? `<img src="${PROXY(b.logo)}" crossorigin="anonymous" />`
    : `<span style="font-size:64px;font-weight:800;color:${b.logoDark ? "#1a1a1a" : V.accent}">${initial(b)}</span>`;
  return `<div class="cpv-cover" style="${cover}"><div class="cpv-ov" style="${ov}"></div></div>
    <div class="cpv-body"><div class="cpv-head">
      <div class="cpv-logo" style="background:${V.tile};border:3px solid ${V.tileBorder}">${logoInner}</div>
      <div style="min-width:0;padding-bottom:6px">
        <div class="cpv-name">${esc(b.name)}</div>
        <div class="cpv-sub" style="color:${V.accent}">Club League · 24 members</div>
      </div></div>`;
}
function tabs(active: string, V: V) {
  return `<div class="cpv-tabs">${["Board", "Events", "Feed"].map((t) => { const on = t === active; return `<div style="background:${on ? V.accent : "transparent"};color:${on ? "#0a0a0f" : "#8a948f"};font-weight:${on ? 700 : 600}">${t}</div>`; }).join("")}</div>`;
}
function nav(V: V) {
  const items: [string, string, number][] = [["🏠", "Home", 0], ["🏆", "Leagues", 1], ["🧠", "Quiz", 0], ["⚽", "38-0", 0], ["👤", "Profile", 0]];
  return `<div class="cpv-nav">${items.map(([ic, lb, on]) => `<div style="color:${on ? V.accent : "#8a948f"}"><span class="ic">${ic}</span>${lb}</div>`).join("")}</div>`;
}
function boardRow(r: (typeof ROWS)[number], pos: number, V: V) {
  const top = pos === 1;
  const medal = pos <= 3 ? ["🥇", "🥈", "🥉"][pos - 1] : `<span style="color:#8a948f">#${pos}</span>`;
  const ptcol = top ? "#ffd700" : r.you ? V.accent : "#9aa39d";
  return `<div class="cpv-row" style="background:${r.you ? V.dim : "#0e1611"};border:1px solid ${r.you ? V.b44 : "rgba(255,255,255,0.06)"}">
    <div class="rk">${medal}</div><div class="av" style="background:${r.bg};color:${r.fg}">${r.i}</div>
    <div class="mid"><div class="n">${esc(r.n)}${r.you ? `<span style="color:${V.accent};font-size:20px;font-weight:400"> you</span>` : ""}</div>
      <div class="r" style="color:#586058">${r.w}W · ${r.d}D · ${r.l}L · global #${num(r.g)}</div></div>
    <div class="pt" style="color:${ptcol}">${r.p}</div></div>`;
}
// Illustrative upcoming World Cup fixtures for the events screen.
const FIXTURES = [
  { m: "England vs Wales", d: "Sat 21 Jun · 8:00 pm" },
  { m: "Brazil vs Argentina", d: "Sun 22 Jun · 8:00 pm" },
  { m: "France vs Spain", d: "Mon 23 Jun · 5:00 pm" },
];
function fixtureRow(f: { m: string; d: string }, V: V) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;border-radius:16px;padding:18px 22px;margin-bottom:10px;background:#0e1611;border:1px solid rgba(255,255,255,0.07)">
    <div><div style="font-size:27px;font-weight:700">${esc(f.m)}</div><div style="font-size:20px;color:#586058;margin-top:3px">${esc(f.d)}</div></div>
    <span style="font-size:18px;font-weight:700;color:${V.accent};background:${V.dim};padding:8px 16px;border-radius:10px;white-space:nowrap">Half Time Quiz</span></div>`;
}

function renderHome(b: Brand) {
  const V = vars(b);
  return `${topbar}${coverHeader(b, V)}
    <div class="cpv-pinned" style="background:${V.b11};border:1px solid ${V.b33}"><div class="k" style="color:${V.accent}">📌 Pinned</div>
      <div class="v">England vs Ghana — Half Time Quiz tonight. Winner takes the ${esc(b.prize)}.</div></div>
    ${tabs("Board", V)}
    <div class="cpv-prize" style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.15);color:#ffd700">🏆 ${esc(b.prize)}</div>
    ${ROWS.map((r, i) => boardRow(r, i + 1, V)).join("")}
    <div class="cpv-foot" style="color:#3a423d">YourScore points — 38-0 wins, quiz knowledge, one table.</div>
    </div>${nav(V)}`;
}
function renderEvents(b: Brand) {
  const V = vars(b);
  return `${topbar}${coverHeader(b, V)}${tabs("Events", V)}
    <div class="cpv-ev" style="background:${V.a(0.07)};border:1px solid ${V.b44}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span class="cpv-chip" style="color:${V.accent};background:${V.dim}">LIVE NOW</span><span style="color:#586058;font-size:22px">Today · half time</span></div>
      <div style="font-size:34px;font-weight:800;margin-bottom:4px">England vs Ghana — Half Time Quiz</div>
      <div style="font-size:23px;color:#8a948f;margin-bottom:8px">Play at half time · all welcome</div>
      <div style="font-size:24px;color:#ffd700">🏆 ${esc(b.prize)}</div>
      <div style="margin-top:20px;border-radius:16px;padding:18px;text-align:center;background:${V.accent};color:#0a0a0f;font-size:28px;font-weight:800;letter-spacing:1px">PLAY NOW →</div></div>
    <div style="font-size:21px;text-transform:uppercase;letter-spacing:2px;color:#586058;margin:6px 0 14px">Upcoming fixtures</div>
    ${FIXTURES.map((f) => fixtureRow(f, V)).join("")}
    </div>${nav(V)}`;
}
function renderResult(b: Brand) {
  const V = vars(b);
  return `${topbar}<div class="cpv-body" style="padding-top:28px">
    <div style="font-size:22px;color:#8a948f;margin-bottom:18px">← ${esc(b.name)}</div>
    <div style="border-radius:22px;padding:26px;background:#0e1611;border:1px solid ${V.b33};margin-bottom:18px">
      <span class="cpv-chip" style="color:#8a948f;background:rgba(255,255,255,0.06)">ENDED</span>
      <div style="font-size:40px;font-weight:800;margin:14px 0 6px">England vs Ghana — Half Time Quiz</div>
      <div style="font-size:22px;color:#586058">Played at half time · 10 questions</div>
      <div style="margin-top:16px;border-radius:14px;padding:14px 18px;background:rgba(255,215,0,0.07);border:1px solid rgba(255,215,0,0.18);color:#ffd700;font-size:24px">🏆 ${esc(b.prize)}</div></div>
    <div style="border-radius:22px;padding:30px;text-align:center;background:${V.dim};border:1px solid ${V.b44};margin-bottom:22px">
      <div style="color:${V.accent};font-size:22px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">🏆 Winner — ${esc(b.winner)}</div>
      <div style="font-size:78px;font-weight:800;line-height:1">9,240</div>
      <div style="color:#8a948f;font-size:24px;margin-top:8px">12 correct · took the ${esc(b.prize)}</div></div>
    <div style="font-size:21px;text-transform:uppercase;letter-spacing:2px;color:#586058;margin-bottom:14px">Event board</div>
    ${eventRows(b).map((r, i) => { const pos = i + 1, medal = pos <= 3 ? ["🥇", "🥈", "🥉"][pos - 1] : `<span style="color:#8a948f">#${pos}</span>`;
      return `<div class="cpv-row" style="background:${r.win ? V.dim : "#0e1611"};border:1px solid ${r.win ? V.b44 : "rgba(255,255,255,0.06)"}">
        <div class="rk">${medal}</div><div class="av" style="background:${r.bg};color:${r.fg}">${r.i}</div>
        <div class="mid"><div class="n">${esc(r.n)}</div><div class="r" style="color:#586058">${r.c} correct</div></div>
        <div class="pt" style="color:${pos === 1 ? "#ffd700" : "#9aa39d"}">${r.p}</div></div>`; }).join("")}
    </div>${nav(V)}`;
}

function analyzeImage(url: string): Promise<{ lum: number; vibrant: string | null; mono: boolean; transparentRatio: number } | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const S = 64, c = document.createElement("canvas"); c.width = S; c.height = S;
        const x = c.getContext("2d"); if (!x) return resolve(null);
        x.clearRect(0, 0, S, S); x.drawImage(img, 0, 0, S, S);
        const { data } = x.getImageData(0, 0, S, S);
        let trans = 0, lsum = 0, lcnt = 0, br = 0, bg = 0, bb = 0, best = -1;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 32) { trans++; continue; }
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx, lum = (mx + mn) / 2;
          lsum += lum; lcnt++;
          if (lum < 24 || lum > 232) continue;
          const sc = sat * (1 - Math.abs(lum - 128) / 128);
          if (sc > best) { best = sc; br = r; bg = g; bb = b; }
        }
        const vibrant = best > 0.18 ? [br, bg, bb].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : null;
        resolve({ lum: lcnt ? lsum / lcnt : 128, vibrant, mono: !vibrant, transparentRatio: trans / (S * S) });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = PROXY(url);
  });
}
const SHOTS = [["home", renderHome], ["events", renderEvents], ["result", renderResult]] as const;
function slug(s: string) { return (s || "venue").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue"; }
function loadImg(src: string): Promise<HTMLImageElement> { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

async function composeStrip(): Promise<string> {
  const urls = await Promise.all(SHOTS.map(([k]) => toPng(document.getElementById("shot-" + k)!, { width: 860, height: 1530, pixelRatio: 2, cacheBust: true, backgroundColor: "#0a0a0f" })));
  const imgs = await Promise.all(urls.map(loadImg));
  const sw = imgs[0].naturalWidth, sh = imgs[0].naturalHeight, pad = 80, gap = 64, r = 44;
  const W = pad * 2 + sw * 3 + gap * 2, H = pad * 2 + sh;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d")!; x.fillStyle = "#0a0a0f"; x.fillRect(0, 0, W, H);
  const roundPath = (dx: number, dy: number, w: number, h: number) => {
    x.beginPath();
    x.moveTo(dx + r, dy); x.arcTo(dx + w, dy, dx + w, dy + h, r); x.arcTo(dx + w, dy + h, dx, dy + h, r);
    x.arcTo(dx, dy + h, dx, dy, r); x.arcTo(dx, dy, dx + w, dy, r); x.closePath();
  };
  imgs.forEach((im, i) => {
    const dx = pad + i * (sw + gap), dy = pad;
    x.save(); roundPath(dx, dy, sw, sh); x.clip(); x.drawImage(im, dx, dy, sw, sh); x.restore();
    x.strokeStyle = "rgba(255,255,255,0.08)"; x.lineWidth = 2; roundPath(dx, dy, sw, sh); x.stroke();
  });
  return c.toDataURL("image/png");
}

const inputStyle = { background: "#0a0a0f", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" } as const;

export default function ClubPreviewGenerator() {
  const [site, setSite] = useState("");
  const [b, setB] = useState<Brand>(EMPTY);
  const [fetching, setFetching] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => setB((p) => ({ ...p, [k]: v }));

  const screens = useMemo(() => SHOTS.map(([k, fn]) => [k, fn(b)] as const), [b]);

  // Scale the true-size (860px) screens down to fit their preview frames.
  useEffect(() => {
    const fit = () => SHOTS.forEach(([k]) => {
      const wrap = document.getElementById("wrap-" + k); const stage = wrap?.parentElement;
      if (wrap && stage) wrap.style.transform = `scale(${stage.clientWidth / 860})`;
    });
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  async function fetchBranding() {
    if (!site.trim() || fetching) return;
    setFetching(true); setMsg({ text: "Reading the site…", ok: true });
    try {
      const r = await fetch(ENRICH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: site }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Could not read that site");
      const next: Brand = { ...b, name: d.name || b.name, logo: d.logo || "", wallpaper: d.wallpaper || "", color: d.color || "" };
      const logo = await analyzeImage(next.logo);
      const wall = next.wallpaper ? await analyzeImage(next.wallpaper) : null;
      next.logoDark = !!(logo && logo.lum < 120);
      next.coverLight = !!(wall && (wall.transparentRatio > 0.25 || wall.lum > 205));
      if (logo && logo.mono && logo.lum < 120) next.color = AMBER;
      else next.color = d.color || (logo && logo.vibrant) || "aeea00";
      setB(next);
      setMsg({ text: `Pulled from ${d.source || site} ✓${d.via === "ai" ? " · read by Claude" : ""} — tweak anything, then download.`, ok: true });
    } catch (e) { setMsg({ text: String((e as Error).message), ok: false }); }
    setFetching(false);
  }
  async function reSample() {
    if (!b.logo) return;
    const logo = await analyzeImage(b.logo);
    if (logo) setB((p) => ({ ...p, color: logo.vibrant || AMBER, logoDark: logo.lum < 120 }));
  }
  async function download() {
    if (downloading) return; setDownloading(true);
    try {
      const url = await composeStrip();
      const a = document.createElement("a"); a.href = url; a.download = `clubleague-${slug(b.name)}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch { setMsg({ text: "Could not render — check the logo/wallpaper URLs", ok: false }); }
    setDownloading(false);
  }

  const accent = `#${b.color || "aeea00"}`;
  return (
    <main className="min-h-dvh bg-bg px-6 py-8">
      <style jsx global>{`
        .cpv-shot { width: 860px; height: 1530px; background: #0a0a0f; position: relative; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff; display: flex; flex-direction: column; }
        .cpv-topbar { display: flex; align-items: center; height: 84px; padding: 0 44px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
        .cpv-topbar img { height: 34px; }
        .cpv-cover { height: 250px; position: relative; background-size: cover; background-position: center; flex-shrink: 0; }
        .cpv-cover .cpv-ov { position: absolute; inset: 0; }
        .cpv-body { padding: 0 44px; flex: 1; }
        .cpv-head { display: flex; align-items: flex-end; gap: 18px; margin-top: -78px; position: relative; z-index: 2; margin-bottom: 26px; }
        .cpv-logo { width: 140px; height: 140px; border-radius: 28px; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; padding: 14px; }
        .cpv-logo img { width: 100%; height: 100%; object-fit: contain; }
        .cpv-name { font-size: 52px; font-weight: 800; letter-spacing: -1px; line-height: 1.02; }
        .cpv-sub { font-size: 26px; font-weight: 600; margin-top: 8px; }
        .cpv-pinned { border-radius: 22px; padding: 22px 26px; margin-bottom: 24px; }
        .cpv-pinned .k { font-size: 22px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px; }
        .cpv-pinned .v { font-size: 30px; line-height: 1.4; }
        .cpv-tabs { display: flex; gap: 8px; padding: 8px; border-radius: 22px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); margin-bottom: 24px; }
        .cpv-tabs div { flex: 1; text-align: center; padding: 18px 0; border-radius: 16px; font-size: 27px; }
        .cpv-prize { border-radius: 16px; padding: 16px 22px; margin-bottom: 14px; font-size: 26px; }
        .cpv-row { display: flex; align-items: center; gap: 18px; border-radius: 22px; padding: 20px 24px; margin-bottom: 10px; }
        .cpv-row .rk { width: 56px; text-align: center; font-size: 34px; font-weight: 800; flex-shrink: 0; }
        .cpv-row .av { width: 64px; height: 64px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 700; flex-shrink: 0; }
        .cpv-row .mid { flex: 1; min-width: 0; }
        .cpv-row .mid .n { font-size: 30px; font-weight: 600; }
        .cpv-row .mid .r { font-size: 21px; margin-top: 3px; }
        .cpv-row .pt { font-size: 40px; font-weight: 800; flex-shrink: 0; }
        .cpv-foot { text-align: center; font-size: 22px; margin-top: 16px; }
        .cpv-ev { border-radius: 22px; padding: 26px; margin-bottom: 16px; }
        .cpv-chip { font-size: 22px; font-weight: 700; padding: 6px 16px; border-radius: 10px; }
        .cpv-nav { display: flex; align-items: center; justify-content: space-around; height: 130px; border-top: 1px solid rgba(255,255,255,0.07); background: rgba(10,10,15,0.9); flex-shrink: 0; }
        .cpv-nav div { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 21px; }
        .cpv-nav div .ic { font-size: 34px; }
      `}</style>

      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <BackPill href="/admin" label="Admin" tone="neutral" />
          <h1 className="font-display text-3xl text-white tracking-wide mt-2">Club League visual generator</h1>
          <p className="font-body text-sm mt-1" style={{ color: "#8a948f" }}>
            Paste a pub&apos;s website. Claude reads their branding and renders their Club League — download one strip PNG for outreach.
          </p>
        </div>

        {/* fetch */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.18)" }}>
          <p className="font-display tracking-wide" style={{ fontSize: 15, color: "#aeea00" }}>1 · PASTE THE PUB&apos;S SITE</p>
          <div className="flex gap-2">
            <input value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchBranding()}
              placeholder="theredlionpub.co.uk  (or a full https:// link)" className="flex-1 rounded-xl px-3 py-3 font-body text-sm outline-none" style={inputStyle} />
            <button onClick={fetchBranding} disabled={fetching || !site.trim()} className="rounded-xl px-5 font-display tracking-wide disabled:opacity-50" style={{ background: "#aeea00", color: "#062013", fontSize: 15 }}>
              {fetching ? "READING…" : "FETCH BRANDING"}
            </button>
          </div>
          {msg && <p className="font-body text-xs" style={{ color: msg.ok ? "#aeea00" : "#ff4757" }}>{msg.text}</p>}
        </div>

        {/* preview strip */}
        <div className="rounded-2xl p-4" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between mb-3">
            <strong className="text-white text-sm">The three screens</strong>
            <button onClick={download} disabled={downloading} className="rounded-xl px-4 py-2 font-display tracking-wide disabled:opacity-50" style={{ background: accent, color: "#0a0a0f", fontSize: 13 }}>
              {downloading ? "RENDERING…" : "↓ Download strip (1 image)"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {screens.map(([k, html]) => (
              <div key={k} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ width: "100%", aspectRatio: "860 / 1530", overflow: "hidden", position: "relative", background: "#0a0a0f" }}>
                  <div id={`wrap-${k}`} style={{ position: "absolute", top: 0, left: 0, transformOrigin: "top left" }}>
                    <div id={`shot-${k}`} className="cpv-shot" dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* edit */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="font-display tracking-wide" style={{ fontSize: 15, color: "#fff" }}>2 · ADJUST ANYTHING</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Venue name</span>
              <input value={b.name} onChange={(e) => set("name", e.target.value)} maxLength={40} className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} /></label>
            <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Partner type</span>
              <select value={b.kind} onChange={(e) => set("kind", e.target.value as Kind)} className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle}>
                <option value="pub">pub</option><option value="creator">creator</option><option value="sponsor">sponsor</option></select></label>
          </div>
          <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Brand colour</span>
            <div className="flex items-center gap-2">
              <input type="color" value={accent} onChange={(e) => set("color", e.target.value.replace(/^#/, ""))} style={{ width: 44, height: 40, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 2 }} />
              <input value={b.color} onChange={(e) => set("color", e.target.value.replace(/^#/, "").slice(0, 6))} placeholder="c8102e" className="flex-1 rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
              <button onClick={reSample} disabled={!b.logo} className="rounded-xl px-3 py-2.5 font-body text-xs font-semibold disabled:opacity-40" style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe0", border: "1px solid rgba(255,255,255,0.12)" }}>Sample from logo</button>
            </div></label>
          <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Logo URL</span>
            <input value={b.logo} onChange={(e) => set("logo", e.target.value)} placeholder="https://…/logo.png" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} /></label>
          <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Cover / wallpaper URL</span>
            <input value={b.wallpaper} onChange={(e) => set("wallpaper", e.target.value)} placeholder="https://…/pub-interior.jpg" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Quiz-night prize</span>
              <input value={b.prize} onChange={(e) => set("prize", e.target.value)} maxLength={40} className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} /></label>
            <label className="block"><span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Winner (result screen)</span>
              <input value={b.winner} onChange={(e) => set("winner", e.target.value)} maxLength={30} className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} /></label>
          </div>
        </div>
      </div>
    </main>
  );
}
