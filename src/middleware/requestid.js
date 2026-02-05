const crypto = require("crypto");

const requestId = (req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && incoming.trim().length > 0
      ? incoming.trim()
      : (crypto.randomUUID?.() ?? crypto.randomBytes(16).toString("hex"));
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
};

module.exports = requestId;
