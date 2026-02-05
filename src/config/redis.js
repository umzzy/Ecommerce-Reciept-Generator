const IORedis = require("ioredis");

const logger = require("../utils/logger");
const { redisUrl} = require("./keys");

const connection = new IORedis({
  url: redisUrl,
  maxRetriesPerRequest: null,
});

connection.on("connect", () => {
  logger.info("Redis connected successfully");
});
connection.on("ready", () => {
  logger.info("Redis connection is ready to use");
});
connection.on("reconnecting", (delay) => {
  logger.warn(`Redis is reconnecting... Delay: ${delay}ms`);
});
connection.on("error", (error) => {
  logger.error("Redis connection error:", error);
});
connection.on("end", () => {
  logger.warn("Redis connection has been closed");
});

module.exports = connection;
