const test = require("node:test");
const assert = require("node:assert/strict");

let Motion = {};
try {
  Motion = require("../src/customer-motion.js");
} catch {}

function motionSurface(reducedMotion = false) {
  const targets = new Map();
  for (const selector of [".lcd-root", ".lcd-body", ".customer-main"]) {
    const target = new EventTarget();
    const names = new Set();
    target.classList = {
      add: (...values) => values.forEach((value) => names.add(value)),
      remove: (...values) => values.forEach((value) => names.delete(value)),
      contains: (value) => names.has(value),
    };
    target.ownerDocument = {
      defaultView: { matchMedia: () => ({ matches: reducedMotion }) },
    };
    targets.set(selector, target);
  }
  return {
    root: { querySelector: (selector) => targets.get(selector) || null },
    target: (selector) => targets.get(selector),
  };
}

test("customer navigation applies motion to the correct visible surface", () => {
  assert.equal(typeof Motion.enter, "function");
  const surface = motionSurface();

  assert.equal(Motion.enter(surface.root, "detail"), surface.target(".lcd-root"));
  assert.equal(
    surface.target(".lcd-root").classList.contains("lcd-view-enter"),
    true,
  );

  assert.equal(Motion.enter(surface.root, "tab"), null);
  assert.equal(
    surface.target(".lcd-body").classList.contains("lcd-tab-enter"),
    false,
  );

  assert.equal(Motion.enter(surface.root, "filter"), surface.target(".lcd-body"));
  assert.equal(
    surface.target(".lcd-body").classList.contains("lcd-filter-enter"),
    true,
  );

  assert.equal(
    Motion.enter(surface.root, "list"),
    surface.target(".customer-main"),
  );
  assert.equal(
    surface.target(".customer-main").classList.contains("customer-list-enter"),
    true,
  );
});

test("entry motion removes its class after finishing so the content remains paintable", () => {
  const surface = motionSurface();
  const detail = Motion.enter(surface.root, "detail");
  assert.equal(detail.classList.contains("lcd-view-enter"), true);
  detail.dispatchEvent(new Event("animationend"));
  assert.equal(detail.classList.contains("lcd-view-enter"), false);
});

test("entry motion also clears when WebKit does not deliver animationend", async () => {
  const surface = motionSurface();
  const detail = Motion.enter(surface.root, "detail");
  await new Promise((resolve) => setTimeout(resolve, 390));
  assert.equal(detail.classList.contains("lcd-view-enter"), false);
});

test("return waits for detail exit, including the reduced-motion fade", async () => {
  assert.equal(typeof Motion.exitDetail, "function");
  const surface = motionSurface(false);
  let finished = false;
  const leaving = Motion.exitDetail(surface.root, { fallbackMs: 1000 }).then(
    () => {
      finished = true;
    },
  );
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(
    surface.target(".lcd-root").classList.contains("lcd-view-exit"),
    true,
  );
  surface.target(".lcd-root").dispatchEvent(new Event("animationend"));
  await leaving;
  assert.equal(finished, true);

  const reduced = motionSurface(true);
  let reducedFinished = false;
  const reducedExit = Motion.exitDetail(reduced.root, { fallbackMs: 1000 }).then(
    () => { reducedFinished = true; },
  );
  await Promise.resolve();
  assert.equal(reducedFinished, false);
  reduced.target(".lcd-root").dispatchEvent(new Event("animationend"));
  await reducedExit;
  assert.equal(
    reduced.target(".lcd-root").classList.contains("lcd-view-exit"),
    true,
  );
});

test("opening a customer waits for list exit, including the reduced-motion fade", async () => {
  assert.equal(typeof Motion.exitList, "function");
  const surface = motionSurface(false);
  let finished = false;
  const leaving = Motion.exitList(surface.root, { fallbackMs: 1000 }).then(
    () => {
      finished = true;
    },
  );
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(
    surface.target(".customer-main").classList.contains("customer-list-exit"),
    true,
  );
  surface.target(".customer-main").dispatchEvent(new Event("animationend"));
  await leaving;
  assert.equal(finished, true);

  const reduced = motionSurface(true);
  let reducedFinished = false;
  const reducedExit = Motion.exitList(reduced.root, { fallbackMs: 1000 }).then(
    () => { reducedFinished = true; },
  );
  await Promise.resolve();
  assert.equal(reducedFinished, false);
  reduced.target(".customer-main").dispatchEvent(new Event("animationend"));
  await reducedExit;
  assert.equal(
    reduced.target(".customer-main").classList.contains("customer-list-exit"),
    true,
  );
});


test("tab underline rounds source-style ink bounds inside a scrolled nav", () => {
  const active = { offsetLeft: 21, offsetWidth: 35,
    getBoundingClientRect: () => ({ left: 121.4375, width: 34.5625 }) };
  const indicator = { style: {}, classList: { remove() {}, add() {} } };
  const nav = { scrollLeft: 50, clientWidth: 200, getBoundingClientRect: () => ({ left: 100.25 }),
    querySelector: selector => selector === "button.active" ? active : indicator };
  const root = { querySelector: () => nav };
  assert.equal(Motion.placeTabIndicator(root, true), indicator);
  assert.equal(indicator.style.transform, "translateX(71px) scaleX(35)");
});

test("keyboard underline commits rounded ink bounds before pointer transition", () => {
  const active = { offsetLeft: 0, offsetWidth: 35,
    getBoundingClientRect: () => ({ left: 760, width: 34.5625 }) };
  const classes = new Set(["ready"]), frames = [], committed = [];
  const indicator = { style: {}, isConnected: true,
    classList: { remove: name => classes.delete(name), add: name => classes.add(name) },
    ownerDocument: { defaultView: {
      getComputedStyle: () => { committed.push(indicator.style.transform); return { transform: indicator.style.transform }; },
      requestAnimationFrame: callback => frames.push(callback),
    } } };
  const nav = { scrollLeft: 0, clientWidth: 100, getBoundingClientRect: () => ({ left: 760 }),
    querySelector: selector => selector === "button.active" ? active : indicator };
  Motion.placeTabIndicator({ querySelector: () => nav });
  assert.equal(classes.has("ready"), false);
  assert.deepEqual(committed, ["translateX(0px) scaleX(35)"]);
  frames[0]();
  assert.equal(classes.has("ready"), true);
});


test("selected compact tab scrolls only enough to reveal its right edge", () => {
  const active = { getBoundingClientRect: () => ({ left: 1029.453125, width: 63.125 }) };
  const indicator = { style: {}, classList: { remove() {}, add() {} } };
  const nav = { scrollLeft: 0, clientWidth: 453,
    getBoundingClientRect: () => ({ left: 600 }),
    querySelector: selector => selector === "button.active" ? active : indicator };
  Motion.placeTabIndicator({ querySelector: () => nav }, true);
  assert.equal(nav.scrollLeft, 39.578125);
  assert.equal(indicator.style.transform, "translateX(429px) scaleX(63)");
});

test("returning to an earlier tab reveals its left edge without overscrolling", () => {
  const active = { getBoundingClientRect: () => ({ left: 591.4375, width: 34.5625 }) };
  const indicator = { style: {}, classList: { remove() {}, add() {} } };
  const nav = { scrollLeft: 40, clientWidth: 453,
    getBoundingClientRect: () => ({ left: 600 }),
    querySelector: selector => selector === "button.active" ? active : indicator };
  Motion.placeTabIndicator({ querySelector: () => nav }, true);
  assert.equal(nav.scrollLeft, 31.4375);
  assert.equal(indicator.style.transform, "translateX(31px) scaleX(35)");
});
