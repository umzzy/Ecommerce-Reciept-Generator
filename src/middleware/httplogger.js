const pinoHttp = require("pino-http");
const logger = require("../utils/logger");

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customAttributes: {
    req: "req",
    res: "res",
    err: "err",
    responseTime: "responseTimeMs",
  },
  autoLogging: {
    ignore: (req) =>
      req.url.startsWith("/health") ||
      req.url.startsWith("/ready") ||
      req.url.startsWith("/metrics"),
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      "req.body.password",
      "req.body.token",
      "req.body.refreshToken",
    ],
    remove: true,
  },
  customLogLevel: (req, res, err) => {
    const status = res.statusCode ?? res.code;
    if (err || status >= 500) return "error";
    if (status >= 400) return "warn";
    return "info";
  },
  serializers: {
    req(req) {
      const raw = req.originalUrl || req.url || "";
      const pathOnly = raw.split("?")[0];

      const routePattern =
        req.route?.path != null
          ? `${req.baseUrl || ""}${req.route.path}`
          : undefined;

      return {
        id: req.id,
        method: req.method,
        path: pathOnly,
        route: routePattern,
        queryKeys: req.query ? Object.keys(req.query) : undefined,
        userAgent: req.headers["user-agent"],
        remoteAddress: req.socket?.remoteAddress,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode ?? res.code,
      };
    },
    err(err) {
      return {
        type: err?.name,
        message: err?.message,
        stack: err?.stack,
      };
    },
  },
});

module.exports = httpLogger;
