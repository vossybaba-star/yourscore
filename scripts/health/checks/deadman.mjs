/**
 * deadman.mjs — Layer 6: are the OTHER automations alive?
 *
 * The business runs on a dozen scheduled jobs (quiz launch, edition roll,
 * X pipeline, content pipeline). Each normally leaves a trace file; this layer
 * asserts every trace is recent, so a silently-dead job pages the founder
 * instead of being discovered days later. Table-driven from deadman.config.json
 * so the VPS migration only edits the JSON.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { todayUK, hourUK } from "../lib/db.mjs";

const CONFIG_URL = new URL("../deadman.config.json", import.meta.url);

export async function run(report) {
  let jobs;
  try {
    jobs = JSON.parse(readFileSync(CONFIG_URL, "utf8")).jobs;
  } catch (e) {
    report.add("jobs", "deadman config", false, { detail: e.message, hint: "fix scripts/health/deadman.config.json" });
    return;
  }

  const today = todayUK();
  const hour = hourUK();

  for (const job of jobs) {
    if (job.disabled) continue;
    const path = job.path.replace(/^~/, homedir());

    let st;
    try {
      st = statSync(path);
    } catch {
      report.add("jobs", job.name, false, {
        detail: `signal file missing: ${job.path}`,
        hint: `job never ran or moved — ${job.note ?? ""}`,
      });
      continue;
    }

    const ageHours = (Date.now() - st.mtimeMs) / 3600_000;
    let ok = ageHours <= job.maxAgeHours;
    let detail = ok ? "" : `last trace ${ageHours.toFixed(1)}h ago (max ${job.maxAgeHours}h)`;

    if (job.mode === "date-content" && ok) {
      try {
        const content = readFileSync(path, "utf8").trim();
        if (!content.includes(today)) {
          ok = hour < (job.graceHourUK ?? 0);
          detail = `ran for ${content || "?"} — not yet for ${today}${ok ? " (within grace window)" : ""}`;
        }
      } catch { /* unreadable content — mtime already passed, let it slide */ }
    }

    // Daily jobs get a morning grace window so an 08:20 run doesn't page about
    // a job whose slot simply hasn't arrived yet today.
    if (!ok && job.graceHourUK && hour < job.graceHourUK && ageHours < 30) {
      ok = true;
      detail += " (grace window)";
    }

    report.add("jobs", job.name, ok, {
      warn: ok && detail !== "",
      detail,
      hint: ok ? "" : `check launchd: launchctl list | grep ${job.name}, log at ${job.path}`,
    });
  }
}
