require("dotenv").config();

const mongoose = require("mongoose");
const { Worker } = require("bullmq");

const connectDB = require("./utils/db");
const logger = require("./utils/logger");
const connection = require("./config/redis");
const { QUEUE_NAME, JOB_NAME } = require("./queues/receipt");
const Receipt = require("./models/receipt");
const Webhook = require("./models/webhook");
const { processReceiptGeneration } = require("./jobs/receiptProcessor");

const start = async () => {
  await connectDB();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_NAME) return null;
      const eventId = job.data?.eventId;
      if (!eventId) throw new Error("eventId is required");

      try {
        return await processReceiptGeneration({ eventId });
      } catch (err) {
        try {
          await Webhook.updateOne(
            { eventId },
            { $set: { status: "FAILED", processedAt: new Date() } },
          );
        } catch (updateErr) {
          logger.error({ updateErr }, "Failed to mark webhook as FAILED in worker");
        }

        try {
          const webhookEvent = await Webhook.findOne({ eventId }).lean();
          const paymentReference = webhookEvent?.payload?.payment?.reference;
          if (paymentReference) {
            await Receipt.updateOne(
              { paymentReference },
              { $set: { uploadStatus: "Failed", lastError: err?.message || "Receipt generation failed" } },
            );
          }
        } catch (updateErr) {
          logger.error({ updateErr }, "Failed to mark receipt as FAILED in worker");
        }
        throw err;
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "Receipt job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Receipt job failed");
  });

  const shutdown = async () => {
    logger.info("Shutting down worker...");
    try {
      await worker.close();
    } catch (err) {
      logger.error({ err }, "Worker close error");
    }
    try {
      await connection.quit();
    } catch (err) {
      logger.error({ err }, "Redis quit error");
    }
    try {
      await mongoose.disconnect();
    } catch (err) {
      logger.error({ err }, "MongoDB disconnect error");
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(`Worker started for queue: ${QUEUE_NAME}`);
};

start().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
