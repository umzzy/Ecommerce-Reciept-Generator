const notFound = (req, res, next) => {
  res.code = 404;
  next(new Error(`Resource Not Found - ${req.originalUrl}`));
};

module.exports = notFound;
