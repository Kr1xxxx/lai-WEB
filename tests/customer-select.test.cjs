const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const sourcePath = path.join(__dirname, "../src/customer-select.js");

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = {};
    this.style = { cssText: "" };
    this.listeners = {};
    this.textContent = "";
    this.rect = {
      left: 30,
      top: 30,
      right: 190,
      bottom: 62,
      width: 160,
      height: 32,
    };
    this._value = "";
    this._index = -1;
    this._disabled = false;
    this._required = false;
    this.labels = [];
    this.type = "";
    this.classList = {
      add: (v) => (this.className = [this.className || "", v].join(" ").trim()),
      remove: (v) =>
        (this.className = (this.className || "")
          .split(" ")
          .filter((x) => x !== v)
          .join(" ")),
      contains: (v) => (this.className || "").split(" ").includes(v),
    };
  }
  get isConnected() {
    return this === this.ownerDocument.body || !!this.parentNode?.isConnected;
  }
  get options() {
    return this.children.filter((c) => c.tagName === "OPTION");
  }
  get value() {
    return this.tagName === "SELECT"
      ? this.options[this._index]?.value || ""
      : this._value;
  }
  set value(v) {
    if (this.tagName === "SELECT")
      this._index = this.options.findIndex((o) => o.value === String(v));
    else this._value = String(v);
  }
  get selectedIndex() {
    return this._index;
  }
  set selectedIndex(v) {
    this._index = Number(v);
  }
  get disabled() {
    return this._disabled;
  }
  set disabled(v) {
    this._disabled = !!v;
  }
  get required() {
    return this._required;
  }
  set required(v) {
    this._required = !!v;
  }
  get className() {
    return this.attributes.class || "";
  }
  set className(v) {
    this.attributes.class = v;
  }
  get id() {
    return this.attributes.id || "";
  }
  set id(v) {
    this.attributes.id = v;
  }
  get dataset() {
    return Object.fromEntries(
      Object.entries(this.attributes)
        .filter(([k]) => k.startsWith("data-"))
        .map(([k, v]) => [
          k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
          v,
        ]),
    );
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  hasAttribute(k) {
    return k in this.attributes;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  insertAdjacentElement(_, n) {
    const p = this.parentNode;
    n.parentNode = p;
    p.children.splice(p.children.indexOf(this) + 1, 0, n);
  }
  remove() {
    if (this.parentNode)
      this.parentNode.children = this.parentNode.children.filter(
        (c) => c !== this,
      );
    this.parentNode = null;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  contains(n) {
    return n === this || this.children.some((c) => c.contains(n));
  }
  matches(selector) {
    return selector === "select"
      ? this.tagName === "SELECT"
      : selector === "option"
        ? this.tagName === "OPTION"
        : false;
  }
  closest(selector) {
    if (selector === '[role="dialog"][aria-modal="true"]' && this.getAttribute("role") === "dialog" && this.getAttribute("aria-modal") === "true") return this;
    return this.parentNode?.closest(selector) || null;
  }
  querySelectorAll(selector) {
    const match = (n) =>
      selector === "select"
        ? n.tagName === "SELECT"
        : selector === '[role="option"]' || selector === '[role="listbox"]'
          ? n.getAttribute("role") === selector.match(/"([^"]+)"/)[1]
          : selector === "input"
            ? n.tagName === "INPUT"
            : false;
    return this.children.flatMap((c) => [
      ...(match(c) ? [c] : []),
      ...c.querySelectorAll(selector),
    ]);
  }
  querySelector(s) {
    return this.querySelectorAll(s)[0] || null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatchEvent(e) {
    e.target ||= this;
    for (const fn of this.listeners[e.type] || []) fn(e);
    return !e.defaultPrevented;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  scrollIntoView() {}
}
function harness() {
  const document = {
    activeElement: null,
    listeners: {},
    createElement(tag) {
      return new Element(tag, this);
    },
    addEventListener: Element.prototype.addEventListener,
    removeEventListener: Element.prototype.removeEventListener,
    dispatchEvent: Element.prototype.dispatchEvent,
    querySelectorAll(s) {
      return this.body.querySelectorAll(s);
    },
  };
  document.body = new Element("body", document);
  class Event {
    constructor(type, options = {}) {
      this.type = type;
      Object.assign(this, options);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopPropagation() {}
  }
  const window = {
    document,
    innerWidth: 500,
    innerHeight: 400,
    Event,
    getComputedStyle() {
      return { width: "160px" };
    },
    listeners: {},
    addEventListener: Element.prototype.addEventListener,
    removeEventListener: Element.prototype.removeEventListener,
  };
  const context = {
    window,
    document,
    Event,
    console,
    setTimeout: (fn) => fn(),
    clearTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context);
  const api = window.LaiCustomerSelect;
  function select(values = ["", "A", "B"]) {
    const el = document.createElement("select");
    el.name = "country";
    for (const value of values) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = value || "请选择";
      el.append(o);
    }
    el.selectedIndex = 0;
    document.body.append(el);
    return el;
  }
  const emit = (node, type, options = {}) =>
    node.dispatchEvent(new Event(type, options));
  return {
    api,
    document,
    window,
    select,
    emit,
    trigger(el) {
      return el.parentNode.children[el.parentNode.children.indexOf(el) + 1];
    },
    options() {
      return document.body.querySelectorAll('[role="option"]');
    },
  };
}

test("menu placement flips above and clamps both axes to the viewport", () => {
  const h = harness();
  const p = h.api.positionMenu(
    { left: 450, right: 610, top: 350, bottom: 382, width: 160 },
    { width: 500, height: 400 },
    268,
  );
  assert.equal(p.left, 332);
  assert.equal(p.top, 78);
  assert.equal(p.width, 160);
  assert.equal(p.maxHeight, 268);
  const tiny = h.api.positionMenu(
    { left: -10, right: 590, top: 30, bottom: 62, width: 600 },
    { width: 200, height: 100 },
    268,
  );
  assert.equal(tiny.width, 184);
  assert.ok(tiny.left >= 8);
  assert.ok(tiny.top >= 8);
  assert.ok(tiny.top + tiny.maxHeight <= 92);
});
test("keyboard traversal skips disabled options and clamps at boundaries", () => {
  const h = harness(),
    choices = [
      { disabled: true },
      { disabled: false },
      { disabled: true },
      { disabled: false },
    ];
  assert.equal(h.api.nextEnabled(choices, -1, "ArrowDown"), 1);
  assert.equal(h.api.nextEnabled(choices, 1, "ArrowDown"), 3);
  assert.equal(h.api.nextEnabled(choices, 3, "ArrowDown"), 3);
  assert.equal(h.api.nextEnabled(choices, 3, "Home"), 1);
  assert.equal(h.api.nextEnabled(choices, 1, "End"), 3);
  assert.equal(h.api.nextEnabled([{ disabled: true }], 0, "Home"), -1);
});
test("enhancement retains original control, form properties and listeners; commits close before one input/change", () => {
  const h = harness(),
    s = h.select();
  s.required = true;
  s.setAttribute("aria-label", "国家");
  s.className = "original";
  const form = h.document.createElement("form");
  s.form = form;
  let inputs = 0,
    changes = 0;
  s.addEventListener("input", () => inputs++);
  s.addEventListener("change", () => {
    changes++;
    assert.equal(h.options().length, 0);
  });
  h.api.enhance(h.document.body);
  const b = h.trigger(s);
  assert.equal(s.name, "country");
  assert.equal(s.form, form);
  assert.equal(s.required, true);
  assert.equal(b.type, "button");
  assert.equal(b.getAttribute("aria-label"), "国家");
  assert.ok(b.className.includes("original"));
  h.emit(b, "click");
  h.emit(h.options()[1], "click");
  assert.equal(s.value, "A");
  assert.equal(inputs, 1);
  assert.equal(changes, 1);
  h.emit(b, "click");
  h.emit(h.options()[1], "click");
  assert.equal(changes, 1);
  assert.equal(inputs, 1);
});
test("Escape and Tab cancel highlighted changes while Enter commits, and programmatic values resync silently", () => {
  const h = harness(),
    s = h.select();
  h.api.enhance(h.document.body);
  const b = h.trigger(s);
  let changes = 0;
  s.addEventListener("change", () => changes++);
  h.emit(b, "keydown", { key: "ArrowDown" });
  h.emit(b, "keydown", { key: "End" });
  h.emit(b, "keydown", { key: "Escape" });
  assert.equal(s.value, "");
  assert.equal(changes, 0);
  h.emit(b, "keydown", { key: "ArrowDown" });
  h.emit(b, "keydown", { key: "End" });
  h.emit(b, "keydown", { key: "Tab" });
  assert.equal(s.value, "");
  assert.equal(h.options().length, 0);
  h.emit(b, "keydown", { key: "ArrowDown" });
  h.emit(b, "keydown", { key: "End" });
  h.emit(b, "keydown", { key: "Enter" });
  assert.equal(s.value, "B");
  assert.equal(changes, 1);
  s.value = "A";
  assert.match(b.textContent, /A/);
  assert.equal(changes, 1);
  s.disabled = true;
  assert.equal(b.disabled, true);
});
test("required invalid and associated labels focus the trigger; outside click and rerender close floating menus", () => {
  const h = harness(),
    s = h.select(),
    label = h.document.createElement("label");
  label.textContent = "来源";
  s.labels = [label];
  h.document.body.append(label);
  h.api.enhance(h.document.body);
  const b = h.trigger(s);
  h.emit(s, "invalid");
  assert.equal(h.document.activeElement, b);
  assert.equal(b.getAttribute("aria-invalid"), "true");
  h.emit(label, "click");
  assert.equal(h.document.activeElement, b);
  h.emit(b, "click");
  h.emit(h.document, "pointerdown", { target: h.document.body });
  assert.equal(h.options().length, 0);
  h.emit(b, "click");
  s.remove();
  h.api.enhance(h.document.body);
  assert.equal(h.options().length, 0);
  assert.equal(b.isConnected, false);
});
test("search filters choices without changing select value; multiple controls are not enhanced", () => {
  const h = harness(),
    s = h.select(["", "France", "Finland", "Japan"]);
  s.setAttribute("data-searchable", "");
  h.api.enhance(h.document.body);
  h.emit(h.trigger(s), "click");
  const input = h.document.body.querySelector("input");
  assert.ok(input);
  input.value = "fin";
  h.emit(input, "input");
  assert.equal(h.options().length, 1);
  assert.equal(h.options()[0].textContent.includes("Finland"), true);
  assert.equal(s.value, "");
  h.api.close();
  assert.equal(s.value, "");
  const multi = h.select();
  multi.multiple = true;
  const list = h.select();
  list.size = 3;
  h.api.enhance(h.document.body);
  assert.equal(multi.classList.contains("lai-select-native"), false);
  assert.equal(list.classList.contains("lai-select-native"), false);
});

test("position clamps a menu when its anchor has moved beyond the viewport", () => {
  const h = harness(),
    p = h.api.positionMenu(
      { left: 600, top: 600, bottom: 632, width: 160 },
      { width: 500, height: 400 },
      268,
    );
  assert.ok(p.top + p.maxHeight <= 392);
  assert.ok(p.left + p.width <= 492);
});

test("search Tab returns focus to the trigger before native tab traversal, without committing", () => {
  const h = harness(),
    s = h.select();
  s.setAttribute("data-searchable", "");
  h.api.enhance(h.document.body);
  const b = h.trigger(s);
  h.emit(b, "click");
  const search = h.document.body.querySelector("input");
  h.emit(search, "keydown", { key: "End" });
  h.emit(search, "keydown", { key: "Tab" });
  assert.equal(s.value, "");
  assert.equal(h.options().length, 0);
  assert.equal(h.document.activeElement, b);
});
test("repeated enhance is idempotent and native change closes menus while updating the label", () => {
  const h = harness(),
    s = h.select();
  h.api.enhance(h.document.body);
  const b = h.trigger(s);
  h.api.enhance(h.document.body);
  assert.equal(h.trigger(s), b);
  h.emit(b, "click");
  s.value = "B";
  assert.equal(h.options().length, 0);
  assert.equal(b.textContent, "B");
  h.emit(b, "click");
  h.emit(s, "change");
  assert.equal(h.options().length, 0);
  assert.equal(b.textContent, "B");
  s.multiple = true;
  h.api.enhance(h.document.body);
  assert.equal(b.isConnected, false);
  assert.equal(s.hasAttribute("aria-hidden"), false);
  assert.equal(Object.hasOwn(s, "value"), false);
});
test("clicking a non-search select explicitly focuses its trigger inside a dialog", () => {
  const h = harness(),
    s = h.select();
  h.api.enhance(h.document.body);
  const b = h.trigger(s);
  h.document.activeElement = h.document.body;
  h.emit(b, "click");
  assert.equal(h.document.activeElement, b);
  h.emit(b, "keydown", { key: "Escape" });
  assert.equal(h.options().length, 0);
  assert.equal(s.value, "");
});

test("the open combobox owns its option list and releases ownership on close and switching", () => {
  const h = harness(), first = h.select(), second = h.select(["", "Other"]);
  h.api.enhance(h.document.body);
  const a = h.trigger(first), b = h.trigger(second);
  h.emit(a, "click");
  const firstList = h.document.body.querySelector('[role="listbox"]');
  assert.equal(a.getAttribute("aria-owns"), firstList.id);
  h.emit(b, "click");
  assert.equal(a.getAttribute("aria-owns"), null);
  assert.equal(b.getAttribute("aria-owns"), h.document.body.querySelector('[role="listbox"]').id);
  h.emit(b, "keydown", { key: "Escape" });
  assert.equal(b.getAttribute("aria-owns"), null);
  assert.equal(first.value, "");
  assert.equal(second.value, "");
});


test("modal options stay inside their accessibility boundary without changing viewport geometry", () => {
  const h = harness();
  const select = h.select();
  const dialog = h.document.createElement("section");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.rect = {left:20,top:10,width:400,height:350,right:420,bottom:360};
  select.remove();
  h.document.body.append(dialog);
  dialog.append(select);
  h.api.enhance(dialog);
  const button = dialog.children.find(n => n.getAttribute("role") === "combobox");
  h.emit(button, "click");
  const list = dialog.querySelector('[role="listbox"]');
  assert.ok(list, "menu must be a DOM descendant of the modal dialog");
  assert.equal(list.parentNode.parentNode, dialog);
  assert.equal(list.parentNode.style.position, "absolute");
  assert.equal(list.parentNode.style.left, "10px");
  assert.equal(list.parentNode.style.top, "56px");
  h.emit(button, "keydown", {key:"Escape"});
  assert.equal(dialog.querySelector('[role="listbox"]'), null);
  assert.equal(select.value, "");
});
