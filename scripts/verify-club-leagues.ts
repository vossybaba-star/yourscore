import { eventWindowState, makeJoinCode } from "../src/lib/club";

const now = new Date("2026-06-12T20:00:00Z");
const ev = (starts: string, ends: string, status = "scheduled") =>
  ({ starts_at: starts, ends_at: ends, status } as Parameters<typeof eventWindowState>[0]);

const checks: [string, boolean][] = [
  ["upcoming before start", eventWindowState(ev("2026-06-12T21:00:00Z", "2026-06-12T23:00:00Z"), now) === "upcoming"],
  ["live inside window", eventWindowState(ev("2026-06-12T19:00:00Z", "2026-06-12T21:00:00Z"), now) === "live"],
  ["live at exact start", eventWindowState(ev("2026-06-12T20:00:00Z", "2026-06-12T21:00:00Z"), now) === "live"],
  ["ended at exact end", eventWindowState(ev("2026-06-12T19:00:00Z", "2026-06-12T20:00:00Z"), now) === "ended"],
  ["ended after window", eventWindowState(ev("2026-06-12T18:00:00Z", "2026-06-12T19:00:00Z"), now) === "ended"],
  ["cancelled overrides live", eventWindowState(ev("2026-06-12T19:00:00Z", "2026-06-12T21:00:00Z", "cancelled"), now) === "cancelled"],
  ["join code length", makeJoinCode().length === 6],
  ["join code alphabet", /^[A-HJ-KM-NP-Z2-9]+$/.test(makeJoinCode(100))],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
