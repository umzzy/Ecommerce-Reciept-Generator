const crypto = require("crypto");

const {
  publicBaseUrl,
  port,
  nodeEnv,
  receiptSignedUrlTtlSec,
  receiptDownloadSecret,
} = require("../config/keys");

const DEFAULT_TTL_SEC = 15 * 60;

const timingSafeEqualHex = (aHex, bHex) => {
  if (typeof aHex !== "string" || typeof bHex !== "string") return false;
  if (aHex.length !== bHex.length) return false;
  const aBuf = Buffer.from(aHex, "hex");
  const bBuf = Buffer.from(bHex, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const resolvePublicBaseUrl = () => {
  if (publicBaseUrl && typeof publicBaseUrl === "string") {
    return publicBaseUrl.replace(/\/+$/, "");
  }
  if (nodeEnv === "production") return "";
  const resolvedPort = port || 4000;
  return `http://localhost:${resolvedPort}`;
};

const getReceiptSignedUrlTtlSec = () => {
  const value = Number(receiptSignedUrlTtlSec);
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_TTL_SEC;
};

const computeSignatureHex = ({ receiptId, expiresAtSec }) => {
  const secret = receiptDownloadSecret;
  if (!secret) {
    const err = new Error("Receipt download secret is not configured");
    err.code = "RECEIPT_DOWNLOAD_SECRET_NOT_CONFIGURED";
    throw err;
  }

  const payload = `${receiptId}.${expiresAtSec}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
};

const createReceiptDownloadToken = ({ receiptId, expiresAtSec }) => {
  if (!receiptId) throw new Error("receiptId is required");
  if (!Number.isFinite(expiresAtSec)) throw new Error("expiresAtSec is required");
  const signature = computeSignatureHex({ receiptId, expiresAtSec });
  return `${expiresAtSec}.${signature}`;
};

const verifyReceiptDownloadToken = ({ receiptId, token, nowSec }) => {
  if (!receiptId) return { valid: false, reason: "missing_receipt_id" };
  if (typeof token !== "string" || token.trim().length === 0) {
    return { valid: false, reason: "missing_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "invalid_token_format" };

  const expiresAtSec = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(expiresAtSec)) {
    return { valid: false, reason: "invalid_exp" };
  }

  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  if (expiresAtSec <= now) return { valid: false, reason: "expired", expiresAtSec };

  let expected;
  try {
    expected = computeSignatureHex({ receiptId, expiresAtSec });
  } catch (err) {
    return { valid: false, reason: err?.code || "secret_not_configured" };
  }

  const provided = parts[1];
  if (!timingSafeEqualHex(expected, provided)) {
    return { valid: false, reason: "invalid_signature", expiresAtSec };
  }

  return { valid: true, expiresAtSec };
};

const buildReceiptDownloadUrl = ({ receiptId, token, baseUrl }) => {
  const resolvedBase = (baseUrl ?? resolvePublicBaseUrl()) || "";
  if (!resolvedBase) return null;
  const base = resolvedBase.replace(/\/+$/, "");

  const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${base}/api/receipts/${encodeURIComponent(receiptId)}/download${tokenSuffix}`;
};

const buildSignedReceiptDownloadUrl = ({ receiptId, baseUrl, ttlSec }) => {
  const resolvedTtl = Number.isFinite(Number(ttlSec))
    ? Number(ttlSec)
    : getReceiptSignedUrlTtlSec();
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAtSec = nowSec + resolvedTtl;
  const token = createReceiptDownloadToken({ receiptId, expiresAtSec });
  const url = buildReceiptDownloadUrl({ receiptId, token, baseUrl });
  return { url, token, expiresAtSec, ttlSec: resolvedTtl };
};

module.exports = {
  resolvePublicBaseUrl,
  getReceiptSignedUrlTtlSec,
  createReceiptDownloadToken,
  verifyReceiptDownloadToken,
  buildReceiptDownloadUrl,
  buildSignedReceiptDownloadUrl,
};

