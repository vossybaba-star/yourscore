/**
 * /s/[id] — public landing for a SHORT-linked season result.
 *
 * The result payload is stored server-side (draft_shares) under a short id, so the
 * shared URL stays compact instead of carrying the whole XI in the query string.
 * We resolve the id → payload, set og:image → /api/draft/season-og so pasted links
 * unfurl as the broadcast card, and show a clean CTA to build your own XI. Lives at
 * the root (not under the game's route prefix) so the shared link stays neutral.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { createDraftDb } from "@/lib/draft/server";

export const runtime = "nodejs";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";
const KEYS = ["w", "d", "l", "pts", "pos", "ovr", "mode", "inv", "boot", "pots", "xi"];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function loadPayload(id: string): Promise<Record<string, string> | null> {
  try {
    const db = createDraftDb();
    const { data } = await db.from("draft_shares").select("payload").eq("id", id).maybeSingle();
    const p = data?.payload as Record<string, string> | undefined;
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

function ogUrl(p: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const k of KEYS) { const v = p[k]; if (v) params.set(k, v); }
  // Landscape variant: socials show summary_large_image at ~1.91:1, which would
  // crop a portrait card's hero record. The wide card keeps the W-D-L visible.
  params.set("wide", "1");
  return `${BASE}/api/draft/season-og?${params.toString()}`;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const p = await loadPayload(params.id);
  if (!p) {
    const title = "YourScore — build your all-time XI";
    return { title, description: "Build an all-time XI and simulate your season. Think you can beat it?" };
  }
  const pos = parseInt(p.pos || "10", 10);
  const title = `${p.w ?? 0}-${p.d ?? 0}-${p.l ?? 0} · finished ${ordinal(pos)} on ${p.pts ?? 0} pts | YourScore`;
  const description = "Build an all-time XI and simulate your season on YourScore. Think you can beat it?";
  const image = ogUrl(p);
  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SeasonShortSharePage({ params }: { params: { id: string } }) {
  const p = await loadPayload(params.id);

  if (!p) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
        <div>
          <div className="font-body" style={{ fontSize: 13, color: "#8888aa", letterSpacing: 1 }}>YOURSCORE</div>
          <div className="font-display tracking-wide mt-3" style={{ fontSize: 28, color: "#fff" }}>This link has expired</div>
          <Link href="/38-0" className="inline-block mt-6 rounded-2xl px-6 py-4 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
            BUILD YOUR OWN XI →
          </Link>
        </div>
      </div>
    );
  }

  const pos = parseInt(p.pos || "10", 10);
  const pts = p.pts || "0";
  const w = p.w || "0", d = p.d || "0", l = p.l || "0";
  const accent = p.inv === "1" ? "#ffd700" : pos === 1 ? "#00ff87" : pos <= 4 ? "#22d3ee" : pos <= 12 ? "#ffb800" : "#ff4757";

  return (
    <div className="min-h-[100dvh] grid place-items-center px-6 text-center" style={{ background: "#0a0a0f" }}>
      <div>
        <div className="font-body" style={{ fontSize: 13, color: "#8888aa", letterSpacing: 1 }}>YOURSCORE</div>
        <div className="font-display tracking-wide leading-none mt-3" style={{ fontSize: 64, color: "#fff" }}>{w}-{d}-{l}</div>
        <div className="font-body" style={{ fontSize: 12, color: "#8888aa", letterSpacing: 2 }}>WON · DRAWN · LOST</div>
        <div className="font-body mt-3" style={{ fontSize: 18, color: "#fff" }}>
          Finished <b style={{ color: accent }}>{ordinal(pos)}</b> on <b>{pts}</b> pts
        </div>
        <Link href="/38-0" className="inline-block mt-6 rounded-2xl px-6 py-4 font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 24 }}>
          BUILD YOUR OWN XI →
        </Link>
      </div>
    </div>
  );
}
