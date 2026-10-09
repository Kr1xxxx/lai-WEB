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

test("订单编号列不加省略号，并且全局截断提示已接入构建", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/business.css"), "utf8");
  assert.match(css, /\.unified-orders td:first-child \.company-link\s*\{[^}]*text-overflow:\s*clip/);
  assert.match(css, /\.unified-orders td:first-child\s*\{[^}]*min-width:\s*128px/);
  assert.match(fs.readFileSync(path.join(__dirname, "../scripts/build.py"), "utf8"), /truncation-title\.js/);
  assert.match(fs.readFileSync(path.join(__dirname, "../src/template.html"), "utf8"), /<!--UI_TRUNCATION-->/);
});
