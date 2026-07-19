import * as Sentry from "@sentry/nextjs";
import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Bebas_Neue, DM_Sans, DM_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NativeBootstrap } from "@/components/native/NativeBootstrap";
import { NavTracker } from "@/components/ui/NavTracker";
import { TouchGuards } from "@/components/ui/TouchGuards";
import { GamesNav } from "@/components/ui/GamesNav";
import { UsernamePrompt } from "@/components/profile/UsernamePrompt";
import { ClubPrompt } from "@/components/clubs/ClubPrompt";
import { AppStoreBanner } from "@/components/app/AppStoreBanner";
import { NativeOnboarding } from "@/components/native/onboarding/NativeOnboarding";
import { PushPrePrompt } from "@/components/native/PushPrePrompt";
import { UpdateBanner } from "@/components/native/UpdateBanner";
import { TimezoneSync } from "@/components/TimezoneSync";
import { SignupPixel } from "@/components/analytics/SignupPixel";
import { AcquisitionCapture } from "@/components/analytics/AcquisitionCapture";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import Script from "next/script";
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

const dmMono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-dm-mono",
  display: "swap",
});

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL("https://yourscore.app"),
    title: "YourScore — The Home of Football Gaming",
    description:
      "Test your football knowledge with daily quizzes, head-to-head battles and private leagues. Build your XI and compete with your mates. Free on web and iOS.",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "YourScore",
    },
    openGraph: {
      title: "YourScore — The Home of Football Gaming",
      description: "Test your football knowledge with daily quizzes, head-to-head battles and private leagues. Build your XI and compete with your mates. Free on web and iOS.",
      type: "website",
      siteName: "YourScore",
      images: [{ url: "https://yourscore.app/api/og/home", width: 1200, height: 630, alt: "YourScore · 38-0" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "YourScore — The Home of Football Gaming",
      description: "Test your football knowledge with daily quizzes, head-to-head battles and private leagues. Build your XI and compete with your mates. Free on web and iOS.",
      images: ["https://yourscore.app/api/og/home"],
    },
    icons: {
      apple: "/icon-192.png",
      icon: "/icon-192.png",
    },
    other: {
      ...Sentry.getTraceData(),
      // Meta (Facebook) domain verification for yourscore.app, owned by the business
      // portfolio that owns pixel 690844488412429. Without a verified domain Meta will
      // not let us configure Aggregated Event Measurement, which is what cripples
      // website custom audiences for iOS traffic (conversions still attribute, which is
      // why this stayed hidden). Must be SERVER-RENDERED in <head> — Meta's check fails
      // if the tag is injected by JavaScript, so it lives here and not in a client
      // component. Do not remove: verification is re-checked periodically.
      "facebook-domain-verification": "c1p9ippw7wnzrkydqj2vpsxfrmveyx",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * Zoom DISABLED app-wide (founder, 2026-07-16). An accidental pinch on the
   * PL tab left the app stuck zoomed-in with no way back — effectively frozen.
   * This is the standard app-shell trade: we lose WCAG 1.4.4 pinch-zoom (the
   * earlier comment here chose the opposite), which is why maximumScale is 1.
   * Note iOS SAFARI ignores user-scalable for accessibility, so the web keeps
   * pinch-zoom there regardless; the native WKWebView — where the freeze
   * happened — respects it.
   */
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
  // Ad/analytics pixel IDs (inlined at build). Each vendor renders only when its
  // ID is set, so dev/preview never inject empty-ID pixels.
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const googleAdsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID;
  const tiktokId = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;
  const xId = process.env.NEXT_PUBLIC_X_PIXEL_ID;
  const metaId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const snapId = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID;
  return (
    <html lang="en" className={`${bebasNeue.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        <Suspense fallback={null}>
          <NavTracker />
        </Suspense>
        <TouchGuards />
        <NativeBootstrap />
        <UsernamePrompt />
        <ClubPrompt />
        <AppStoreBanner />
        <NativeOnboarding />
        <PushPrePrompt />
        <UpdateBanner />
        <TimezoneSync />
        <SignupPixel />
        <AcquisitionCapture />
        {/* No-op until NEXT_PUBLIC_POSTHOG_KEY is set — then route-change pageviews,
            identify-by-uuid, and masked session recording come on. */}
        {/* THE games nav — one persistent bar for the five game sections;
            pages render below it and must not mount their own switcher. */}
        <GamesNav />
        <PostHogProvider>{children}</PostHogProvider>
        <Analytics />
        <SpeedInsights />
        {/* ─── Ad/analytics pixels: STUBS-FIRST, heavy JS deferred ──────────────
            Each vendor's queueing stub is installed SYNCHRONOUSLY (plain inline
            <script>, runs during HTML parse) so window.gtag/ttq/twq/fbq/snaptr
            exist before any React effect fires — conversion calls (SignupPixel,
            trackGame: `window.fbq?.(...)`) then QUEUE instead of no-op-dropping,
            which is what happened when the stub only appeared `afterInteractive`.
            The heavy vendor libraries load `lazyOnload` (after the page is idle),
            off the LCP/TBT path; on load each drains its queue, so no event is
            lost — PageView/config just attribute a few seconds later. */}

        {/* Google Analytics 4 (+ Google Ads) — stub + config queue now, lib later */}
        {gaId && (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');${googleAdsId ? `gtag('config','${googleAdsId}');` : ""}`,
              }}
            />
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="lazyOnload" />
          </>
        )}

        {/* TikTok — stub + page() queue now; ttq.load() (injects events.js) deferred */}
        {tiktokId && (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
                  ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],
                  ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
                  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
                  ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},
                  ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";
                  ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
                  n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;
                  e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
                  ttq.page();
                  }(window,document,'ttq');
                `,
              }}
            />
            <Script
              id="tiktok-pixel-load"
              strategy="lazyOnload"
              dangerouslySetInnerHTML={{ __html: `window.ttq&&window.ttq.load('${tiktokId}');` }}
            />
          </>
        )}

        {/* Twitter/X — stub + config queue now; uwt.js (drains queue) deferred */}
        {xId && (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html: `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[])}(window,document,'script');twq('config','${xId}');`,
              }}
            />
            <Script src="https://static.ads-twitter.com/uwt.js" strategy="lazyOnload" />
          </>
        )}

        {/* Meta — stub + init + PageView queue now; fbevents.js (drains queue) deferred */}
        {metaId && (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html: `!function(f,b,e,n){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window,document);fbq('init','${metaId}');fbq('track','PageView');`,
              }}
            />
            <Script src="https://connect.facebook.net/en_US/fbevents.js" strategy="lazyOnload" />
          </>
        )}

        {/* Snapchat — stub + init + PAGE_VIEW queue now; scevent.min.js (drains queue) deferred */}
        {snapId && (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html: `(function(e){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[]})(window);snaptr('init','${snapId}');snaptr('track','PAGE_VIEW');`,
              }}
            />
            <Script src="https://sc-static.net/scevent.min.js" strategy="lazyOnload" />
          </>
        )}
      </body>
    </html>
  );
}
