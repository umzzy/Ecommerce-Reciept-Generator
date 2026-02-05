const http = require("http");
const app = require("./app");
const { port } = require("./config/keys");
const logger = require("./utils/logger");
const connectDB = require("./utils/db");

connectDB();

const server = http.createServer(app);

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
