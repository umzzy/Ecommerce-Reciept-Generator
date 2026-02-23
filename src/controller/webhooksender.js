const crypto = require("crypto");

const {
  webhookSecret,
  webhookReceiverUrl,
  storeName,
  storeAddress,
  storePhone,
  port,
  nodeEnv,
} = require("../config/keys");
const logger = require("../utils/logger");
const Order = require("../models/order");
const Webhook = require("../models/webhook");

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const sample = (items) => items[randInt(0, items.length - 1)];

const roundMoney = (value) =>
  Number(Number.isFinite(value) ? value.toFixed(2) : "0");

const buildSignatureHeader = ({ secret, timestamp, rawBody }) => {
  if (!secret) return undefined;
  const payload = `${timestamp}.${rawBody}`;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
};

const generateRandomCustomer = () => {
  const firstNames = [
    "Amina",
    "Chinedu",
    "Fatima",
    "Kemi",
    "Ibrahim",
    "Ada",
    "Tunde",
    "Zainab",
    "Emeka",
    "Sade",
  ];
  const lastNames = [
    "Okafor",
    "Balogun",
    "Okoye",
    "Adeyemi",
    "Mohammed",
    "Ibrahim",
    "Okonkwo",
    "Ogunleye",
    "Abubakar",
    "Afolayan",
  ];
  const first = sample(firstNames);
  const last = sample(lastNames);
  const name = `${first} ${last}`;
  const email = `${first}.${last}${randInt(10, 999)}@book.com`
    .toLowerCase()
    .replace(/\s+/g, "");
  return { name, email };
};

const generateRandomItems = () => {
  const products = [
    "Wireless Mouse",
    "USB-C Cable",
    "Bluetooth Speaker",
    "Mechanical Keyboard",
    "Phone Case",
    "Laptop Stand",
    "Smart Watch Strap",
    "Portable Charger",
    "HDMI Adapter",
    "Noise Cancelling Earbuds",
  ];
  const count = randInt(1, 4);
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const name = sample(products);
    const quantity = randInt(1, 99);
    const price = roundMoney(randInt(500, 50000) / 100);
    items.push({ name, quantity, price });
  }
  return items;
};

const buildOrderDoc = (overrides) => {
  const fallbackStore = {
    storeName: storeName || "My E-commerce Store",
    storeAddress: storeAddress || "Store Address",
    storePhone: storePhone || "+000-000-0000",
  };

  const customer = generateRandomCustomer();
  const orderItems =
    Array.isArray(overrides?.items) && overrides.items.length > 0
      ? overrides.items
      : generateRandomItems();
  const quantity = orderItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = roundMoney(
    orderItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
  );
  const unitPrice = quantity > 0 ? roundMoney(totalPrice / quantity) : 0;

  return {
    customerName: overrides?.customerName || customer.name,
    customerEmail: overrides?.customerEmail || customer.email,
    orderItems,
    quantity,
    unitPrice,
    totalPrice,
    paymentMethod:
      overrides?.paymentMethod ||
      sample(["Credit Card", "PayPal", "Bank Transfer"]),
    status: "Completed",
    ...fallbackStore,
  };
};

const buildWebhookPayload = ({
  eventId,
  eventType,
  currency,
  paymentReference,
  order,
}) => {
  const now = new Date();
  return {
    eventId,
    eventType,
    createdAt: now.toISOString(),
    payment: {
      reference: paymentReference,
      status: eventType === "payment failed" ? "failed" : "succeeded",
      amount: order.totalPrice,
      currency,
      method: order.paymentMethod,
      paidAt: now.toISOString(),
    },
    order: {
      id: String(order._id),
      status: order.status,
      items: order.orderItems,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      totalPrice: order.totalPrice,
    },
    customer: {
      name: order.customerName,
      email: order.customerEmail,
    },
    store: {
      name: order.storeName,
      address: order.storeAddress,
      phone: order.storePhone,
    },
  };
};

const resolveReceiverUrl = (overrideUrl) => {
  if (overrideUrl) return overrideUrl;
  if (webhookReceiverUrl) return webhookReceiverUrl;
  if (nodeEnv === "production") return "";
  const resolvedPort = port || 4000;
  return `http://localhost:${resolvedPort}/api/webhook/payment-webhook`;
};

