/**
 * env.mjs — env loading for the halftime pipeline.
 *
 * `.env.local` is NOT safely shell-sourceable (it contains values with characters
 * the shell chokes on — `. .env.local` exits 126), so nothing here shells out.
 * `node --env-file=.env.local` is the normal entry point; loadEnvFile() is the
 * belt-and-braces fallback for a VPS cron wrapper that forgot the flag.
 *
 * Never prints a secret. need() reports only the NAME of a missing key.
 */

import { readFileSync, existsSync } from "node:fs";

/**
 * Parse a dotenv file and set only keys that are not already in process.env
 * (a real env var always wins over the file).
 */
export function loadEnvFile(path = ".env.local") {
  if (!existsSync(path)) return 0;
  let n = 0;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    n++;
  }
  return n;
}

/** Fetch a required env var, or die with its NAME (never its value). */
export function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ missing ${name} in env`);
    process.exit(2);
  }
  return v;
}

export const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};

export const has = (argv, name) => argv.includes(name);
