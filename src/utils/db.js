const mongoose = require("mongoose");
const logger = require("./logger");
const { mongodbUri } = require("../config/keys");

const connectDB = async () => {
  if (!mongodbUri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }
  try {
    await mongoose.connect(mongodbUri);
    logger.info("MongoDB connected successfully");
  } catch (error) {
    logger.error({ error }, "MongoDB connection error");
    throw error;
  }
};

module.exports = connectDB;
