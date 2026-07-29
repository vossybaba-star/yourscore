"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const club_1 = require("../src/lib/club");
const now = new Date("2026-06-12T20:00:00Z");
const ev = (starts, ends, status = "scheduled") => ({ starts_at: starts, ends_at: ends, status });
const checks = [
    ["upcoming before start", (0, club_1.eventWindowState)(ev("2026-06-12T21:00:00Z", "2026-06-12T23:00:00Z"), now) === "upcoming"],
    ["live inside window", (0, club_1.eventWindowState)(ev("2026-06-12T19:00:00Z", "2026-06-12T21:00:00Z"), now) === "live"],
    ["live at exact start", (0, club_1.eventWindowState)(ev("2026-06-12T20:00:00Z", "2026-06-12T21:00:00Z"), now) === "live"],
    ["ended at exact end", (0, club_1.eventWindowState)(ev("2026-06-12T19:00:00Z", "2026-06-12T20:00:00Z"), now) === "ended"],
    ["ended after window", (0, club_1.eventWindowState)(ev("2026-06-12T18:00:00Z", "2026-06-12T19:00:00Z"), now) === "ended"],
    ["cancelled overrides live", (0, club_1.eventWindowState)(ev("2026-06-12T19:00:00Z", "2026-06-12T21:00:00Z", "cancelled"), now) === "cancelled"],
    ["join code length", (0, club_1.makeJoinCode)().length === 6],
    ["join code alphabet", /^[A-HJ-KM-NP-Z2-9]+$/.test((0, club_1.makeJoinCode)(100))],
];
let fail = 0;
for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok)
        fail++;
}
process.exit(fail ? 1 : 0);
