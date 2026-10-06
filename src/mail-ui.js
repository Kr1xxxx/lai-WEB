(function (root) {
  "use strict";
  // 邮件页：文件夹导航 + 邮箱绑定（目前只支持 Zoho 邮箱，只做登录验证）。
  // 绑定后仍不读取、不发送邮件；「写信」仍是保留入口。密码只提交给本机服务，界面不保存、不回显。
  const folders = [
    { id: "inbox", label: "收件箱", icon: "mail" },
    { id: "pending", label: "待处理邮件", icon: "check" },
    { id: "unread", label: "未读邮件", icon: "bell" },
    { id: "drafts", label: "草稿箱", icon: "note" },
    { id: "sent", label: "发件箱", icon: "next" },
    { id: "bulk", label: "群发箱", icon: "people" },
  ];
  const DEFAULT_FOLDER = folders[0].id;
  // 顶部三个页签。「客户」「下属」目前只有说明页：前者要等邮件读取上线，后者需要公司账号与上下级关系。
  const views = [
    { id: "mail", label: "邮件" },
    { id: "customer", label: "客户", title: "客户邮件", icon: "people", heading: "按客户查看往来邮件", note: "绑定邮箱并开启邮件读取后，这里会按客户归集往来邮件。目前还没有开启邮件读取。" },
    { id: "team", label: "下属", title: "下属邮件", icon: "lead", heading: "查看下属的邮件", note: "这需要公司账号和上下级关系。来财目前是单机版，还没有这部分。" },
  ];
  const sites = [
    { id: "cn", label: "中国站（mail.zoho.com.cn）" },
    { id: "com", label: "国际站（mail.zoho.com）" },
  ];
  const accountTypes = [
    { id: "auto", label: "自动判断" },
    { id: "personal", label: "个人邮箱（@zoho.com.cn 等）" },
    { id: "organization", label: "企业域名邮箱" },
  ];
  const normalize = (id) =>
    folders.some((folder) => folder.id === id) ? id : DEFAULT_FOLDER;
  const time = (value) => {
    const parsed = new Date(value || "");
    if (!Number.isFinite(parsed.getTime())) return "—";
    const pad = (n) => String(n).padStart(2, "0");
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  };

  function create(ctx) {
    const E = ctx.escape,
      icon = ctx.icon;
    let view = "mail",
      folder = DEFAULT_FOLDER,
      // status: loading｜ready｜error；available=false 表示当前环境（网页试用版）无法连接邮箱。
      status = "idle",
      account = null,
      available = true,
      loadError = "",
      working = false,
      loadToken = 0;
    const current = () => folders.find((item) => item.id === folder);
    const currentView = () => views.find((item) => item.id === view);
    const option = (item, selected) =>
      `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${E(item.label)}</option>`;

    function subnav() {
      return (
        `<div class="mail-views" role="tablist" aria-label="邮件视图">` +
        views
          .map(
            (item) =>
              `<button type="button" role="tab" class="mail-view ${item.id === view ? "active" : ""}" data-mail-view="${item.id}" aria-selected="${item.id === view}">${E(item.label)}</button>`,
          )
          .join("") +
        `</div>` +
        `<div class="mail-compose-split"><button type="button" class="primary mail-compose" data-feature="写信">写 信</button><button type="button" class="primary mail-compose-more" data-feature="写信选项" aria-label="更多写信选项">${icon("next")}</button></div>` +
        (view === "mail"
          ? `<div class="mail-folders" role="list">` +
            folders
              .map(
                (item) =>
                  `<button type="button" role="listitem" class="nav-entry ${item.id === folder ? "active" : ""}" data-mail-folder="${item.id}" ${item.id === folder ? 'aria-current="page"' : ""}>${icon(item.icon)}${E(item.label)}</button>`,
              )
              .join("") +
            `</div>`
          : `<p class="subnav-empty mail-view-note">${E(currentView().note)}</p>`)
      );
    }
    function body() {
      if (status === "idle" || status === "loading")
        return `<div class="empty mail-unbound" aria-busy="true"><span>正在读取邮箱绑定状态…</span></div>`;
      if (status === "error")
        return `<div class="empty mail-unbound"><div class="mail-unbound-art">${icon("mail")}</div><strong>无法读取邮箱绑定状态</strong><span>${E(loadError)}</span><button type="button" class="primary" data-mail-action="reload">重试</button></div>`;
      if (!account)
        return (
          `<div class="empty mail-unbound"><div class="mail-unbound-art">${icon("mail")}</div>` +
          `<strong>未绑定邮箱</strong>` +
          `<span>绑定 Zoho 邮箱后，可在这里集中查看和处理邮件。</span>` +
          `<button type="button" class="primary" data-mail-action="bind">绑定邮箱</button></div>`
        );
      const row = (label, value) => `<div><dt>${label}</dt><dd>${E(value)}</dd></div>`;
      return (
        `<div class="mail-bound"><div class="mail-bound-head"><div class="mail-unbound-art">${icon("mail")}</div>` +
        `<div><span class="mail-bound-tag">${icon("check")}已绑定</span><strong>${E(account.email)}</strong></div></div>` +
        `<dl class="mail-bound-facts">${row("邮箱服务", "Zoho 邮箱")}${row("收信服务器", `${account.host}:${account.port}`)}${row("绑定时间", time(account.boundAt))}${row("最近验证通过", time(account.verifiedAt))}</dl>` +
        `<p class="module-note">目前只完成绑定与登录验证，还不会读取或发送邮件，所以「${E(current().label)}」暂时没有内容。</p>` +
        `<div class="error" id="mail-account-error" role="alert"></div>` +
        `<div class="mail-bound-actions"><button type="button" data-mail-action="verify" ${working ? "disabled" : ""}>${working ? "正在验证…" : "重新验证"}</button><button type="button" data-mail-action="bind" ${working ? "disabled" : ""}>更换邮箱</button><button type="button" data-mail-action="unbind" ${working ? "disabled" : ""}>解除绑定</button></div></div>`
      );
    }
    function page() {
      if (view !== "mail") {
        const item = currentView();
        return (
          `<div class="pagebar"><div class="page-tabs"><h1>${E(item.title)}</h1></div></div>` +
          `<section class="module-page mail-page"><div class="empty mail-unbound"><div class="mail-unbound-art">${icon(item.icon)}</div><strong>${E(item.heading)}</strong><span>${E(item.note)}</span></div></section>`
        );
      }
      return (
        `<div class="pagebar"><div class="page-tabs"><h1>${E(current().label)}</h1></div></div>` +
        `<section class="module-page mail-page">${body()}</section>`
      );
    }
    function render() {
      ctx.mount(page());
    }
    const onMailPage = () => ctx.isActive?.() !== false;
    const rerender = () => {
      if (onMailPage()) render();
    };
    async function call(path, payload) {
      const response = await ctx.request(path, payload);
      let data = null;
      try {
        data = await response.json();
      } catch (_) {}
      if (!response.ok || !data || data.ok === false)
        throw Object.assign(new Error((data && data.message) || `请求失败（${response.status}）`), { status: response.status, code: data && data.code });
      return data;
    }
    function accept(data) {
      account = data.account || null;
      available = data.available !== false;
      status = "ready";
      loadError = "";
    }
    async function load() {
      const token = ++loadToken;
      status = "loading";
      try {
        const data = await call("/api/mail-account");
        if (token !== loadToken) return;
        accept(data);
      } catch (error) {
        if (token !== loadToken) return;
        status = "error";
        loadError = error.status === 404 ? "当前版本的本机服务还不支持邮箱绑定，请更新应用后再试。" : error.message;
      }
      rerender();
    }
    function showError(id, message) {
      const box = document.getElementById(id);
      if (!box) return;
      box.textContent = message;
      box.classList.toggle("visible", !!message);
    }

    function bindDialog(pointerActivated) {
      const blocked = !available;
      ctx.dialog(
        account ? "更换邮箱" : "绑定 Zoho 邮箱",
        `<form class="drawer-body mail-bind-form" id="mail-bind-form" autocomplete="off" novalidate>` +
          (blocked ? `<div class="module-note mail-bind-blocked">网页试用版运行在浏览器里，无法连接邮箱服务器。请在 Mac 上安装的来财应用里绑定。</div>` : "") +
          `<label class="field">邮箱地址<input id="mail-bind-email" name="email" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="name@yourcompany.com" value="${E(account ? account.email : "")}" required></label>` +
          `<label class="field">应用专用密码<input id="mail-bind-password" name="password" type="password" autocomplete="new-password" placeholder="在 Zoho 账户里生成，不是登录密码" required></label>` +
          `<div class="form-grid"><label class="field">Zoho 站点<select id="mail-bind-site" name="site">${sites.map((item) => option(item, account ? account.site : "cn")).join("")}</select></label>` +
          `<label class="field">账号类型<select id="mail-bind-type" name="accountType">${accountTypes.map((item) => option(item, "auto")).join("")}</select></label></div>` +
          `<div class="error" id="mail-bind-error" role="alert"></div>` +
          `<details class="mail-bind-help" open><summary>绑定前需要在 Zoho 里完成两步</summary><ol>` +
          `<li>开启 IMAP：登录 Zoho 邮箱 → 设置 → 邮件账户 → IMAP 访问，勾选启用。</li>` +
          `<li>生成应用专用密码：Zoho 账户（accounts.zoho.com.cn）→ 安全 → 应用专用密码 → 生成新密码，把生成的密码填到上面。</li>` +
          `</ol><p>来财只用它登录一次来确认可以连接，不读取、不发送邮件。密码保存在这台电脑的来财数据库里，数据库备份文件也会包含它。</p></details>` +
          `</form>`,
        `<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="mail-bind-form" id="mail-bind-submit" ${blocked ? "disabled" : ""}>验证并绑定</button>`,
        "mail-bind",
        pointerActivated,
      );
      const form = document.getElementById("mail-bind-form");
      if (!form) return;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (working || blocked) return;
        const fields = form.elements;
        const payload = {
          email: String(fields.email.value || "").trim(),
          password: String(fields.password.value || ""),
          site: fields.site.value,
          accountType: fields.accountType.value,
        };
        if (!payload.email) return showError("mail-bind-error", "请填写邮箱地址");
        if (!payload.password) return showError("mail-bind-error", "请填写应用专用密码");
        const submit = document.getElementById("mail-bind-submit");
        working = true;
        showError("mail-bind-error", "");
        if (submit) {
          submit.disabled = true;
          submit.textContent = "正在验证…";
        }
        try {
          accept(await call("/api/mail-account/bind", payload));
          working = false;
          ctx.closeDialog();
          ctx.toast("邮箱已绑定");
          rerender();
        } catch (error) {
          working = false;
          showError("mail-bind-error", error.message);
          if (submit && submit.isConnected !== false) {
            submit.disabled = false;
            submit.textContent = "验证并绑定";
          }
        }
      });
    }
    async function verify() {
      if (working || !account) return;
      working = true;
      rerender();
      let failure = "";
      try {
        accept(await call("/api/mail-account/verify", {}));
        ctx.toast("验证通过，邮箱连接正常");
      } catch (error) {
        if (error.code === "not_bound") account = null;
        failure = error.message;
      }
      working = false;
      rerender();
      if (failure) showError("mail-account-error", failure);
    }
    function unbindDialog(pointerActivated) {
      if (!account) return;
      ctx.dialog(
        "解除绑定",
        `<div class="drawer-body"><p>解除 ${E(account.email)} 的绑定？</p><div class="module-note">保存在这台电脑上的邮箱密码会一并删除。Zoho 里的邮件不受影响；之前的数据库备份文件里仍可能留有这个密码。</div><div class="error" id="mail-unbind-error" role="alert"></div></div>`,
        `<button type="button" data-action="close-modal">取消</button><button type="button" class="primary" data-mail-action="unbind-confirm">解除绑定</button>`,
        "mail-unbind",
        pointerActivated,
      );
    }
    async function unbind() {
      if (working) return;
      working = true;
      try {
        accept(await call("/api/mail-account/unbind", {}));
        working = false;
        ctx.closeDialog();
        ctx.toast("已解除绑定");
        rerender();
      } catch (error) {
        working = false;
        showError("mail-unbind-error", error.message);
      }
    }
    function action(name, pointerActivated = false) {
      if (name === "bind") return bindDialog(pointerActivated);
      if (name === "verify") return verify();
      if (name === "unbind") return unbindDialog(pointerActivated);
      if (name === "unbind-confirm") return unbind();
      if (name === "reload") {
        const pending = load();
        render();
        return pending;
      }
    }
    return {
      subnav,
      page,
      render,
      action,
      showView(next) {
        view = views.some((item) => item.id === next) ? next : "mail";
        const pending = view === "mail" && (status === "idle" || status === "error") ? load() : null;
        render();
        return pending;
      },
      view: () => view,
      select(next) {
        view = "mail";
        folder = normalize(next);
        const pending = status === "idle" || status === "error" ? load() : null;
        render();
        return pending;
      },
      folder: () => folder,
      account: () => account,
      busy: () => working,
    };
  }
  root.LaiMailUI = { create, folders, views, DEFAULT_FOLDER };
})(typeof window === "undefined" ? globalThis : window);
