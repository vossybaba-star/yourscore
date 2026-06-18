"use client";

import type { CSSProperties } from "react";
import { trackDownload } from "@/lib/analytics/trackGame";

const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL;

/**
 * "Get the app" CTA. On tap it fires the Download (app-install *intent*) conversion
 * across every ad/analytics platform (see trackDownload) and then opens the App
 * Store. Renders nothing until NEXT_PUBLIC_IOS_APP_URL is set, so it's safe to drop
 * anywhere before the store link is configured. `source` tags where the tap came
 * from (e.g. "hero", "dashboard") in the event payload.
 */
export function DownloadAppButton({
  className,
  style,
  label = "Download the app",
  source = "button",
}: {
  className?: string;
  style?: CSSProperties;
  label?: string;
  source?: string;
}) {
  if (!IOS_APP_URL) return null;
  return (
    <a
      href={IOS_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackDownload({ source })}
      className={
        className ??
        "inline-flex items-center justify-center gap-2 font-body font-semibold text-base px-6 py-4 rounded-xl transition-all hover:opacity-90 text-white"
      }
      style={style}
    >
      {label}
    </a>
  );
}
