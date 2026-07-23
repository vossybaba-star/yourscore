import type { Metadata } from "next";

/**
 * The page itself is "use client" (tab state, autoplaying step carousel), so it
 * cannot export metadata. This layout carries it. The route is listed in
 * sitemap.ts and llms.txt, and /how-it-works redirects here, so it needs a real
 * title rather than falling through to the root default.
 */

const TITLE = "The Games | YourScore";
const DESCRIPTION =
  "Every game on YourScore and how each one scores. Quiz, 38-0, Perfect 10, Higher or Lower and Guess the Player, plus fantasy and the gameday quiz landing with the season on 21 August.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://yourscore.app/games" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "YourScore",
    url: "https://yourscore.app/games",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
