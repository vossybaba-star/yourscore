import type { Metadata } from "next";
import { latestBriefing } from "@/lib/pl/briefingRead";
import { BriefingView } from "@/components/matchweek/BriefingView";

/**
 * /matchweek/briefing — the Daily Briefing in full.
 *
 * A page, not a sheet: it scrolls, it is ours rather than an outlet's, and it
 * gets a URL a reader can return to or send to a friend.
 *
 * Reads the row DIRECTLY, and must keep doing so. It used to fetch our own
 * /api/pl/briefing over HTTP, which stacked Next's Data Cache on top of the
 * CDN's cache over the same row — two independent 600s windows that drift, so
 * for a while after 18:00 the tile showed the new headline and this page still
 * rendered yesterday's. Tapping the tile gave you the wrong briefing.
 *
 * force-no-store is not optional here: a service-role Supabase read has a
 * constant cache key, so without it Vercel's data cache pins the FIRST briefing
 * this page ever rendered and serves it forever (see CLAUDE.md §4).
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Daily Briefing · YourScore",
  description: "The day's biggest Premier League stories, in one place.",
};

export default async function BriefingPage() {
  const briefing = await latestBriefing();
  return <BriefingView briefing={briefing} />;
}
