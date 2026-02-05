const errorHandler = require("./errorhandler");
const notfoundHandler = require("./notfound");
const reqId = require("./requestid");
const httpLog = require("./httplogger");
const { requireAdmin, attachAdminIfPresent } = require("./adminAuth");

module.exports = {
  errorHandler,
  notfoundHandler,
  reqId,
  httpLog,
  requireAdmin,
  attachAdminIfPresent,
};
