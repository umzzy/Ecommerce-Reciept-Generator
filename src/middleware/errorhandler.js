const { nodeEnv } = require("../config/keys");
const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  const rawCode = res.code;
  const code =
    Number.isInteger(rawCode) && rawCode >= 100 && rawCode < 600
      ? rawCode
      : 500;
  const isProd = nodeEnv === "production";
  logger.error(
    { err, method: req.method, url: req.originalUrl, code },
    "Error Handler Caught an Error",
  );
  const payload = {
    code,
    status: false,
    message: err?.message || "Internal Server Error",
  };
  if (!isProd) {
    payload.stack = err?.stack;
  }
  res.status(code).json(payload);
};
module.exports = errorHandler;
