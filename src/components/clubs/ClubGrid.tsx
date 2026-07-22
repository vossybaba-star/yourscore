"use client";

/**
 * The club picker — square crest tiles, the way you pick a side in a game
 * (founder, 2026-07-16). It replaced a row of text pills, which read like a
 * dropdown: this is a choice you make once a season, so it should feel like one.
 *
 * Shared by ClubPrompt (post-signup) and ClubSetting (Settings → Your club) so
 * the two can never drift into different pickers for the same decision.
 *
 * Crest leads, name underneath in the terrace form (shortClubName) — "Brighton &
 * Hove Albion" cannot fit a ~95px tile, and nobody says it anyway.
 */

import { Crest } from "./Crest";
import { shortClubName } from "@/lib/clubs/display";

const TEAL = "#00d8c0";

export function ClubGrid({
  clubs,
  selected,
  onSelect,
  disabled = false,
}: {
  clubs: string[];
  selected: string | null;
  onSelect: (club: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {clubs.map((c) => {
        const on = selected === c;
        return (
          <button
            key={c}
            onClick={() => onSelect(c)}
            disabled={disabled}
            aria-pressed={on}
            aria-label={c}
            className="relative rounded-2xl flex flex-col items-center justify-center gap-2 px-1 py-3 transition-all active:scale-[0.97]"
            style={{
              aspectRatio: "1 / 1",
              background: on ? "rgba(0,216,192,0.13)" : "rgba(255,255,255,0.03)",
              border: `1.5px solid ${on ? TEAL : "rgba(255,255,255,0.07)"}`,
              boxShadow: on ? "0 0 0 3px rgba(0,216,192,0.10)" : "none",
            }}
          >
            <Crest name={c} size={38} />
            <span
              className="font-body text-[11px] text-center leading-tight w-full truncate px-0.5"
              style={{ color: on ? TEAL : "#c4ccc6", fontWeight: on ? 600 : 500 }}
            >
              {shortClubName(c)}
            </span>

            {/* Ticked, so the choice is unmistakable on a busy grid of crests. */}
            {on && (
              <span
                aria-hidden="true"
                className="absolute flex items-center justify-center rounded-full font-display"
                style={{
                  top: 6, right: 6, width: 16, height: 16,
                  background: TEAL, color: "#062018", fontSize: 10, lineHeight: "16px",
                }}
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
