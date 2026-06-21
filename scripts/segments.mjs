/**
 * segments.mjs — YourScore user segment explorer
 *
 * Shows live counts for every segment, or exports emails for one.
 *
 * Usage:
 *   node --env-file=.env.local scripts/segments.mjs
 *       → print counts for ALL segments
 *
 *   node --env-file=.env.local scripts/segments.mjs <segment> [arg1] [arg2]
 *       → print emails in that segment
 *
 * Available segments (with default args):
 *   wc_active       [days=7]          Played ranked WC in last N days
 *   quiz_active     [days=7]          Answered quiz in last N days
 *   both_active     [days=7]          Active in WC AND quiz in last N days
 *   wc_only         [days=7]          WC active but not quiz
 *   quiz_only       [days=7]          Quiz active but not WC
 *   engaged         [days=7]          Any activity in last N days
 *   wc_lapsed       [min=2] [max=14]  WC activity X–Y days ago, not recently
 *   lapsed          [min=2] [max=14]  Any activity X–Y days ago, not recently
 *   new_users       [days=7]          Signed up in last N days
 *   never_played    [min_days=1]      Signed up >N days ago, never played
 *   wc_streak       [days=7] [min=5]  Played WC on min N of last M days
 *   all_sendable                      Everyone not suppressed
 *
 * Examples:
 *   node --env-file=.env.local scripts/segments.mjs wc_active 3
 *   node --env-file=.env.local scripts/segments.mjs wc_lapsed 1 7
 *   node --env-file=.env.local scripts/segments.mjs never_played 3
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Segment definitions: { rpc, args: (argv) => object }
const SEGMENTS = [
  {
    name: "wc_active",
    label: "WC Mastermind active (last 7d)",
    rpc:  "get_segment_wc_active",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "classic_active",
    label: "Classic 38-0 active (last 7d)",
    rpc:  "get_segment_classic_active",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "quiz_active",
    label: "Standalone quiz active (last 7d)",
    rpc:  "get_segment_quiz_active",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "both_active",
    label: "WC + quiz both active (last 7d)",
    rpc:  "get_segment_both_active",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "wc_only",
    label: "WC only — no standalone quiz (last 7d)",
    rpc:  "get_segment_wc_only",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "quiz_only",
    label: "Quiz only — no WC (last 7d)",
    rpc:  "get_segment_quiz_only",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "engaged",
    label: "Engaged — any game (last 7d)",
    rpc:  "get_segment_engaged",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "wc_lapsed",
    label: "WC lapsed (played 2–14 days ago, not today)",
    rpc:  "get_segment_wc_lapsed",
    args: ([min = 2, max = 14]) => ({ p_min_days: Number(min), p_max_days: Number(max) }),
  },
  {
    name: "lapsed",
    label: "Lapsed any game (2–14 days ago)",
    rpc:  "get_segment_lapsed",
    args: ([min = 2, max = 14]) => ({ p_min_days: Number(min), p_max_days: Number(max) }),
  },
  {
    name: "new_users",
    label: "New users (last 7d)",
    rpc:  "get_segment_new_users",
    args: ([days = 7]) => ({ p_days: Number(days) }),
  },
  {
    name: "never_played",
    label: "Never played (signed up >1d ago)",
    rpc:  "get_segment_never_played",
    args: ([min = 1]) => ({ p_min_signup_days: Number(min) }),
  },
  {
    name: "wc_streak",
    label: "WC power users — 5+ days in last 7",
    rpc:  "get_segment_wc_streak",
    args: ([days = 7, min = 5]) => ({ p_days: Number(days), p_min_streak: Number(min) }),
  },
  {
    name: "all_sendable",
    label: "All sendable users",
    rpc:  "get_segment_all_sendable",
    args: () => ({}),
  },
];

async function callSegment(seg, extraArgs) {
  const params = seg.args(extraArgs);
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.rpc(seg.rpc, params).range(from, from + PAGE - 1);
    if (error) throw new Error(`${seg.rpc}(${JSON.stringify(params)}): ${error.message}`);
    const rows = data ?? [];
    all = all.concat(rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const argv = process.argv.slice(2);
const [segName, ...extraArgs] = argv;

if (!segName) {
  // ── Show all segment counts ─────────────────────────────────────────────
  console.log("\nYourScore — User Segment Counts\n");
  console.log(`  ${"Segment".padEnd(36)} ${"Count".padStart(6)}`);
  console.log(`  ${"-".repeat(44)}`);

  for (const seg of SEGMENTS) {
    try {
      const rows = await callSegment(seg, []);
      console.log(`  ${seg.label.padEnd(36)} ${String(rows.length).padStart(6)}`);
    } catch (err) {
      console.log(`  ${seg.label.padEnd(36)} ${"ERROR".padStart(6)}  (${err.message})`);
    }
  }
  console.log();
} else {
  // ── Show emails for a specific segment ─────────────────────────────────
  const seg = SEGMENTS.find(s => s.name === segName);
  if (!seg) {
    console.error(`Unknown segment: ${segName}`);
    console.error(`Available: ${SEGMENTS.map(s => s.name).join(", ")}`);
    process.exit(1);
  }

  const rows = await callSegment(seg, extraArgs);
  console.log(`\n${seg.label} — ${rows.length} users\n`);
  for (const r of rows) {
    console.log(r.email + (r.days_played ? `  (${r.days_played}d streak)` : ""));
  }
  console.log(`\nTotal: ${rows.length}\n`);
}
