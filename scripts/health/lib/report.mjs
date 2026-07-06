/**
 * report.mjs — result registry + Telegram scorecard + JSONL run record.
 *
 * Every check lands here as {layer, name, ok, warn, ms, detail, hint}.
 *   ok:false            → red (run fails, alert line)
 *   ok:true, warn:true  → warn line (run still green)
 * `hint` is the phone-actionable "first move" shown on failures.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = new URL("../../data/health/", import.meta.url).pathname;

const LAYER_LABELS = {
  cleanup: "Cleanup",
  api: "API",
  fresh: "Fresh",
  journeys: "Journeys",
  browser: "Browser",
  sentry: "Sentry",
  jobs: "Jobs",
  gamer: "Gamer",
};

export function createReport() {
  const checks = [];

  function add(layer, name, ok, { warn = false, ms = 0, detail = "", hint = "" } = {}) {
    checks.push({ layer, name, ok: !!ok, warn: !!warn, ms, detail: String(detail).slice(0, 400), hint });
    const mark = ok ? (warn ? "⚠" : "✓") : "✗";
    console.log(`  ${mark} [${layer}] ${name}${detail ? ` — ${detail}` : ""}`);
    return ok;
  }

  const failed = () => checks.filter((c) => !c.ok);
  const warned = () => checks.filter((c) => c.ok && c.warn);

  /** One-line per-layer tally, e.g. "API 9/9 · Fresh 6/6 · Jobs 8/8". */
  function layerLine() {
    const layers = [...new Set(checks.map((c) => c.layer))];
    return layers
      .filter((l) => l !== "cleanup")
      .map((l) => {
        const of = checks.filter((c) => c.layer === l);
        const ok = of.filter((c) => c.ok).length;
        return `${LAYER_LABELS[l] ?? l} ${ok}/${of.length}`;
      })
      .join(" · ");
  }

  /** Compose the Telegram message for this run (HTML parse mode). */
  function telegramText(startedAt, durationMs) {
    const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(startedAt);
    const fails = failed();
    const warns = warned();
    const lines = [];

    if (fails.length === 0) {
      lines.push(`✅ <b>YourScore health</b> — ${hhmm} · ${checks.length}/${checks.length} · ${Math.round(durationMs / 1000)}s`);
      lines.push(layerLine());
    } else {
      lines.push(`🚨 <b>YourScore health</b> — ${hhmm} · <b>${fails.length} FAILED</b> / ${checks.length - fails.length} passed`);
      for (const f of fails.slice(0, 8)) {
        lines.push(`✗ <b>${f.layer} ${f.name}</b> — ${f.detail || "failed"}${f.hint ? `\n   → ${f.hint}` : ""}`);
      }
      if (fails.length > 8) lines.push(`…and ${fails.length - 8} more (see run record)`);
    }
    for (const w of warns.slice(0, 6)) {
      const icon = w.layer === "gamer" ? "🎮" : "⚠";
      lines.push(`${icon} ${w.name}: ${w.detail}`);
    }
    if (warns.length > 6) lines.push(`⚠ …and ${warns.length - 6} more warnings`);
    return lines.join("\n");
  }

  /** Append the run to today's JSONL + overwrite latest.json. Never throws. */
  function persist(startedAt, durationMs, extra = {}) {
    const record = {
      ts: startedAt.toISOString(),
      ok: failed().length === 0,
      warn: warned().length,
      durationMs,
      base: extra.base,
      checks,
      ...extra,
    };
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(startedAt);
      appendFileSync(join(DATA_DIR, `${day}.jsonl`), JSON.stringify(record) + "\n");
      writeFileSync(join(DATA_DIR, "latest.json"), JSON.stringify(record, null, 2));
    } catch (e) {
      console.error(`✗ could not persist run record: ${e.message}`);
    }
    return record;
  }

  return { add, checks, failed, warned, layerLine, telegramText, persist };
}

/**
 * Run `fn` under a wall-clock budget. On timeout the layer's remaining checks
 * are represented by a single red "<layer> layer" check; other layers still run.
 */
export async function withBudget(report, layer, budgetMs, fn) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`layer budget ${budgetMs / 1000}s exceeded`)), budgetMs); });
  try {
    await Promise.race([fn(), timeout]);
  } catch (e) {
    report.add(layer, "layer", false, { detail: e.message, hint: "layer crashed or timed out — see cron log" });
  } finally {
    clearTimeout(timer);
  }
}
