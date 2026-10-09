const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const css = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");

test("下拉框只有一份规格：高度、字号、字重、边框都来自 customer-select.css 的 --dd-* 变量", () => {
  const sheet = css("src/customer-select.css");
  const trigger = sheet.match(/^button\.lai-select-trigger\s*\{[^}]*\}/m)[0];
  assert.match(trigger, /height:\s*var\(--dd-h\)/);
  assert.match(trigger, /font-size:\s*var\(--dd-font\)/);
  assert.match(trigger, /font-weight:\s*400/);
  assert.match(trigger, /border-radius:\s*var\(--dd-radius\)/);
  // 工具栏 32、表单 36，只有这两种尺寸
  const sizes = new Set([...sheet.matchAll(/--dd-h:\s*(\d+)px/g)].map((m) => m[1]));
  assert.deepEqual([...sizes].sort(), ["32", "36"]);
});

test("别的样式文件不再单独改下拉触发框的高度、字号、字重", () => {
  for (const file of ["src/business.css", "src/customer-replica.css", "src/skin-glass.css", "src/mail.css"]) {
    if (!fs.existsSync(path.join(__dirname, "..", file))) continue;
    for (const [, selector, body] of css(file).matchAll(/([^{}]*lai-select-trigger[^{}]*)\{([^}]*)\}/g)) {
      if (/::after|::before/.test(selector)) continue;
      assert.doesNotMatch(body, /(^|[;\s])(height|min-height|font-size|font-weight|line-height)\s*:/, `${file}: ${selector.trim()}`);
    }
  }
});

test("点开前后样子不变：选中项不加粗、都带 ✓，占位字和触发框文字同色，浮层字号跟触发框走", () => {
  const sheet = css("src/customer-select.css");
  assert.doesNotMatch(sheet, /aria-selected="true"\][^{]*\{[^}]*font-weight:\s*(600|700|bold)/);
  // 树形的客户分组用整行高亮代替 ✓，其余下拉的选中项都要带 ✓
  for (const [, selector, body] of sheet.matchAll(/([^{}]*aria-selected="true"\][^{}]*::after)\s*\{([^}]*)\}/g))
    if (!/is-customer-group/.test(selector)) assert.doesNotMatch(body, /content:\s*none|display:\s*none/, selector.trim());
  assert.match(sheet, /input\.lai-select-search::placeholder[\s\S]*?color:\s*var\(--dd-ink\)/);
  const js = read("src/customer-select.js");
  assert.match(js, /box\.style\.fontSize\s*=\s*triggerStyle\.fontSize/);
});

test("新出现的 <select> 自动换成统一下拉；选项多于 8 个自动带搜索框", () => {
  const select = require("../src/customer-select.js");
  assert.equal(typeof select.watch, "function");
  const fake = (count, attrs = {}) => ({
    options: { length: count },
    hasAttribute: (k) => k in attrs,
    getAttribute: (k) => attrs[k] ?? null,
  });
  assert.equal(select.wantsSearch(fake(8)), false);
  assert.equal(select.wantsSearch(fake(9)), true);
  assert.equal(select.wantsSearch(fake(30, { "data-searchable": "false" })), false);
  assert.equal(select.wantsSearch(fake(3, { "data-searchable": "true" })), true);
  assert.match(read("src/customer-select.js"), /if \(doc\?\.body\) watch\(\)/);
});

test("顶栏搜索范围按钮用统一的 V 形箭头，不再是文字「⌄」", () => {
  const app = read("src/app.js");
  assert.equal((app.match(/class="dd-caret"/g) || []).length, 2);
  assert.doesNotMatch(app, /global-search-label[^`]*<span>⌄<\/span>/);
});
