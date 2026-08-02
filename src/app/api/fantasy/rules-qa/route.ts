/**
 * POST /api/fantasy/rules-qa — the free text tail of the rules bot on
 * /fantasy/rules. RulesBot.tsx answers everything it can from the canned FAQ
 * with zero network; this route only runs for the rest.
 *
 * Grounding follows tips.ts's own rule (see lib/fantasy/tips.ts header): the
 * model is handed OUR rules document and forbidden from using its own
 * football knowledge. buildRulesDoc() (rulesFaq.ts) is the entire system
 * prompt's factual content, built from the same engine constants the rest of
 * the rules page uses, so this route can never state a rule the game itself
 * does not enforce.
 *
 * Auth, the founder allowlist, the 30/min rate limit and the error shape all
 * come from withFantasyUser — nothing here reinvents that.
 */
import { NextRequest } from "next/server";
import { withFantasyUser } from "../_lib";
import { HttpError } from "@/lib/fantasy/server";
import { buildRulesDoc } from "@/lib/fantasy/rulesFaq";

export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_QUESTION = 300;

const SYSTEM = (doc: string) => `You answer questions about YourScore Fantasy Football's rules, and nothing else.

THE RULES DOCUMENT — the only football knowledge you have:
${doc}

STRICT RULES
- Answer only from the document above. You know nothing else about football, and your training knowledge is out of date, so never use it.
- If the answer is not in the document, or the question is not about YourScore fantasy rules, say plainly that you can only help with the fantasy rules here.
- Two to four sentences at most. Plain, friendly tone.
- Never use the word mate. Say friend instead if you need a word like that.
- Never use a dash character of any kind in your reply.`;

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  return withFantasyUser("rules-qa", async () => {
    const raw = body?.question;
    if (typeof raw !== "string") throw new HttpError(400, "question must be a string", "bad-input");
    const question = raw.trim().slice(0, MAX_QUESTION);
    if (!question) throw new HttpError(400, "question is empty", "bad-input");

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { fallback: true };

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          system: SYSTEM(buildRulesDoc()),
          messages: [{ role: "user", content: question }],
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        console.error(`[fantasy rules-qa] http-${res.status}`);
        return { fallback: true };
      }
      const json = (await res.json()) as AnthropicResponse;
      const text = json.content?.find((c) => c.type === "text")?.text?.trim();
      if (!text) {
        console.error("[fantasy rules-qa] no text block in response");
        return { fallback: true };
      }
      // The prompt bans dashes but the model still slips on compound words
      // ("mid-week") — the house zero-dash rule is absolute, so enforce it
      // here rather than trusting instruction following.
      const answer = text
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/([A-Za-z])-([A-Za-z])/g, "$1 $2");
      return { answer };
    } catch (e) {
      console.error("[fantasy rules-qa] exception", e);
      return { fallback: true };
    }
  });
}
