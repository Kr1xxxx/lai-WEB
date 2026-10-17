const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { appSource } = require("./helpers/source.cjs");

const app = appSource();
const css = fs.readFileSync(
  path.join(__dirname, "../src/customer-replica.css"),
  "utf8",
);

test("top chrome shows the current Lai version beside the wordmark", () => {
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
  assert.ok(app.includes(`const APP_VERSION = "${version}";`));
  assert.match(
    app,
    /class="app-version" data-action="version-history"[^>]*>v\$\{APP_VERSION\}<\/button>/,
  );
  assert.match(app, /<h2>来财Lai \$\{APP_VERSION\}<\/h2>/);
  assert.doesNotMatch(app, /来财Lai 1\.2/);
  assert.match(css, /\.app-version\s*\{/);
});

test("left rail pins a guarded refresh control to the bottom", () => {
  assert.match(app, /refresh:\s*"[^"]+"/);
  assert.match(
    app,
    /class="rail-item rail-refresh" data-action="refresh-app" aria-label="刷新来财数据"/,
  );
  // 刷新在入口滚动区（.rail-scroll）外面，永远占着左栏底部自己的位置
  assert.match(app, /<\/div><button class="rail-item rail-refresh"/);
  assert.match(css, /\.rail-refresh\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.rail-refresh\s*\{[^}]*flex:\s*none/s);
  assert.match(app, /async function refreshApplication\(\)/);
  assert.match(app, /await window\.flushPendingSave\(\)/);
  assert.match(app, /window\.location\.reload\(\)/);
  assert.match(
    app,
    /if \(a === "refresh-app"\) return refreshApplication\(\);/,
  );
});
