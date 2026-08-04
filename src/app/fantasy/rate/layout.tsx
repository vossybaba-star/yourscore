import type { Metadata } from "next";

/**
 * Metadata for /fantasy/rate. The page itself is a client component, so the
 * link-preview (openGraph/twitter) lives here in a server layout. The card is
 * the dynamic /api/og/rate image — a YourScore Fantasy PL launch ad. Absolute
 * URL to match every other og route in this app (crawlers need it absolute).
 */

const TITLE = "Rate your FPL team";
const DESCRIPTION =
  "Upload a screenshot of your FPL team and the YourScore Scout grades it in seconds. Fantasy PL is live on YourScore. Free.";
const IMAGE = "https://yourscore.app/api/og/rate";

export const metadata: Metadata = {
  title: `${TITLE} · YourScore`,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://yourscore.app/fantasy/rate",
    images: [{ url: IMAGE, width: 1200, height: 630, alt: "Rate your FPL team with the YourScore Scout" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [IMAGE],
  },
};

export default function RateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
