const { adminApiKey, nodeEnv } = require("../config/keys");

const extractToken = (req) => {
  const header = req.headers?.authorization;
  if (typeof header === "string") {
    const trimmed = header.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      const token = trimmed.slice(7).trim();
      if (token) return token;
    }
  }

  const xAdminKey = req.headers?.["x-admin-key"];
  if (typeof xAdminKey === "string" && xAdminKey.trim()) {
    return xAdminKey.trim();
  }

  return "";
};

const isAdminTokenValid = (req) => {
  if (!adminApiKey) return false;
  const token = extractToken(req);
  return Boolean(token && token === adminApiKey);
};

const requireAdmin = (req, res, next) => {
  if (!adminApiKey) {
    if (nodeEnv === "production") {
      res.code = 401;
      return next(new Error("ADMIN_API_KEY is not configured"));
    }
    req.isAdmin = true;
    return next();
  }

  if (isAdminTokenValid(req)) {
    req.isAdmin = true;
    return next();
  }

  res.code = 401;
  return next(new Error("Unauthorized"));
};

const attachAdminIfPresent = (req, res, next) => {
  if (!adminApiKey) {
    if (nodeEnv !== "production") {
      req.isAdmin = true;
    }
    return next();
  }

  if (isAdminTokenValid(req)) {
    req.isAdmin = true;
  }
  return next();
};

module.exports = {
  requireAdmin,
  attachAdminIfPresent,
};

