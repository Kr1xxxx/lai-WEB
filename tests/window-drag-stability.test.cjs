const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const native = fs.readFileSync(
  path.join(__dirname, "../native/Sources/LaiNative/main.swift"),
  "utf8",
);
const list = fs.readFileSync(
  path.join(__dirname, "../src/customer-list-ui.js"),
  "utf8",
);

test("customer header omits the mobile shortcut", () => {
  assert.doesNotMatch(list, /手机端客户管理/);
});

test("window dragging uses one native path across non-interactive topbar space", () => {
  assert.match(native, /const region = document\.querySelector\('\.topbar'\);/);
  assert.match(native, /window\.isMovableByWindowBackground = false/);
  assert.doesNotMatch(native, /installFallbackDragMonitor/);
  assert.doesNotMatch(native, /setFrameOrigin/);
  assert.match(
    native,
    /let isExcluded = exclusionRects\.contains[\s\S]*guard !isExcluded else \{ return nil \}/,
  );
  assert.match(native, /window\?\.performDrag\(with: event\)/);
});
