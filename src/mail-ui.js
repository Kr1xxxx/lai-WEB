(function (root) {
  "use strict";
  // 邮件页界面骨架：只有导航与“未绑定邮箱”空态。
  // 不连接邮箱、不收发邮件、不读写任何数据；写信与绑定邮箱仍是保留入口。
  const folders = [
    { id: "inbox", label: "收件箱", icon: "mail" },
    { id: "pending", label: "待处理邮件", icon: "check" },
    { id: "unread", label: "未读邮件", icon: "bell" },
    { id: "drafts", label: "草稿箱", icon: "note" },
    { id: "sent", label: "发件箱", icon: "next" },
    { id: "bulk", label: "群发箱", icon: "people" },
  ];
  const DEFAULT_FOLDER = folders[0].id;
  const normalize = (id) =>
    folders.some((folder) => folder.id === id) ? id : DEFAULT_FOLDER;

  function create(ctx) {
    const E = ctx.escape,
      icon = ctx.icon;
    let folder = DEFAULT_FOLDER;
    const current = () => folders.find((item) => item.id === folder);

    function subnav() {
      return (
        `<h3>邮件</h3>` +
        `<button type="button" class="primary mail-compose" data-feature="写信">写 信</button>` +
        `<div class="mail-folders" role="list">` +
        folders
          .map(
            (item) =>
              `<button type="button" role="listitem" class="nav-entry ${item.id === folder ? "active" : ""}" data-mail-folder="${item.id}" ${item.id === folder ? 'aria-current="page"' : ""}>${icon(item.icon)}${E(item.label)}</button>`,
          )
          .join("") +
        `</div>`
      );
    }
    function page() {
      return (
        `<div class="pagebar"><div class="page-tabs"><h1>${E(current().label)}</h1></div></div>` +
        `<section class="module-page mail-page"><div class="empty mail-unbound">` +
        `<div class="mail-unbound-art">${icon("mail")}</div>` +
        `<strong>未绑定邮箱</strong>` +
        `<span>绑定邮箱后，可在这里集中查看和处理邮件。</span>` +
        `<button type="button" class="primary" data-feature="绑定邮箱">绑定邮箱</button>` +
        `</div></section>`
      );
    }
    function render() {
      ctx.mount(page());
    }
    return {
      subnav,
      page,
      render,
      select(next) {
        folder = normalize(next);
        render();
      },
      folder: () => folder,
    };
  }
  root.LaiMailUI = { create, folders, DEFAULT_FOLDER };
})(typeof window === "undefined" ? globalThis : window);
