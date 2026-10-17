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
          record.error.textContent = root.LaiFormCheck?.describe(input) || input.validationMessage;
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

(function (root) {
  "use strict";
  // ---------- 表单必填检查（全应用一处处理） ----------
  // 不用浏览器自己的英文气泡（Please fill out this field.）：没填好的框由这里写一句中文短句，
  // 放进保存按钮旁边的错误条（data-form-error），并把光标和视线移到第一个没填好的框。
  // - 打了 novalidate + data-form-check 的表单：提交前这里先查，没填好就拦下，后面的保存代码收不到提交。
  // - 其他表单：浏览器照常拦提交，这里取消它的气泡（invalid 事件 preventDefault），改成同样的中文提示。
  const CONTROL = "input,select,textarea,button,datalist,output";
  const NOISE = ".required,.ce-required,.cs-use,.opp-field-hint,.lai-select-validation,.lai-select-trigger,.flatpickr-input";

  // 标签文字去掉星号、冒号和括号里的说明（如“（选填）”“（只读）”）。
  function cleanLabel(text) {
    return String(text ?? "")
      .replace(/[*\uFF0A]/g, "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[：:]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  // info：{label, missing, choice, type, typeMismatch, badInput, under, over, min, max, tooShort, tooLong, minLength, maxLength, step, pattern}
  function messageFor(info = {}) {
    const name = cleanLabel(info.label) || "这一项";
    if (info.missing) return `${info.choice ? "请选择" : "请填写"}${name}`;
    if (info.badInput) return `${name}请填写数字`;
    if (info.typeMismatch) {
      if (info.type === "email") return `${name}请填写正确的邮箱`;
      if (info.type === "url") return `${name}请填写正确的网址`;
      return `${name}格式不对`;
    }
    if (info.under) return `${name}不能小于 ${info.min}`;
    if (info.over) return `${name}不能大于 ${info.max}`;
    if (info.tooShort) return `${name}至少 ${info.minLength} 个字`;
    if (info.tooLong) return `${name}最多 ${info.maxLength} 个字`;
    if (info.step) return `${name}的数值不对`;
    if (info.pattern) return info.patternText || `${name}格式不对`;
    return `${name}没填好`;
  }
  function textOf(node) {
    if (!node || typeof node.cloneNode !== "function") return "";
    const copy = node.cloneNode(true);
    for (const extra of copy.querySelectorAll?.(`${CONTROL},${NOISE}`) || []) extra.remove();
    return cleanLabel(copy.textContent);
  }
  function labelOf(el) {
    if (!el) return "";
    const aria = el.getAttribute?.("aria-label");
    if (aria) return cleanLabel(aria);
    for (const label of Array.from(el.labels || [])) {
      const text = textOf(label);
      if (text) return text;
    }
    const box = el.closest?.(".ce-field,.field,.opp-field,.cs-field,label,fieldset");
    const head = box?.querySelector?.(":scope > label, :scope > legend, :scope > .ce-label, :scope > .opp-field-label, :scope > span");
    return textOf(head) || textOf(box) || "";
  }
  function infoOf(el) {
    const v = el.validity || {};
    const type = String(el.type || el.getAttribute?.("type") || "").toLowerCase();
    return {
      label: labelOf(el),
      missing: !!v.valueMissing,
      choice: el.tagName === "SELECT" || ["checkbox", "radio", "date", "month", "datetime-local"].includes(type) || !!el.list,
      type,
      typeMismatch: !!v.typeMismatch,
      badInput: !!v.badInput,
      under: !!v.rangeUnderflow, min: el.min,
      over: !!v.rangeOverflow, max: el.max,
      tooShort: !!v.tooShort, minLength: el.minLength,
      tooLong: !!v.tooLong, maxLength: el.maxLength,
      step: !!v.stepMismatch,
      pattern: !!v.patternMismatch, patternText: el.getAttribute?.("data-invalid-text") || "",
    };
  }
  const describe = (el) => messageFor(infoOf(el));
  const firstInvalid = (form) => Array.from(form?.elements || []).find((el) => el.willValidate && el.validity && !el.validity.valid) || null;

  // 错误条：抽屉底栏里的 data-form-error → 表单里的 data-form-error → 表单（或抽屉）里原有的错误框 → 临时在底栏／保存按钮前加一个。
  function slotFor(form) {
    if (!form) return null;
    const drawer = form.closest?.(".drawer");
    const found =
      drawer?.querySelector(".drawer-footer [data-form-error]") ||
      form.querySelector("[data-form-error]") ||
      form.querySelector(".error[role=alert]") ||
      drawer?.querySelector(".error[role=alert]");
    if (found) return found;
    const doc = form.ownerDocument;
    const slot = doc.createElement("div");
    slot.className = "error form-foot-error";
    slot.setAttribute("role", "alert");
    slot.setAttribute("data-form-error", "");
    const footer = drawer?.querySelector(".drawer-footer");
    const submit = form.querySelector('[type="submit"]');
    if (footer) footer.prepend(slot);
    else if (submit) submit.before(slot);
    else form.append(slot);
    return slot;
  }
  function show(slot, text) {
    if (!slot) return;
    slot.textContent = text;
    slot.classList.toggle("visible", !!text);
  }
  // 把光标放到这个框上，并让它出现在眼前（收起的“展开全部”先打开；美化过的下拉框、日期框会把光标转给自己看得见的按钮）。
  function focusField(el) {
    if (!el) return false;
    const closed = el.closest?.("details:not([open])");
    if (closed) closed.open = true;
    try { el.focus({ preventScroll: true }); } catch (_) { return false; }
    const doc = el.ownerDocument;
    const shown = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : el;
    shown.scrollIntoView?.({ block: "center", inline: "nearest" });
    return shown !== doc.body && doc.activeElement === shown;
  }
  function report(form) {
    const el = firstInvalid(form);
    if (!el) return true;
    const slot = slotFor(form);
    show(slot, describe(el));
    if (slot) slot.__laiField = el;
    el.setAttribute("aria-invalid", "true");
    focusField(el);
    return false;
  }
  // 保存时出错（模型里抛的错）：找出说的是哪个框。error.field（表单里的 name）优先；
  // 否则看错误文字里有没有某个框的标题（如“请填写产品型号”里的“产品型号”），取最长的那个。
  function fieldFor(form, error) {
    if (!form) return null;
    const elements = Array.from(form.elements || []).filter((el) => !el.disabled && el.type !== "hidden" && el.tagName !== "BUTTON" && el.tagName !== "FIELDSET" && el.tagName !== "OUTPUT");
    const named = error?.field && elements.find((el) => el.name === error.field);
    if (named) return named;
    const message = String(error?.message ?? error ?? "");
    let best = null, size = 1;
    for (const el of elements) {
      const label = labelOf(el);
      if (label.length > size && message.includes(label)) { best = el; size = label.length; }
    }
    return best;
  }
  function install(doc) {
    if (!doc || doc.__laiFormCheck) return;
    doc.__laiFormCheck = true;
    const queued = new Set();
    doc.addEventListener("invalid", (event) => {
      const form = event.target?.form;
      event.preventDefault();
      if (!form) return;
      if (!queued.size) Promise.resolve().then(() => { for (const f of queued) report(f); queued.clear(); });
      queued.add(form);
    }, true);
    doc.addEventListener("submit", (event) => {
      const form = event.target;
      if (!form?.noValidate || !form.hasAttribute?.("data-form-check") || event.submitter?.formNoValidate) return;
      if (form.checkValidity()) {
        const slot = slotFor(form);
        if (slot?.__laiField) { show(slot, ""); slot.__laiField = null; }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    // 改好了：撤掉红框；错误条说的正是这个框时一起收起。
    const settle = (event) => {
      const el = event.target;
      if (!el?.hasAttribute?.("aria-invalid") || !el.validity?.valid || !el.form) return;
      el.removeAttribute("aria-invalid");
      const drawer = el.form.closest?.(".drawer");
      const slot = drawer?.querySelector(".drawer-footer [data-form-error]") || el.form.querySelector("[data-form-error],.error[role=alert]");
      if (slot?.__laiField === el) { show(slot, ""); slot.__laiField = null; }
    };
    doc.addEventListener("input", settle, true);
    doc.addEventListener("change", settle, true);
  }
  const api = { cleanLabel, messageFor, labelOf, infoOf, describe, firstInvalid, slotFor, show, focusField, report, fieldFor, install };
  if (typeof module !== "undefined" && module.exports) module.exports.formCheck = api;
  else {
    root.LaiFormCheck = api;
    install(root.document);
  }
})(typeof window !== "undefined" ? window : globalThis);
