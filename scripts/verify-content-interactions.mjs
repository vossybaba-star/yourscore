/**
 * Verify the interactive content feed end-to-end against a running dev server:
 * react → comment → batched state → thread read → cleanup. Uses the health bot.
 *   node -r dotenv/config scripts/verify-content-interactions.mjs dotenv_config_path=.env.local
 */
import { signInBot } from "./health/lib/auth.mjs";

const BASE = process.env.VERIFY_BASE || "http://localhost:3025";

const j = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
let pass = true;
const check = (label, ok, detail) => { console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) pass = false; };

const { cookieHeader } = await signInBot();
const H = { "Content-Type": "application/json", Cookie: cookieHeader };

// 1. Pull a real item + its subjectKey from the live feed.
const feed = await j(await fetch(`${BASE}/api/feed/live`));
const item = (feed.items || []).find((i) => i.subjectKey);
check("live feed returns items with subjectKey", !!item, item ? `${(feed.items||[]).length} items, subject ${item.subjectKey}` : "none");
if (!item) process.exit(1);
const subjectId = item.subjectKey;

// 2. React 🔥 (authed).
const r1 = await fetch(`${BASE}/api/feed/content/react`, { method: "POST", headers: H, body: JSON.stringify({ subjectId, emoji: "🔥" }) });
const r1b = await j(r1);
check("POST react 🔥", r1.status === 200 && r1b.reacted === "🔥", `status ${r1.status} ${JSON.stringify(r1b)}`);

// 3. Switch reaction to ❤️ (same user, one-per-user upsert).
const r2 = await fetch(`${BASE}/api/feed/content/react`, { method: "POST", headers: H, body: JSON.stringify({ subjectId, emoji: "❤️" }) });
check("POST switch to ❤️", r2.status === 200, `status ${r2.status}`);

// 4. Post a comment on the content item.
const body = `verify-${Date.now()}`;
const c1 = await fetch(`${BASE}/api/comments`, { method: "POST", headers: H, body: JSON.stringify({ subjectType: "content", subjectId, body }) });
const c1b = await j(c1);
const commentId = c1b?.id || c1b?.comment?.id;
check("POST comment (content)", c1.status === 200 || c1.status === 201, `status ${c1.status} ${JSON.stringify(c1b).slice(0,120)}`);

// 5. Batched state reflects the reaction + comment.
const st = await j(await fetch(`${BASE}/api/feed/content/state?ids=${subjectId}`, { headers: { Cookie: cookieHeader } }));
const s = st.states?.[subjectId];
check("batched state: mine=❤️", s?.mine === "❤️", JSON.stringify(s));
check("batched state: 1 reaction total", (s?.reactions || []).reduce((a, r) => a + r.count, 0) === 1, JSON.stringify(s?.reactions));
check("batched state: comments >= 1", (s?.comments || 0) >= 1, `comments ${s?.comments}`);

// 6. Public thread read (no cookie) returns the comment.
const thread = await j(await fetch(`${BASE}/api/comments?type=content&id=${subjectId}`));
const found = JSON.stringify(thread).includes(body);
check("public thread read shows the comment (signed-out)", found, `total ${thread.total ?? "?"}`);

// 7. Cleanup: clear the reaction + soft-delete the comment.
const d1 = await fetch(`${BASE}/api/feed/content/react`, { method: "DELETE", headers: H, body: JSON.stringify({ subjectId }) });
check("DELETE reaction (cleanup)", d1.status === 200, `status ${d1.status}`);
if (commentId) {
  const d2 = await fetch(`${BASE}/api/comments?id=${commentId}`, { method: "DELETE", headers: H });
  console.log(`   comment delete status ${d2.status}`);
}

console.log(pass ? "\nALL PASS" : "\nFAILURES ABOVE");
process.exit(pass ? 0 : 1);
