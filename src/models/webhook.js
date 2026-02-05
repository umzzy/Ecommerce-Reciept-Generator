const mongoose = require("mongoose");

const WebhookSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  eventType: {
    type: String,
    required: true,
    enum: ["order.pending", "order.failed", "order.paid"],
  },
  payload: { type: Object, required: true },
  processedAt: { type: Date, default: Date.now },
  status: {
    type: String,
    required: true,
    enum: ["PROCESSING", "FAILED", "COMPLETED"],
  },
});

const Webhook = mongoose.model("Webhook", WebhookSchema);

module.exports = Webhook;
