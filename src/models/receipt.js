const mongoose = require("mongoose");

const receiptSchema = new mongoose.Schema(
  {
    receiptId: { type: String, required: true, unique: true },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    paymentReference: { type: String, required: true, unique: true },
    pdfCloudinaryPublicId: {
      type: String,
      required: function () {
        return this.uploadStatus === "Uploaded";
      },
    },
    pdfCloudUrl: {
      type: String,
      required: function () {
        return this.uploadStatus === "Uploaded";
      },
    },
    emailedTo: { type: String, required: true },
    uploadStatus: {
      type: String,
      required: true,
      enum: ["Pending", "Uploaded", "Failed"],
      default: "Pending",
    },
    uploadCompletedAt: { type: Date },
    emailStatus: {
      type: String,
      required: true,
      enum: ["Pending", "Sent", "Failed"],
      default: "Pending",
    },
    emailSentAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true },
);

const Receipt = mongoose.model("Receipt", receiptSchema);

module.exports = Receipt;
