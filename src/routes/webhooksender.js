const express = require("express");
const { webhookSenderController } = require("../controller");
const { validateSendMockOrderPaid, validateResendWebhook } = require("../validator");

const router = express.Router();

router.post(
  "/order-paid",
  validateSendMockOrderPaid,
  webhookSenderController.sendMockOrderPaid,
);

router.post(
  "/resend/:eventId",
  validateResendWebhook,
  webhookSenderController.resendWebhookEvent,
);

module.exports = router;
