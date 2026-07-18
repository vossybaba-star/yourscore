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
 *
 * NOTE (founder ruling 2026-07-18): the five GAME SECTIONS (/play, /38-0 and
 * the three game intros) are tabs under the persistent games nav and have NO
 * back buttons by design — never add back-retrace flows for them. The flows
 * below all live outside the game sections and keep their Back pills.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE } from "../lib/http.mjs";
import { signInBot } from "../lib/auth.mjs";
import { DATA_DIR } from "../lib/report.mjs";

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
    // Skip every session-scoped signup nudge the layout can pop over the page —
    // the bot deliberately has no username AND no club (declaring a club would
    // put a fake club on the supporters leaderboard), so without these skips a
    // prompt modal covers the UI and every click below times out.
    await context.addInitScript(() => {
      sessionStorage.setItem("ys:username-prompt:skipped", "1");
      sessionStorage.setItem("ys:club-prompt:skipped", "1");
    });
    const page = await context.newPage();

    const path = () => new URL(page.url()).pathname + new URL(page.url()).search;
    const goto = async (p) => {
      await page.goto(`${BASE}${p}`, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(2500);
    };

    // What actually sits on the target's click point? A blocked click almost
    // always means an overlay (the Jul-18 ClubPrompt incident: a z-100 modal
    // backdrop turned all four flows into bare timeouts that took a session to
    // identify). Naming the covering element makes that a one-line read.
    const describeClickPoint = async (el) => {
      try {
        const box = await el.boundingBox();
        if (!box) return "target hidden or detached (no bounding box)";
        return await page.evaluate(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          if (!hit) return "nothing at the click point";
          const id = hit.id ? `#${hit.id}` : "";
          const cls = typeof hit.className === "string" && hit.className.trim()
            ? `.${hit.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
          const text = (hit.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
          return `click point hits <${hit.tagName.toLowerCase()}${id}${cls}>${text ? ` "${text}"` : ""}`;
        }, [box.x + box.width / 2, box.y + box.height / 2]);
      } catch (e) {
        return `blocker probe failed: ${String(e.message).slice(0, 60)}`;
      }
    };

    // Click with a diagnosis: on timeout the thrown error carries where we
    // were, the real Playwright reason, what covers the click point, and a
    // screenshot in scripts/data/health/ — instead of a truncated timeout.
    const clickOrExplain = async (locator, what, timeout = 10_000) => {
      const el = locator.first();
      await el.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
      await page.waitForTimeout(400);
      try {
        await el.click({ timeout });
      } catch (e) {
        const shot = join(DATA_DIR, `nav-blocked-${what.replace(/[^a-z0-9]+/gi, "-")}.png`);
        try { mkdirSync(DATA_DIR, { recursive: true }); await page.screenshot({ path: shot }); } catch { /* best effort */ }
        const blocker = await describeClickPoint(el);
        const reason = e.message.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" · ").slice(0, 180);
        throw new Error(`${what} at ${path()} — ${blocker} — ${reason} (screenshot: ${shot})`);
      }
    };

    const back = async () => {
      await clickOrExplain(page.locator('button:has-text("Back")'), "back control");
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
      await clickOrExplain(page.locator('a[href^="/challenges/"]'), "featured quiz card", 30_000);
      await page.waitForTimeout(2500);
      await back();
      assertFlow("home → featured quiz → back", "/");
    } catch (e) {
      report.add("nav", "home → featured quiz → back", false, { detail: e.message.slice(0, 350) });
    }

    // 2. Versus → quiz picker → back retraces to Versus.
    try {
      await goto("/versus");
      await goto("/versus/quiz");
      await back();
      assertFlow("versus → quiz picker → back", "/versus");
    } catch (e) {
      report.add("nav", "versus → quiz picker → back", false, { detail: e.message.slice(0, 350) });
    }

    // 3+4. Versus Leagues → public league table → member profile → back →
    // league table → back → Versus Leagues (the exact founder complaint).
    try {
      await goto("/versus?view=leagues");
      await clickOrExplain(page.locator("text=Discover"), "Discover tab", 30_000);
      await page.waitForTimeout(2000);
      const card = page.locator('text=xG Deniers Club').first();
      if (!(await card.count())) {
        report.add("nav", "league retrace", true, { detail: "skipped — no public league card visible" });
      } else {
        await clickOrExplain(card, "public league card");
        await page.waitForTimeout(2500);
        const leaguePath = path();
        await clickOrExplain(page.locator('a[href^="/profile/"]'), "league member profile");
        await page.waitForTimeout(2500);
        await back();
        assertFlow("league → profile → back", leaguePath);
        await back();
        assertFlow("league → back", "/versus?view=leagues");
      }
    } catch (e) {
      report.add("nav", "league retrace", false, { detail: e.message.slice(0, 350) });
    }

    // 5. Home → /debate → back retraces home.
    try {
      await goto("/");
      await goto("/debate");
      await back();
      assertFlow("home → debate → back", "/");
    } catch (e) {
      report.add("nav", "home → debate → back", false, { detail: e.message.slice(0, 350) });
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