const dispatchWebhook = async ({ receiverUrl, secret, eventId, payload }) => {
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildSignatureHeader({ secret, timestamp, rawBody });

  const headers = {
    "content-type": "application/json",
    "x-webhook-id": eventId,
    "x-webhook-timestamp": String(timestamp),
  };
  if (signature) {
    headers["x-webhook-signature"] = signature;
  }

  const startedAt = Date.now();
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch(receiverUrl, {
      method: "POST",
      headers,
      body: rawBody,
      signal: ac.signal,
    });

    let response = null;
    try {
      const text = await res.text();
      if (text) {
        try {
          response = JSON.parse(text);
        } catch {
          response = text.slice(0, 2000);
        }
      }
    } catch {
      response = null;
    }

    const durationMs = Date.now() - startedAt;
    return {
      attempted: true,
      receiverUrl,
      ok: res.ok,
      status: res.status,
      durationMs,
      response,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const sendMockOrderPaid = async (req, res, next) => {
  try {
    const {
      receiverUrl: receiverUrlOverride,
      currency,
      customerName,
      customerEmail,
      paymentMethod,
      items,
      dryRun,
      eventType,
    } = req.body;

    const receiverUrl = resolveReceiverUrl(receiverUrlOverride);

    const orderDoc = buildOrderDoc({
      customerName,
      customerEmail,
      paymentMethod,
      items,
    });
    const order = await Order.create(orderDoc);

    const eventId = crypto.randomUUID();
    const paymentReference = crypto.randomUUID();
    const webhookPayload = buildWebhookPayload({
      eventId,
      eventType,
      currency,
      paymentReference,
      order,
    });

    let dispatch = { attempted: false, receiverUrl: receiverUrl || null };
    if (dryRun) {
      dispatch.reason = "dryRun=true; dispatch skipped";
    } else if (!receiverUrl) {
      dispatch.reason =
        "No receiver URL configured; set WEBHOOK_RECEIVER_URL or pass receiverUrl";
    } else {
      try {
        dispatch = await dispatchWebhook({
          receiverUrl,
          secret: webhookSecret,
          eventId,
          payload: webhookPayload,
        });
      } catch (err) {
        dispatch = {
          attempted: true,
          receiverUrl,
          ok: false,
          status: null,
          durationMs: null,
          error: err?.message || "Dispatch failed",
        };
      }
    }

    logger.info(
      { eventId, eventType, orderId: String(order._id), dispatch },
      "Mock webhook generated",
    );

    res.status(201).json({
      code: 201,
      status: true,
      message: "Mock payment webhook generated",
      data: {
        order,
        event: { eventId, eventType, paymentReference, currency },
        payload: webhookPayload,
        dispatch,
        receiver: {
          url: receiverUrl || null,
          configured: Boolean(webhookReceiverUrl),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const resendWebhookEvent = async (req, res, next) => {
  try {
    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) {
      res.code = 400;
      throw new Error("eventId is required");
    }

    const { receiverUrl: receiverUrlOverride, dryRun } = req.body;
    const receiverUrl = resolveReceiverUrl(receiverUrlOverride);

    const webhookEvent = await Webhook.findOne({ eventId }).lean();
    if (!webhookEvent) {
      res.code = 404;
      throw new Error("Webhook event not found");
    }

    const payload = webhookEvent.payload;

    let dispatch = { attempted: false, receiverUrl: receiverUrl || null };
    if (dryRun) {
      dispatch.reason = "dryRun=true; dispatch skipped";
    } else if (!receiverUrl) {
      dispatch.reason =
        "No receiver URL configured; set WEBHOOK_RECEIVER_URL or pass receiverUrl";
    } else {
      try {
        dispatch = await dispatchWebhook({
          receiverUrl,
          secret: webhookSecret,
          eventId,
          payload,
        });
      } catch (err) {
        dispatch = {
          attempted: true,
          receiverUrl,
          ok: false,
          status: null,
          durationMs: null,
          error: err?.message || "Dispatch failed",
        };
      }
    }

    res.status(200).json({
      code: 200,
      status: true,
      message: "Webhook resent",
      data: {
        webhook: {
          eventId,
          eventType: webhookEvent.eventType,
          status: webhookEvent.status,
        },
        dispatch,
        receiver: {
          url: receiverUrl || null,
          configured: Boolean(webhookReceiverUrl),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendMockOrderPaid,
  resendWebhookEvent,
};
