"use client";

import { useState } from "react";
import { medalColor, shelfOrder, type Medal } from "@/lib/medals";
import { MedalsModal } from "@/components/profile/MedalsModal";

/**
 * The award cabinet, compact. Shows your best few (rarest first), with a tile
 * that opens the full set — earned and locked — where each medal explains
 * itself. The old version showed six flat tiles and a count and stopped there;
 * you couldn't see what you were missing and a medal told you nothing.
 */
export function MedalShelf({ medals, preview = 5 }: { medals: Medal[]; preview?: number }) {
  const [open, setOpen] = useState(false);
  const earned = medals.filter((m) => m.earned).length;
  const ordered = shelfOrder(medals);
  // Lead with what they've won; if they've won nothing, lead with the nearest
  // targets so the row is never empty.
  const lead = (earned > 0 ? ordered.filter((m) => m.earned) : ordered).slice(0, preview);
  const remaining = medals.length - lead.length;

  return (
    <div>
      <button onClick={() => setOpen(true)} className="w-full flex items-baseline justify-between mb-3">
        <span className="font-body text-xs text-text-muted uppercase tracking-widest">Awards</span>
        <span className="font-body text-[11px]" style={{ color: "#aeea00" }}>
          {earned}/{medals.length} · see all
        </span>
      </button>

      <button
        onClick={() => setOpen(true)}
        className="w-full grid gap-2 active:scale-[0.99] transition-transform"
        style={{ gridTemplateColumns: `repeat(${lead.length + 1}, minmax(0, 1fr))` }}
      >
        {lead.map((m) => {
          const c = medalColor(m.pct);
          return (
            <div
              key={m.id}
              className="rounded-xl py-3 text-center"
              style={{
                background: m.earned ? `${c}12` : "transparent",
                border: m.earned ? `1px solid ${c}3d` : "1px dashed rgba(255,255,255,0.12)",
              }}
            >
              <span
                className="block text-xl leading-none"
                style={{ filter: m.earned ? "none" : "grayscale(1)", opacity: m.earned ? 1 : 0.3 }}
              >
                {m.glyph}
              </span>
              <p className="font-body text-[10px] mt-1.5 leading-tight truncate px-1" style={{ color: m.earned ? "#eef2f0" : "#8a948f" }}>
                {m.label}
              </p>
            </div>
          );
        })}
        <div
          className="rounded-xl py-3 flex flex-col items-center justify-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span className="font-display text-lg leading-none text-white">+{remaining}</span>
          <span className="font-body text-[10px] text-text-muted mt-1">more</span>
        </div>
      </button>

      {open && <MedalsModal medals={medals} onClose={() => setOpen(false)} />}
    </div>
  );
}
