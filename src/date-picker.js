(function (root) {
  "use strict";
  // 日期框、月份框统一用 flatpickr（vendor/flatpickr，MIT）画中文日历，不再用系统原生控件（Mac 上是系统样式、英文占位字 mm/dd/yyyy）。
  // 做法和 customer-select.js 一样：原生 <input type="date|month"> 留着当数据载体（取值、必填校验、事件、程序里改 value 都照旧），
  // 页面上看到的是紧挨着它的一个文本框，选了日期就写回原生框并发出 input／change。
  const doc = root.document,
    records = new Set(),
    lookup = new WeakMap();
  let sequence = 0,
    watching = false;

  const KINDS = {
    date: { format: "Y-m-d", placeholder: "选择日期", today: "今天" },
    month: { format: "Y-m", placeholder: "选择月份", today: "本月" },
  };
  const kindOf = (input) => {
    const type = input?.getAttribute?.("type");
    return KINDS[type] ? type : null;
  };
  const qualifies = (input) => !!kindOf(input) && !lookup.has(input) && !input.closest?.(".flatpickr-calendar");
  const SELECTOR = 'input[type="date"], input[type="month"]';

  function descriptor(input, key) {
    let proto = Object.getPrototypeOf(input);
    while (proto && !Object.getOwnPropertyDescriptor(proto, key)) proto = Object.getPrototypeOf(proto);
    return proto && Object.getOwnPropertyDescriptor(proto, key);
  }
  function fillsParent(input, rect) {
    try {
      const parent = input.parentElement;
      if (!parent || !rect.width) return false;
      const style = root.getComputedStyle(parent);
      if (style.display.includes("flex") || style.display.includes("grid")) return false;
      const inner = parent.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
      return inner > 0 && Math.abs(inner - rect.width) <= 1;
    } catch (_) {
      return false;
    }
  }
  function emit(input) {
    input.dispatchEvent(new root.Event("input", { bubbles: true }));
    input.dispatchEvent(new root.Event("change", { bubbles: true }));
  }

  function remove(record) {
    try {
      record.picker.destroy();
    } catch (_) {}
    record.trigger.remove();
    record.error?.remove();
    record.input.classList.remove("lai-date-native");
    for (const key of ["value", "disabled"]) delete record.input[key];
    for (const key of ["tabindex", "aria-hidden"]) {
      const old = record.original[key];
      if (old === null) record.input.removeAttribute(key);
      else record.input.setAttribute(key, old);
    }
    records.delete(record);
    lookup.delete(record.input);
  }

  function enhance(scope = doc) {
    if (!doc || !scope || typeof root.flatpickr !== "function") return;
    for (const record of [...records]) if (!record.input.isConnected) remove(record);
    const inputs = [...(scope.matches?.(SELECTOR) ? [scope] : []), ...scope.querySelectorAll(SELECTOR)];
    for (const input of inputs) {
      if (!qualifies(input)) continue;
      const kind = kindOf(input),
        spec = KINDS[kind],
        nativeGet = descriptor(input, "value").get,
        nativeSet = descriptor(input, "value").set,
        rect = input.getBoundingClientRect(),
        trigger = doc.createElement("input");
      trigger.type = "text";
      trigger.className = input.className + " lai-date-trigger";
      trigger.style.cssText = input.style.cssText;
      trigger.style.width = input.style.width || (fillsParent(input, rect) ? "100%" : rect.width ? rect.width + "px" : "");
      trigger.id = `lai-date-trigger-${++sequence}`;
      trigger.placeholder = input.getAttribute("placeholder") || spec.placeholder;
      trigger.autocomplete = "off";
      trigger.disabled = input.disabled;
      const label =
        input.getAttribute("aria-label") ||
        Array.from(input.labels || []).map((l) => l.textContent.trim()).join(" ");
      if (label) trigger.setAttribute("aria-label", label);
      for (const attribute of ["aria-labelledby", "aria-describedby", "title"])
        if (input.hasAttribute(attribute)) trigger.setAttribute(attribute, input.getAttribute(attribute));
      const record = {
        input,
        trigger,
        original: { tabindex: input.getAttribute("tabindex"), "aria-hidden": input.getAttribute("aria-hidden") },
      };
      input.insertAdjacentElement("afterend", trigger);
      input.classList.add("lai-date-native");
      input.setAttribute("tabindex", "-1");
      input.setAttribute("aria-hidden", "true");

      const options = {
        locale: Object.assign({}, root.flatpickr.l10ns?.zh || {}, { firstDayOfWeek: 1 }),
        dateFormat: spec.format,
        allowInput: true,
        disableMobile: true,
        monthSelectorType: "static",
        defaultDate: nativeGet.call(input) || null,
        minDate: input.getAttribute("min") || undefined,
        maxDate: input.getAttribute("max") || undefined,
        errorHandler: () => {},
        onChange: (_dates, text) => {
          if (nativeGet.call(input) === text) return;
          nativeSet.call(input, text);
          trigger.removeAttribute("aria-invalid");
          record.error?.remove();
          record.error = null;
          emit(input);
        },
        // 关闭后让文本框回到日历里真正选中的日期（输入了无法识别的内容时不留脏字）
        onClose: (dates, _text, picker) => {
          trigger.value = dates.length ? picker.formatDate(dates[0], spec.format) : "";
        },
        onReady: (_d, _t, picker) => {
          const footer = doc.createElement("div");
          footer.className = "lai-date-footer";
          const button = (text, handler, extra) => {
            const b = doc.createElement("button");
            b.type = "button";
            b.textContent = text;
            if (extra) b.className = extra;
            b.addEventListener("click", handler);
            return b;
          };
          footer.append(
            button("清除", () => { picker.clear(); picker.close(); }, "lai-date-clear"),
            button(spec.today, () => { picker.setDate(new Date(), true); picker.close(); }, "lai-date-today"),
          );
          picker.calendarContainer.append(footer);
          picker.calendarContainer.classList.add("lai-date-calendar");
          picker.calendarContainer.dataset.kind = kind;
          const sync = () => { footer.querySelector(".lai-date-clear").hidden = input.required; };
          sync();
          record.syncFooter = sync;
        },
      };
      if (kind === "month" && typeof root.monthSelectPlugin === "function")
        options.plugins = [new root.monthSelectPlugin({ shorthand: false, dateFormat: spec.format, altFormat: "Y年n月" })];
      record.picker = root.flatpickr(trigger, options);

      records.add(record);
      lookup.set(input, record);
      // 程序里改原生框的 value／disabled（清空筛选、重置表单等），日历框跟着变
      Object.defineProperty(input, "value", {
        configurable: true,
        get: () => nativeGet.call(input),
        set: (v) => {
          nativeSet.call(input, v);
          record.picker.setDate(nativeGet.call(input) || null, false);
        },
      });
      const disabledDescriptor = descriptor(input, "disabled");
      Object.defineProperty(input, "disabled", {
        configurable: true,
        get: () => disabledDescriptor.get.call(input),
        set: (v) => {
          disabledDescriptor.set.call(input, v);
          trigger.disabled = !!v;
        },
      });
      input.addEventListener("focus", () => trigger.focus());
      // 必填但没选：原生框是看不见的，没法弹出浏览器自己的提示，改成在日历框上提示
      input.addEventListener("invalid", (event) => {
        event.preventDefault();
        trigger.setAttribute("aria-invalid", "true");
        trigger.focus();
        if (input.validationMessage && !record.error) {
          record.error = doc.createElement("span");
          record.error.className = "lai-select-validation";
          record.error.setAttribute("role", "alert");
          record.error.textContent = input.validationMessage;
          trigger.insertAdjacentElement("afterend", record.error);
        }
      });
      for (const labelElement of Array.from(input.labels || []))
        labelElement.addEventListener("click", (event) => {
          event.preventDefault();
          if (!trigger.disabled) trigger.focus();
        });
    }
  }

  function needsEnhance(node) {
    const list = node.matches?.(SELECTOR) ? [node] : [...(node.querySelectorAll?.(SELECTOR) || [])];
    return list.some(qualifies);
  }
  // 页面里新出现的日期框、月份框自动换成中文日历
  function watch(target = doc?.body) {
    if (watching || !target || typeof root.MutationObserver !== "function") return;
    watching = true;
    const pending = new Set();
    let queued = false;
    const flush = () => {
      queued = false;
      const nodes = [...pending].filter((n) => n.isConnected && needsEnhance(n));
      pending.clear();
      for (const node of nodes) enhance(node);
    };
    new root.MutationObserver((mutations) => {
      for (const m of mutations)
        for (const n of m.addedNodes)
          if (n.nodeType === 1 && (n.matches?.(SELECTOR) || n.querySelector?.(SELECTOR))) pending.add(n);
      if (pending.size && !queued) {
        queued = true;
        (root.requestAnimationFrame || ((f) => setTimeout(f, 16)))(flush);
      }
    }).observe(target, { childList: true, subtree: true });
    enhance(target);
  }
  function close() {
    for (const record of records) record.picker.close();
  }

  const api = { enhance, watch, close, kindOf, qualifies };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.LaiDatePicker = api;
    if (doc?.body) watch();
    else doc?.addEventListener?.("DOMContentLoaded", () => watch());
  }
})(typeof window !== "undefined" ? window : globalThis);
