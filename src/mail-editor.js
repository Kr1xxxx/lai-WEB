(function (root) {
  "use strict";
  // 写信用的富文本编辑器：在开源编辑器 Squire（Fastmail，见 vendor/squire）之上加一条工具栏。
  // 放进编辑器的 HTML（包括回复时引用的原邮件）都先经 DOMPurify 净化；两个库缺失时退回到纯文本，不会把未净化的 HTML 写进页面。
  const SIZES = [["", "字号"], ["12px", "小"], ["14px", "正常"], ["18px", "大"], ["24px", "特大"]];
  const COLORS = [["", "颜色"], ["#1d273e", "黑"], ["#d64552", "红"], ["#0a6aff", "蓝"], ["#1a7f45", "绿"], ["#d9822b", "橙"], ["#8c95a5", "灰"]];
  const BUTTONS = [
    ["bold", "B", "加粗"], ["italic", "I", "斜体"], ["underline", "U", "下划线"], ["strike", "S", "删除线"],
    ["ul", "• 列表", "项目列表"], ["ol", "1. 列表", "编号列表"], ["quote", "❝ 引用", "引用"], ["unquote", "取消引用", "取消引用"],
    ["link", "链接", "插入链接"], ["image", "图片", "插入图片"], ["clear", "清除格式", "清除格式"], ["undo", "撤销", "撤销"], ["redo", "重做", "重做"],
  ];
  const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const textToHtml = (text) => String(text ?? "").split("\n").map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`).join("");
  const htmlToText = (html) => String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

  function toolbar() {
    const select = (name, label, options) => `<select data-editor-select="${name}" aria-label="${label}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>`;
    return (
      `<div class="mail-editor-toolbar" role="toolbar" aria-label="正文格式">` +
      BUTTONS.slice(0, 4).map(([id, text, title]) => `<button type="button" class="mail-editor-button ${id}" data-editor-command="${id}" title="${title}" aria-label="${title}">${text}</button>`).join("") +
      select("size", "字号", SIZES) + select("color", "文字颜色", COLORS) +
      BUTTONS.slice(4).map(([id, text, title]) => `<button type="button" class="mail-editor-button" data-editor-command="${id}" title="${title}" aria-label="${title}">${text}</button>`).join("") +
      `<span class="mail-editor-link" hidden><input type="url" placeholder="https://" aria-label="链接地址"><button type="button" data-editor-command="link-apply">确定</button><button type="button" data-editor-command="link-cancel">取消</button></span>` +
      `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-editor-image hidden></div>`
    );
  }

  // 净化后放进编辑器。没有 DOMPurify 时只保留文字。
  function clean(html) {
    if (root.DOMPurify && typeof root.DOMPurify.sanitize === "function")
      return root.DOMPurify.sanitize(String(html ?? ""), { FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "svg", "math"], FORBID_ATTR: ["srcset", "action", "formaction"], ALLOW_DATA_ATTR: false });
    return textToHtml(htmlToText(html));
  }

  function create(node, bar, initialHtml) {
    const doc = node.ownerDocument;
    let squire = null;
    if (typeof root.Squire === "function" && root.DOMPurify) {
      try {
        squire = new root.Squire(node, { blockTag: "DIV" });
      } catch (_) {
        squire = null;
      }
    }
    const api = {
      rich: !!squire,
      getHTML: () => (squire ? squire.getHTML() : node.innerHTML),
      getText: () => String(node.innerText ?? node.textContent ?? "").replace(/ /g, " "),
      setHTML(html) {
        const safe = clean(html) || "<div><br></div>";
        if (squire) squire.setHTML(safe);
        else node.innerHTML = safe;
      },
      focus: () => (squire ? squire.focus() : node.focus()),
      destroy() {
        if (squire) squire.destroy();
        squire = null;
      },
    };
    if (!squire) node.contentEditable = "true";
    api.setHTML(initialHtml);
    if (!bar) return api;

    const linkBox = bar.querySelector(".mail-editor-link"),
      picker = bar.querySelector("[data-editor-image]");
    const exec = (command, value) => {
      try {
        doc.execCommand(command, false, value);
      } catch (_) {}
    };
    const toggle = (tag, on, off, fallback) => {
      if (!squire) return exec(fallback);
      if (squire.hasFormat(tag)) squire[off]();
      else squire[on]();
    };
    const run = {
      bold: () => toggle("B", "bold", "removeBold", "bold"),
      italic: () => toggle("I", "italic", "removeItalic", "italic"),
      underline: () => toggle("U", "underline", "removeUnderline", "underline"),
      strike: () => toggle("S", "strikethrough", "removeStrikethrough", "strikeThrough"),
      ul: () => (squire ? (squire.hasFormat("UL") ? squire.removeList() : squire.makeUnorderedList()) : exec("insertUnorderedList")),
      ol: () => (squire ? (squire.hasFormat("OL") ? squire.removeList() : squire.makeOrderedList()) : exec("insertOrderedList")),
      quote: () => (squire ? squire.increaseQuoteLevel() : exec("formatBlock", "blockquote")),
      unquote: () => (squire ? squire.decreaseQuoteLevel() : exec("outdent")),
      clear: () => (squire ? squire.removeAllFormatting() : exec("removeFormat")),
      undo: () => (squire ? squire.undo() : exec("undo")),
      redo: () => (squire ? squire.redo() : exec("redo")),
      link() {
        if (squire && squire.hasFormat("A")) return squire.removeLink();
        linkBox.hidden = false;
        linkBox.querySelector("input").focus();
      },
      "link-cancel"() {
        linkBox.hidden = true;
        linkBox.querySelector("input").value = "";
      },
      "link-apply"() {
        const input = linkBox.querySelector("input"),
          url = String(input.value || "").trim();
        run["link-cancel"]();
        if (!/^(https?:\/\/|mailto:)[^\s"<>]+$/i.test(url)) return;
        if (squire) squire.makeLink(url, { target: "_blank", rel: "noopener noreferrer" });
        else exec("createLink", url);
      },
      image: () => picker.click(),
    };
    bar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-editor-command]");
      if (!button) return;
      event.preventDefault();
      const command = run[button.dataset.editorCommand];
      if (command) command();
      if (!/^link/.test(button.dataset.editorCommand)) api.focus();
    });
    // 点工具栏按钮时不要让正文失去选区。
    bar.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) event.preventDefault();
    });
    bar.addEventListener("change", (event) => {
      const select = event.target.closest("[data-editor-select]");
      if (select) {
        const value = select.value;
        if (value && select.dataset.editorSelect === "size") squire ? squire.setFontSize(value) : exec("fontSize", value === "12px" ? 2 : value === "18px" ? 5 : value === "24px" ? 6 : 3);
        if (value && select.dataset.editorSelect === "color") squire ? squire.setTextColor(value) : exec("foreColor", value);
        select.value = "";
        return api.focus();
      }
      if (event.target === picker && picker.files && picker.files[0]) {
        const file = picker.files[0];
        picker.value = "";
        if (file.size > 2 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return bar.dispatchEvent(new root.CustomEvent("mail-editor-error", { detail: "正文里的图片要小于 2 MB，格式为 PNG、JPG、GIF 或 WebP。", bubbles: true }));
        const reader = new root.FileReader();
        reader.onload = () => {
          if (squire) squire.insertImage(String(reader.result), { alt: file.name });
          else exec("insertImage", String(reader.result));
        };
        reader.readAsDataURL(file);
      }
    });
    return api;
  }

  root.LaiMailEditor = { toolbar, create, clean, textToHtml, htmlToText };
})(typeof window === "undefined" ? globalThis : window);
