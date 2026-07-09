import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How It Works — YourScore Football Games",
  description:
    "Learn how to play YourScore: answer football knowledge questions, draft your XI in 38-0, compete in private leagues, and climb the global leaderboard.",
  alternates: {
    canonical: "/how-it-works",
  },
};

export default function HowItWorksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
