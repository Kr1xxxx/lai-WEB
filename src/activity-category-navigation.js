(function (root) {
  "use strict";
  let nav = null, viewport = null, list = null, observer = null, offset = 0;
  const reduced = () => root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const selected = () => nav?.querySelector('[data-activity-filter][aria-pressed="true"]');
  function measure() {
    const width = list.getBoundingClientRect().width;
    const overflow = width > nav.clientWidth + 0.5;
    const hidingFocusedArrow = !overflow && nav.contains(document.activeElement) &&
      document.activeElement.matches("[data-activity-scroll]");
    nav.querySelectorAll(".lcd-activity-arrow").forEach((arrow) => { arrow.hidden = !overflow; });
    if (hidingFocusedArrow) {
      selected()?.focus({ preventScroll: true });
    }
    return Math.max(0, Math.ceil(width - viewport.clientWidth));
  }
  function apply(max, immediate) {
    offset = Math.max(0, Math.min(max, offset));
    // A native Tab may scroll the hidden viewport. The list's transform owns
    // local navigation, so keep native scroll and transform from compounding.
    viewport.scrollLeft = 0;
    if (immediate || reduced()) list.style.transition = "none";
    list.style.transform = `translateX(${-offset}px)`;
    if (immediate || reduced()) {
      void list.offsetWidth;
      list.style.transition = "";
    }
    nav.querySelector('[data-activity-scroll="left"]').setAttribute("aria-disabled", String(offset <= 0));
    nav.querySelector('[data-activity-scroll="right"]').setAttribute("aria-disabled", String(offset >= max));
  }
  function update(reveal, immediate = false) {
    if (!nav?.isConnected) return;
    const max = measure();
    if (reveal?.matches("[data-activity-filter]") && list.contains(reveal)) {
      const item = reveal.getBoundingClientRect(), bounds = list.getBoundingClientRect();
      const start = item.left - bounds.left, end = start + item.width;
      if (start < offset) offset = start;
      else if (end > offset + viewport.clientWidth) offset = end - viewport.clientWidth;
    }
    apply(max, immediate);
  }
  function scroll(direction) {
    if (!nav?.isConnected) return;
    const max = measure();
    offset += (direction === "left" ? -1 : 1) * viewport.clientWidth;
    apply(max, false);
  }
  function onClick(event) {
    const arrow = event.target.closest("[data-activity-scroll]");
    if (arrow && nav.contains(arrow)) scroll(arrow.dataset.activityScroll);
  }
  function onFocus(event) {
    if (event.target.matches("[data-activity-filter]")) update(event.target, true);
  }
  function onKey(event) {
    if (event.key !== "Tab") return;
    const buttons = [...nav.querySelectorAll("button")].filter((button) => !button.hidden);
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    const next = buttons[index + (event.shiftKey ? -1 : 1)];
    // Reveal before the browser's native focus scroll, without overriding Tab.
    if (next?.matches("[data-activity-filter]")) update(next, true);
  }
  function mount(container) {
    const next = container?.querySelector(".lcd-activity-filters") || null;
    if (next === nav) {
      if (nav) update(nav.contains(document.activeElement) ? document.activeElement : selected(), true);
      return;
    }
    observer?.disconnect();
    if (nav) {
      nav.removeEventListener("click", onClick);
      nav.removeEventListener("focusin", onFocus);
      nav.removeEventListener("keydown", onKey);
    }
    nav = next;
    viewport = nav?.querySelector(".lcd-activity-clip") || null;
    list = nav?.querySelector(".lcd-activity-list") || null;
    observer = null;
    offset = 0;
    if (!nav) return;
    nav.addEventListener("click", onClick);
    nav.addEventListener("focusin", onFocus);
    nav.addEventListener("keydown", onKey);
    update(selected(), true);
    observer = new ResizeObserver(() => update(
      nav?.contains(document.activeElement) ? document.activeElement : selected(), true,
    ));
    observer.observe(nav);
    observer.observe(list);
  }
  root.LaiActivityCategoryNavigation = { mount, update, scroll };
})(window);
