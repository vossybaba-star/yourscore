import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Play Football Quiz — YourScore",
  description:
    "Answer football knowledge questions, climb the rankings, and challenge your mates. Join lobbies, play head-to-head, or go solo on YourScore.",
  alternates: {
    canonical: "/play",
  },
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
