/**
 * /38-0/season/share — public, server-rendered landing for a shared season result.
 * Stateless: the result is encoded in the query string (computed client-side), so
 * generateMetadata sets og:image → /api/draft/season-og and pasted links unfurl as
 * the broadcast graphic. A clean CTA invites the viewer to build their own XI.
 */

import type { Metadata } from "next";
import { SaveTeamButton } from "./SaveTeamButton";
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import { SeasonScorecard, type SeasonAward, type SeasonData } from "@/components/draft/SeasonScorecard";

export const runtime = "edge";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ogUrl(sp: SP): string {
  const keys = ["w", "d", "l", "pts", "pos", "ovr", "mode", "inv", "boot", "pots", "xi"];
  const params = new URLSearchParams();
  for (const k of keys) { const v = one(sp[k]); if (v) params.set(k, v); }
  params.set("wide", "1"); // landscape so socials don't crop the hero record
  return `${BASE}/api/draft/season-og?${params.toString()}`;
}

export function generateMetadata({ searchParams }: { searchParams: SP }): Metadata {
  const pos = parseInt(one(searchParams.pos) || "10", 10);
  const pts = one(searchParams.pts) || "0";
  const w = one(searchParams.w), d = one(searchParams.d), l = one(searchParams.l);
  const title = `${w}-${d}-${l} · finished ${ordinal(pos)} on ${pts} pts | YourScore 38-0`;
  const description = "This was my result from YourScore 38-0 — build an all-time XI and simulate your season. Think you can beat it?";
  const image = ogUrl(searchParams);
  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** "name~12" → an award with a formatted detail line. */
function award(v: string | undefined, label: string, fmt: (rest: string[]) => string): SeasonAward | null {
  if (!v) return null;
  const [name, ...rest] = v.split("~");
  return name ? { label, name, detail: fmt(rest) } : null;
}

export default function SeasonSharePage({ searchParams }: { searchParams: SP }) {
  const num = (k: string, d = 0) => { const n = parseInt(one(searchParams[k]) || "", 10); return Number.isFinite(n) ? n : d; };
  const awards = [
    award(one(searchParams.boot), "Golden Boot", (r) => `${r[0] ?? 0} goals`),
    award(one(searchParams.play), "Playmaker", (r) => `${r[0] ?? 0} assists`),
    award(one(searchParams.glov), "Golden Glove", (r) => `${r[0] ?? 0} clean sheets`),
    award(one(searchParams.pots), "Player of the Season", (r) => `${r[0] ?? 0}G · ${r[1] ?? 0}A`),
  ].filter((a): a is SeasonAward => a !== null);

  const data: SeasonData = {
    context: "Season",
    invincible: one(searchParams.inv) === "1",
    wins: num("w"), draws: num("d"), losses: num("l"),
    points: num("pts"), position: num("pos", 10),
    verdict: one(searchParams.verdict) || undefined,
    gf: one(searchParams.gf) ? num("gf") : undefined,
    ga: one(searchParams.ga) ? num("ga") : undefined,
    strength: one(searchParams.ovr) ? num("ovr") : undefined,
    awards,
  };

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative mx-auto max-w-lg px-4 pt-safe">
        <div className="py-3">
          <BackPill href="/38-0" label="38-0" tone="draft" />
        </div>

        <SeasonScorecard data={data} />

        <div className="mt-6 flex flex-col gap-3">
          <SaveTeamButton ogUrl={ogUrl(searchParams)} />
          <Button href="/38-0" variant="primary" tone="lime" size="lg" fullWidth>
            BUILD YOUR OWN XI →
          </Button>
        </div>
      </div>
    </div>
  );
}
