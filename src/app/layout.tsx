import type { Metadata, Viewport } from "next";
import { Bebas_Neue, DM_Sans } from "next/font/google";
import "./globals.css";

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "YourScore — Live Football Quiz",
  description:
    "Create a room, invite your mates, and answer live questions during the 2026 World Cup. 45 seconds. Real-time leaderboard.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "YourScore",
  },
  openGraph: {
    title: "YourScore — Live Football Quiz",
    description: "Answer live questions during the match. 45 seconds. Real-time leaderboard.",
    type: "website",
    siteName: "YourScore",
  },
  twitter: {
    card: "summary_large_image",
    title: "YourScore — Live Football Quiz",
    description: "Answer live questions during the match. 45 seconds. Real-time leaderboard.",
  },
  icons: {
    apple: "/icon-192.png",
    icon: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0f",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bebasNeue.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
