(function (root) {
  "use strict";
  // 文字被省略号截断时，鼠标移上去用系统提示显示全文。全应用一处处理，各页面不用再单独加 title。
  const MARK = "data-lai-auto-title";
  const MAX_CLIMB = 3;

  function isTruncated(el, style) {
    if (!el || !style) return false;
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== "none";
    if (clamp) return el.scrollHeight - el.clientHeight > 2;
    if (style.textOverflow !== "ellipsis") return false;
    return el.scrollWidth - el.clientWidth > 1;
  }
  function fullText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  // 从鼠标所在的元素往外找最多 3 层，找到被截断的那个，补上 title；已经有人写了 title 的不动。
  function apply(target, getStyle) {
    let el = target;
    for (let depth = 0; el && el.nodeType === 1 && depth <= MAX_CLIMB; depth++, el = el.parentElement) {
      if (el.tagName === "BODY" || el.tagName === "HTML") return null;
      if (el.hasAttribute("title") && !el.hasAttribute(MARK)) return null;
      const truncated = isTruncated(el, getStyle(el));
      if (truncated) {
        const text = fullText(el);
        if (text && el.getAttribute("title") !== text) {
          el.setAttribute("title", text);
          el.setAttribute(MARK, "");
        }
        return el;
      }
      if (el.hasAttribute(MARK)) {
        // 窗口变宽后不再截断：撤掉自动加的 title，免得多余的提示
        el.removeAttribute("title");
        el.removeAttribute(MARK);
      }
    }
    return null;
  }
  function install(doc) {
    const view = doc?.defaultView;
    if (!doc || !view || doc.__laiTruncationTitle) return;
    doc.__laiTruncationTitle = true;
    doc.addEventListener("pointerover", (event) => apply(event.target, (el) => view.getComputedStyle(el)), true);
  }
  const api = { isTruncated, fullText, apply, install };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.LaiTruncationTitle = api;
    install(root.document);
  }
})(typeof window !== "undefined" ? window : globalThis);
