const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const list = fs.readFileSync(
  path.join(__dirname, "../src/customer-list-ui.js"),
  "utf8",
);

test("customer header omits the mobile shortcut", () => {
  assert.doesNotMatch(list, /手机端客户管理/);
});
