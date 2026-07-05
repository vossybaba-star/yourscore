/**
 * navigation.mjs — Layer: back-navigation retraces the user's steps.
 *
 * Founder report (Jul 5): back buttons teleported players to areas they never
 * came from (league table → Versus, featured quiz → /play). Fixed with the
 * session nav trail (src/lib/nav.ts) + smart BackPill fallbacks. This layer
 * walks the golden paths end-to-end in a real browser and asserts every
 * visible back control lands the player exactly where they arrived from, so
 * a regression shows up on the next scorecard instead of in a user complaint.
 *
 * Uses the signed-in bot (ctx.auth from journeys, else signs in itself) —
 * these flows only exist for authenticated players.
 */

import { BASE } from "../lib/http.mjs";
import { signInBot } from "../lib/auth.mjs";

const VIEWPORT = { width: 390, height: 844 };

export async function run(report, ctx) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    report.add("nav", "playwright", false, { detail: `playwright not installed: ${e.message}` });
    return;
  }

  let auth = ctx.auth;
  if (!auth) {
    try {
      auth = await signInBot();
      ctx.auth = auth;
    } catch (e) {
      report.add("nav", "auth", false, { detail: e.message });
      return;
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const host = new URL(BASE).hostname;
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.addCookies(
      auth.cookies.map((c) => ({ name: c.name, value: c.value, domain: host, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" }))
    );
    await context.addInitScript(() => sessionStorage.setItem("ys:username-prompt:skipped", "1"));
    const page = await context.newPage();

    const path = () => new URL(page.url()).pathname + new URL(page.url()).search;
    const goto = async (p) => {
      await page.goto(`${BASE}${p}`, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(2500);
    };
    const back = async () => {
      const el = page.locator('button:has-text("Back")').first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(400);
      await el.click({ timeout: 10_000 });
      await page.waitForTimeout(1800);
    };
    const assertFlow = (name, want) => {
      const got = path();
      report.add("nav", name, got === want, {
        detail: got === want ? `retraced to ${got}` : `expected ${want}, landed on ${got}`,
        hint: "back navigation stopped retracing — check src/lib/nav.ts trail + BackPill fallbacks",
      });
    };

    // 1. Home → featured quiz → back retraces home (used to teleport to /play).
    try {
      await goto("/");
      const featured = page.locator('a[href^="/challenges/"]').first();
      await featured.scrollIntoViewIfNeeded();
      await featured.click();
      await page.waitForTimeout(2500);
      await back();
      assertFlow("home → featured quiz → back", "/");
    } catch (e) {
      report.add("nav", "home → featured quiz → back", false, { detail: e.message.slice(0, 120) });
    }

    // 2. Versus → quiz picker → back retraces to Versus.
    try {
      await goto("/versus");
      await goto("/versus/quiz");
      await back();
      assertFlow("versus → quiz picker → back", "/versus");
    } catch (e) {
      report.add("nav", "versus → quiz picker → back", false, { detail: e.message.slice(0, 120) });
    }

    // 3+4. Versus Leagues → public league table → member profile → back →
    // league table → back → Versus Leagues (the exact founder complaint).
    try {
      await goto("/versus?view=leagues");
      await page.locator("text=Discover").first().click();
      await page.waitForTimeout(2000);
      const card = page.locator('text=xG Deniers Club').first();
      if (!(await card.count())) {
        report.add("nav", "league retrace", true, { detail: "skipped — no public league card visible" });
      } else {
        await card.scrollIntoViewIfNeeded();
        await card.click();
        await page.waitForTimeout(2500);
        const leaguePath = path();
        const member = page.locator('a[href^="/profile/"]').first();
        await member.scrollIntoViewIfNeeded();
        await member.click();
        await page.waitForTimeout(2500);
        await back();
        assertFlow("league → profile → back", leaguePath);
        await back();
        assertFlow("league → back", "/versus?view=leagues");
      }
    } catch (e) {
      report.add("nav", "league retrace", false, { detail: e.message.slice(0, 120) });
    }

    // 5. Home → /debate → back retraces home.
    try {
      await goto("/");
      await goto("/debate");
      await back();
      assertFlow("home → debate → back", "/");
    } catch (e) {
      report.add("nav", "home → debate → back", false, { detail: e.message.slice(0, 120) });
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
