(function (window) {
  "use strict";
  const enhanced = new WeakSet();
  const documents = new WeakSet();
  const selector = "input[list],input[data-lai-suggestions-list]";
  let active = null;
  let nextId = 0;
  let selecting = false;

  function close() {
    if (!active) return;
    active.input.setAttribute("aria-expanded", "false");
    active.input.removeAttribute("aria-activedescendant");
    active.input.removeAttribute("aria-controls");
    active.menu.remove();
    active = null;
  }

  function optionsFor(input) {
    const list = input.ownerDocument.getElementById(
      input.getAttribute("data-lai-suggestions-list"),
    );
    const query = input.value.trim().toLocaleLowerCase();
    const seen = new Set();
    return [...(list?.options || [])].flatMap((option) => {
      const value = String(option.value || "");
      const label = String(option.label || value);
      if (!value || option.disabled || option.hidden || seen.has(value))
        return [];
      seen.add(value);
      return !query || `${label} ${value}`.toLocaleLowerCase().includes(query)
        ? [{ value, label }]
        : [];
    });
  }

  function inputVisible(input) {
    const rect = input.getBoundingClientRect();
    const height = input.ownerDocument.defaultView.innerHeight ||
      input.ownerDocument.documentElement.clientHeight;
    const body = input.closest(".drawer-body")?.getBoundingClientRect();
    const top = Math.max(0, body?.top ?? 0);
    const bottom = Math.min(height, body?.bottom ?? height);
    return bottom > top && rect.bottom > top && rect.top < bottom;
  }

  function positionMenu(input, menu) {
    const rect = input.getBoundingClientRect();
    const view = input.ownerDocument.defaultView;
    const width =
      view.innerWidth || input.ownerDocument.documentElement.clientWidth;
    const height =
      view.innerHeight || input.ownerDocument.documentElement.clientHeight;
    menu.style.minWidth = `${rect.width}px`;
    menu.style.width = `${rect.width}px`;
    menu.style.maxHeight = "268px";
    const desiredHeight = menu.getBoundingClientRect().height;
    const below = Math.max(0, height - rect.bottom - 12);
    const above = Math.max(0, rect.top - 12);
    const upward = below < desiredHeight && above > below;
    menu.style.maxHeight = `${Math.min(268, upward ? above : below)}px`;
    const actualHeight = menu.getBoundingClientRect().height;
    menu.style.left = `${Math.max(8, Math.min(rect.left, width - rect.width - 8))}px`;
    menu.style.top = `${upward ? rect.top - actualHeight - 4 : rect.bottom + 4}px`;
  }

  function highlight(index) {
    if (!active || !active.items.length) return;
    active.index = (index + active.items.length) % active.items.length;
    active.items.forEach((item, position) =>
      item.setAttribute("aria-selected", String(position === active.index)),
    );
    const item = active.items[active.index];
    active.input.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  function choose(input, value) {
    close();
    input.value = value;
    selecting = true;
    try {
      const Event = input.ownerDocument.defaultView.Event;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      selecting = false;
    }
  }

  function open(input) {
    if (selecting || input.disabled || input.readOnly) return;
    close();
    if (!inputVisible(input)) return;
    const doc = input.ownerDocument;
    const options = optionsFor(input);
    const menu = doc.createElement("div");
    menu.className = "lai-suggestions";
    menu.id = `lai-suggestions-${++nextId}`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "输入建议");
    const items = options.map((option, index) => {
      const item = doc.createElement("div");
      item.className = "lai-suggestion";
      item.id = `${menu.id}-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.textContent = option.label;
      item.addEventListener("pointerdown", (event) => event.preventDefault());
      item.addEventListener("click", () => choose(input, option.value));
      item.addEventListener("pointermove", () => {
        if (active?.menu === menu) highlight(index);
      });
      menu.appendChild(item);
      return item;
    });
    if (!items.length) {
      const empty = doc.createElement("div");
      empty.className = "lai-suggestions-empty";
      empty.textContent = "暂无可选项，可以输入";
      menu.appendChild(empty);
    }
    active = { input, menu, items, options, index: -1 };
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", menu.id);
    doc.body.appendChild(menu);
    positionMenu(input, menu);
  }

  function enhance(root = window.document) {
    const inputs = [
      ...(root.matches?.(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];
    inputs.forEach((input) => {
      if (enhanced.has(input)) return;
      const listId =
        input.getAttribute("list") ||
        input.getAttribute("data-lai-suggestions-list");
      if (!listId) return;
      enhanced.add(input);
      input.setAttribute("data-lai-suggestions-list", listId);
      input.removeAttribute("list");
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-haspopup", "listbox");
      input.setAttribute("aria-expanded", "false");
      input.addEventListener("focus", () => open(input));
      input.addEventListener("click", () => open(input));
      input.addEventListener("input", () => open(input));
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Escape" || event.key === "Tab") {
          if (active?.input === input) {
            close();
            if (event.key === "Escape") event.preventDefault();
          }
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (active?.input !== input) open(input);
          if (active?.input === input)
            highlight(
              active.index < 0
                ? event.key === "ArrowDown"
                  ? 0
                  : active.items.length - 1
                : active.index + (event.key === "ArrowDown" ? 1 : -1),
            );
        } else if (
          event.key === "Enter" &&
          active?.input === input &&
          active.index >= 0
        ) {
          event.preventDefault();
          choose(input, active.options[active.index].value);
        }
      });
      const doc = input.ownerDocument;
      if (!documents.has(doc)) {
        documents.add(doc);
        const reposition = () => {
          if (active?.input.ownerDocument !== doc) return;
          if (!inputVisible(active.input)) {
            close();
            return;
          }
          positionMenu(active.input, active.menu);
        };
        const dismissOutside = (event) => {
          if (
            active &&
            event.target !== active.input &&
            !active.menu.contains(event.target)
          )
            close();
        };
        doc.addEventListener("pointerdown", dismissOutside, true);
        doc.addEventListener("focusin", dismissOutside, true);
        doc.addEventListener("scroll", reposition, true);
        doc.defaultView.addEventListener("resize", reposition);
      }
    });
  }
  window.LaiCustomerSuggestions = { enhance, close };
})(window);
