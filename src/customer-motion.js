(function (root) {
  "use strict";

  const entries = {
    detail: [".lcd-root", "lcd-view-enter"],
    filter: [".lcd-body", "lcd-filter-enter"],
    list: [".customer-main", "customer-list-enter"],
    listExit: [".customer-main", "customer-list-exit"],
    exit: [".lcd-root", "lcd-view-exit"],
  };

  function targetFor(container, kind) {
    const [selector] = entries[kind] || [];
    return selector ? container?.querySelector?.(selector) || null : null;
  }

  function enter(container, kind) {
    const target = targetFor(container, kind);
    const className = entries[kind]?.[1];
    if (!target || !className) return null;
    target.classList.add(className);
    if (["detail", "tab", "filter", "list"].includes(kind)) {
      let timer;
      const finish = (event) => {
        if (event && event.target !== target) return;
        target.removeEventListener("animationend", finish);
        clearTimeout(timer);
        target.classList.remove(className);
      };
      target.addEventListener("animationend", finish);
      timer = setTimeout(finish, 360);
      timer?.unref?.();
    }
    return target;
  }

  function prefersReducedMotion(target) {
    return Boolean(
      target?.ownerDocument?.defaultView
        ?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    );
  }

  function exit(container, kind, options = {}) {
    const target = enter(container, kind);
    if (!target) return Promise.resolve(null);
    const fallbackMs = prefersReducedMotion(target)
      ? 80
      : Math.max(0, Number(options.fallbackMs) || 180);
    return new Promise((resolve) => {
      let timer;
      const finish = (event) => {
        if (event && event.target !== target) return;
        target.removeEventListener("animationend", finish);
        clearTimeout(timer);
        resolve(target);
      };
      target.addEventListener("animationend", finish);
      timer = setTimeout(finish, fallbackMs);
    });
  }

  function exitDetail(container, options = {}) {
    return exit(container, "exit", options);
  }

  function exitList(container, options = {}) {
    return exit(container, "listExit", { fallbackMs: 130, ...options });
  }

  function placeTabIndicator(container, animate = false) {
    const tabs = container?.querySelector?.(".lcd-tabs");
    const active = tabs?.querySelector?.("button.active");
    const indicator = tabs?.querySelector?.(".lcd-active-indicator");
    if (!active || !indicator) return null;
    if (!animate) indicator.classList.remove("ready");
    const activeBounds = active.getBoundingClientRect();
    const tabBounds = tabs.getBoundingClientRect();
    const left = activeBounds.left - tabBounds.left + tabs.scrollLeft;
    const right = left + activeBounds.width;
    if (left < tabs.scrollLeft) tabs.scrollLeft = left;
    else if (right > tabs.scrollLeft + tabs.clientWidth)
      tabs.scrollLeft = right - tabs.clientWidth;
    indicator.style.transform =
      `translateX(${Math.round(left)}px) scaleX(${Math.round(activeBounds.width)})`;
    if (!animate) {
      const view = indicator.ownerDocument?.defaultView;
      // Commit the initial/keyboard position before enabling later pointer transitions.
      void view?.getComputedStyle?.(indicator)?.transform;
      const frame = view?.requestAnimationFrame;
      if (frame) frame(() => {
        if (indicator.isConnected) indicator.classList.add("ready");
      });
      else indicator.classList.add("ready");
    }
    return indicator;
  }

  const api = { enter, exitDetail, exitList, placeTabIndicator };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerMotion = api;
})(typeof window !== "undefined" ? window : globalThis);
