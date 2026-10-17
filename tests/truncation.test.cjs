const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const T = require("../src/truncation-title.js");

const el = (props = {}) => {
  const attrs = { ...(props.attrs || {}) };
  return {
    nodeType: 1,
    tagName: props.tag || "SPAN",
    scrollWidth: props.scrollWidth ?? 100,
    clientWidth: props.clientWidth ?? 100,
    scrollHeight: props.scrollHeight ?? 20,
    clientHeight: props.clientHeight ?? 20,
    textContent: props.text ?? "",
    parentElement: props.parent || null,
    hasAttribute: (k) => k in attrs,
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    attrs,
  };
};
const ellipsis = { textOverflow: "ellipsis" };
const plain = { textOverflow: "clip" };

test("只有真的被省略号截断的文字才算截断", () => {
  assert.equal(T.isTruncated(el({ scrollWidth: 214, clientWidth: 136 }), ellipsis), true);
  assert.equal(T.isTruncated(el({ scrollWidth: 136, clientWidth: 136 }), ellipsis), false);
  assert.equal(T.isTruncated(el({ scrollWidth: 214, clientWidth: 136 }), plain), false);
  assert.equal(T.isTruncated(el({ scrollHeight: 60, clientHeight: 40 }), { webkitLineClamp: "2", textOverflow: "clip" }), true);
});

test("鼠标移到被截断的文字上时补全文 title，已有 title 的不动", () => {
  const cut = el({ scrollWidth: 214, clientWidth: 136, text: " 即将流失客户（超过45天未复购） " });
  assert.equal(T.apply(cut, () => ellipsis), cut);
  assert.equal(cut.attrs.title, "即将流失客户（超过45天未复购）");
  const own = el({ scrollWidth: 214, clientWidth: 136, text: "x", attrs: { title: "手写的提示" } });
  assert.equal(T.apply(own, () => ellipsis), null);
  assert.equal(own.attrs.title, "手写的提示");
});

test("鼠标在被截断文字里面的子元素上，也会往外找到它", () => {
  const parent = el({ scrollWidth: 300, clientWidth: 100, text: "很长的公司名称 USD" });
  const child = el({ parent, text: "USD" });
  const styles = new Map([[parent, ellipsis], [child, plain]]);
  assert.equal(T.apply(child, (e) => styles.get(e)), parent);
  assert.ok(parent.attrs.title);
});

test("窗口变宽、不再截断后，自动加的 title 会撤掉", () => {
  const e = el({ scrollWidth: 100, clientWidth: 100, text: "短", attrs: { title: "短", "data-lai-auto-title": "" } });
  T.apply(e, () => ellipsis);
  assert.equal("title" in e.attrs, false);
});

test("鼠标进入行里没被碰到的文字，也会补上 title（邮件主题、预览、订单格等）", () => {
  const cutNode = el({ scrollWidth: 300, clientWidth: 100, text: "很长的预览文字" });
  const shortNode = el({ scrollWidth: 50, clientWidth: 100, text: "短" });
  const scope = { querySelectorAll: () => [shortNode, cutNode] };
  const target = el({});
  target.closest = (sel) => (sel === T.SCOPES ? scope : null);
  assert.equal(T.applyWithin(target, () => ellipsis), cutNode);
  assert.equal(cutNode.attrs.title, "很长的预览文字");
  assert.equal("title" in shortNode.attrs, false);
  for (const name of ["op-row", "wb-row", "calendar-day", "mail-row", "group-row"]) assert.ok(T.SCOPES.includes(name));
  for (const name of [".wb-next", ".calendar-event", ".mail-row-subject", ".mail-row-snippet"]) assert.ok(T.TEXTS.includes(name));
});

// 小满旧订单表（.unified-orders）的编号列规则随 D-029 删掉了；全部订单页的编号由重叠扫描检查不被切掉。
test("全局截断提示已接入构建", () => {
  assert.match(fs.readFileSync(path.join(__dirname, "../scripts/build.py"), "utf8"), /truncation-title\.js/);
  assert.match(fs.readFileSync(path.join(__dirname, "../src/template.html"), "utf8"), /<!--UI_TRUNCATION-->/);
});
