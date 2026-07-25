import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "38-0 — Draft Your Best XI | YourScore",
  description:
    "Build the perfect team, go head-to-head with rivals, and top your league. 38-0 is the football knowledge team-builder game on YourScore.",
  alternates: {
    canonical: "/38-0",
  },
};

export default function ThirtyEightLayout({ children }: { children: React.ReactNode }) {
  return children;
}
