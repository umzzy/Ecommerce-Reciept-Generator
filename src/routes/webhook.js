const express = require("express");
const { webhookController } = require("../controller");
const { validatePaymentWebhook } = require("../validator");

const router = express.Router();

router.post(
  "/payment-webhook",
  validatePaymentWebhook,
  webhookController.receivePaymentWebhook,
);

module.exports = router;
