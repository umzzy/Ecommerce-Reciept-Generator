const express = require("express");

const { receiptController } = require("../controller");
const { requireAdmin, attachAdminIfPresent } = require("../middleware");

const router = express.Router();

router.get("/", requireAdmin, receiptController.listReceipts);
router.get(
  "/:receiptId/signed-url",
  requireAdmin,
  receiptController.getSignedReceiptDownloadUrl,
);
router.get(
  "/:receiptId/download",
  attachAdminIfPresent,
  receiptController.downloadReceiptPdf,
);
router.get("/:receiptId", requireAdmin, receiptController.getReceiptByReceiptId);
router.post("/:receiptId/retry-email", requireAdmin, receiptController.retryReceiptEmail);

module.exports = router;
