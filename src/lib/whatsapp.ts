/* eslint-disable @typescript-eslint/no-unused-vars */
const API_VERSION = "v25.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export interface QuestionNotificationPayload {
  roomName: string;
  questionText: string;
  durationSeconds: number;
  roomUrl: string;
}

// Sends a template message. Using hello_world for dev — swap to custom
// yourscore_question_alert template once approved in WhatsApp Manager.
export async function sendQuestionAlert(
  toNumber: string,
  payload: QuestionNotificationPayload
): Promise<{ success: boolean; error?: string; raw?: unknown }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_BUSINESS_PHONE_ID;

  if (!token || !phoneNumberId) {
    return { success: false, error: "WhatsApp env vars not set" };
  }

  const normalised = normaliseNumber(toNumber);
  if (!isValidE164(normalised)) {
    return { success: false, error: "Invalid phone number" };
  }

  // DEV: hello_world template (no params, just confirms delivery pipeline).
  // PROD: replace "hello_world"/"en_US" with your approved template name/lang
  // and add a `components` array with your question text + link as variables.
  const body = {
    messaging_product: "whatsapp",
    to: normalised,
    type: "template",
    template: {
      name: "hello_world",
      language: { code: "en_US" },
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      // Log the full Graph API error server-side; return a generic message so
      // we don't leak Meta trace IDs / account context to the caller.
      console.error("WhatsApp send failed", { status: res.status, data });
      return { success: false, error: "Failed to send WhatsApp message" };
    }

    return { success: true };
  } catch (err) {
    console.error("WhatsApp send threw", err);
    return { success: false, error: "Failed to send WhatsApp message" };
  }
}

// Once your custom template is approved, use this instead:
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendQuestionAlertTemplate(
  toNumber: string,
  payload: QuestionNotificationPayload // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<{ success: boolean; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_BUSINESS_PHONE_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? "yourscore_question_alert";

  if (!token || !phoneNumberId) return { success: false, error: "WhatsApp env vars not set" };

  const normalised = normaliseNumber(toNumber);
  if (!isValidE164(normalised)) return { success: false, error: "Invalid phone number" };

  const body = {
    messaging_product: "whatsapp",
    to: normalised,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en_GB" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: payload.roomName },
            { type: "text", text: payload.questionText },
            { type: "text", text: String(payload.durationSeconds) },
            { type: "text", text: payload.roomUrl },
          ],
        },
      ],
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp template send failed", { status: res.status, data });
      return { success: false, error: "Failed to send WhatsApp message" };
    }
    return { success: true };
  } catch (err) {
    console.error("WhatsApp template send threw", err);
    return { success: false, error: "Failed to send WhatsApp message" };
  }
}

function normaliseNumber(raw: string): string {
  let n = raw.replace(/[\s\-().+]/g, "");
  if (n.startsWith("07") && n.length === 11) n = "44" + n.slice(1);
  return n;
}

// E.164: country code (no leading zero) + subscriber number, 8–15 digits total.
function isValidE164(n: string): boolean {
  return /^[1-9]\d{7,14}$/.test(n);
}
