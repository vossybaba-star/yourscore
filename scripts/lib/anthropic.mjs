/**
 * Shared Anthropic client for node scripts.
 *
 * The repo had six hand-rolled `fetch` calls to api.anthropic.com, each re-implementing
 * the x-api-key + anthropic-version headers, each with different retry behaviour (mostly
 * none), and several pinned to model IDs that don't exist. The quiz factory needs web-
 * grounded calls with real retry, so the client lives here.
 *
 * Credit exhaustion is treated as a HARD stop, not a retryable error: scripts/reddit-track.mjs
 * grew four separate credit-exhaustion guards because a drained key silently degrades every
 * downstream stage. Better to abort the run loudly than to ship half a batch.
 */

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

/**
 * Web search server tool — lets Claude ground a claim against live sources.
 * `allowed_callers: ["direct"]` is REQUIRED for models without programmatic tool calling
 * (e.g. Haiku 4.5) — without it the API 400s. Harmless on models that do support it.
 */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 6,
  allowed_callers: ["direct"],
};

export const MODELS = {
  /** Authoring + verification. Needs real reasoning and tool use. */
  author: "claude-sonnet-5",
  verify: "claude-sonnet-5",
  /** Cheap deterministic-ish classification (theme proposals, triage). */
  cheap: "claude-haiku-4-5-20251001",
};

export class CreditExhausted extends Error {}

// ── Cost accounting ──────────────────────────────────────────────────────────
// Non-negotiable. scripts/lib/reddit.mjs learned this the hard way: "$66 in a week,
// $20 in a day, and nobody could say where it went — because nothing counted." Web
// search is the dominant cost and it was completely invisible. Every call bills here.
const PRICES = {                                  // USD per 1M tokens
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
const WEB_SEARCH_USD = 0.01;                      // $10 per 1,000 searches

export const usage = { calls: 0, searches: 0, inTok: 0, outTok: 0, usd: 0, byStage: {} };

/** Server-tool uses are billed per search, and they're invisible in token counts. */
const searchCount = (resp) => resp?.usage?.server_tool_use?.web_search_requests ?? 0;

function bill(stage, model, resp) {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5"];
  const u = resp?.usage ?? {};
  const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const outTok = u.output_tokens ?? 0;
  const searches = searchCount(resp);
  const usd = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out + searches * WEB_SEARCH_USD;

  usage.calls++; usage.searches += searches; usage.inTok += inTok; usage.outTok += outTok; usage.usd += usd;
  const s = (usage.byStage[stage] ??= { calls: 0, searches: 0, inTok: 0, outTok: 0, usd: 0 });
  s.calls++; s.searches += searches; s.inTok += inTok; s.outTok += outTok; s.usd += usd;
  return usd;
}

export function costReport() {
  const lines = [`$${usage.usd.toFixed(2)} · ${usage.calls} calls · ${usage.searches} searches · ${(usage.inTok / 1000).toFixed(0)}k in / ${(usage.outTok / 1000).toFixed(0)}k out`];
  for (const [stage, s] of Object.entries(usage.byStage)) {
    lines.push(`  ${stage.padEnd(10)} $${s.usd.toFixed(2)}  ${s.calls} calls  ${s.searches} searches`);
  }
  return lines.join("\n");
}

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set (source .env.local)");
  return key;
}

/**
 * Reassemble a streamed response into the same shape a non-streamed one has, so every caller
 * (textOf / lastTextOf / parseJson / bill) keeps working unchanged.
 */
function applyEvent(acc, ev) {
  switch (ev.type) {
    case "message_start":
      acc.model = ev.message?.model ?? acc.model;
      acc.usage = { ...acc.usage, ...(ev.message?.usage ?? {}) };
      break;
    case "content_block_start":
      // Keep the block as sent (text, server_tool_use, web_search_tool_result, …) and grow
      // text into it as deltas arrive.
      acc.content[ev.index] = { ...(ev.content_block ?? {}) };
      if (acc.content[ev.index].type === "text") acc.content[ev.index].text ??= "";
      break;
    case "content_block_delta": {
      const b = acc.content[ev.index];
      if (b && ev.delta?.type === "text_delta") b.text = (b.text ?? "") + ev.delta.text;
      break;
    }
    case "message_delta":
      acc.stop_reason = ev.delta?.stop_reason ?? acc.stop_reason;
      // Cumulative — output_tokens and server_tool_use only land here.
      acc.usage = { ...acc.usage, ...(ev.usage ?? {}) };
      break;
    case "error":
      throw new Error(`stream error: ${JSON.stringify(ev.error ?? {}).slice(0, 300)}`);
  }
}

/**
 * Read an SSE body, rebuilding the message. `onActivity` fires on every chunk so the caller
 * can run an INACTIVITY timeout rather than a total-duration one — the distinction that
 * matters here: a research call that streams for eight minutes is working, not hung.
 */
async function readStream(res, onActivity) {
  const acc = { content: [], usage: {}, stop_reason: null, model: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; keep the trailing partial in the buffer.
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(payload); } catch { continue; }
        applyEvent(acc, ev);
      }
    }
  }
  acc.content = acc.content.filter(Boolean);
  return acc;
}

