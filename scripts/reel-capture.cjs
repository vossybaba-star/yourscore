// Captures REAL in-app screens of the 38-0 World Cup Daily flow from the running
// dev server (http://localhost:3000). The draft mechanic (Practice mode) is driven
// live in-browser as a guest; the server-backed run/board pages render the real app
// components fed intercepted API responses (demo data). Output: marketing/reels/real/.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "..", "marketing", "reels", "real");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const TRANSPARENT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// ── demo World XI (4-3-3) ──────────────────────────────────────────────────────
const P = (slot, slotPos, name, club, overall, position) => ({
  slot, slotPos, player_season_id: `${name}-${club}`.toLowerCase().replace(/\s+/g, "-"),
  name, club, season: "", overall, position,
});
const SQUAD = [
  P("gk", "GK", "Alisson", "Brazil", 89, "GK"),
  P("rb", "RB", "Achraf Hakimi", "Morocco", 85, "RB"),
  P("rcb", "CB", "Virgil van Dijk", "Netherlands", 90, "CB"),
  P("lcb", "CB", "Marquinhos", "Brazil", 87, "CB"),
  P("lb", "LB", "Theo Hernández", "France", 85, "LB"),
  P("cdm", "CDM", "Rodri", "Spain", 91, "CDM"),
  P("rcm", "CM", "Jude Bellingham", "England", 90, "CM"),
  P("lcm", "CM", "Kevin De Bruyne", "Belgium", 91, "CM"),
  P("rw", "RW", "Lionel Messi", "Argentina", 93, "RW"),
  P("st", "ST", "Kylian Mbappé", "France", 92, "ST"),
  P("lw", "LW", "Vinícius Júnior", "Brazil", 89, "LW"),
];
const fx = (stage, label, nation) => ({ stage, label, opponent: { nation } });
const PLAN = {
  group: [fx("group", "Group · 1", "Mexico"), fx("group", "Group · 2", "Switzerland"), fx("group", "Group · 3", "South Korea")],
  knockouts: [
    fx("ko", "Round of 32", "Canada"), fx("ko", "Round of 16", "Morocco"),
    fx("qf", "Quarter-final", "Brazil"), fx("sf", "Semi-final", "Spain"), fx("final", "Final", "France"),
  ],
};
const baseRun = {
  id: "demo", mode: "world", nation: "World XI", status: "active", stage: "group",
  stage_index: 0, formation: "4-3-3", squad: SQUAD, strength: 89, plan: PLAN,
  group_points: 0, upgrades_left: 0,
};
const m = (stage, idx, yg, og, won, py = null, oy = null) => ({ stage, idx, you_goals: yg, opp_goals: og, pens_you: py, pens_opp: oy, won });

