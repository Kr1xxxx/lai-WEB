// 表单必填检查（src/date-picker.js 末尾的 LaiFormCheck）：中文提示怎么写、出错后找哪个框。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FC = require("../src/date-picker.js").formCheck;
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("labels lose stars, colons and notes in brackets", () => {
  assert.equal(FC.cleanLabel("* 公司名称"), "公司名称");
  assert.equal(FC.cleanLabel("关联联系人＊"), "关联联系人");
  assert.equal(FC.cleanLabel("规格（只读）："), "规格");
  assert.equal(FC.cleanLabel("  跟进 \n 内容 "), "跟进 内容");
});

test("messages are short plain Chinese, one per kind of problem", () => {
  assert.equal(FC.messageFor({ label: "公司名称", missing: true }), "请填写公司名称");
  assert.equal(FC.messageFor({ label: "国家地区", missing: true, choice: true }), "请选择国家地区");
  assert.equal(FC.messageFor({ missing: true }), "请填写这一项");
  assert.equal(FC.messageFor({ label: "邮箱", typeMismatch: true, type: "email" }), "请填写正确的邮箱");
  assert.equal(FC.messageFor({ label: "付款账号", typeMismatch: true, type: "email" }), "付款账号：请填写正确的邮箱");
  assert.equal(FC.messageFor({ label: "公司网址", typeMismatch: true, type: "url" }), "请填写正确的公司网址");
  assert.equal(FC.messageFor({ label: "订单金额", under: true, min: "0" }), "订单金额不能小于 0");
  assert.equal(FC.messageFor({ label: "数量", over: true, max: "9" }), "数量不能大于 9");
  assert.equal(FC.messageFor({ label: "备注", tooLong: true, maxLength: 20 }), "备注最多 20 个字");
  assert.equal(FC.messageFor({ label: "金额", badInput: true }), "金额请填写数字");
  assert.equal(FC.messageFor({ label: "前缀", pattern: true }), "前缀格式不对");
  assert.equal(FC.messageFor({ label: "前缀", pattern: true, patternText: "订单前缀只能用字母、数字和-" }), "订单前缀只能用字母、数字和-");
  for (const text of [FC.messageFor({ label: "x", missing: true }), FC.messageFor({})]) assert.doesNotMatch(text, /[A-Za-z]{3,}/);
});

// 假的表单控件：只有 fieldFor／infoOf 用到的部分。
const control = (name, label, extra = {}) => ({
  name, tagName: "INPUT", type: "text", disabled: false, validity: {}, labels: [],
  getAttribute: (k) => (k === "aria-label" ? label : null), ...extra,
});

test("a failed save points at the field it names, or the field whose title the message mentions", () => {
  const form = { elements: [control("client", "客户名称"), control("num", "订单编号"), control("productType", "产品"), control("model", "产品型号"), control("x", "", { type: "hidden" })] };
  assert.equal(FC.fieldFor(form, Object.assign(new Error("whatever"), { field: "num" })).name, "num");
  assert.equal(FC.fieldFor(form, new Error("请填写产品型号")).name, "model", "the longest title wins over 产品");
  assert.equal(FC.fieldFor(form, new Error("请填写客户名称")).name, "client");
  assert.equal(FC.fieldFor(form, new Error("数据已发生变化")), null);
  assert.equal(FC.fieldFor(null, new Error("请填写客户名称")), null);
});

test("what the browser found wrong becomes the info the message is built from", () => {
  const select = control("country", "国家地区", { tagName: "SELECT", type: "select-one", validity: { valueMissing: true } });
  assert.equal(FC.describe(select), "请选择国家地区");
  const email = control("email", "邮箱", { type: "email", validity: { typeMismatch: true } });
  assert.equal(FC.describe(email), "请填写正确的邮箱");
  const date = control("date", "日期", { type: "date", validity: { valueMissing: true } });
  assert.equal(FC.describe(date), "请选择日期");
});

test("the app's forms check themselves and say what is required", () => {
  const app = read("src/business-ui.js");
  assert.match(app, /<form class="drawer-body" id="biz-order-form" novalidate data-form-check>/);
  assert.match(app, /<form id="biz-task-form" class="drawer-body" novalidate data-form-check>/);
  for (const id of ["biz-order-error", "biz-task-error", "opp-error", "lead-error", "product-error"])
    assert.match(app, new RegExp(`footError\\("${id}"\\)`), `${id} sits in the drawer footer`);
  assert.match(read("src/opportunity-ui.js"), /id="opp-form" novalidate data-form-check>/);
  assert.match(read("src/lead-ui.js"), /id="lead-form" novalidate data-form-check>/);
  assert.match(read("src/product-ui.js"), /id="product-form" class="drawer-body cs-group-form" novalidate data-form-check>/);
  const editor = read("src/customer-editor-ui.js");
  assert.match(editor, /id="customer-form"[^>]*novalidate data-form-check>/);
  assert.match(editor, /<div class="error form-foot-error k-error" id="form-error" role="alert" data-form-error><\/div><div class="ce-footer-actions">/);
  assert.match(editor, /aria-required="true" required/);
  // The browser's own English bubble never shows: every invalid event is cancelled and answered in Chinese.
  const check = read("src/date-picker.js");
  assert.match(check, /addEventListener\("invalid", \(event\) => \{\s*const form = event\.target\?\.form;\s*event\.preventDefault\(\);/);
});
