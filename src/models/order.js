const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);
const OrderSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    orderItems: { type: [OrderItemSchema], required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["Credit Card", "PayPal", "Bank Transfer"],
      default: "Credit Card",
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Processing", "Completed", "Cancelled"],
      default: "Pending",
    },
    orderDate: { type: Date, default: Date.now },
    storeName: { type: String, required: true },
    storeAddress: { type: String, required: true },
    storePhone: { type: String, required: true },
  },
  { timestamps: true },
);

const Order = mongoose.model("Order", OrderSchema);

module.exports = Order;
