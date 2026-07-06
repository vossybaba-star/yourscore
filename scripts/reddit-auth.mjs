/**
 * reddit-auth.mjs — one-shot OAuth setup for the Reddit listening pipeline.
 *
 * Run AFTER the script app exists at reddit.com/prefs/apps and
 * REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are in .env.local:
 *
 *   node --env-file=.env.local scripts/reddit-auth.mjs
 *
 * It starts a tiny server on http://localhost:8910, prints (and opens) the
 * Reddit authorize URL, waits for the "Allow" redirect, exchanges the code for
 * a PERMANENT refresh token, and appends REDDIT_REFRESH_TOKEN to .env.local.
 *
 * IMPORTANT: run it while the browser is logged into the account replies should
 * post from. To switch account later: log into the other account, delete the
 * REDDIT_REFRESH_TOKEN line, re-run this.
 *
 *   node --env-file=.env.local scripts/reddit-auth.mjs whoami   # verify identity
 */

import http from "node:http";
import crypto from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_AGENT, me } from "./lib/reddit.mjs";

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDIRECT = "http://localhost:8910/callback";
const SCOPES = "identity read submit"; // listen + comment; nothing else

if (process.argv[2] === "whoami") {
  const u = await me();
  console.log(`Authed as u/${u.name} (link karma ${u.link_karma}, comment karma ${u.comment_karma})`);
  process.exit(0);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("✗ Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to .env.local first (from reddit.com/prefs/apps).");
  process.exit(1);
}
if (/^REDDIT_REFRESH_TOKEN=./m.test(readFileSync(ENV_PATH, "utf8"))) {
  console.error("✗ REDDIT_REFRESH_TOKEN already set in .env.local — delete that line first to re-auth.");
  process.exit(1);
}

const state = crypto.randomBytes(12).toString("hex");
const authUrl = `https://www.reddit.com/api/v1/authorize?${new URLSearchParams({
  client_id: CLIENT_ID, response_type: "code", state, redirect_uri: REDIRECT, duration: "permanent", scope: SCOPES,
})}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8910");
  if (url.pathname !== "/callback") { res.writeHead(404).end(); return; }
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (err || !code || url.searchParams.get("state") !== state) {
    res.writeHead(400, { "content-type": "text/plain" }).end(`Auth failed: ${err || "bad state/code"}`);
    console.error(`✗ callback error: ${err || "bad state/code"}`);
    process.exit(1);
  }
  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const r = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT }),
    });
    const j = await r.json();
    if (!j.refresh_token) throw new Error(`no refresh_token in response: ${JSON.stringify(j).slice(0, 200)}`);
    appendFileSync(ENV_PATH, `\nREDDIT_REFRESH_TOKEN=${j.refresh_token}\n`);
    res.writeHead(200, { "content-type": "text/plain" }).end("✅ YourScore Reddit auth complete. You can close this tab.");
    console.log("✅ REDDIT_REFRESH_TOKEN written to .env.local");
    console.log("   Verify: node --env-file=.env.local scripts/reddit-auth.mjs whoami");
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }).end(`Token exchange failed: ${e.message}`);
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
  server.close();
});

server.listen(8910, () => {
  console.log("Waiting for Reddit authorization (5 min timeout)...\n\nOpen this and click Allow:\n" + authUrl + "\n");
  try { execSync(`open "${authUrl}"`); } catch { /* headless — the printed URL is enough */ }
  setTimeout(() => { console.error("✗ timed out"); process.exit(1); }, 5 * 60 * 1000).unref();
});
