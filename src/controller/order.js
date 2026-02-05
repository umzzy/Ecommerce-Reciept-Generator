const mongoose = require("mongoose");

const Order = require("../models/order");
const Receipt = require("../models/receipt");

const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const listOrders = async (req, res, next) => {
  try {
    const email = req.query.email ? String(req.query.email).trim() : "";
    const status = req.query.status ? String(req.query.status).trim() : "";
    const from = parseDateOrNull(req.query.from);
    const to = parseDateOrNull(req.query.to);

    const pageRaw = req.query.page ? String(req.query.page).trim() : "1";
    const limitRaw = req.query.limit ? String(req.query.limit).trim() : "20";
    const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (email) filter.customerEmail = email;
    if (status) filter.status = status;
    if (from || to) {
      filter.orderDate = {};
      if (from) filter.orderDate.$gte = from;
      if (to) filter.orderDate.$lte = to;
    }

    const includeReceipts = String(req.query.includeReceipts || "") === "1";

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ orderDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    let receiptMap = null;
    if (includeReceipts && orders.length > 0) {
      const orderIds = orders.map((o) => o._id);
      const receipts = await Receipt.find({ orderId: { $in: orderIds } })
        .sort({ createdAt: -1 })
        .lean();
      receiptMap = new Map();
      for (const receipt of receipts) {
        const key = String(receipt.orderId);
        const list = receiptMap.get(key) || [];
        list.push({
          receiptId: receipt.receiptId,
          paymentReference: receipt.paymentReference,
          uploadStatus: receipt.uploadStatus,
          pdfCloudUrl: receipt.pdfCloudUrl,
          emailStatus: receipt.emailStatus,
          emailedTo: receipt.emailedTo,
          createdAt: receipt.createdAt,
        });
        receiptMap.set(key, list);
      }
    }

    res.status(200).json({
      code: 200,
      status: true,
      message: "Orders fetched",
      data: {
        page,
        limit,
        total,
        orders: receiptMap
          ? orders.map((order) => ({
              ...order,
              receipts: receiptMap.get(String(order._id)) || [],
            }))
          : orders,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const orderId = String(req.params.orderId || "").trim();
    if (!orderId) {
      res.code = 400;
      throw new Error("orderId is required");
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      res.code = 400;
      throw new Error("Invalid orderId");
    }

    const order = await Order.findById(orderId).lean();
    if (!order) {
      res.code = 404;
      throw new Error("Order not found");
    }

    const includeReceipts = String(req.query.includeReceipts || "") === "1";
    let receipts = [];
    if (includeReceipts) {
      receipts = await Receipt.find({ orderId: order._id })
        .sort({ createdAt: -1 })
        .lean();
    }

    res.status(200).json({
      code: 200,
      status: true,
      message: "Order fetched",
      data: { order, receipts: includeReceipts ? receipts : undefined },
    });
  } catch (err) {
    next(err);
  }
};

const getReceiptsForOrder = async (req, res, next) => {
  try {
    const orderId = String(req.params.orderId || "").trim();
    if (!orderId) {
      res.code = 400;
      throw new Error("orderId is required");
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      res.code = 400;
      throw new Error("Invalid orderId");
    }

    const order = await Order.findById(orderId).lean();
    if (!order) {
      res.code = 404;
      throw new Error("Order not found");
    }

    const receipts = await Receipt.find({ orderId: order._id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      code: 200,
      status: true,
      message: "Order receipts fetched",
      data: {
        orderId,
        receipts,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listOrders,
  getOrderById,
  getReceiptsForOrder,
};

