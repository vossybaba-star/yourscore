"use client";

/**
 * Small crest badge, shared by ClubPicker and ClubTable. Mirrors the local Crest
 * helper in HalftimeRail.tsx (same fallback-initial treatment) — pulled out here
 * because it's needed in two files instead of one.
 */

import { useEffect, useState } from "react";
import { getTeamBadgeUrl } from "@/lib/teamImages";

export function Crest({ name, size = 32 }: { name: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTeamBadgeUrl(name).then((u) => {
      if (!cancelled && u) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded-full font-display text-xs text-white flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: "rgba(0,216,192,0.12)",
          border: "1px solid rgba(0,216,192,0.25)",
        }}
      >
        {name[0]}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} width={size} height={size} style={{ objectFit: "contain", flexShrink: 0 }} />
  );
}
