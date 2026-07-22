/**
 * llm.mjs — the Anthropic call. Raw HTTPS, no SDK: `package.json` is untouched
 * by this workstream (spec §9, "no new deps"), and the Messages API over fetch is
 * a dozen lines.
 *
 * THE MODEL WRITES ENGLISH. IT DOES NOT SUPPLY FACTS.
 * Its entire input is a dossier of facts the miner already computed and can
 * already prove (dossier.mjs / history.mjs), plus the exact list of people it is
 * allowed to name. Everything it returns is then re-checked, claim by claim,
 * against SportMonks (validate.mjs). A question that cites a fact id it wasn't
 * given, or names a person outside the whitelist, is dropped before any human
 * sees it. This is the structural answer to "the model states stale facts as
 * truth" — it is never in a position to state a fact at all.
 *
 * Model: Sonnet-class per the Feature-Build Framework's model policy (spec §2.3);
 * override with HALFTIME_LLM_MODEL. Structured outputs (`output_config.format`)
 * guarantee the JSON shape, so there is no brittle parse step.
 * Sampling parameters are deliberately absent — Sonnet 5 rejects non-default
 * temperature/top_p/top_k with a 400.
 */

const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.HALFTIME_LLM_MODEL || "claude-sonnet-5";
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Structured-output schema. Deliberately free of the JSON-Schema keywords the
 * API does not support (minItems/maxItems/minLength) — the counts are enforced
 * in code instead, where a violation is a drop rather than a 400.
 */
const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "object",
            properties: {
              A: { type: "string" },
              B: { type: "string" },
              C: { type: "string" },
              D: { type: "string" },
            },
            required: ["A", "B", "C", "D"],
            additionalProperties: false,
          },
          answer: { type: "string", enum: ["A"] },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          fact_ids: { type: "array", items: { type: "string" } },
          named_entities: { type: "array", items: { type: "string" } },
        },
        required: ["question", "options", "answer", "difficulty", "fact_ids", "named_entities"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export class LlmError extends Error {}

/**
 * One Messages call, bounded retries (LOOP rule 3). Returns { questions: [...] }.
 * Never throws on a well-formed refusal — a refusal means zero questions, which
 * degrades to a base-only pack, which is a normal outcome.
 */
export async function writeQuestions({ system, prompt, maxTokens = 4000, effort = "high" }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new LlmError("ANTHROPIC_API_KEY is not set");

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: {
      effort,
      format: { type: "json_schema", schema: QUESTION_SCHEMA },
    },
    messages: [{ role: "user", content: prompt }],
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new LlmError(`Anthropic ${res.status}: ${detail}`);
        }
        lastErr = new LlmError(`Anthropic ${res.status}: ${detail}`);
      } else {
        const json = await res.json();

        // A safety refusal is a content outcome, not an error. Zero questions →
        // base-only pack. Never read content[0] without checking stop_reason.
        if (json.stop_reason === "refusal") {
          return { questions: [], refused: true, model: json.model };
        }

        const text = (json.content ?? []).find((b) => b.type === "text")?.text;
        if (!text) throw new LlmError("no text block in response");
        const parsed = JSON.parse(text);
        return {
          questions: Array.isArray(parsed.questions) ? parsed.questions : [],
          refused: false,
          model: json.model,
          usage: json.usage,
        };
      }
    } catch (err) {
      if (err instanceof LlmError && /Anthropic 4\d\d/.test(err.message) && !/429/.test(err.message)) {
        throw err;
      }
      lastErr = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(800 * 2 ** (attempt - 1));
  }
  throw lastErr ?? new LlmError("Anthropic request failed");
}

export const modelId = () => MODEL;
