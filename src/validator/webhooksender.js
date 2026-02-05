const { z } = require("zod");

const eventTypeSchema = z.enum(["order.pending", "order.failed", "order.paid"]);
const paymentMethodSchema = z.enum(["Credit Card", "PayPal", "Bank Transfer"]);

const orderItemSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().int().min(1),
  price: z.number().min(0),
});

const sendMockOrderPaidSchema = z
  .object({
    receiverUrl: z.string().url().optional(),
    eventType: eventTypeSchema.optional().default("order.paid"),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .length(3)
      .optional()
      .default("NGN"),
    customerName: z.string().trim().min(1).optional(),
    customerEmail: z.string().trim().email().optional(),
    paymentMethod: paymentMethodSchema.optional(),
    items: z.array(orderItemSchema).min(1).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .strict();

const resendWebhookSchema = z
  .object({
    receiverUrl: z.string().url().optional(),
    dryRun: z.boolean().optional().default(false),
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
  validateSendMockOrderPaid: validateBody(sendMockOrderPaidSchema),
  validateResendWebhook: validateBody(resendWebhookSchema),
};
