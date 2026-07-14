#!/bin/bash
# Runs a Claude routine headless on the VPS. Usage: run-routine.sh <prompt.md> <workdir> <model>
# Prompt is piped via STDIN so a leading '---' (YAML frontmatter) isn't parsed as a CLI flag.
#
# METERED (Jul 14). These 7 daily routines are full agentic Claude Code sessions billed to
# ANTHROPIC_API_KEY, and until now not one of them recorded a single dollar — the same
# blindness that hid the Reddit spend ("$66 in a week, $20 in a day, and nobody could say
# where it went"). `--output-format json` makes claude return total_cost_usd per run, so:
#   · every run appends one line to logs/spend.jsonl  (the ledger)
#   · every run prints its own cost into its routine log
#   · a run over ALERT_USD pings Telegram, so a runaway can't quietly bill for days
# The human-readable result still lands in the routine log exactly as before.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
export ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' "$HOME/yourscore/.env.local" | cut -d= -f2-)"

PROMPT="$1"; WD="$2"; MODEL="${3:-sonnet}"
NAME="$(basename "$PROMPT" .md)"
LOG="$HOME/routines/logs/$NAME.log"
LEDGER="$HOME/routines/logs/spend.jsonl"
ALERT_USD="${ALERT_USD:-5.00}"   # a single run costing more than this is a bug until proven otherwise

echo "===== $(date '+%Y-%m-%d %H:%M %Z') (model $MODEL) =====" >> "$LOG"
cd "$WD" || exit 1

RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT

cat "$HOME/routines/$PROMPT" | claude -p --model "$MODEL" --output-format json \
  --dangerously-skip-permissions > "$RAW" 2>>"$LOG"
RC=$?

# Parse with node (always present on this box; jq may not be). Never let the accounting
# step mask the routine's own exit code — that is how a failing routine looks healthy.
/usr/bin/node -e '
  const fs = require("fs");
  const [raw, name, model, ledger, alertUsd, rc] = process.argv.slice(1);
  let j = null;
  try { j = JSON.parse(fs.readFileSync(raw, "utf8")); } catch { /* not JSON: claude died before emitting */ }

  if (!j) {
    console.log("💰 cost: UNKNOWN — claude produced no JSON result (see the error above)");
    process.exit(0);
  }

  // The result text is what the log used to contain. Keep it human-readable.
  if (j.result) console.log(j.result);

  const usd  = Number(j.total_cost_usd ?? 0);
  const secs = Math.round(Number(j.duration_ms ?? 0) / 1000);
  const turns = j.num_turns ?? 0;
  console.log(`\n💰 cost: $${usd.toFixed(3)} · ${turns} turns · ${secs}s · model ${model}${j.is_error ? " · ⚠️ ERRORED" : ""}`);

  fs.appendFileSync(ledger, JSON.stringify({
    ts: new Date().toISOString(), routine: name, model,
    usd, turns, secs, is_error: !!j.is_error, exit: Number(rc),
  }) + "\n");

  // Loud on a runaway. Silence is what made this expensive in the first place.
  if (usd > Number(alertUsd)) {
    const msg = `💸 Routine \`${name}\` cost $${usd.toFixed(2)} in ONE run (${turns} turns, ${model}).\n\nThat is over the $${Number(alertUsd).toFixed(2)} alert line — check it before it bills again tomorrow.`;
    try {
      require("child_process").execFileSync(process.execPath,
        [`${process.env.HOME}/yourscore/scripts/tg.mjs`, "text", msg], { timeout: 20000, stdio: "ignore" });
    } catch { /* alerting must never mask the underlying run */ }
  }
' "$RAW" "$NAME" "$MODEL" "$LEDGER" "$ALERT_USD" "$RC" >> "$LOG" 2>&1

echo "----- exit $RC -----" >> "$LOG"
exit $RC
