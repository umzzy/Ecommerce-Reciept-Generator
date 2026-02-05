const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const Order = require("../models/order");
const Receipt = require("../models/receipt");
const Webhook = require("../models/webhook");
const { generateReceiptPdfBuffer } = require("../utils/receiptPdf");
const {
  isCloudinaryConfigured,
  uploadPdfBuffer,
  getSignedPdfDownloadUrl,
} = require("../utils/cloudinary");
const { sendReceiptEmail } = require("../utils/mailer");
const { buildSignedReceiptDownloadUrl } = require("../utils/receiptDownload");

const savePdfLocally = async ({ receiptId, buffer }) => {
  const relativePath = path.posix.join("logs", "receipts", `${receiptId}.pdf`);
  const absolutePath = path.join(
    process.cwd(),
    "logs",
    "receipts",
    `${receiptId}.pdf`,
  );
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return { publicId: `local:${receiptId}`, url: relativePath };
};

const processReceiptGeneration = async ({ eventId }) => {
  const webhookEvent = await Webhook.findOne({ eventId });
  if (!webhookEvent) {
    throw new Error("Webhook event not found");
  }

  const payload = webhookEvent.payload;
  if (!payload?.payment?.reference || !payload?.order?.id) {
    throw new Error("Webhook payload is missing required fields");
  }

  const eventType = payload.eventType || webhookEvent.eventType;
  if (eventType === "payment failed") {
    await Webhook.updateOne(
      { eventId },
      { $set: { status: "COMPLETED", processedAt: new Date() } },
    );
    return { skipped: true, reason: "payment failed" };
  }

  const orderUpdate = {
    customerName: payload.customer?.name,
    customerEmail: payload.customer?.email,
    orderItems: payload.order?.items,
    quantity: payload.order?.quantity,
    unitPrice: payload.order?.unitPrice,
    totalPrice: payload.order?.totalPrice,
    paymentMethod: payload.payment?.method,
    status: "Completed",
    storeName: payload.store?.name,
    storeAddress: payload.store?.address,
    storePhone: payload.store?.phone,
  };

  const orderDoc = await Order.findOneAndUpdate(
    { _id: payload.order.id },
    { $set: orderUpdate },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  const paymentReference = payload.payment.reference;
  const newReceiptId = `rcpt_${crypto.randomUUID()}`;

  const receiptDoc = await Receipt.findOneAndUpdate(
    { paymentReference },
    {
      $setOnInsert: {
        receiptId: newReceiptId,
        paymentReference,
        uploadStatus: "Pending",
        emailStatus: "Pending",
      },
      $set: {
        orderId: orderDoc._id,
        emailedTo: payload.customer?.email,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  let pdfBuffer = null;
  let pdfUrl = receiptDoc.pdfCloudUrl || null;
  let cloudinaryPublicId =
    typeof receiptDoc.pdfCloudinaryPublicId === "string"
      ? receiptDoc.pdfCloudinaryPublicId
      : null;

  if (receiptDoc.uploadStatus === "Uploaded" && receiptDoc.pdfCloudUrl) {
    await Webhook.updateOne(
      { eventId },
      { $set: { status: "COMPLETED", processedAt: new Date() } },
    );

    if (typeof receiptDoc.pdfCloudUrl === "string") {
      const isLocal = receiptDoc.pdfCloudUrl.startsWith("logs/receipts/");
      if (isLocal) {
        try {
          const absolutePath = path.join(
            process.cwd(),
            ...receiptDoc.pdfCloudUrl.split("/"),
          );
          pdfBuffer = await fs.readFile(absolutePath);
        } catch {
          pdfBuffer = null;
        }
      }
    }
  } else {
    pdfBuffer = await generateReceiptPdfBuffer({
      receiptId: receiptDoc.receiptId,
      order: orderDoc,
      payment: payload.payment,
      customer: payload.customer,
      store: payload.store,
    });

    let upload;
    if (isCloudinaryConfigured()) {
      upload = await uploadPdfBuffer({
        buffer: pdfBuffer,
        publicId: receiptDoc.receiptId,
        folder: "receipts",
      });
    } else {
      upload = await savePdfLocally({
        receiptId: receiptDoc.receiptId,
        buffer: pdfBuffer,
      });
    }

    pdfUrl = upload.url;
    cloudinaryPublicId = upload.publicId || cloudinaryPublicId;

    await Receipt.updateOne(
      { _id: receiptDoc._id },
      {
        $set: {
          pdfCloudinaryPublicId: upload.publicId,
          pdfCloudUrl: upload.url,
          uploadStatus: "Uploaded",
          uploadCompletedAt: new Date(),
        },
        $unset: { lastError: 1 },
      },
    );

    await Webhook.updateOne(
      { eventId },
      { $set: { status: "COMPLETED", processedAt: new Date() } },
    );
  }

  let resolvedDownloadUrl = pdfUrl;
  if (isCloudinaryConfigured() && cloudinaryPublicId) {
    try {
      const signed = getSignedPdfDownloadUrl({
        publicId: cloudinaryPublicId,
        attachment: true,
      });
      resolvedDownloadUrl = signed.url;
    } catch {}
  } else {
    try {
      const signed = buildSignedReceiptDownloadUrl({
        receiptId: receiptDoc.receiptId,
      });
      if (signed?.url) resolvedDownloadUrl = signed.url;
    } catch {}
  }

  let email = null;
  try {
    if (receiptDoc.emailStatus === "Sent") {
      email = { skipped: true, reason: "already sent" };
    } else {
      email = await sendReceiptEmail({
        to: receiptDoc.emailedTo || payload.customer?.email,
        receiptId: receiptDoc.receiptId,
        customerName: payload.customer?.name,
        storeName: payload.store?.name,
        storeAddress: payload.store?.address,
        storePhone: payload.store?.phone,
        orderId: String(orderDoc._id),
        paymentReference,
        total: payload.payment?.amount,
        currency: payload.payment?.currency,
        items: Array.isArray(orderDoc.orderItems)
          ? orderDoc.orderItems
          : undefined,
        pdfBuffer,
        pdfUrl,
        downloadUrl: resolvedDownloadUrl,
      });

      if (email.delivered) {
        await Receipt.updateOne(
          { _id: receiptDoc._id },
          {
            $set: { emailStatus: "Sent", emailSentAt: new Date() },
            $unset: { lastError: 1 },
          },
        );
      } else {
        await Receipt.updateOne(
          { _id: receiptDoc._id },
          {
            $set: {
              emailStatus: "Failed",
              lastError: email?.reason || "Email not delivered",
            },
          },
        );
      }
    }
  } catch (err) {
    email = {
      delivered: false,
      mode: "smtp",
      error: err?.message || "Email failed",
    };
    await Receipt.updateOne(
      { _id: receiptDoc._id },
      { $set: { emailStatus: "Failed", lastError: email.error } },
    );
  }

  return {
    receiptId: receiptDoc.receiptId,
    pdfUrl,
    cloudinary: isCloudinaryConfigured(),
    email,
  };
};

module.exports = {
  processReceiptGeneration,
};
