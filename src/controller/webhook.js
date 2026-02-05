const crypto = require("crypto");

const { webhookSecret } = require("../config/keys");
const logger = require("../utils/logger");
const Order = require("../models/order");
const Receipt = require("../models/receipt");
const Webhook = require("../models/webhook");
const { enqueueReceiptGeneration } = require("../queues/receipt");

const SIGNATURE_TOLERANCE_SEC = 5 * 60;

const parseSignatureHeader = (headerValue) => {
  if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
    return null;
  }
  const parts = headerValue
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const parsed = {};
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) continue;
    if (parsed[key] == null) parsed[key] = [];
    parsed[key].push(value);
  }

  const timestampRaw = parsed.t?.[0];
  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) return null;

  const signatures = parsed.v1 ?? [];
  return { timestamp, signatures };
};

const timingSafeEqualHex = (aHex, bHex) => {
  if (typeof aHex !== "string" || typeof bHex !== "string") return false;
  if (aHex.length !== bHex.length) return false;
  const aBuf = Buffer.from(aHex, "hex");
  const bBuf = Buffer.from(bHex, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const computeSignatureHex = ({ secret, timestamp, rawBody }) => {
  const payload = `${timestamp}.${rawBody}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
};

const verifyWebhookSignature = (req) => {
  if (!webhookSecret) {
    logger.warn("WEBHOOK_SECRET is not set; skipping signature verification");
    return { verified: true, skipped: true };
  }

  const signatureHeader = req.headers["x-webhook-signature"];
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || parsed.signatures.length === 0) {
    const error = new Error("Missing or invalid x-webhook-signature header");
    error.statusCode = 401;
    throw error;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > SIGNATURE_TOLERANCE_SEC) {
    const error = new Error("Webhook signature timestamp is outside tolerance");
    error.statusCode = 401;
    throw error;
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString("utf8")
    : JSON.stringify(req.body ?? {});

  const expected = computeSignatureHex({
    secret: webhookSecret,
    timestamp: parsed.timestamp,
    rawBody,
  });

  const ok = parsed.signatures.some((sig) => timingSafeEqualHex(expected, sig));
  if (!ok) {
    const error = new Error("Invalid webhook signature");
    error.statusCode = 401;
    throw error;
  }

  return { verified: true, skipped: false, timestamp: parsed.timestamp };
};

const isDuplicateKeyError = (err) =>
  err?.code === 11000 ||
  (typeof err?.message === "string" && err.message.includes("E11000"));

const receivePaymentWebhook = async (req, res, next) => {
  try {
    const verification = verifyWebhookSignature(req);

    const eventIdHeader = req.headers["x-webhook-id"];
    if (eventIdHeader && String(eventIdHeader) !== String(req.body.eventId)) {
      res.code = 400;
      throw new Error("x-webhook-id does not match payload eventId");
    }

    const { eventId, eventType, payment, order, customer, store } = req.body;
    const orderStatus =
      eventType === "order.failed" ? "Cancelled" : "Completed";

    const rawPayload = req.body;
    const claimedAt = new Date();

    let webhookEvent = await Webhook.findOneAndUpdate(
      { eventId, status: { $nin: ["PROCESSING", "COMPLETED"] } },
      {
        $set: {
          eventType,
          payload: rawPayload,
          status: "PROCESSING",
          processedAt: claimedAt,
        },
      },
      { new: true },
    );

    if (!webhookEvent) {
      const existing = await Webhook.findOne({ eventId }).lean();
      if (existing) {
        if (existing.status === "COMPLETED") {
          return res.status(200).json({
            code: 200,
            status: true,
            message: "Duplicate webhook ignored",
            data: {
              duplicate: true,
              webhook: {
                eventId,
                eventType: existing.eventType,
                status: existing.status,
              },
            },
          });
        }

        if (existing.status === "PROCESSING") {
          return res.status(202).json({
            code: 202,
            status: true,
            message: "Webhook already processing",
            data: {
              duplicate: true,
              webhook: {
                eventId,
                eventType: existing.eventType,
                status: existing.status,
              },
            },
          });
        }

        res.code = 409;
        throw new Error("Webhook event is in an unexpected state");
      }

      try {
        webhookEvent = await Webhook.create({
          eventId,
          eventType,
          payload: rawPayload,
          status: "PROCESSING",
          processedAt: claimedAt,
        });
      } catch (createErr) {
        if (isDuplicateKeyError(createErr)) {
          const after = await Webhook.findOne({ eventId }).lean();
          if (after?.status === "COMPLETED") {
            return res.status(200).json({
              code: 200,
              status: true,
              message: "Duplicate webhook ignored",
              data: {
                duplicate: true,
                webhook: {
                  eventId,
                  eventType: after.eventType,
                  status: after.status,
                },
              },
            });
          }
          if (after?.status === "PROCESSING") {
            return res.status(202).json({
              code: 202,
              status: true,
              message: "Webhook already processing",
              data: {
                duplicate: true,
                webhook: {
                  eventId,
                  eventType: after.eventType,
                  status: after.status,
                },
              },
            });
          }
        }
        throw createErr;
      }
    }

    const orderUpdate = {
      customerName: customer.name,
      customerEmail: customer.email,
      orderItems: order.items,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      totalPrice: order.totalPrice,
      paymentMethod: payment.method,
      status: orderStatus,
      storeName: store.name,
      storeAddress: store.address,
      storePhone: store.phone,
    };

    const persistedOrder = await Order.findOneAndUpdate(
      { _id: order.id },
      { $set: orderUpdate },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    );

    let receipt = null;
    let job = null;

    if (eventType === "payment failed") {
      await Webhook.updateOne(
        { _id: webhookEvent._id },
        { $set: { status: "COMPLETED", processedAt: new Date() } },
      );
    } else {
      const newReceiptId = `rcpt_${crypto.randomUUID()}`;
      receipt = await Receipt.findOneAndUpdate(
        { paymentReference: payment.reference },
        {
          $setOnInsert: {
            receiptId: newReceiptId,
            paymentReference: payment.reference,
            uploadStatus: "Pending",
            emailStatus: "Pending",
          },
          $set: {
            orderId: persistedOrder._id,
            emailedTo: customer.email,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        },
      );

      job = await enqueueReceiptGeneration({ eventId });
    }

    logger.info(
      {
        eventId,
        eventType,
        orderId: String(persistedOrder._id),
        verified: verification.verified,
        signatureSkipped: verification.skipped,
        receiptId: receipt?.receiptId,
        job,
      },
      "Webhook received",
    );

    res.status(200).json({
      code: 200,
      status: true,
      message:
        eventType === "payment failed"
          ? "Webhook received"
          : "Webhook received; receipt generation queued",
      data: {
        webhook: {
          id: webhookEvent._id,
          eventId: webhookEvent.eventId,
          eventType: webhookEvent.eventType,
          status: eventType === "payment failed" ? "COMPLETED" : "PROCESSING",
        },
        order: persistedOrder,
        receipt: receipt
          ? {
              receiptId: receipt.receiptId,
              uploadStatus: receipt.uploadStatus,
              pdfCloudUrl: receipt.pdfCloudUrl,
              emailStatus: receipt.emailStatus,
              emailedTo: receipt.emailedTo,
            }
          : null,
        job,
      },
    });
  } catch (err) {
    try {
      const eventId = req?.body?.eventId;
      if (eventId) {
        await Webhook.updateOne(
          { eventId },
          { $set: { status: "FAILED", processedAt: new Date() } },
        );
      }
    } catch (updateErr) {
      logger.error({ updateErr }, "Failed to mark webhook as FAILED");
    }

    const statusCode = err?.statusCode;
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
      res.code = statusCode;
    }
    next(err);
  }
};

module.exports = {
  receivePaymentWebhook,
};
