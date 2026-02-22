# E‑Commerce Receipt Generator

Automatically generates a PDF receipt after a successful payment webhook, uploads the PDF to Cloudinary (or saves locally), and emails the customer with the PDF attached.

## Requirements

- Node.js 18+ (uses built-in `fetch`, `AbortController`, and `crypto.randomUUID` when available)
- MongoDB (local or remote)
- Redis (required for BullMQ background jobs)
- Cloudinary account (optional; if not configured, PDFs are saved locally)
- SMTP credentials (Mailgun SMTP, Gmail SMTP, Resend SMTP, etc.)

## Setup

1. Install dependencies:
   - `npm install`
2. Configure environment variables:
   - Create a `.env` with your MongoDB, Redis, Cloudinary, and SMTP values.
   - Optional (recommended): set `ADMIN_API_KEY` to protect owner routes.
3. Run the API and the worker (two terminals):
   - API: `npm run dev`
   - Worker: `npm run worker`

## Environment Variables

Commonly used variables (see `src/config/keys.js` for the full list):

- `PORT` (required): API port, e.g. `4000`
- `NODE_ENV`: `development` or `production`
- `MONGODB_URI` (required): Mongo connection string
- `REDIS_HOST` / `REDIS_PORT` (required): Redis connection
- `WEBHOOK_SECRET` (recommended): shared secret used to verify `x-webhook-signature` on incoming webhooks
- `WEBHOOK_RECEIVER_URL` (optional): default receiver URL used by the mock sender
- Cloudinary (optional): `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Email sending (choose one):
  - Resend API (recommended): `RESEND_API_KEY` (and `RESEND_FROM` or `MAIL_FROM`)
  - SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (optional `MAIL_FROM`)
- Admin auth (optional): `ADMIN_API_KEY` (send via `Authorization: Bearer <key>` or `x-admin-key: <key>`)
- Signed receipt links (optional): `RECEIPT_DOWNLOAD_SECRET`, `RECEIPT_SIGNED_URL_TTL_SEC`, `PUBLIC_BASE_URL`

## Main Flow

1. A payment success webhook hits the receiver: `POST /api/webhook/payment-webhook`
2. The receiver stores the event + order, then queues a background job.
3. The worker generates a PDF, uploads it (Cloudinary or local), then sends an email with the PDF attached.

## Endpoints

### Mock sender (simulate payments)

- `POST /api/sender/order-paid`
  - Generates a random order + payment payload and sends it to the configured receiver URL.
  - Required body fields:
    - `customerName`, `customerEmail`
    - `items`: array of `{ name, quantity, price }`
  - Optional body fields:
    - `receiverUrl` (URL): override the receiver endpoint for this call
    - `eventType` (enum): `order.pending`, `order.failed`, `order.paid` (default: `order.paid`)
    - `currency` (3-letter, auto-uppercased; default: `NGN`)
    - `paymentMethod` (enum): `Credit Card`, `PayPal`, `Bank Transfer`
    - `dryRun` (boolean; default: `false`) skips the HTTP dispatch but still creates the Order + payload

- `POST /api/sender/resend/:eventId`
  - Re-dispatches a previously stored webhook event by `eventId`.
  - Optional body fields: `receiverUrl`, `dryRun`

### Webhook receiver

- `POST /api/webhook/payment-webhook`
  - Verifies `x-webhook-signature` (HMAC SHA256) when `WEBHOOK_SECRET` is set.
  - Idempotent: duplicate events won’t generate duplicate receipts.
  - Expected headers:
    - `x-webhook-id`: must match `eventId` in the JSON payload (if provided)
    - `x-webhook-timestamp`: unix seconds (used by the mock sender)
    - `x-webhook-signature`: `t=<timestamp>,v1=<hex-digest>` (required when `WEBHOOK_SECRET` is set)

### Receipts (history + access)

- `GET /api/receipts`
  - Query: `email`, `page`, `limit`
  - Owner-only when `ADMIN_API_KEY` is set (send `Authorization: Bearer <key>` or `x-admin-key: <key>`)

- `GET /api/receipts/:receiptId`
  - Fetch a receipt (includes upload + email status).
  - Owner-only when `ADMIN_API_KEY` is set

- `GET /api/receipts/:receiptId/signed-url`
  - Returns a signed download URL (uses `RECEIPT_SIGNED_URL_TTL_SEC`).
  - Owner-only when `ADMIN_API_KEY` is set

- `GET /api/receipts/:receiptId/download?token=...`
  - Streams the PDF (local or Cloudinary).
  - In production, `token` is required when `RECEIPT_DOWNLOAD_SECRET` is set.
  - If you include the admin key, `token` is not required.

- `POST /api/receipts/:receiptId/retry-email`
  - Re-sends the receipt email (PDF is attached).
  - Owner-only when `ADMIN_API_KEY` is set

### Orders (owner order history)

- `GET /api/orders`
  - Query: `email`, `status`, `from`, `to`, `page`, `limit`, `includeReceipts=1`
  - Owner-only when `ADMIN_API_KEY` is set

- `GET /api/orders/:orderId`
  - Query: `includeReceipts=1`
  - Owner-only when `ADMIN_API_KEY` is set

- `GET /api/orders/:orderId/receipts`
  - Owner-only when `ADMIN_API_KEY` is set

## Notes

- Mailgun sandbox domains often require adding “authorized recipients” before emails are delivered.
- If you run without Cloudinary config, PDFs are stored under `logs/receipts/` (relative to the project root).
- Request IDs: the middleware accepts `x-request-id` from clients and always returns `x-request-id` in responses; HTTP logs include it as `req.id`.
- Logging:
  - Development uses pretty console logs; production defaults to JSON logs to stdout.
  - Logs may also be written to `logs/app.log` depending on `LOG_TO_FILE` / `NODE_ENV`.
  - Sensitive fields like `Authorization`, cookies, API keys, and common password/token fields are redacted from HTTP logs.
