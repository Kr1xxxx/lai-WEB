const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// ---- 极简的假 DOM：只实现 date-picker.js 用到的部分 ----
class Node0 {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.style = { cssText: "", width: "" };
    this.listeners = {};
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.labels = [];
    this.className = "";
    this.disabled = false;
    this.required = false;
    this.validationMessage = "";
    this.classes = new Set();
    this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) };
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  matches(sel) { return sel.split(",").map((s) => s.trim()).some((s) => { const m = s.match(/^input\[type="(\w+)"\]$/); return m && this.tagName === "INPUT" && this.attrs.type === m[1]; }); }
  closest() { return null; }
  getBoundingClientRect() { return { width: 140, height: 32, left: 0, top: 0 }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach((fn) => fn(event)); return true; }
  insertAdjacentElement(_where, el) { el.parentElement = this.parentElement; this.after = el; el.isConnected = true; return el; }
  remove() { this.isConnected = false; }
  focus() { this.focused = true; }
  querySelectorAll() { return []; }
}
class FakeInput extends Node0 {
  get value() { return this._v || ""; }
  set value(v) { this._v = String(v); }
  set type(v) { this.attrs.type = v; }
  get type() { return this.attrs.type; }
}

function setup(valueAtStart = "") {
  const created = [];
  const picker = { set: [], destroyed: false, closed: 0, cleared: 0, selectedDates: [] };
  const fakeFlatpickr = Object.assign(
    (el, options) => {
      picker.options = options;
      picker.el = el;
      picker.setDate = (v, trigger) => picker.set.push([v, trigger]);
      picker.destroy = () => { picker.destroyed = true; };
      picker.close = () => { picker.closed++; };
      picker.clear = () => { picker.cleared++; };
      picker.formatDate = (d) => d.iso;
      picker.calendarContainer = { append() {}, classList: { add() {} }, dataset: {} };
      return picker;
    },
    { l10ns: { zh: { name: "zh" } } },
  );
  class FakeEvent { constructor(type) { this.type = type; } }
  const input = new FakeInput("input");
  input.attrs.type = "date";
  input.parentElement = new Node0("div");
  input.value = valueAtStart;
  const root = new Node0("div");
  root.matches = () => false;
  root.querySelectorAll = () => [input];
  const doc = {
    body: null,
    createElement: (tag) => { const el = tag === "input" ? new FakeInput(tag) : new Node0(tag); created.push(el); return el; },
  };
  globalThis.document = doc;
  globalThis.flatpickr = fakeFlatpickr;
  globalThis.Event = FakeEvent;
  globalThis.getComputedStyle = () => ({ display: "block", paddingLeft: "0", paddingRight: "0" });
  delete require.cache[require.resolve("../src/date-picker.js")];
  const mod = require("../src/date-picker.js");
  return { mod, input, root, picker, created };
}
const cleanup = () => { for (const k of ["document", "flatpickr", "Event", "getComputedStyle"]) delete globalThis[k]; };

test("原生日期框留着当数据载体，页面上换成中文日历文本框", () => {
  const { mod, input, root, picker, created } = setup("2026-10-01");
  try {
    mod.enhance(root);
    const trigger = created.find((el) => el.className.includes("lai-date-trigger"));
    assert.ok(trigger, "应创建日历文本框");
    assert.equal(trigger.attrs.type, "text");
    assert.equal(trigger.placeholder, "选择日期");
    assert.ok(input.classes.has("lai-date-native"));
    assert.equal(input.attrs["aria-hidden"], "true");
    assert.equal(picker.options.dateFormat, "Y-m-d");
    assert.deepEqual(picker.options.locale, { name: "zh" });
    assert.equal(picker.options.defaultDate, "2026-10-01");
    assert.equal(mod.qualifies(input), false, "已经换过的不再重复处理");
  } finally { cleanup(); }
});

test("选了日期写回原生框并发出 input／change；清空也一样", () => {
  const { mod, input, root, picker } = setup("");
  try {
    mod.enhance(root);
    const seen = [];
    input.addEventListener("input", () => seen.push("input:" + input.value));
    input.addEventListener("change", () => seen.push("change:" + input.value));
    picker.options.onChange([], "2026-10-09");
    assert.equal(input.value, "2026-10-09");
    picker.options.onChange([], "");
    assert.equal(input.value, "");
    assert.deepEqual(seen, ["input:2026-10-09", "change:2026-10-09", "input:", "change:"]);
    picker.options.onChange([], "");
    assert.equal(seen.length, 4, "值没变不重复发事件");
  } finally { cleanup(); }
});

test("程序里改原生框的 value（清空筛选、重置表单）时，日历框跟着变", () => {
  const { mod, input, root, picker } = setup("2026-10-01");
  try {
    mod.enhance(root);
    picker.set.length = 0;
    input.value = "";
    assert.deepEqual(picker.set.at(-1), [null, false]);
    input.value = "2026-11-05";
    assert.deepEqual(picker.set.at(-1), ["2026-11-05", false]);
    assert.equal(input.value, "2026-11-05");
  } finally { cleanup(); }
});

test("必填但没选：在日历框上提示，不留看不见的原生框去弹浏览器提示", () => {
  const { mod, input, root, created } = setup("");
  try {
    mod.enhance(root);
    const trigger = created.find((el) => el.className.includes("lai-date-trigger"));
    input.validationMessage = "请填写此字段。";
    let prevented = false;
    input.dispatchEvent({ type: "invalid", preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(trigger.attrs["aria-invalid"], "true");
  } finally { cleanup(); }
});

test("日期、月份用 flatpickr 与中文语言包，并随构建内联；vendor 文件与记录的校验值一致", () => {
  const build = read("scripts/build.py");
  assert.match(build, /<!--DATE_PICKER-->','\.\.\/vendor\/flatpickr\/flatpickr\.min\.js\|\.\.\/vendor\/flatpickr\/l10n-zh\.js\|\.\.\/vendor\/flatpickr\/monthSelect\.js\|date-picker\.js'/);
  assert.match(read("src/template.html"), /<!--DATE_PICKER_STYLE-->[\s\S]*<!--DATE_PICKER-->/);
  const readme = read("vendor/flatpickr/README.md");
  for (const file of ["flatpickr.min.js", "flatpickr.min.css", "l10n-zh.js", "monthSelect.js", "monthSelect.css", "LICENSE"]) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../vendor/flatpickr", file))).digest("hex");
    assert.ok(readme.includes(hash + "  " + file), file + " 的 SHA-256 与 README 不一致");
  }
});
