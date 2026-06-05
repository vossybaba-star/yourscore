import { FROM, REPLY_TO, getResend } from "./client";
import { buildFooterUrls, renderEmail } from "./render";

/**
 * Send the welcome email (lifecycle 01).
 * Fire-and-forget — never throws to the caller. Logs failures.
 */
export async function sendWelcomeEmail(args: { userId: string; email: string }) {
  try {
    const html = await renderEmail("01-welcome", {
      ...buildFooterUrls(args.userId, "all"),
    });

    await getResend().emails.send({
      from: FROM,
      to: args.email,
      replyTo: REPLY_TO,
      subject: "You're in. Now let's see what you actually know.",
      html,
      headers: {
        "X-Entity-Ref-ID": `welcome-${args.userId}`,
      },
      tags: [
        { name: "category", value: "lifecycle" },
        { name: "template", value: "01-welcome" },
      ],
    });
  } catch (err) {
    console.error("[email] sendWelcomeEmail failed:", err);
  }
}
