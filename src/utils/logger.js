const pino = require("pino");
const path = require("path");
const fs = require("fs");

const {
  nodeEnv,
  logLevel,
  serviceName,
  logFilePath,
  logToFile,
} = require("../config/keys");

let resolvedServiceName = serviceName;
if (!resolvedServiceName) {
  try {
    resolvedServiceName = require("../../package.json").name;
  } catch {
    resolvedServiceName = "ecommerce-receipt-generator";
  }
}

const env = nodeEnv || "production";
const level = logLevel || (env === "production" ? "info" : "debug");

const defaultLogDir = path.join(__dirname, "..", "..", "logs");
const filePath = logFilePath || path.join(defaultLogDir, "app.log");
const isLogToFile =
  String(logToFile || "").toLowerCase() === "true" || env !== "production";

if (isLogToFile) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

const streams = [];
if (env === "production") {
  streams.push({ stream: process.stdout });
} else {
  const prettyTransport = pino.transport({
    target: "pino-pretty",
    options: { colorize: true },
  });
  streams.push({ stream: prettyTransport });
}

if (isLogToFile) {
  streams.push({ stream: pino.destination({ dest: filePath, sync: false }) });
}

const logger = pino(
  {
    level,
    base: {
      service: resolvedServiceName,
      env,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.multistream(streams),
);

module.exports = logger;
