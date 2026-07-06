/**
 * browser.mjs — Layer 4: headless-browser smoke of what users actually see.
 *
 * APIs can be green while the app is broken in the client — the 38-0 "can't
 * pick a player" incident was a stale webpack chunk 404 invisible to every
 * API probe. Each page here asserts: renders, no failed/4xx static-JS
 * requests, no console errors, and a page-specific "the game is actually
 * usable" signal. Screenshots land in scripts/data/health/shots/<ts>/ for
 * Telegram failure attachments and the daily LLM gamer review.
 *
 * Mobile viewport (512×1108, iPhone UA) — matches how ~all players see it.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE } from "../lib/http.mjs";
import { DATA_DIR } from "../lib/report.mjs";

// Console noise that isn't a product bug (analytics pixels etc.) — extend as needed.
const CONSOLE_ALLOWLIST = [/analytics/i, /pixel/i, /posthog/i, /third-party cookie/i, /net::ERR_BLOCKED_BY_CLIENT/i];

const PAGES = [
  {
    path: "/",
    name: "home",
    ready: async (page) => page.waitForSelector("main, [class*=hero], nav", { timeout: 20_000 }),
  },
  {
    path: "/38-0/wc",
    name: "38-0 WC",
    // The stale-chunk detector: the pool JSON must load AND interactive UI must render.
    setup: (page, state) => {
      state.poolResponse = page
        .waitForResponse((r) => r.url().includes("/data/draft/player-seasons.json"), { timeout: 25_000 })
        .catch(() => null);
    },
    ready: async (page, state) => {
      await page.waitForSelector("button, [class*=draft], [class*=pitch]", { timeout: 20_000 });
      const pool = await state.poolResponse;
      // Pool fetch is lazy on some paths — only a FAILED fetch is fatal; absent is fine.
      if (pool && pool.status() >= 400) throw new Error(`pool fetch ${pool.status()}`);
    },
  },
  {
    path: "/play",
    name: "quiz hub",
    ready: async (page) => page.waitForSelector("button, [class*=pack], [class*=quiz]", { timeout: 20_000 }),
  },
  {
    path: "/leaderboard",
    name: "leaderboard",
    // Rows are client-fetched divs — "ready" = a ranked list with numbers on screen.
    ready: async (page) => {
      await page.waitForFunction(
        () => /leaderboard|rank/i.test(document.body.innerText) && /\d/.test(document.body.innerText),
        { timeout: 20_000 },
      );
    },
  },
  {
    path: "/auth/sign-in",
    name: "sign-in",
    anon: true, // fresh context: the logged-out front door must render its options
    ready: async (page) => {
      await page.waitForFunction(
        () => document.querySelectorAll("button").length > 0 && /sign|email|google|apple/i.test(document.body.innerText),
        { timeout: 20_000 },
      );
    },
  },
];

export async function run(report, ctx) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    report.add("browser", "playwright", false, { detail: `playwright not installed: ${e.message}`, hint: "npm i -D playwright && npx playwright install chromium" });
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const shotsDir = join(DATA_DIR, "shots", ts);
  mkdirSync(shotsDir, { recursive: true });
  ctx.screenshots = [];
  ctx.failureShots = ctx.failureShots ?? [];

  const browser = await chromium.launch({ headless: true });
  try {
    const contextOpts = {
      viewport: { width: 512, height: 1108 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    };
    const authedContext = await browser.newContext(contextOpts);
    if (ctx.auth?.cookies) {
      const host = new URL(BASE).hostname;
      await authedContext.addCookies(ctx.auth.cookies.map((c) => ({ name: c.name, value: c.value, domain: host, path: "/", secure: true, httpOnly: false, sameSite: "Lax" })));
    }
    const anonContext = await browser.newContext(contextOpts);

    for (const spec of PAGES) {
      const context = spec.anon ? anonContext : authedContext;
      const page = await context.newPage();
      const state = {};
      const consoleErrors = [];
      const badRequests = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && !CONSOLE_ALLOWLIST.some((re) => re.test(msg.text()))) consoleErrors.push(msg.text());
      });
      page.on("requestfailed", (r) => {
        // ERR_ABORTED = cancelled request (Next.js RSC prefetches abort routinely) — not a failure.
        if (r.failure()?.errorText === "net::ERR_ABORTED") return;
        if (!CONSOLE_ALLOWLIST.some((re) => re.test(r.url()))) badRequests.push(`${r.url().slice(-80)} (${r.failure()?.errorText})`);
      });
      page.on("response", (r) => {
        // The stale-deploy signature: any static JS/chunk answering 4xx+.
        if (r.status() >= 400 && (/\.js(\?|$)/.test(r.url()) || r.url().includes("/_next/static/"))) {
          badRequests.push(`${r.url().slice(-80)} → ${r.status()}`);
        }
      });

      let ok = true, detail = "";
      try {
        spec.setup?.(page, state);
        const resp = await page.goto(BASE + spec.path, { timeout: 30_000, waitUntil: "domcontentloaded" });
        if (!resp || resp.status() >= 400) throw new Error(`navigation ${resp?.status()}`);
        await spec.ready(page, state, ctx);
        await page.waitForTimeout(1500); // let late chunk loads/console errors surface
        if (badRequests.length) { ok = false; detail = `failed asset(s): ${badRequests.slice(0, 2).join("; ")}`; }
        else if (consoleErrors.length) { ok = false; detail = `console error: ${consoleErrors[0].slice(0, 140)}`; }
      } catch (e) {
        ok = false;
        detail = [e.message.slice(0, 140), badRequests.slice(0, 2).join("; ")].filter(Boolean).join(" | ");
      }

      const shotPath = join(shotsDir, `${spec.name.replace(/[^a-z0-9-]+/gi, "-")}.png`);
      try {
        await page.screenshot({ path: shotPath, fullPage: false });
        ctx.screenshots.push({ page: spec.name, path: shotPath });
        if (!ok) ctx.failureShots.push({ path: shotPath, caption: `✗ ${spec.name} — ${detail}`.slice(0, 200) });
      } catch { /* screenshot is best-effort */ }

      report.add("browser", spec.name, ok, {
        detail,
        hint: ok ? "" : detail.includes("_next/static") || detail.includes(".js")
          ? "looks like a stale deploy chunk — check latest Vercel build, consider redeploy"
          : "page broken in the client — open the screenshot",
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