const RUNS = {
  // mid-tournament: into the quarter-final, opponent revealed, upgrades to spend
  "demo-qf": {
    run: { ...baseRun, status: "active", stage: "qf", stage_index: 3, group_points: 7, upgrades_left: 2 },
    matches: [m("group", 0, 2, 0, true), m("group", 1, 1, 0, true), m("group", 2, 1, 1, null), m("ko", 0, 3, 1, true), m("ko", 1, 2, 0, true)],
    opponent: { nation: "Brazil", label: "Quarter-final", formation: "4-3-3", strength: 87,
      squad: SQUAD.map((p) => ({ ...p, name: "—" })) },
    pensPending: null, pendingTie: null,
  },
  // champions: perfect 8-0-0
  "demo-champ": {
    run: { ...baseRun, status: "champion", stage: "final", stage_index: 4, group_points: 9, upgrades_left: 0 },
    matches: [m("group", 0, 2, 0, true), m("group", 1, 3, 0, true), m("group", 2, 2, 0, true),
      m("ko", 0, 3, 1, true), m("ko", 1, 2, 0, true), m("qf", 0, 2, 1, true), m("sf", 0, 1, 0, true), m("final", 0, 2, 1, true)],
    opponent: null, pensPending: null, pendingTie: null,
  },
};
const BOARD_ROWS = [
  { user_id: "1", display_name: "FootyBrain99", avatar_url: null, wins: 7, draws: 1, losses: 0, points: 22, days: 6, rank: 1 },
  { user_id: "2", display_name: "TikiTaka_Tom", avatar_url: null, wins: 7, draws: 0, losses: 1, points: 21, days: 5, rank: 2 },
  { user_id: "3", display_name: "GafferJess", avatar_url: null, wins: 6, draws: 2, losses: 0, points: 20, days: 6, rank: 3 },
  { user_id: "4", display_name: "ManagerMo", avatar_url: null, wins: 6, draws: 1, losses: 1, points: 19, days: 4, rank: 4 },
  { user_id: "5", display_name: "SundayLeaguer", avatar_url: null, wins: 5, draws: 2, losses: 1, points: 17, days: 5, rank: 5 },
  { user_id: "6", display_name: "PubQuizPete", avatar_url: null, wins: 5, draws: 1, losses: 2, points: 16, days: 5, rank: 6 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  // Crest/flag images are external (a.espncdn.com) and blocked by the egress policy —
  // serve a transparent pixel so they don't render as broken-image icons.
  await page.route(/espncdn\.com|teamlogos|\/i\/teamlogos/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }));
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + ".png") }); console.log("✓", name); };
  const safe = async (label, fn) => { try { await fn(); } catch (e) { console.log("⚠", label, "—", e.message.split("\n")[0]); } };

  // ── 1. mode picker (Today's Run / Mastermind) — real, client-side ────────────
  await page.goto(`${BASE}/38-0/wc`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  await shot("01-mode-picker");

  await safe("how-it-works", async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(600); await shot("02-how-it-works");
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  });

  // ── 2. enter Practice (same draft mechanic as Today's Run, no sign-in) ───────
  await safe("draft-empty", async () => {
    await page.getByText("PRACTICE", { exact: true }).click();
    await sleep(1500); await shot("03-draft-empty");
  });

  // ── 3. the question + answer + slate + building the XI (real) ────────────────
  // Drive the real draft as a small state machine: SCOUT → answer → pick → place.
  let gotCorrect = false, gotSlate = false, gotProgress = false, gotQuestion = false, placed = 0;
  for (let step = 0; step < 130 && placed < 11; step++) {
    if (gotCorrect && placed >= 8) break;
    const state = await page.evaluate(() => {
      const vis = (el) => el && el.offsetParent !== null;
      const has = (re) => Array.from(document.querySelectorAll("div,span,p")).some((d) => vis(d) && re.test(d.textContent || ""));
      if (has(/ANSWER TO SCOUT/)) return "question";
      if (Array.from(document.querySelectorAll("div")).some((d) => /^Place /.test(d.textContent || "") && d.offsetParent !== null)) return "place";
      if (has(/pick a player/i)) return "slate";
      const scout = Array.from(document.querySelectorAll("button")).find((b) => /SCOUT/.test(b.textContent || "") && b.offsetParent !== null && !b.disabled);
      if (scout) return "scout";
      return "wait";
    });
    if (process.env.DBG) console.log("step", step, state, "placed", placed);

    if (state === "scout") {
      await page.evaluate(() => { Array.from(document.querySelectorAll("button")).find((b) => /SCOUT/.test(b.textContent || "") && !b.disabled)?.click(); });
      await sleep(700);
    } else if (state === "question") {
      if (!gotQuestion) { await shot("04-question"); gotQuestion = true; }
      await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll("button")).filter((b) => b.offsetParent !== null && (b.textContent || "").length > 1 && !/SCOUT|CANCEL/i.test(b.textContent || ""));
        if (opts.length) opts[Math.floor(Math.random() * opts.length)].click();
      });
      await sleep(500);
      if (!gotCorrect && (await page.getByText(/Correct/).count())) { await shot("05-correct"); gotCorrect = true; }
      await sleep(1300); // let the slate spin in
    } else if (state === "slate") {
      if (!gotSlate) { await shot("06-slate"); gotSlate = true; }
      await page.evaluate(() => {
        const row = Array.from(document.querySelectorAll("button")).find((b) => /^\s*\d{2}[A-Za-z]/.test(b.textContent || "") && b.offsetParent !== null && !b.disabled);
        if (row) row.click();
      });
      await sleep(500);
    } else if (state === "place") {
      await page.evaluate(() => {
        const chip = Array.from(document.querySelectorAll("button")).find((b) => /^(GK|CB|LB|RB|CM|CDM|CAM|ST|LW|RW|LWB|RWB)$/.test((b.textContent || "").trim()) && b.offsetParent !== null);
        if (chip) chip.click();
      });
      placed++;
      await sleep(500);
      if (placed >= 4 && !gotProgress) { await shot("07-draft-progress"); gotProgress = true; }
    } else {
      await sleep(500);
    }
  }
  // completed/near-complete XI: shows Strength (Overall) + line ratings + ENTER cta
  if (placed >= 8) await safe("draft-full", async () => { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400); await shot("07b-draft-full"); });

  // ── 4. real run page (mid-tournament QF) — real component, demo data ─────────
  for (const [id, key] of [["demo-qf", "08-run-quarterfinal"], ["demo-champ", "09-run-champion"]]) {
    await safe(key, async () => {
      await page.route(`**/api/draft/wc/${id}`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RUNS[id]) }));
      await page.goto(`${BASE}/38-0/wc/run/${id}`, { waitUntil: "domcontentloaded" });
      await sleep(3500); await shot(key); // allow the real share-card OG image to render
    });
  }

  // ── 5. real season board — real component, demo rows ─────────────────────────
  await safe("board", async () => {
    await page.route("**/api/draft/wc/leaderboard", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: BOARD_ROWS, ready: true }) }));
    await page.goto(`${BASE}/38-0/wc/board`, { waitUntil: "domcontentloaded" });
    await sleep(2000); await shot("10-board");
  });

  await browser.close();
  console.log("\nReal screens written to", OUT);
})();
