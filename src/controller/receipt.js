const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const { nodeEnv, receiptDownloadSecret } = require("../config/keys");
const Receipt = require("../models/receipt");
const Webhook = require("../models/webhook");
const { sendReceiptEmail } = require("../utils/mailer");
const {
  isCloudinaryConfigured,
  getSignedPdfDownloadUrl,
} = require("../utils/cloudinary");
const {
  buildSignedReceiptDownloadUrl,
  verifyReceiptDownloadToken,
} = require("../utils/receiptDownload");

const getReceiptByReceiptId = async (req, res, next) => {
  try {
    const receiptId = String(req.params.receiptId || "").trim();
    if (!receiptId) {
      res.code = 400;
      throw new Error("receiptId is required");
    }

    const receipt = await Receipt.findOne({ receiptId }).populate("orderId");
    if (!receipt) {
      res.code = 404;
      throw new Error("Receipt not found");
    }

    res.status(200).json({
      code: 200,
      status: true,
      message: "Receipt fetched",
      data: { receipt },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listReceipts: async (req, res, next) => {
    try {
      const emailedTo = req.query.email ? String(req.query.email).trim() : "";
      const pageRaw = req.query.page ? String(req.query.page).trim() : "1";
      const limitRaw = req.query.limit ? String(req.query.limit).trim() : "20";

      const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(limitRaw, 10) || 20),
      );
      const skip = (page - 1) * limit;

      const filter = {};
      if (emailedTo) filter.emailedTo = emailedTo;

      const [receipts, total] = await Promise.all([
        Receipt.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Receipt.countDocuments(filter),
      ]);

      res.status(200).json({
        code: 200,
        status: true,
        message: "Receipts fetched",
        data: {
          page,
          limit,
          total,
          receipts,
        },
      });
    } catch (err) {
      next(err);
    }
  },
  getReceiptByReceiptId,
  getSignedReceiptDownloadUrl: async (req, res, next) => {
    try {
      const receiptId = String(req.params.receiptId || "").trim();
      if (!receiptId) {
        res.code = 400;
        throw new Error("receiptId is required");
      }

      const receipt = await Receipt.findOne({ receiptId }).lean();
      if (!receipt) {
        res.code = 404;
        throw new Error("Receipt not found");
      }

      if (receipt.uploadStatus !== "Uploaded" || !receipt.pdfCloudUrl) {
        res.code = 409;
        throw new Error("Receipt PDF is not ready yet");
      }

      const isCloudinary =
        isCloudinaryConfigured() && receipt.pdfCloudinaryPublicId;

      const signed = isCloudinary
        ? getSignedPdfDownloadUrl({
            publicId: receipt.pdfCloudinaryPublicId,
            attachment: true,
          })
        : buildSignedReceiptDownloadUrl({ receiptId });

      if (!signed?.url) {
        res.code = 409;
        throw new Error("Unable to generate a signed download link");
      }

      res.status(200).json({
        code: 200,
        status: true,
        message: "Signed download URL generated",
        data: {
          receiptId,
          url: signed.url,
          expiresAtSec: signed.expiresAtSec,
          ttlSec: signed.ttlSec,
        },
      });
    } catch (err) {
      next(err);
    }
  },
  downloadReceiptPdf: async (req, res, next) => {
    try {
      const receiptId = String(req.params.receiptId || "").trim();
      if (!receiptId) {
        res.code = 400;
        throw new Error("receiptId is required");
      }

      const receipt = await Receipt.findOne({ receiptId }).lean();
      if (!receipt) {
        res.code = 404;
        throw new Error("Receipt not found");
      }

      if (receipt.uploadStatus !== "Uploaded" || !receipt.pdfCloudUrl) {
        res.code = 409;
        throw new Error("Receipt PDF is not ready yet");
      }

      const isAdmin = req.isAdmin === true;
      if (!isAdmin) {
        if (receiptDownloadSecret && nodeEnv === "production") {
          const token = req.query.token ? String(req.query.token).trim() : "";
          const verified = verifyReceiptDownloadToken({ receiptId, token });
          if (!verified.valid) {
            res.code = 401;
            throw new Error("Invalid or expired download token");
          }
        } else {
          const token = req.query.token ? String(req.query.token).trim() : "";
          if (token) {
            const verified = verifyReceiptDownloadToken({ receiptId, token });
            if (!verified.valid) {
              res.code = 401;
              throw new Error("Invalid or expired download token");
            }
          }
        }
      }

      const inline = String(req.query.inline || "") === "1";
      const disposition = inline ? "inline" : "attachment";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename=\"${receiptId}.pdf\"`,
      );

      const pdfUrl = receipt.pdfCloudUrl;

      if (isCloudinaryConfigured() && receipt.pdfCloudinaryPublicId) {
        const signed = getSignedPdfDownloadUrl({
          publicId: receipt.pdfCloudinaryPublicId,
          attachment: !inline,
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const upstream = await fetch(signed.url, {
            signal: controller.signal,
          });
          if (!upstream.ok || !upstream.body) {
            res.code = 502;
            throw new Error(
              `Failed to fetch receipt PDF (status ${upstream.status})`,
            );
          }
          Readable.fromWeb(upstream.body).pipe(res);
          return;
        } finally {
          clearTimeout(timeout);
        }
      }

      if (typeof pdfUrl === "string" && pdfUrl.startsWith("logs/receipts/")) {
        const absolutePath = path.join(process.cwd(), ...pdfUrl.split("/"));
        const stream = fs.createReadStream(absolutePath);
        stream.on("error", next);
        stream.pipe(res);
        return;
      }

      if (typeof pdfUrl === "string" && /^https?:\/\//i.test(pdfUrl)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const upstream = await fetch(pdfUrl, { signal: controller.signal });
          if (!upstream.ok || !upstream.body) {
            res.code = 502;
            throw new Error(
              `Failed to fetch receipt PDF (status ${upstream.status})`,
            );
          }
          Readable.fromWeb(upstream.body).pipe(res);
          return;
        } finally {
          clearTimeout(timeout);
        }
      }

      res.code = 409;
      throw new Error("Receipt PDF URL is invalid");
    } catch (err) {
      next(err);
    }
  },
  retryReceiptEmail: async (req, res, next) => {
    try {
      const receiptId = String(req.params.receiptId || "").trim();
      if (!receiptId) {
        res.code = 400;
        throw new Error("receiptId is required");
      }

      const receipt = await Receipt.findOne({ receiptId }).populate("orderId");
      if (!receipt) {
        res.code = 404;
        throw new Error("Receipt not found");
      }

      if (receipt.uploadStatus !== "Uploaded" || !receipt.pdfCloudUrl) {
        res.code = 409;
        throw new Error("Receipt PDF is not ready yet");
      }

      const to = receipt.emailedTo;
      if (!to) {
        res.code = 409;
        throw new Error("Receipt has no emailedTo address");
      }

      const pdfUrl = receipt.pdfCloudUrl;
      let downloadUrl = pdfUrl;
      if (isCloudinaryConfigured() && receipt.pdfCloudinaryPublicId) {
        try {
          const signed = getSignedPdfDownloadUrl({
            publicId: receipt.pdfCloudinaryPublicId,
            attachment: true,
          });
          downloadUrl = signed.url;
        } catch {}
      } else {
        try {
          const signed = buildSignedReceiptDownloadUrl({
            receiptId: receipt.receiptId,
          });
          if (signed?.url) downloadUrl = signed.url;
        } catch {}
      }

      let currency;
      try {
        const webhookEvent = await Webhook.findOne({
          "payload.payment.reference": receipt.paymentReference,
        }).lean();
        currency = webhookEvent?.payload?.payment?.currency;
      } catch {
        currency = undefined;
      }

      const order = receipt.orderId;
      const email = await sendReceiptEmail({
        to,
        receiptId: receipt.receiptId,
        customerName: order?.customerName,
        storeName: order?.storeName,
        storeAddress: order?.storeAddress,
        storePhone: order?.storePhone,
        orderId: order?._id ? String(order._id) : undefined,
        paymentReference: receipt.paymentReference,
        total: order?.totalPrice,
        currency,
        items: Array.isArray(order?.orderItems) ? order.orderItems : undefined,
        pdfUrl,
        downloadUrl,
      });

      await Receipt.updateOne(
        { _id: receipt._id },
        {
          $set: { emailStatus: "Sent", emailSentAt: new Date() },
          $unset: { lastError: 1 },
        },
      );

      res.status(200).json({
        code: 200,
        status: true,
        message: "Receipt email sent",
        data: {
          receiptId: receipt.receiptId,
          emailedTo: to,
          email,
        },
      });
    } catch (err) {
      try {
        const receiptId = String(req.params.receiptId || "").trim();
        if (receiptId) {
          await Receipt.updateOne(
            { receiptId },
            {
              $set: {
                emailStatus: "Failed",
                lastError: err?.message || "Email failed",
              },
            },
          );
        }
      } catch {}
      next(err);
    }
  },
};
