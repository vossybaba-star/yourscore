"use client";

import { useState } from "react";
import { medalColor, shelfOrder, type Medal, type MedalGroup } from "@/lib/medals";

/**
 * The full award cabinet: every medal, earned and locked, grouped, with a
 * tap-to-open explainer on each.
 *
 * The old shelf showed six tiles and a count — you couldn't see what you were
 * missing, and a medal told you nothing about what it was. Here the locked ones
 * are the point: they're the map of what's left to win, and tapping any medal
 * says what it rewards, how rare it is, and how close you are.
 */

const GROUP_ORDER: MedalGroup[] = ["Start", "38-0", "Season", "World Cup", "Quiz", "Habit", "Range"];
const GROUP_LABEL: Record<MedalGroup, string> = {
  Start: "Getting started",
  "38-0": "38-0",
  Season: "38-0 seasons",
  "World Cup": "World Cup",
  Quiz: "Quiz",
  Habit: "Showing up",
  Range: "All-round",
};

function rarityWord(pct: number): string {
  if (pct <= 0) return "Nobody has this yet";
  if (pct <= 1) return "Legendary";
  if (pct <= 5) return "Rare";
  if (pct <= 20) return "Uncommon";
  return "Common";
}

export function MedalsModal({ medals, onClose }: { medals: Medal[]; onClose: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const earned = medals.filter((m) => m.earned).length;

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="min-h-full max-w-lg mx-auto px-5 py-8"
        style={{ animation: "slideUp 0.24s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-5">
          <p className="font-display text-2xl text-white">Awards</p>
          <p className="font-body text-sm text-text-muted">{earned}/{medals.length} won</p>
        </div>

        {GROUP_ORDER.map((g) => {
          const group = shelfOrder(medals.filter((m) => m.group === g));
          if (group.length === 0) return null;
          return (
            <div key={g} className="mb-6">
              <p className="font-body text-[11px] uppercase tracking-widest text-text-muted mb-3">{GROUP_LABEL[g]}</p>
              <div className="grid grid-cols-4 gap-2.5">
                {group.map((m) => {
                  const c = medalColor(m.pct);
                  const open = openId === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setOpenId(open ? null : m.id)}
                      className="rounded-xl px-1.5 py-3 text-center active:scale-95 transition-transform"
                      style={{
                        background: m.earned ? `${c}12` : "transparent",
                        border: open
                          ? `1px solid ${m.earned ? c : "#8a948f"}`
                          : m.earned
                            ? `1px solid ${c}3d`
                            : "1px dashed rgba(255,255,255,0.12)",
                      }}
                    >
                      <span
                        className="block text-2xl leading-none"
                        style={{ filter: m.earned ? "none" : "grayscale(1)", opacity: m.earned ? 1 : 0.3 }}
                      >
                        {m.glyph}
                      </span>
                      <p
                        className="font-body text-[10px] mt-1.5 leading-tight truncate"
                        style={{ color: m.earned ? "#eef2f0" : "#8a948f" }}
                      >
                        {m.label}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Explainer for the tapped medal in this group. */}
              {group.map((m) => {
                if (openId !== m.id) return null;
                const c = medalColor(m.pct);
                return (
                  <div
                    key={`${m.id}-info`}
                    className="rounded-xl px-4 py-3 mt-2.5"
                    style={{ background: "#0e1611", border: `1px solid ${m.earned ? c : "rgba(255,255,255,0.1)"}` }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl" style={{ filter: m.earned ? "none" : "grayscale(1)", opacity: m.earned ? 1 : 0.4 }}>
                        {m.glyph}
                      </span>
                      <p className="font-body text-sm font-semibold text-white">{m.label}</p>
                      <span
                        className="font-body text-[10px] ml-auto px-2 py-0.5 rounded-full"
                        style={{ background: `${c}1f`, color: c }}
                      >
                        {rarityWord(m.pct)}
                      </span>
                    </div>
                    <p className="font-body text-xs text-text-muted mt-2">
                      {m.earned ? (
                        <>Won · {m.pct > 0 ? `only ${m.pct}% of players have this` : "you're one of the first"}</>
                      ) : (
                        <>Not yet · {m.goal}</>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          );
        })}

        <button
          onClick={onClose}
          className="w-full mt-2 rounded-2xl py-3 font-body text-sm"
          style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
