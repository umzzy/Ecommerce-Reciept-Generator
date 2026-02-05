const nodemailer = require("nodemailer");
const fs = require("fs/promises");
const path = require("path");

const { smtp, serviceName, resendApiKey, resendFrom } = require("../config/keys");
const { isResendConfigured, sendResendEmail } = require("./resendmailer");

const isSmtpConfigured = () =>
  Boolean(
    smtp?.host && smtp?.port && smtp?.user && smtp?.pass,
  );

let transporter = null;
let transportMode = null;

const MAX_PDF_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatAmount = (amount, currency) => {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const rounded = safe.toFixed(2);
  return currency ? `${currency} ${rounded}` : rounded;
};

const readLocalPdf = async (relativePath) => {
  const safePath = String(relativePath || "").replace(/^\/+/, "");
  if (!safePath.startsWith("logs/receipts/") || !safePath.endsWith(".pdf")) {
    throw new Error("Invalid local PDF path");
  }
  const absolutePath = path.join(process.cwd(), ...safePath.split("/"));
  return fs.readFile(absolutePath);
};

const fetchPdfBuffer = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch PDF (status ${res.status})`);
    }

    const contentLengthHeader = res.headers.get("content-length");
    const contentLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_PDF_ATTACHMENT_BYTES) {
      throw new Error("PDF is too large to attach");
    }

    const data = await res.arrayBuffer();
    if (data.byteLength > MAX_PDF_ATTACHMENT_BYTES) {
      throw new Error("PDF is too large to attach");
    }
    return Buffer.from(data);
  } finally {
    clearTimeout(timeout);
  }
};

const resolvePdfAttachment = async ({ pdfBuffer, pdfUrl }) => {
  if (Buffer.isBuffer(pdfBuffer)) return pdfBuffer;
  if (!pdfUrl || typeof pdfUrl !== "string") return null;

  if (pdfUrl.startsWith("logs/receipts/")) {
    return readLocalPdf(pdfUrl);
  }

  if (/^https?:\/\//i.test(pdfUrl)) {
    return fetchPdfBuffer(pdfUrl);
  }

  return null;
};

const ensureTransporter = () => {
  if (transporter) return transporter;

  if (isSmtpConfigured()) {
    const portNumber = Number(smtp.port);
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: portNumber,
      secure: portNumber === 465,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    transportMode = "smtp";
    return transporter;
  }

  const err = new Error(
    "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally MAIL_FROM).",
  );
  err.code = "SMTP_NOT_CONFIGURED";
  throw err;
};

const sendReceiptEmail = async ({
  to,
  receiptId,
  customerName,
  storeName,
  storeAddress,
  storePhone,
  orderId,
  paymentReference,
  total,
  currency,
  items,
  pdfBuffer,
  pdfUrl,
  downloadUrl,
}) => {
  if (!to) throw new Error("Email recipient (to) is required");
  if (!receiptId) throw new Error("receiptId is required");

  const resolvedStoreName =
    storeName || (serviceName ? String(serviceName) : "E-commerce Store");

  const resolvedCurrency = currency ? String(currency) : "";
  const totalLine = total != null ? formatAmount(total, resolvedCurrency) : "";

  const subject = `Your receipt from ${resolvedStoreName} (${receiptId})`;
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";

  const resolvedLink = downloadUrl || pdfUrl || "";

  let resolvedPdfBuffer = null;
  try {
    resolvedPdfBuffer = await resolvePdfAttachment({ pdfBuffer, pdfUrl });
  } catch {
    resolvedPdfBuffer = null;
  }

  if (
    !Buffer.isBuffer(resolvedPdfBuffer) &&
    downloadUrl &&
    typeof downloadUrl === "string" &&
    downloadUrl !== pdfUrl
  ) {
    try {
      resolvedPdfBuffer = await resolvePdfAttachment({ pdfUrl: downloadUrl });
    } catch {
      resolvedPdfBuffer = null;
    }
  }

  if (!Buffer.isBuffer(resolvedPdfBuffer)) {
    throw new Error("Unable to load receipt PDF to attach");
  }

  const text = [
    greeting,
    "",
    "Thanks for your purchase. Your receipt is attached.",
    orderId ? `Order ID: ${orderId}` : "",
    paymentReference ? `Payment Reference: ${paymentReference}` : "",
    totalLine ? `Total: ${totalLine}` : "",
    resolvedLink ? `Download link: ${resolvedLink}` : "",
    "",
    "—",
    resolvedStoreName,
  ]
    .filter(Boolean)
    .join("\n");

  const attachments = [];
  attachments.push({
    filename: `${receiptId}.pdf`,
    content: resolvedPdfBuffer,
    contentType: "application/pdf",
  });

  const smtpFromEmail =
    (isSmtpConfigured() && (smtp?.mailFrom || smtp?.user)) ||
    `no-reply@${resolvedStoreName.replace(/\s+/g, "").toLowerCase()}.local`;
  const smtpFrom = smtpFromEmail.includes("<")
    ? smtpFromEmail
    : `${resolvedStoreName} <${smtpFromEmail}>`;

  const useResend = isResendConfigured(resendApiKey);
  let resendFromHeader = null;
  if (useResend) {
    const resendFromEmail = String(resendFrom || smtp?.mailFrom || smtp?.user || "").trim();
    if (!resendFromEmail) {
      const err = new Error(
        "Resend is enabled but sender email is missing. Set RESEND_FROM or MAIL_FROM.",
      );
      err.code = "RESEND_FROM_MISSING";
      throw err;
    }
    resendFromHeader = resendFromEmail.includes("<")
      ? resendFromEmail
      : `${resolvedStoreName} <${resendFromEmail}>`;
  }

  const safeStoreName = escapeHtml(resolvedStoreName);
  const safeCustomerName = escapeHtml(customerName || "");
  const safeReceiptId = escapeHtml(receiptId);
  const safeOrderId = escapeHtml(orderId || "");
  const safePaymentReference = escapeHtml(paymentReference || "");
  const safeTotalLine = escapeHtml(totalLine || "");
  const safeStoreAddress = escapeHtml(storeAddress || "");
  const safeStorePhone = escapeHtml(storePhone || "");

  const normalizedItems = Array.isArray(items) ? items.slice(0, 20) : [];
  const itemsRows = normalizedItems
    .map((item) => {
      const name = escapeHtml(item?.name || "");
      const qty = Number(item?.quantity) || 0;
      const price = Number(item?.price) || 0;
      const lineTotal = qty * price;
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eef0f4;">${name}</td>
          <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:right;">${qty}</td>
          <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:right;">${escapeHtml(formatAmount(price, resolvedCurrency))}</td>
          <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:right;">${escapeHtml(formatAmount(lineTotal, resolvedCurrency))}</td>
        </tr>
      `;
    })
    .join("");

  const downloadCta = resolvedLink
    ? `
      <p style="margin:16px 0 0;color:#374151;font-size:14px;line-height:1.6;">
        You can also download it here:
      </p>
      <p style="margin:12px 0 0;">
        <a href="${escapeHtml(resolvedLink)}"
           style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:600;">
          Download receipt
        </a>
      </p>
      <p style="margin:10px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">
        If the button doesn't work, copy and paste this link:<br/>
        <span style="word-break:break-all;">${escapeHtml(resolvedLink)}</span>
      </p>
    `
    : "";

  const introLine = safeCustomerName
    ? `Hi ${safeCustomerName},`
    : "Hi,";

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:22px 24px;background:#111827;color:#ffffff;">
                <div style="font-size:16px;font-weight:700;letter-spacing:0.2px;">${safeStoreName}</div>
                <div style="font-size:12px;opacity:0.9;margin-top:6px;">Receipt ${safeReceiptId}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 24px;">
                <p style="margin:0;color:#111827;font-size:15px;line-height:1.6;">${introLine}</p>
                <p style="margin:10px 0 0;color:#374151;font-size:14px;line-height:1.6;">
                  Thanks for your purchase. Your receipt is attached to this email.
                </p>

                <div style="margin:18px 0 0;padding:14px 16px;background:#f9fafb;border:1px solid #eef0f4;border-radius:12px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#111827;">
                    ${safeOrderId ? `<tr><td style="padding:4px 0;color:#6b7280;">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:600;">${safeOrderId}</td></tr>` : ""}
                    ${safePaymentReference ? `<tr><td style="padding:4px 0;color:#6b7280;">Payment Ref</td><td style="padding:4px 0;text-align:right;font-weight:600;">${safePaymentReference}</td></tr>` : ""}
                    ${safeTotalLine ? `<tr><td style="padding:4px 0;color:#6b7280;">Total</td><td style="padding:4px 0;text-align:right;font-weight:700;">${safeTotalLine}</td></tr>` : ""}
                  </table>
                </div>

                ${itemsRows ? `
                  <h3 style="margin:18px 0 10px;font-size:14px;color:#111827;">Items</h3>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#111827;border:1px solid #eef0f4;border-radius:12px;overflow:hidden;">
                    <thead>
                      <tr style="background:#f9fafb;">
                        <th style="padding:10px;text-align:left;border-bottom:1px solid #eef0f4;">Item</th>
                        <th style="padding:10px;text-align:right;border-bottom:1px solid #eef0f4;">Qty</th>
                        <th style="padding:10px;text-align:right;border-bottom:1px solid #eef0f4;">Price</th>
                        <th style="padding:10px;text-align:right;border-bottom:1px solid #eef0f4;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsRows}
                    </tbody>
                  </table>
                ` : ""}

                ${downloadCta}

                <p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">
                  Need help? Reply to this email.
                </p>
              </td>
            </tr>
            ${(safeStoreAddress || safeStorePhone) ? `
              <tr>
                <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #eef0f4;color:#6b7280;font-size:12px;line-height:1.6;">
                  ${safeStoreAddress ? `<div>${safeStoreAddress}</div>` : ""}
                  ${safeStorePhone ? `<div>${safeStorePhone}</div>` : ""}
                </td>
              </tr>
            ` : ""}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const mail = {
    from: smtpFrom,
    to,
    subject,
    text,
    html,
    attachments,
  };

  if (useResend) {
    const resendMail = {
      from: resendFromHeader,
      to,
      subject,
      text,
      html,
      attachments: [
        {
          filename: `${receiptId}.pdf`,
          content: resolvedPdfBuffer.toString("base64"),
          content_type: "application/pdf",
        },
      ],
    };

    const info = await sendResendEmail({ apiKey: resendApiKey, mail: resendMail });
    return {
      delivered: true,
      mode: "resend",
      messageId: info?.id || null,
    };
  }

  const transport = ensureTransporter();
  const info = await transport.sendMail(mail);

  return {
    delivered: true,
    mode: transportMode || "smtp",
    messageId: info.messageId || null,
  };
};

module.exports = {
  isSmtpConfigured,
  sendReceiptEmail,
};
