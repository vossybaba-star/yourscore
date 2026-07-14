/**
 * audit.mjs — the append-only decision log.
 *
 * The fresh-slice gate is NEGATIVE CONSENT: if the founder does not veto within
 * the window, the questions ship. He chose that deliberately. The price of that
 * choice is that "nobody said no" has to be as legible after the fact as "someone
 * said yes" — so every step of the decision is written down at the moment it
 * happens, with a timestamp and an actor:
 *
 *   gate.sent           the batch went to Telegram (message id, deadline)
 *   gate.veto           the founder vetoed question N (actor: founder)
 *   gate.kill           the matchday kill switch was thrown (actor: founder)
 *   gate.auto_release   the deadline passed with no response → shipped
 *                       (actor: TIMEOUT — this is the line that must never be
 *                       ambiguous when someone asks "who approved this?")
 *   gate.dropped        a question the validator killed, with its reason
 *   gate.send_failed    the batch could not be confirmed sent → slice dropped
 *
 * JSONL, one file per matchday, alongside the other pipeline logs in scripts/data.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const DIR = process.env.HALFTIME_AUDIT_DIR || "scripts/data/halftime";

export function auditPath(matchday) {
  return `${DIR}/audit-${matchday}.jsonl`;
}

export function audit(matchday, event, detail = {}) {
  const path = auditPath(matchday);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const row = { at: new Date().toISOString(), event, ...detail };
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

/** Read a matchday's decision log back — the "who approved this?" answer. */
export function readAudit(matchday) {
  const path = auditPath(matchday);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
