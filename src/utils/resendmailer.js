const RESEND_API_URL = "https://api.resend.com/emails";

const isResendConfigured = (apiKey) =>
  typeof apiKey === "string" && apiKey.trim().length > 0;

const readResendErrorMessage = async (res) => {
  try {
    const data = await res.json();
    if (data && typeof data === "object") {
      if (typeof data.message === "string" && data.message.trim()) {
        return data.message.trim();
      }
      if (typeof data.error === "string" && data.error.trim()) {
        return data.error.trim();
      }
      if (data.error && typeof data.error.message === "string") {
        return data.error.message.trim();
      }
    }
  } catch {}

  try {
    const text = await res.text();
    if (text && text.trim()) return text.trim().slice(0, 2000);
  } catch {}

  return "";
};

const sendResendEmail = async ({ apiKey, mail }) => {
  if (!isResendConfigured(apiKey)) {
    const err = new Error("RESEND_API_KEY is not configured");
    err.code = "RESEND_NOT_CONFIGURED";
    throw err;
  }
  if (!mail || typeof mail !== "object") {
    throw new Error("sendResendEmail expects a mail object");
  }
  if (!mail.from) throw new Error("Resend mail.from is required");
  if (!mail.to) throw new Error("Resend mail.to is required");
  if (!mail.subject) throw new Error("Resend mail.subject is required");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(mail),
      signal: controller.signal,
    });

    if (!res.ok) {
      const message = await readResendErrorMessage(res);
      const err = new Error(
        message
          ? `Resend API error (${res.status}): ${message}`
          : `Resend API error (${res.status})`,
      );
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  isResendConfigured,
  sendResendEmail,
};
