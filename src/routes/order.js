const express = require("express");

const { orderController } = require("../controller");
const { requireAdmin } = require("../middleware");

const router = express.Router();

router.use(requireAdmin);

router.get("/", orderController.listOrders);
router.get("/:orderId", orderController.getOrderById);
router.get("/:orderId/receipts", orderController.getReceiptsForOrder);

module.exports = router;

