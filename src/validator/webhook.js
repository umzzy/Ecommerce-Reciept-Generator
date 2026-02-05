const { z } = require("zod");

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

const eventTypeSchema = z.enum(["order.pending", "order.failed", "order.paid"]);
const paymentMethodSchema = z.enum(["Credit Card", "PayPal", "Bank Transfer"]);

const orderItemSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().int().min(1),
  price: z.number().min(0),
});

const paymentSchema = z.object({
  reference: z.string().trim().min(1),
  status: z.enum(["succeeded", "failed"]).optional(),
  amount: z.number().min(0),
  currency: z.string().trim().toUpperCase().length(3),
  method: paymentMethodSchema,
  paidAt: z.string().datetime().optional(),
});

const orderSchema = z.object({
  id: objectIdSchema,
  status: z.string().trim().min(1).optional(),
  items: z.array(orderItemSchema).min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  totalPrice: z.number().min(0),
});

const customerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
});

const storeSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  phone: z.string().trim().min(1),
});

const paymentWebhookSchema = z
  .object({
    eventId: z.string().trim().min(1),
    eventType: eventTypeSchema,
    createdAt: z.string().datetime().optional(),
    payment: paymentSchema,
    order: orderSchema,
    customer: customerSchema,
    store: storeSchema,
  })
  .strict();

const formatZodError = (error) => {
  const issueText = error.issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  return issueText.length > 0
    ? `Invalid request body: ${issueText}`
    : "Invalid request body";
};

const validateBody = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.code = 400;
    return next(new Error(formatZodError(parsed.error)));
  }
  req.body = parsed.data;
  next();
};

module.exports = {
  validatePaymentWebhook: validateBody(paymentWebhookSchema),
};
