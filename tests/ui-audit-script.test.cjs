const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dir = path.join(__dirname, "../scripts/ui-audit");

test("界面扫描脚本语法正确，页面内检查是一个可执行的函数", () => {
  const checks = fs.readFileSync(path.join(dir, "page-checks.js"), "utf8");
  assert.equal(typeof vm.runInNewContext(checks), "function");
  new vm.Script(fs.readFileSync(path.join(dir, "ui-audit.cjs"), "utf8").replace(/^#!.*/, ""), { filename: "ui-audit.cjs" });
});

test("脚本覆盖清单里的几项自动检查，并有说明文档", () => {
  const script = fs.readFileSync(path.join(dir, "ui-audit.cjs"), "utf8");
  for (const word of ["covered", "nativeSelects", "triggerStyles", "fontDiffs", "baseline"]) assert.match(script, new RegExp(word));
  const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  for (const word of ["被遮挡", "原生下拉框", "点击前后字体", "基线"]) assert.match(readme, new RegExp(word));
  assert.match(fs.readFileSync(path.join(__dirname, "../CLAUDE.md"), "utf8"), /scripts\/ui-audit\/ui-audit\.cjs/);
});
