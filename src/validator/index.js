const senderValidators = require("./webhooksender");
const webhookValidators = require("./webhook");

module.exports = {
  ...senderValidators,
  ...webhookValidators,
};
