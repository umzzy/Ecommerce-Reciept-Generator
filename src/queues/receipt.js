const { Queue } = require("bullmq");

const connection = require("../config/redis");
const logger = require("../utils/logger");

const QUEUE_NAME = "receipt-generation";
const JOB_NAME = "generate-receipt";

let receiptQueue = null;
try {
  receiptQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  });
} catch (err) {
  logger.error({ err }, "Failed to initialize receipt queue");
  receiptQueue = null;
}

const enqueueReceiptGeneration = async ({ eventId }) => {
  if (!receiptQueue) {
    const err = new Error("Receipt queue is not initialized");
    err.code = "RECEIPT_QUEUE_NOT_INITIALIZED";
    throw err;
  }
  if (!eventId || typeof eventId !== "string") {
    throw new Error("eventId is required");
  }
  try {
    const job = await receiptQueue.add(
      JOB_NAME,
      { eventId },
      { jobId: eventId },
    );
    return { id: job.id, name: job.name, queue: QUEUE_NAME };
  } catch (err) {
    if (typeof err?.message === "string" && err.message.includes("JobId")) {
      return { id: eventId, name: JOB_NAME, queue: QUEUE_NAME, alreadyQueued: true };
    }
    throw err;
  }
};

module.exports = {
  QUEUE_NAME,
  JOB_NAME,
  enqueueReceiptGeneration,
};
