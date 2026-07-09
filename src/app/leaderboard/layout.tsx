import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leaderboard — Top Football Knowledge Players | YourScore",
  description:
    "See who's topping the YourScore rankings. The global leaderboard tracks quiz scores, match wins, and overall football knowledge across every player.",
  alternates: {
    canonical: "/leaderboard",
  },
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