/**
 * One Claude call with retry. Returns the full response body.
 * Throws CreditExhausted (never retried) if the key is out of credit.
 *
 * STREAMS BY DEFAULT, and that is a correctness fix rather than a nicety. A non-streamed call
 * is invisible until it finishes, so the only timeout you can enforce is on TOTAL DURATION —
 * and a big research call (80 facts, each with a source quote, plus web searches) legitimately
 * runs past five minutes. A Newcastle run burned 30 minutes on six consecutive 300s timeouts
 * and produced nothing: every attempt was killed while it was still working, and each one had
 * almost certainly been billed server-side by the time we hung up. Retrying a call that is
 * merely slow is the most expensive possible failure.
 *
 * Streaming makes the timeout an INACTIVITY timeout instead: fail when nothing has arrived for
 * `timeoutMs`, which is the condition we actually mean by "hung". A slow call now completes.
 */
export async function callClaude({
  model = MODELS.author,
  system,
  messages,
  tools,
  maxTokens = 4096,
  retries = 5,      // must outlast a short network/DNS outage — see the backoff note below
  stage = "misc",
  // INACTIVITY, not total duration: how long we tolerate silence before calling it hung.
  // 2 minutes of nothing arriving is a dead connection; 12 minutes of steady output is fine.
  timeoutMs = 2 * 60_000,
  stream = true,
} = {}) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (stream) body.stream = true;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s (+0-500ms). Capped at 20s.
      // A DNS/network outage (ENOTFOUND api.anthropic.com) killed a 45-minute sweep because
      // three quick retries all landed inside the same blip — the backoff needs to outlast a
      // short outage, not just a single dropped packet.
      const wait = Math.min(1000 * 2 ** (attempt - 1), 20_000) + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, wait));
    }
    // ⚠️ A TIMEOUT IS NOT OPTIONAL. Without one, fetch waits for ever on a connection that
    // opens and never answers — and it happened: a research call sat for 28 minutes with zero
    // output, on a laptop whose wifi had dropped. The retry loop is useless if attempt 1 never
    // returns. But the clock must measure SILENCE, not elapsed time (see callClaude's note), so
    // it's an idle timer we push forward on every byte rather than AbortSignal.timeout.
    const ctl = new AbortController();
    let idle = setTimeout(() => ctl.abort(), timeoutMs);
    const keepAlive = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), timeoutMs); };

    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: {
          "x-api-key": apiKey(),
          "anthropic-version": VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(idle);
      // AbortError = nothing arrived for timeoutMs; anything else is a network blip. Both retry.
      lastErr = e.name === "TimeoutError" || e.name === "AbortError"
        ? new Error(`no response for ${Math.round(timeoutMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})`)
        : e;
      console.warn(`   ⏱  ${lastErr.message} — retrying…`);
      continue;
    }

    if (res.ok) {
      try {
        const json = stream ? await readStream(res, keepAlive) : await res.json();
        bill(stage, model, json);
        return json;
      } catch (e) {
        // A stream that dies mid-flight is retryable — but say so, because a partial read
        // looks like success from the outside.
        lastErr = ctl.signal.aborted
          ? new Error(`stream went silent for ${Math.round(timeoutMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})`)
          : e;
        console.warn(`   ⏱  ${lastErr.message} — retrying…`);
        continue;
      } finally {
        clearTimeout(idle);
      }
    }
    clearTimeout(idle);

    const text = await res.text().catch(() => "");

    // Out of credit: abort the whole run. Retrying cannot help and a partial batch is worse
    // than no batch — a half-verified pack looks identical to a fully-verified one.
    if (/credit balance|insufficient.*credit/i.test(text)) {
      throw new CreditExhausted(`ANTHROPIC OUT OF CREDIT — aborting run.\n${text.slice(0, 300)}`);
    }
    // 429 / 5xx are transient; 4xx (bad request, bad model id) are not.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`);
    }
    lastErr = new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  throw lastErr ?? new Error("Anthropic call failed");
}

/** Concatenated text blocks from a response (ignores thinking / server-tool blocks). */
export const textOf = (resp) =>
  (resp?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * The FINAL text block. With server-side web search the model narrates as it works
 * ("Now let me search for…"), so a response contains many interleaved text blocks and the
 * actual answer is only in the last one. Concatenating them all and grabbing the first
 * bracket picks up prose, not the payload.
 */
export const lastTextOf = (resp) =>
  ((resp?.content ?? []).filter((b) => b.type === "text").pop()?.text ?? "").trim();

/**
 * Parse the JSON object/array out of a model reply. Models wrap JSON in prose or ```json
 * fences no matter how firmly you ask them not to. Tries the final text block first (where
 * the answer lives), then falls back to the whole reply.
 */
export function parseJson(resp) {
  if (typeof resp !== "string" && resp?.stop_reason === "max_tokens") {
    throw new Error(
      "Model hit max_tokens before finishing its JSON — the reply is truncated. Raise maxTokens or ask for fewer items."
    );
  }
  if (typeof resp !== "string") {
    try {
      return extractJson(lastTextOf(resp));
    } catch {
      /* fall through to the full concatenation */
    }
  }
  const raw = typeof resp === "string" ? resp : textOf(resp);
  return extractJson(raw);
}

function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON in model reply: ${raw.slice(0, 200)}`);
  // Walk to the matching close bracket — a naive lastIndexOf breaks on trailing prose.
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error(`Unbalanced JSON in model reply: ${raw.slice(0, 200)}`);
}

/** Sum of usage across calls, for the cost log. */
export const usageOf = (resp) => ({
  input: resp?.usage?.input_tokens ?? 0,
  output: resp?.usage?.output_tokens ?? 0,
});
