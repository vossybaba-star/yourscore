/**
 * Draft XI — formation definitions.
 *
 * Each formation is exactly 11 slots: 1 GK + outfield. `pos` is the canonical
 * position used for fit scoring; `label` is the on-pitch label (so a "RM" reads
 * as a wide midfielder but is scored against an RW slot, since the canonical
 * Position set has no RM/LM). Coordinates are 0-100 with y=8 at the GK and y=92
 * at the strikers, x=50 centre — used directly by the pitch view.
 */

import type { Formation, Slot } from "./types";

const GK: Slot = { id: "gk", pos: "GK", label: "GK", x: 50, y: 8 };

export const FORMATION_SLOTS: Record<Formation, Slot[]> = {
  "4-3-3": [
    GK,
    { id: "rb", pos: "RB", label: "RB", x: 84, y: 30 },
    { id: "rcb", pos: "CB", label: "CB", x: 62, y: 24 },
    { id: "lcb", pos: "CB", label: "CB", x: 38, y: 24 },
    { id: "lb", pos: "LB", label: "LB", x: 16, y: 30 },
    { id: "cdm", pos: "CDM", label: "CDM", x: 50, y: 46 },
    { id: "rcm", pos: "CM", label: "CM", x: 68, y: 56 },
    { id: "lcm", pos: "CM", label: "CM", x: 32, y: 56 },
    { id: "rw", pos: "RW", label: "RW", x: 82, y: 80 },
    { id: "st", pos: "ST", label: "ST", x: 50, y: 86 },
    { id: "lw", pos: "LW", label: "LW", x: 18, y: 80 },
  ],
  "4-4-2": [
    GK,
    { id: "rb", pos: "RB", label: "RB", x: 84, y: 30 },
    { id: "rcb", pos: "CB", label: "CB", x: 62, y: 24 },
    { id: "lcb", pos: "CB", label: "CB", x: 38, y: 24 },
    { id: "lb", pos: "LB", label: "LB", x: 16, y: 30 },
    { id: "rm", pos: "RW", label: "RM", x: 84, y: 58 },
    { id: "rcm", pos: "CM", label: "CM", x: 60, y: 54 },
    { id: "lcm", pos: "CM", label: "CM", x: 40, y: 54 },
    { id: "lm", pos: "LW", label: "LM", x: 16, y: 58 },
    { id: "rst", pos: "ST", label: "ST", x: 60, y: 86 },
    { id: "lst", pos: "ST", label: "ST", x: 40, y: 86 },
  ],
  "4-2-4": [
    GK,
    { id: "rb", pos: "RB", label: "RB", x: 84, y: 30 },
    { id: "rcb", pos: "CB", label: "CB", x: 62, y: 24 },
    { id: "lcb", pos: "CB", label: "CB", x: 38, y: 24 },
    { id: "lb", pos: "LB", label: "LB", x: 16, y: 30 },
    { id: "rcm", pos: "CM", label: "CM", x: 64, y: 52 },
    { id: "lcm", pos: "CM", label: "CM", x: 36, y: 52 },
    { id: "rw", pos: "RW", label: "RW", x: 86, y: 82 },
    { id: "rst", pos: "ST", label: "ST", x: 62, y: 88 },
    { id: "lst", pos: "ST", label: "ST", x: 38, y: 88 },
    { id: "lw", pos: "LW", label: "LW", x: 14, y: 82 },
  ],
  "3-4-3": [
    GK,
    { id: "rcb", pos: "CB", label: "CB", x: 72, y: 26 },
    { id: "ccb", pos: "CB", label: "CB", x: 50, y: 22 },
    { id: "lcb", pos: "CB", label: "CB", x: 28, y: 26 },
    { id: "rm", pos: "RW", label: "RM", x: 86, y: 54 },
    { id: "rcm", pos: "CM", label: "CM", x: 60, y: 52 },
    { id: "lcm", pos: "CM", label: "CM", x: 40, y: 52 },
    { id: "lm", pos: "LW", label: "LM", x: 14, y: 54 },
    { id: "rw", pos: "RW", label: "RW", x: 80, y: 84 },
    { id: "st", pos: "ST", label: "ST", x: 50, y: 88 },
    { id: "lw", pos: "LW", label: "LW", x: 20, y: 84 },
  ],
  "3-5-2": [
    GK,
    { id: "rcb", pos: "CB", label: "CB", x: 72, y: 26 },
    { id: "ccb", pos: "CB", label: "CB", x: 50, y: 22 },
    { id: "lcb", pos: "CB", label: "CB", x: 28, y: 26 },
    { id: "rwb", pos: "RWB", label: "RWB", x: 88, y: 50 },
    { id: "rcm", pos: "CM", label: "CM", x: 64, y: 52 },
    { id: "cam", pos: "CAM", label: "CAM", x: 50, y: 62 },
    { id: "lcm", pos: "CM", label: "CM", x: 36, y: 52 },
    { id: "lwb", pos: "LWB", label: "LWB", x: 12, y: 50 },
    { id: "rst", pos: "ST", label: "ST", x: 60, y: 88 },
    { id: "lst", pos: "ST", label: "ST", x: 40, y: 88 },
  ],
  "5-3-2": [
    GK,
    { id: "rwb", pos: "RWB", label: "RWB", x: 90, y: 34 },
    { id: "rcb", pos: "CB", label: "CB", x: 68, y: 24 },
    { id: "ccb", pos: "CB", label: "CB", x: 50, y: 22 },
    { id: "lcb", pos: "CB", label: "CB", x: 32, y: 24 },
    { id: "lwb", pos: "LWB", label: "LWB", x: 10, y: 34 },
    { id: "rcm", pos: "CM", label: "CM", x: 68, y: 56 },
    { id: "cm", pos: "CM", label: "CM", x: 50, y: 52 },
    { id: "lcm", pos: "CM", label: "CM", x: 32, y: 56 },
    { id: "rst", pos: "ST", label: "ST", x: 60, y: 88 },
    { id: "lst", pos: "ST", label: "ST", x: 40, y: 88 },
  ],
  "5-4-1": [
    GK,
    { id: "rwb", pos: "RWB", label: "RWB", x: 90, y: 34 },
    { id: "rcb", pos: "CB", label: "CB", x: 68, y: 24 },
    { id: "ccb", pos: "CB", label: "CB", x: 50, y: 22 },
    { id: "lcb", pos: "CB", label: "CB", x: 32, y: 24 },
    { id: "lwb", pos: "LWB", label: "LWB", x: 10, y: 34 },
    { id: "rm", pos: "RW", label: "RM", x: 84, y: 58 },
    { id: "rcm", pos: "CM", label: "CM", x: 60, y: 54 },
    { id: "lcm", pos: "CM", label: "CM", x: 40, y: 54 },
    { id: "lm", pos: "LW", label: "LM", x: 16, y: 58 },
    { id: "st", pos: "ST", label: "ST", x: 50, y: 88 },
  ],
};

export function slotsFor(formation: Formation): Slot[] {
  return FORMATION_SLOTS[formation];
}

/** One-line tactical flavour shown under the formation picker (onboarding). */
export const FORMATION_NOTE: Record<Formation, string> = {
  "4-3-3": "Attacking width. Three forwards apply constant pressure.",
  "4-4-2": "Classic and balanced. Two banks of four, a strike partnership.",
  "4-2-4": "All-out attack. Four forwards, a daring two-man midfield.",
  "3-4-3": "Front-foot football. Wing-backs bomb on, a front three.",
  "3-5-2": "Midfield control. Wing-backs supply two strikers.",
  "5-3-2": "Solid and compact. Five at the back, two up top to break.",
  "5-4-1": "Backs to the wall. Defend deep, hit hard on the counter.",
};
