(function (root) {
  "use strict";
  const doc = root.document,
    records = new Set(),
    lookup = new WeakMap(),
    closing = new Set();
  let opened = null,
    sequence = 0,
    listening = false;

  function positionMenu(rect, viewport, desiredHeight) {
    const margin = 8,
      gap = 4;
    const width = Math.min(
      Math.max(0, rect.width),
      Math.max(0, viewport.width - margin * 2),
    );
    const below = Math.max(0, viewport.height - margin - rect.bottom - gap);
    const above = Math.max(0, rect.top - margin - gap);
    const upward = below < desiredHeight && above > below;
    const maxHeight = Math.min(
      desiredHeight,
      Math.max(0, viewport.height - margin * 2),
      upward ? above : below,
    );
    return {
      width,
      maxHeight,
      left: Math.max(
        margin,
        Math.min(rect.left, viewport.width - margin - width),
      ),
      top: Math.max(
        margin,
        Math.min(
          viewport.height - margin - maxHeight,
          upward ? rect.top - gap - maxHeight : rect.bottom + gap,
        ),
      ),
    };
  }
  function nextEnabled(options, index, key) {
    const enabled = options
      .map((option, i) => (option.disabled ? -1 : i))
      .filter((i) => i >= 0);
    if (!enabled.length) return -1;
    if (key === "Home") return enabled[0];
    if (key === "End") return enabled[enabled.length - 1];
    if (key === "ArrowUp")
      return [...enabled].reverse().find((i) => i < index) ?? enabled[0];
    return enabled.find((i) => i > index) ?? enabled[enabled.length - 1];
  }
  function close(restoreFocus = false, animate = false) {
    for (const entry of [...closing]) entry.cleanup();
    if (!opened) return;
    const previous = opened;
    opened = null;
    if (previous.anchoredSearch) {
      previous.search.remove();
      previous.record.button.classList.remove("is-searching");
    }
    previous.record.button.setAttribute("aria-expanded", "false");
    previous.record.button.removeAttribute("aria-activedescendant");
    previous.record.button.removeAttribute("aria-owns");
    syncClear(previous.record);
    if (restoreFocus && previous.record.button.isConnected)
      previous.record.button.focus();
    if (!animate || (!previous.quickInline && (!previous.pointer || !previous.record.sourceVariant))) {
      previous.box.remove();
      return;
    }
    const box = previous.box, css = root.getComputedStyle(box);
    box.style.setProperty("--stage-exit-transform", css.transform);
    box.style.setProperty("--stage-exit-opacity", css.opacity);
    box.classList.remove("is-entering");
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.classList.add("is-closing");
    const entry = {
      cleanup() {
        clearTimeout(entry.timer);
        box.removeEventListener("animationend", entry.onEnd);
        box.remove();
        closing.delete(entry);
      },
      onEnd(event) {
        if (event.target === box) entry.cleanup();
      },
    };
    closing.add(entry);
    box.addEventListener("animationend", entry.onEnd);
    entry.timer = setTimeout(entry.cleanup, 240);
  }
  function syncClear(record) {
    if (record.clear)
      record.clear.hidden = !record.select.value || record.select.disabled || record.select.required;
  }
  function clearValue(record, animate = false) {
    const { select, button } = record;
    const empty = Array.from(select.options).find(option => option.value === "" && !option.disabled);
    if (!empty || !select.value || select.disabled || select.required) return;
    // Set the option before closing so the exiting menu reflects the cleared value.
    empty.selected = true;
    if (opened?.record === record) {
      if (opened.search) opened.search.value = "";
      renderOptions();
      close(false, animate);
    }
    sync(record);
    if (button.isConnected) button.focus();
    select.dispatchEvent(new root.Event("input", { bubbles: true }));
    select.dispatchEvent(new root.Event("change", { bubbles: true }));
  }
  function sync(record) {
    const { select, button } = record;
    button.textContent =
      select.options[select.selectedIndex]?.textContent ||
      select.getAttribute("data-placeholder") ||
      "请选择";
    button.disabled = select.disabled;
    button.setAttribute("data-empty", String(!select.value));
    button.setAttribute("aria-required", String(select.required));
    syncClear(record);
    if (select.validity?.valid) {
      button.removeAttribute("aria-invalid");
      record.error?.remove();
      record.error = null;
    }
  }
  function optionsFor(select) {
    return Array.from(select.options)
      .map((option, index) => ({
        index,
        label: option.label || option.textContent,
        disabled:
          option.disabled ||
          (option.parentNode?.tagName === "OPTGROUP" &&
            option.parentNode.disabled),
        hidden: option.hidden,
      }))
      .filter((option) => !option.hidden);
  }
  function highlight(index) {
    if (!opened) return;
    opened.active = index;
    opened.record.button.removeAttribute("aria-activedescendant");
    opened.search?.removeAttribute("aria-activedescendant");
    opened.nodes.forEach((node, i) => {
      node.classList[i === index ? "add" : "remove"]("is-active");
      if (i === index) {
        opened.record.button.setAttribute("aria-activedescendant", node.id);
        opened.search?.setAttribute("aria-activedescendant", node.id);
        node.scrollIntoView({ block: "nearest" });
      }
    });
  }
  function place() {
    if (!opened) return;
    const menu = opened,
      rowHeight =
        Number(menu.record.select.getAttribute("data-option-height")) || 36;
    const verticalPadding = menu.record.sourceVariant || menu.quickInline ? 16 : 10;
    const desired = Math.min(
      menu.quickInline ? 272 : 268,
      (menu.options.length ? menu.options.length * rowHeight
        : menu.record.sourceVariant === "product" ? 116 : rowHeight) +
        verticalPadding +
        (menu.search && !menu.inlineSearch ? 44 : 0),
    );
    const position = positionMenu(
      menu.record.button.getBoundingClientRect(),
      { width: root.innerWidth, height: root.innerHeight },
      desired,
    );
    if (menu.host) {
      // Keep modal options in the modal's accessibility subtree. The drawer is
      // the absolute containing block; its rect already includes translation.
      const origin = menu.host.getBoundingClientRect();
      position.left -= origin.left + (menu.host.clientLeft || 0) - (menu.host.scrollLeft || 0);
      position.top -= origin.top + (menu.host.clientTop || 0) - (menu.host.scrollTop || 0);
    }
    for (const key of ["left", "top", "width", "maxHeight"])
      menu.box.style[key] = position[key] + "px";
    if (menu.record.sourceVariant || menu.quickInline)
      menu.box.style.transformOrigin = position.top + (menu.host?.getBoundingClientRect().top || 0) < menu.record.button.getBoundingClientRect().top
        ? "left bottom" : "left top";
    menu.list.style.maxHeight =
      Math.max(
        0,
        position.maxHeight - (menu.search && !menu.inlineSearch ? 44 : 0) - verticalPadding,
      ) + "px";
  }
  function commit(index, animate = false) {
    const menu = opened,
      option = menu?.options[index];
    if (!option || option.disabled || menu.record.select.disabled) return;
    const { select, button } = menu.record,
      changed = select.selectedIndex !== option.index;
    close(false, animate || menu.quickInline);
    select.selectedIndex = option.index;
    sync(menu.record);
    if (button.isConnected) button.focus();
    if (changed) {
      select.dispatchEvent(new root.Event("input", { bubbles: true }));
      select.dispatchEvent(new root.Event("change", { bubbles: true }));
    }
  }
  function renderOptions(query = "") {
    const menu = opened;
    const term = query.trim().toLocaleLowerCase();
    menu.options = optionsFor(menu.record.select).filter((option) =>
      option.label.toLocaleLowerCase().includes(term),
    );
    menu.list.replaceChildren();
    menu.nodes = menu.options.map((option, i) => {
      const node = doc.createElement("div");
      node.id = `${menu.list.id}-${option.index}`;
      node.className = "lai-select-option";
      node.setAttribute("role", "option");
      node.setAttribute(
        "aria-selected",
        String(option.index === menu.record.select.selectedIndex),
      );
      node.setAttribute("aria-disabled", String(!!option.disabled));
      node.style.height =
        (Number(menu.record.select.getAttribute("data-option-height")) || 36) +
        "px";
      if (menu.record.sourceVariant === "group") {
        const label = doc.createElement("span");
        label.className = "lai-select-option-label";
        label.textContent = option.label;
        node.append(label);
      } else node.textContent = option.label;
      node.addEventListener("pointerdown", (event) => event.preventDefault());
      node.addEventListener("pointermove", () => {
        if (!option.disabled) highlight(i);
      });
      node.addEventListener("click", (event) => commit(i, event.detail > 0));
      menu.list.append(node);
      return node;
    });
    if (!menu.options.length) {
      const empty = doc.createElement("div");
      empty.className = "lai-select-empty";
      if (menu.record.sourceVariant === "product") {
        empty.setAttribute("role", "status");
        empty.innerHTML = '<svg aria-hidden="true" width="80" height="80" viewBox="0 0 80 80" fill="none"><path d="M74 31.5908L68.245 67.3335H12.4216L6.66666 27.3335H36.5926L37.1681 31.5908H74Z" fill="var(--ink-200)"/><path fill-rule="evenodd" d="M64.0771 12.6667L63.5582 30.2574H62.2168L62.5893 14.0001H17.4105L17.3151 26.0001H15.9738L15.9226 12.6667H64.0771Z" fill="var(--ink-500)"/><path d="M50.6666 20.6667H55.3333V22.0001H50.6666V20.6667Z" fill="var(--ink-500)"/><path d="M13.1579 49.3333L12 42H32.8421L34 49.3333H13.1579Z" fill="var(--brand-500)"/></svg><span>暂无数据</span>';
      } else empty.textContent = "无匹配选项";
      menu.list.append(empty);
    }
    const selected = menu.options.findIndex(
      (option) =>
        option.index === menu.record.select.selectedIndex && !option.disabled,
    );
    // Establish the scroll viewport before revealing a selected stage near its end.
    if (menu.record.sourceVariant) place();
    highlight(selected >= 0 ? selected : nextEnabled(menu.options, -1, "Home"));
    if (!menu.record.sourceVariant) place();
  }
  // 选项多于 8 个时自动出现搜索框；data-searchable="false" 可以关掉。
  const AUTO_SEARCH_MIN = 9;
  function wantsSearch(select) {
    if (select.hasAttribute("data-searchable"))
      return select.getAttribute("data-searchable") !== "false";
    return select.options.length >= AUTO_SEARCH_MIN;
  }
  function open(record, pointer = false) {
    if (record.select.disabled || !record.select.isConnected) return;
    close();
    sync(record);
    const box = doc.createElement("div"),
      list = doc.createElement("div");
    box.className = "lai-select-menu";
    const inlineSearch = record.select.getAttribute("data-searchable") === "inline";
    if (record.sourceVariant) {
      box.classList.add(`is-customer-${record.sourceVariant}`);
    }
    if ((record.sourceVariant && pointer) || inlineSearch) box.classList.add("is-entering");
    if (inlineSearch) box.addEventListener("animationend", (event) => {
      if (event.target === box && box.classList.contains("is-entering"))
        box.classList.remove("is-entering");
    });
    list.className = "lai-select-options";
    list.id = record.listId;
    list.setAttribute("role", "listbox");
    const label = record.button.getAttribute("aria-label");
    if (label) list.setAttribute("aria-label", label);
    const host = record.button.closest?.('[role="dialog"][aria-modal="true"]') || null;
    opened = {
      record,
      host,
      pointer,
      box,
      list,
      nodes: [],
      options: [],
      active: -1,
      search: null,
      quickInline: inlineSearch,
    };
    if (wantsSearch(record.select)) {
      const search = doc.createElement("input");
      search.type = "search";
      search.className = "lai-select-search";
      search.placeholder = "搜索";
      search.setAttribute("aria-label", `搜索${label || "选项"}`);
      search.setAttribute("aria-controls", list.id);
      search.setAttribute("aria-autocomplete", "list");
      search.addEventListener("input", () => renderOptions(search.value));
      search.addEventListener("keydown", (event) => onKey(record, event));
      opened.search = search;
      if (record.select.getAttribute("data-searchable") === "anchor") {
        opened.inlineSearch = true;
        opened.anchoredSearch = true;
        search.placeholder = record.button.textContent;
        record.button.classList.add("is-searching");
        record.button.insertAdjacentElement("afterend", search);
      } else {
        box.append(search);
      }
      if (inlineSearch) {
        opened.inlineSearch = true;
        box.classList.add("is-inline-search");
        search.placeholder = record.button.textContent;
      }
    }
    box.append(list);
    if (host) box.style.position = "absolute";
    (host || doc.body).append(box);
    // 浮层字体跟触发框一致：点开前后字号、字体不变。
    try {
      const triggerStyle = root.getComputedStyle(record.button);
      if (triggerStyle.fontSize) box.style.fontSize = triggerStyle.fontSize;
    } catch (_) {}
    record.button.setAttribute("aria-owns", list.id);
    record.button.setAttribute("aria-expanded", "true");
    renderOptions();
    if (opened.search) opened.search.focus();
    else record.button.focus();
  }
  function onKey(record, event) {
    const key = event.key,
      current = opened?.record === record;
    if (current && event.target === opened.search && opened.search.value &&
        ["Home", "End"].includes(key)) return;
    if (key === "Escape" && current) {
      event.preventDefault();
      event.stopPropagation();
      close(true, !!opened?.quickInline);
      return;
    }
    if (key === "Tab") {
      if (current) close(true, !!opened?.quickInline);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!current) {
        open(record);
        if (opened && ["Home", "End"].includes(key))
          highlight(nextEnabled(opened.options, opened.active, key));
      } else highlight(nextEnabled(opened.options, opened.active, key));
      return;
    }
    if (key === "Enter" || (key === " " && event.target === record.button)) {
      event.preventDefault();
      event.stopPropagation();
      if (current) commit(opened.active);
      else open(record);
    }
  }
  function intercept(record, key) {
    let owner = record.select,
      descriptor;
    const own = Object.getOwnPropertyDescriptor(owner, key);
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
      owner = Object.getPrototypeOf(owner);
    }
    if (!descriptor?.get || !descriptor?.set || own?.configurable === false)
      return;
    Object.defineProperty(record.select, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        descriptor.set.call(this, value);
        if (opened?.record === record) close();
        sync(record);
      },
    });
    record.cleanup.push(() => {
      if (own) Object.defineProperty(record.select, key, own);
      else delete record.select[key];
    });
  }
  function bind(record, target, type, fn) {
    target.addEventListener(type, fn);
    record.cleanup.push(() => target.removeEventListener(type, fn));
  }
  function remove(record) {
    if (opened?.record === record) close();
    record.cleanup.forEach((fn) => fn());
    record.button.remove();
    record.clear?.remove();
    record.error?.remove();
    record.select.classList.remove("lai-select-native");
    for (const key of ["tabindex", "aria-hidden"]) {
      const old = record.original[key];
      if (old === null) record.select.removeAttribute(key);
      else record.select.setAttribute(key, old);
    }
    records.delete(record);
    lookup.delete(record.select);
  }
  // 原生下拉本来就撑满父容器时，换成的触发框也写 100%，窗口缩放时跟着变。
  function fillsParent(select, rect) {
    try {
      const parent = select.parentElement;
      if (!parent || !rect.width) return false;
      const style = root.getComputedStyle(parent);
      if (style.display.includes("flex") || style.display.includes("grid")) return false;
      const inner = parent.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
      return inner > 0 && Math.abs(inner - rect.width) <= 1;
    } catch (_) {
      return false;
    }
  }
  // 触发框至少要放得下最长的选项，免得被挤成「全部负…」。
  let measureContext = null;
  function fitWidth(record) {
    const { select, button } = record;
    if (select.style.width || button.style.width === "100%" || !button.isConnected) return;
    try {
      measureContext = measureContext || doc.createElement("canvas").getContext("2d");
      const style = root.getComputedStyle(button);
      measureContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const longest = Math.max(0, ...Array.from(select.options).map((o) => measureContext.measureText(o.text).width));
      const need = Math.min(320, Math.ceil(longest + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 4));
      if (need > button.getBoundingClientRect().width) button.style.width = need + "px";
    } catch (_) {}
  }
  function needsEnhance(node) {
    const list = node.matches?.("select") ? [node] : [...(node.querySelectorAll?.("select") || [])];
    return list.some((s) => !lookup.has(s) && !s.multiple && !(s.size > 1));
  }
  // 以后任何地方新出现的 <select> 都自动换成同一个下拉，不用每个页面各写一遍。
  let watching = false;
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
          if (n.nodeType === 1 && (n.matches?.("select") || n.querySelector?.("select"))) pending.add(n);
      if (pending.size && !queued) {
        queued = true;
        (root.requestAnimationFrame || ((f) => setTimeout(f, 16)))(flush);
      }
    }).observe(target, { childList: true, subtree: true });
  }
  function enhance(scope = doc) {
    if (!doc || !scope) return;
    close();
    for (const record of records)
      if (
        !record.select.isConnected ||
        record.select.multiple ||
        record.select.size > 1
      )
        remove(record);
    const selects = [
      ...(scope.matches?.("select") ? [scope] : []),
      ...scope.querySelectorAll("select"),
    ];
    for (const select of selects) {
      if (select.multiple || select.size > 1) continue;
      if (lookup.has(select)) {
        sync(lookup.get(select));
        continue;
      }
      const button = doc.createElement("button"),
        rect = select.getBoundingClientRect();
      button.type = "button";
      button.className = select.className + " lai-select-trigger";
      button.style.cssText = select.style.cssText;
      button.style.width =
        select.style.width ||
        (fillsParent(select, rect) ? "100%" : rect.width ? rect.width + "px" : root.getComputedStyle(select).width);
      button.id = `lai-select-trigger-${++sequence}`;
      const label =
        select.getAttribute("aria-label") ||
        Array.from(select.labels || [])
          .map((l) => l.textContent.trim())
          .join(" ");
      if (label) button.setAttribute("aria-label", label);
      for (const attribute of ["aria-labelledby", "aria-describedby", "title"])
        if (select.hasAttribute(attribute))
          button.setAttribute(attribute, select.getAttribute(attribute));
      if (select.hasAttribute("tabindex"))
        button.setAttribute("tabindex", select.getAttribute("tabindex"));
      const record = {
        select,
        button,
        sourceVariant: select.closest?.("#customer-form")
          ? ({ customerStage: "stage", previewGroup: "group", productType: "product" }[select.name] || "")
          : "",
        listId: `lai-select-list-${sequence}`,
        cleanup: [],
        original: {
          tabindex: select.getAttribute("tabindex"),
          "aria-hidden": select.getAttribute("aria-hidden"),
        },
      };
      button.setAttribute("role", "combobox");
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", record.listId);
      select.insertAdjacentElement("afterend", button);
      if (record.sourceVariant === "product" && Array.from(select.options).some(option => option.value === "" && !option.disabled)) {
        const clear = doc.createElement("button");
        clear.type = "button";
        clear.className = "lai-select-clear";
        clear.setAttribute("aria-label", `清除${label || "主营产品"}`);
        clear.innerHTML = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="6" fill="currentColor"/><path d="m4 4 4 4m0-4-4 4" fill="none" stroke="#fff" stroke-width="1"/></svg>';
        record.clear = clear;
        button.insertAdjacentElement("afterend", clear);
        bind(record, clear, "pointerdown", event => event.preventDefault());
        bind(record, clear, "click", event => {
          event.preventDefault();
          event.stopPropagation();
          clearValue(record, event.detail > 0);
        });
      }
      select.classList.add("lai-select-native");
      select.setAttribute("tabindex", "-1");
      select.setAttribute("aria-hidden", "true");
      records.add(record);
      lookup.set(select, record);
      bind(record, button, "click", (event) => {
        if (opened?.record === record) close(false, event.detail > 0);
        else open(record, event.detail > 0);
      });
      bind(record, button, "keydown", (event) => onKey(record, event));
      bind(record, select, "change", () => {
        if (opened?.record === record) close();
        sync(record);
      });
      bind(record, select, "focus", () => button.focus());
      bind(record, select, "invalid", (event) => {
        event.preventDefault();
        close();
        button.setAttribute("aria-invalid", "true");
        button.focus();
        if (select.validationMessage) {
          record.error?.remove();
          record.error = doc.createElement("span");
          record.error.className = "lai-select-validation";
          record.error.setAttribute("role", "alert");
          record.error.textContent = root.LaiFormCheck?.describe(select) || select.validationMessage;
          button.insertAdjacentElement("afterend", record.error);
        }
      });
      for (const labelElement of Array.from(select.labels || []))
        bind(record, labelElement, "click", (event) => {
          event.preventDefault();
          if (!button.disabled) button.focus();
        });
      for (const key of ["value", "selectedIndex", "disabled", "required"])
        intercept(record, key);
      if (select.form)
        bind(record, select.form, "reset", () =>
          setTimeout(() => {
            if (opened?.record === record) close();
            sync(record);
          }, 0),
        );
      sync(record);
      fitWidth(record);
    }
    if (!listening) {
      listening = true;
      doc.addEventListener("pointerdown", (event) => {
        if (
          opened &&
          !opened.box.contains(event.target) &&
          !opened.record.button.contains(event.target) &&
          !opened.record.clear?.contains(event.target) &&
          !opened.search?.contains(event.target)
        )
          close(false, true);
      });
      root.addEventListener("resize", () => close());
    }
  }
  const api = { enhance, watch, close, positionMenu, nextEnabled, wantsSearch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.LaiCustomerSelect = api;
    // 页面一加载就开始盯着：不管哪个页面渲染出 <select>，都会换成统一的下拉。
    if (doc?.body) watch();
    else doc?.addEventListener?.("DOMContentLoaded", () => watch());
  }
})(typeof window !== "undefined" ? window : globalThis);
