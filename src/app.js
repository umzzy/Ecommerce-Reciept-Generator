require("dotenv").config();

const express = require("express");

const {
  errorHandler,
  notfoundHandler,
  reqId,
  httpLog,
} = require("./middleware");
const {
  senderRoutes,
  webhookRoutes,
  receiptRoutes,
  orderRoutes,
} = require("./routes");

const app = express();
app.use(reqId);
app.use(httpLog);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/sender", senderRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/orders", orderRoutes);

app.use(notfoundHandler);
app.use(errorHandler);

module.exports = app;
