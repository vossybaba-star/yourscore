import * as Sentry from "@sentry/nextjs";
import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Bebas_Neue, DM_Sans, DM_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NativeBootstrap } from "@/components/native/NativeBootstrap";
import { NavTracker } from "@/components/ui/NavTracker";
import { TouchGuards } from "@/components/ui/TouchGuards";
import { UsernamePrompt } from "@/components/profile/UsernamePrompt";
import { AppStoreBanner } from "@/components/app/AppStoreBanner";
import { NativeOnboarding } from "@/components/native/onboarding/NativeOnboarding";
import { PushPrePrompt } from "@/components/native/PushPrePrompt";
import { UpdateBanner } from "@/components/native/UpdateBanner";
import { TimezoneSync } from "@/components/TimezoneSync";
import { SignupPixel } from "@/components/analytics/SignupPixel";
import { AcquisitionCapture } from "@/components/analytics/AcquisitionCapture";
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
    title: "YourScore — Football Knowledge Game",
    description:
      "Test your football knowledge with daily quizzes, head-to-head battles and private leagues. Build your XI and compete with your mates. Free on web and iOS.",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "YourScore",
    },
    openGraph: {
      title: "YourScore — Football Knowledge Game",
      description: "Test your football knowledge with daily quizzes, head-to-head battles and private leagues. Build your XI and compete with your mates. Free on web and iOS.",
      type: "website",
      siteName: "YourScore",
      images: [{ url: "https://yourscore.app/api/og/home", width: 1200, height: 630, alt: "YourScore · 38-0" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "YourScore — Football Knowledge Game",
      description: "Test your football knowledge with daily quizzes, head-to-head battles and private leagues. Build your XI and compete with your mates. Free on web and iOS.",
      images: ["https://yourscore.app/api/og/home"],
    },
    icons: {
      apple: "/icon-192.png",
      icon: "/icon-192.png",
    },
    other: {
      ...Sentry.getTraceData(),
    },
  };
}

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
    <html lang="en" className={`${bebasNeue.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        <Suspense fallback={null}>
          <NavTracker />
        </Suspense>
        <TouchGuards />
        <NativeBootstrap />
        <UsernamePrompt />
        <AppStoreBanner />
        <NativeOnboarding />
        <PushPrePrompt />
        <UpdateBanner />
        <TimezoneSync />
        <SignupPixel />
        <AcquisitionCapture />
        {children}
        <Analytics />
        <SpeedInsights />
        {/* Google Analytics 4 */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script
          id="google-analytics"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');
              ${process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID ? `gtag('config', '${process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID}');` : ''}
            `,
          }}
        />
        {/* TikTok Pixel */}
        <Script
          id="tiktok-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
              ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],
              ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
              for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
              ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},
              ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;
              ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
              n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;
              e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
              ttq.load('${process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID}');
              ttq.page();
              }(window,document,'ttq');
            `,
          }}
        />
        {/* Twitter/X Pixel */}
        <Script
          id="twitter-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
              },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
              a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
              twq('config','${process.env.NEXT_PUBLIC_X_PIXEL_ID}');
            `,
          }}
        />
        {/* Meta Pixel */}
        <Script
          id="meta-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
              n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
              (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${process.env.NEXT_PUBLIC_META_PIXEL_ID}');
              fbq('track', 'PageView');
            `,
          }}
        />
        {/* Snapchat Pixel — only loads once the pixel ID env var is set */}
        {process.env.NEXT_PUBLIC_SNAP_PIXEL_ID && (
          <Script
            id="snap-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){
                a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
                a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;
                r.src=n;var u=t.getElementsByTagName(s)[0];
                u.parentNode.insertBefore(r,u);})(window,document,
                'https://sc-static.net/scevent.min.js');
                snaptr('init', '${process.env.NEXT_PUBLIC_SNAP_PIXEL_ID}');
                snaptr('track', 'PAGE_VIEW');
              `,
            }}
          />
        )}
      </body>
    </html>
  );
}
