"use client";

/**
 * /admin/club-preview — the Club League visual generator.
 *
 * Paste a pub/venue/brand's website or domain → we pull their real branding
 * (name, logo, brand colour, a wallpaper image) off their site, render an
 * immersive "branded takeover" Club League mockup, and hand back a downloadable
 * PNG + a shareable image URL to drop into outreach emails. Everything is
 * editable so the operator can fix whatever the site didn't expose.
 *
 * The shareable image is produced by /api/club-preview (server-rendered, brand
 * fonts). Branding extraction + the image proxy (for canvas colour sampling) are
 * the admin-only routes under /api/admin/club-preview/.
 */

import { useState, useMemo, useEffect, useCallback } from "react";

type Kind = "pub" | "creator" | "sponsor";

interface Brand {
  name: string;
  color: string; // hex without '#'
  logo: string;
  wallpaper: string;
  prize: string;
  kind: Kind;
}

const EMPTY: Brand = { name: "", color: "a78bfa", logo: "", wallpaper: "", prize: "£50 bar tab", kind: "pub" };

function buildImageUrl(b: Brand): string {
  const p = new URLSearchParams();
  if (b.name) p.set("pub", b.name);
  if (b.color) p.set("color", b.color);
  if (b.logo) p.set("logo", b.logo);
  if (b.wallpaper) p.set("wallpaper", b.wallpaper);
  if (b.prize) p.set("prize", b.prize);
  p.set("kind", b.kind);
  return `/api/club-preview?${p.toString()}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "club-league";
}

// Sample a logo's dominant vibrant colour (via the same-origin proxy so the
// canvas isn't tainted). Returns hex without '#', or null.
async function extractColor(logoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        const size = 48;
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let br = 0, bg = 0, bb = 0, bScore = -1, sr = 0, sg = 0, sb = 0, sw = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (max + min) / 2;
          if (lum < 24 || lum > 232) continue; // skip near-black / near-white
          const score = sat * (1 - Math.abs(lum - 128) / 128);
          if (score > bScore) { bScore = score; br = r; bg = g; bb = b; }
          const w = sat * sat;
          sr += r * w; sg += g * w; sb += b * w; sw += w;
        }
        const pick = bScore > 0.12
          ? [br, bg, bb]
          : sw > 0 ? [sr / sw, sg / sw, sb / sw] : null;
        if (!pick) return resolve(null);
        const hex = pick.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
        resolve(hex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = `/api/admin/club-preview/proxy?url=${encodeURIComponent(logoUrl)}`;
  });
}

const inputStyle = {
  background: "#0a0a0f",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.12)",
} as const;

export default function ClubPreviewGenerator() {
  const [site, setSite] = useState("");
  const [brand, setBrand] = useState<Brand>(EMPTY);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Debounced image URL so live edits don't hammer the renderer.
  const targetUrl = useMemo(() => buildImageUrl(brand), [brand]);
  const [imgSrc, setImgSrc] = useState<string>(buildImageUrl(EMPTY));
  useEffect(() => {
    const t = setTimeout(() => setImgSrc(targetUrl), 500);
    return () => clearTimeout(t);
  }, [targetUrl]);

  const set = useCallback(<K extends keyof Brand>(k: K, v: Brand[K]) => {
    setBrand((b) => ({ ...b, [k]: v }));
  }, []);

  async function fetchBranding() {
    if (!site.trim() || fetching) return;
    setFetching(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/club-preview/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: site }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error ?? "Could not read that site");
        setFetching(false);
        return;
      }
      const next: Brand = {
        name: d.name ?? "",
        color: d.color ?? "",
        logo: d.logo ?? "",
        wallpaper: d.wallpaper ?? "",
        prize: brand.prize,
        kind: brand.kind,
      };
      // If the site gave no theme colour, sample it from the logo.
      if (!next.color && next.logo) {
        const sampled = await extractColor(next.logo);
        if (sampled) next.color = sampled;
      }
      if (!next.color) next.color = "a78bfa";
      setBrand(next);
      setMsg(`Pulled from ${d.source ?? site} ✓ — tweak anything below, then download.`);
    } catch {
      setMsg("Network error");
    }
    setFetching(false);
  }

  async function reSampleColor() {
    if (!brand.logo) return;
    const c = await extractColor(brand.logo);
    if (c) set("color", c);
  }

  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(targetUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clubleague-${slugify(brand.name || "venue")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMsg("Could not download — try the image URL instead");
    }
    setDownloading(false);
  }

  function copyUrl() {
    const abs = typeof window !== "undefined" ? window.location.origin + targetUrl : targetUrl;
    navigator.clipboard?.writeText(abs);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const accent = `#${brand.color || "a78bfa"}`;

  return (
    <main className="min-h-dvh bg-bg px-6 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-display text-3xl text-white tracking-wide">Club League visual generator</h1>
          <p className="font-body text-sm mt-1" style={{ color: "#8a948f" }}>
            Paste a pub&apos;s website or domain. We pull their branding and render their Club League — download the PNG for outreach.
          </p>
        </div>

        {/* Step 1 — fetch */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.18)" }}>
          <p className="font-display tracking-wide" style={{ fontSize: 15, color: "#aeea00" }}>1 · PASTE THE PUB&apos;S SITE</p>
          <div className="flex gap-2">
            <input
              value={site}
              onChange={(e) => setSite(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchBranding()}
              placeholder="theredlionpub.co.uk  (or a full https:// link)"
              className="flex-1 rounded-xl px-3 py-3 font-body text-sm outline-none"
              style={inputStyle}
            />
            <button
              onClick={fetchBranding}
              disabled={fetching || !site.trim()}
              className="rounded-xl px-5 font-display tracking-wide disabled:opacity-50"
              style={{ background: "#aeea00", color: "#062013", fontSize: 15 }}
            >
              {fetching ? "READING…" : "FETCH BRANDING"}
            </button>
          </div>
          {msg && <p className="font-body text-xs" style={{ color: msg.includes("✓") ? "#aeea00" : "#ff4757" }}>{msg}</p>}
        </div>

        {/* Step 2 — preview */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgSrc} alt="Club League preview" style={{ display: "block", width: "100%", aspectRatio: "1200 / 630", objectFit: "cover", background: "#0a0a0f" }} />
          <div className="flex items-center gap-2 p-3">
            <button
              onClick={download}
              disabled={downloading}
              className="rounded-xl px-4 py-2.5 font-display tracking-wide disabled:opacity-50"
              style={{ background: accent, color: "#0a0a0f", fontSize: 14 }}
            >
              {downloading ? "PREPARING…" : "↓ DOWNLOAD PNG"}
            </button>
            <button
              onClick={copyUrl}
              className="rounded-xl px-4 py-2.5 font-body text-sm font-semibold"
              style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe0", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              {copied ? "Copied ✓" : "Copy image URL"}
            </button>
            <span className="font-body text-xs ml-auto" style={{ color: "#8a948f" }}>
              1200×630 · embeds inline in email
            </span>
          </div>
        </div>

        {/* Step 3 — edit */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="font-display tracking-wide" style={{ fontSize: 15, color: "#fff" }}>2 · ADJUST ANYTHING</p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Venue name</span>
              <input value={brand.name} onChange={(e) => set("name", e.target.value)} maxLength={40}
                className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
            </label>
            <label className="block">
              <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Partner type</span>
              <select value={brand.kind} onChange={(e) => set("kind", e.target.value as Kind)}
                className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle}>
                <option value="pub">pub</option>
                <option value="creator">creator</option>
                <option value="sponsor">sponsor</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Brand colour</span>
            <div className="flex items-center gap-2">
              <input type="color" value={accent} onChange={(e) => set("color", e.target.value.replace(/^#/, ""))}
                style={{ width: 44, height: 40, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 2 }} />
              <input value={brand.color} onChange={(e) => set("color", e.target.value.replace(/^#/, "").slice(0, 6))}
                placeholder="c8102e" className="flex-1 rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
              <button onClick={reSampleColor} disabled={!brand.logo}
                className="rounded-xl px-3 py-2.5 font-body text-xs font-semibold disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe0", border: "1px solid rgba(255,255,255,0.12)" }}>
                Sample from logo
              </button>
            </div>
          </label>

          <label className="block">
            <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Logo URL</span>
            <input value={brand.logo} onChange={(e) => set("logo", e.target.value)}
              placeholder="https://…/logo.png" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
          </label>

          <label className="block">
            <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Wallpaper URL (the takeover backdrop)</span>
            <input value={brand.wallpaper} onChange={(e) => set("wallpaper", e.target.value)}
              placeholder="https://…/pub-interior.jpg" className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
          </label>

          <label className="block">
            <span className="font-body text-xs block mb-1" style={{ color: "#8a948f" }}>Quiz-night prize line</span>
            <input value={brand.prize} onChange={(e) => set("prize", e.target.value)} maxLength={40}
              className="w-full rounded-xl px-3 py-2.5 font-body text-sm outline-none" style={inputStyle} />
          </label>
        </div>
      </div>
    </main>
  );
}
