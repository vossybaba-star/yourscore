import { headers } from "next/headers";
import type { Metadata } from "next";
import type { PlBriefing } from "@/lib/pl/briefing";
import { BriefingView } from "@/components/matchweek/BriefingView";

/**
 * /matchweek/briefing — the Daily Briefing in full.
 *
 * A page, not a sheet: it scrolls, it is ours rather than an outlet's, and it
 * gets a URL a reader can return to or send to a friend. Server-rendered off the
 * public API so a shared link opens with the content already in it.
 *
 * Revalidate matches the briefing's own cadence — it changes once a day, so
 * anything shorter is just cache churn.
 */

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Daily Briefing · YourScore",
  description: "The day's biggest Premier League stories, in one place.",
};

async function getBriefing(): Promise<PlBriefing | null> {
  try {
    const h = await headers();
    const host = h.get("host") ?? "yourscore.app";
    const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    const res = await fetch(`${proto}://${host}/api/pl/briefing`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    return (await res.json()).doc ?? null;
  } catch {
    return null;
  }
}

export default async function BriefingPage() {
  const briefing = await getBriefing();
  return <BriefingView briefing={briefing} />;
}
