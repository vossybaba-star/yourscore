/**
 * preview-emails.mjs — render every email template with sample data into a
 * one-page gallery you can browse in a browser.
 *
 * Usage:
 *   node scripts/preview-emails.mjs            # writes emails/preview/
 *   npx serve emails/preview                   # or: python3 -m http.server -d emails/preview 8765
 *
 * The gallery (emails/preview/index.html) shows every template as a live
 * mini-preview; click any card to open it full-size. Re-run after editing
 * templates. emails/preview/ is generated output — gitignored.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LIFECYCLE_DIR = path.join(ROOT, "emails", "lifecycle");
const AUTH_DIR = path.join(ROOT, "supabase", "templates");
const OUT = path.join(ROOT, "emails", "preview");

// Sample values for every token any template uses. Lifecycle tokens are
// {{name}}; Supabase auth tokens are {{ .Name }}.
const SAMPLE = {
  // footer
  PAUSE_URL: "https://yourscore.app/settings/email?pause=all",
  UNSUB_URL: "https://yourscore.app/settings/email?unsub=all",
  // quiz lifecycle
  score: "4,500", p4p: "78", streak: "6", club: "ARSENAL",
  league_name: "The Lads", league_code: "TL9999",
  league_url: "https://yourscore.app/league/demo",
  whatsapp_share_url: "https://wa.me/?text=Join+my+league",
  inviter_name: "Tom", member_count: "8",
  top1_name: "Tom", top1_score: "12,400",
  top2_name: "Sam", top2_score: "11,850",
  top3_name: "Marcus", top3_score: "10,920",
  home: "ENGLAND", away: "FRANCE", tournament: "WORLD CUP 2026",
  kickoff: "20:00 BST",
  join_url: "https://yourscore.app/match/demo",
  skip_url: "https://yourscore.app/match/demo?skip=1",
  home_score: "2", away_score: "1", user_score: "3,250",
  rank_in_league: "#3", rank_delta: "▲ 2",
  next_fixture: "Brazil v Argentina · Sat 22:00 BST",
  next_fixture_url: "https://yourscore.app/match/demo2",
  week_score: "8,420", matches_played: "3", week_p4p: "76",
  best_match: "England 2-1 France · 3,250 pts",
  league1_name: "The Lads", league1_rank: "#3",
  league2_name: "Office FC", league2_rank: "#1",
  next_big_fixture: "Brazil v Argentina · Sat 22:00 BST",
  next_big_url: "https://yourscore.app/match/demo2",
  standings_url: "https://yourscore.app/leagues",
  joiner_name: "Tom",
  total_score: "48,720", best_streak: "9", final_rank: "#2",
  next_tournament: "Euro 2028",
  // 38-0
  team_name: "VOSSY UNITED", formation: "4-3-3", strength: "82",
  position: "3RD", projected_points: "76",
  result_word: "YOU WON", result_color: "#00ff87",
  my_score: "3", opp_score: "1", opponent: "RIVAL FC",
  w: "1", d: "0", l: "0",
  code: "RIV9X4",
  challenge_url: "https://yourscore.app/38-0/challenge/RIV9X4",
  match_url: "https://yourscore.app/38-0/match/demo",
  // social
  requester_name: "Tom", requester_initial: "T",
  friend_name: "Sam", friend_initial: "S",
  opponent_name: "RIVAL FC",
  profile_url: "https://yourscore.app/profile/demo",
  // campaign templates (11-15) — common tokens
  DAYS_LEFT: "3", first_name: "Zach", display_name: "Zach",
  cta_url: "https://yourscore.app", app_url: "https://yourscore.app",
};

const SAMPLE_AUTH = {
  ConfirmationURL: "https://yourscore.app/auth/confirm?token=sample",
  Token: "439281",
  Email: "you@example.com",
  NewEmail: "new@example.com",
  SiteURL: "https://yourscore.app",
};

// Display metadata per family. Cards are auto-discovered from the filesystem;
// anything not listed here still renders, in the "Other" group.
const GROUPS = [
  { match: /^(0[1-9]|10)-/, title: "Quiz lifecycle · event-triggered", color: "#00ff87" },
  { match: /^1[1-5]-/, title: "Campaigns · one-off sends", color: "#8888aa" },
  { match: /^1[6-9]-/, title: "38-0 lifecycle · event-triggered", color: "#ffb800" },
  { match: /^2[0-3]-/, title: "Social + retention", color: "#ff4757" },
  { match: /^A\d-/, title: "Auth · Supabase", color: "#a78bfa" },
];

function renderTokens(html, map, authStyle = false) {
  let out = html;
  for (const [k, v] of Object.entries(map)) {
    out = out.replaceAll(authStyle ? `{{ .${k} }}` : `{{${k}}}`, String(v));
  }
  // Any token we don't know gets a visible placeholder rather than raw braces.
  out = out.replace(/\{\{\s*\.?([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => `«${name}»`);
  return out;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function titleFromFile(f) {
  return f
    .replace(/\.html$/, "")
    .replace(/^(\d+|A\d)-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function numFromFile(f) {
  const m = f.match(/^(\d+|A\d)-/);
  return m ? m[1] : "";
}

function familyColor(f) {
  const g = GROUPS.find((g) => g.match.test(f));
  return g ? g.color : "#8888aa";
}

// Status pill per email, mirroring the journey timeline.
function statusOf(f) {
  const n = numFromFile(f);
  if (/^A\d$/.test(n)) return { label: "Transactional", cls: "p-live" };
  const num = parseInt(n, 10);
  if ([5, 6, 7, 8, 10].includes(num)) return { label: "Needs trigger", cls: "p-todo" };
  if ([11, 12, 13, 14, 15].includes(num)) return { label: "Campaign", cls: "p-todo" };
  if (num === 23) return { label: "Gated", cls: "p-gated" };
  return { label: "Live", cls: "p-live" };
}

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const cards = [];

  const lifecycleFiles = (await fs.readdir(LIFECYCLE_DIR)).filter((f) => f.endsWith(".html")).sort();
  for (const f of lifecycleFiles) {
    const html = await fs.readFile(path.join(LIFECYCLE_DIR, f), "utf-8");
    await fs.writeFile(path.join(OUT, f), renderTokens(html, SAMPLE));
    cards.push(f);
  }

  const authFiles = (await fs.readdir(AUTH_DIR)).filter((f) => f.endsWith(".html")).sort();
  const AUTH_ORDER = ["confirmation", "magic_link", "recovery", "email_change", "reauthentication", "invite"];
  authFiles.sort((a, b) => AUTH_ORDER.indexOf(a.replace(".html", "")) - AUTH_ORDER.indexOf(b.replace(".html", "")));
  authFiles.forEach((f, i) => cards.push(`A${i + 1}-${f}`));
  for (let i = 0; i < authFiles.length; i++) {
    const html = await fs.readFile(path.join(AUTH_DIR, authFiles[i]), "utf-8");
    await fs.writeFile(path.join(OUT, `A${i + 1}-${authFiles[i]}`), renderTokens(html, SAMPLE_AUTH, true));
  }

  // Build the gallery
  const groupsHtml = GROUPS.map((g) => {
    const members = cards.filter((f) => g.match.test(f));
    if (!members.length) return "";
    const cardsHtml = members
      .map(
        (f) => `
      <a class="card" target="_blank" href="${f}">
        <div class="frame"><iframe src="${f}" loading="lazy" tabindex="-1"></iframe></div>
        <div class="meta">
          <div class="num" style="color:${g.color}">${esc(numFromFile(f))}</div>
          <div class="title">${esc(titleFromFile(f))}</div>
          <div class="open" style="color:${g.color}">Open full size →</div>
        </div>
      </a>`,
      )
      .join("\n");
    return `
    <div class="group">
      <h2 style="color:${g.color}">${esc(g.title)} · ${members.length}</h2>
      <div class="grid">${cardsHtml}</div>
    </div>`;
  }).join("\n");

  const total = cards.length;
  const index = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>YourScore — All Emails (${total})</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#fff;font-family:'DM Sans',Helvetica,Arial,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:32px 24px}
h1{font-family:'Bebas Neue',Impact,sans-serif;font-size:48px;letter-spacing:1px;margin:0 0 4px}
.sub{font-size:13px;color:#8888aa;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;margin-bottom:36px}
.group{margin-bottom:44px}
.group h2{font-family:'Bebas Neue',Impact,sans-serif;font-size:20px;letter-spacing:2px;margin:0 0 16px;text-transform:uppercase}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}
.card{background:#12121e;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;text-decoration:none;color:#fff;transition:transform .15s,border-color .15s;display:block}
.card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,0.25)}
.frame{position:relative;background:#0a0a0f;border-bottom:1px solid rgba(255,255,255,0.06);height:230px;overflow:hidden}
.frame iframe{position:absolute;top:0;left:0;width:600px;height:1700px;border:0;transform:scale(0.45);transform-origin:0 0;pointer-events:none}
.meta{padding:12px 16px 14px}
.num{font-family:'Bebas Neue',Impact,sans-serif;font-size:15px;letter-spacing:1.5px;margin-bottom:2px}
.title{font-size:14px;font-weight:700;margin-bottom:6px}
.open{font-size:12px;font-weight:700}
</style></head>
<body><div class="wrap">
<h1>YourScore — Every Email</h1>
<p class="sub">${total} templates · rendered with sample data · regenerate with <code>node scripts/preview-emails.mjs</code></p>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin:0 0 28px">
  <a href="all.html" style="display:inline-block;padding:12px 20px;background:linear-gradient(135deg,#00ff87,#00d970);color:#0a0a0f;font-weight:700;font-size:14px;border-radius:10px;text-decoration:none;box-shadow:0 0 24px rgba(0,255,135,0.3)">📭 Read every email in full →</a>
  <a href="journeys.html" style="display:inline-block;padding:12px 20px;background:#12121e;border:1px solid rgba(167,139,250,0.4);color:#a78bfa;font-weight:700;font-size:14px;border-radius:10px;text-decoration:none">📅 Journey timeline →</a>
</div>
${groupsHtml}
</div></body></html>`;

  await fs.writeFile(path.join(OUT, "index.html"), index);

  // ── all.html — every email rendered FULL height, stacked, no clicking ───────
  // Two balanced columns; iframes auto-size to content (same-origin, so we can
  // read scrollHeight). Re-fit after web fonts settle.
  const item = (f) => {
    const st = statusOf(f);
    return `
    <div class="item">
      <div class="lbl" style="border-left-color:${familyColor(f)}">
        <span class="n" style="color:${familyColor(f)}">${esc(numFromFile(f))}</span>
        <span class="t">${esc(titleFromFile(f))}</span>
        <span class="pill ${st.cls}">${st.label}</span>
        <a class="full" href="${f}" target="_blank">open ↗</a>
      </div>
      <iframe src="${f}" scrolling="no" loading="lazy"></iframe>
    </div>`;
  };
  const colA = cards.filter((_, i) => i % 2 === 0).map(item).join("\n");
  const colB = cards.filter((_, i) => i % 2 === 1).map(item).join("\n");

  const allPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>YourScore — Read Every Email</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#fff;font-family:'DM Sans',Helvetica,Arial,sans-serif}
.bar{position:sticky;top:0;z-index:10;background:rgba(10,10,15,0.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,0.08);padding:14px 26px;display:flex;align-items:center;gap:18px}
.bar h1{font-family:'Bebas Neue',Impact,sans-serif;font-size:24px;letter-spacing:1px;margin:0}
.bar a{color:#00ff87;font-size:13px;font-weight:700;text-decoration:none}
.bar .muted{color:#8888aa;font-size:12px;font-weight:600;margin-left:auto}
.cols{display:flex;gap:28px;align-items:flex-start;max-width:1340px;margin:0 auto;padding:28px 26px 80px}
.col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:34px}
.item{background:#0d0d16;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden}
.lbl{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,0.07);border-left:3px solid #8888aa;background:#12121e}
.lbl .n{font-family:'Bebas Neue',Impact,sans-serif;font-size:16px;letter-spacing:1px}
.lbl .t{font-size:13.5px;font-weight:700;color:#fff}
.lbl .full{margin-left:auto;color:#8888aa;font-size:11px;font-weight:600;text-decoration:none}
.lbl .full:hover{color:#fff}
.pill{font-size:9px;letter-spacing:1px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:5px}
.p-live{background:rgba(0,255,135,0.14);color:#00ff87;border:1px solid rgba(0,255,135,0.4)}
.p-gated{background:rgba(255,184,0,0.14);color:#ffb800;border:1px solid rgba(255,184,0,0.4)}
.p-todo{background:rgba(136,136,170,0.14);color:#aaaacc;border:1px solid rgba(136,136,170,0.4)}
iframe{width:100%;border:0;display:block;background:#0a0a0f}
@media(max-width:1100px){.cols{flex-direction:column}}
</style></head>
<body>
<div class="bar">
  <h1>Read Every Email</h1>
  <a href="index.html">⊞ Grid</a>
  <a href="journeys.html">📅 Timeline</a>
  <span class="muted">${total} emails · full height · scroll, no clicking</span>
</div>
<div class="cols"><div class="col">${colA}</div><div class="col">${colB}</div></div>
<script>
  function fit(f){ try{ var d=f.contentWindow.document; f.style.height=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight)+'px'; }catch(e){} }
  function fitAll(){ document.querySelectorAll('iframe').forEach(fit); }
  document.querySelectorAll('iframe').forEach(function(f){ f.addEventListener('load',function(){ fit(f); setTimeout(function(){fit(f)},400); }); });
  window.addEventListener('load',function(){ fitAll(); [300,900,1800].forEach(function(t){setTimeout(fitAll,t)}); });
  window.addEventListener('resize',fitAll);
</script>
</body></html>`;
  await fs.writeFile(path.join(OUT, "all.html"), allPage);

  // Copy the hand-maintained journey timeline alongside the gallery.
  await fs.copyFile(path.join(ROOT, "emails", "journeys.html"), path.join(OUT, "journeys.html")).catch(() => {});

  console.log(`Rendered ${total} templates → emails/preview/`);
  console.log("View:  python3 -m http.server -d emails/preview 8765  →  http://localhost:8765/");
}

main().catch((e) => { console.error(e); process.exit(1); });
