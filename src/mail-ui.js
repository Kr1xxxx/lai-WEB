(function (root) {
  "use strict";
  // 邮件页：绑定 Zoho 邮箱后，读取收件箱／未读／待处理／已发送，阅读、回复、转发、写信、附件、草稿，以及按客户查看往来邮件。
  // 只通过本机服务通信；密码只在绑定时提交给本机服务，界面不保存、不回显。邮件正文放在禁用脚本的隔离框里显示，远程图片不加载。
  const folders = [
    { id: "inbox", label: "收件箱", icon: "mail" },
    { id: "pending", label: "待处理邮件", icon: "check" },
    { id: "unread", label: "未读邮件", icon: "bell" },
    { id: "drafts", label: "草稿箱", icon: "note" },
    { id: "sent", label: "发件箱", icon: "next" },
    { id: "bulk", label: "群发箱", icon: "people" },
  ];
  const DEFAULT_FOLDER = folders[0].id;
  const views = [
    { id: "mail", label: "邮件" },
    { id: "customer", label: "客户" },
    { id: "team", label: "下属" },
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
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  const normalize = (id) => (folders.some((folder) => folder.id === id) ? id : DEFAULT_FOLDER);
  const pad = (n) => String(n).padStart(2, "0");
  const fullTime = (value) => {
    const d = new Date(value || "");
    if (!Number.isFinite(d.getTime())) return "—";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const shortTime = (value, today = new Date()) => {
    const d = new Date(value || "");
    if (!Number.isFinite(d.getTime())) return "";
    if (d.toDateString() === today.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.getFullYear() === today.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const fileSize = (bytes) => {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };
  const person = (item) => (item ? item.name || item.address || "" : "");
  const addressLine = (list) => (list || []).map((item) => (item.name ? `${item.name} <${item.address}>` : item.address)).join(", ");
  const validAddress = (value) => /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value);
  // 客户档案里出现的全部邮箱（公司邮箱与各联系人邮箱）。
  function customerAddresses(profile) {
    const values = [profile?.email, ...(Array.isArray(profile?.emails) ? profile.emails : []), ...(Array.isArray(profile?.contacts) ? profile.contacts.map((item) => item?.email) : []), profile?.alternateEmail];
    return [...new Set(values.map((value) => String(value ?? "").trim().toLowerCase()).filter(validAddress))];
  }
  const replySubject = (subject, prefix) => (new RegExp(`^\\s*${prefix === "Re" ? "(re|回复|答复)" : "(fwd?|转发)"}\\s*[:：]`, "i").test(subject || "") ? subject : `${prefix}: ${subject || ""}`);
  const quote = (text) => String(text || "").split("\n").map((line) => "> " + line).join("\n");

  function create(ctx) {
    const E = ctx.escape,
      icon = ctx.icon;
    let view = "mail",
      folder = DEFAULT_FOLDER,
      // 绑定状态：idle｜loading｜ready｜error；available=false 表示当前环境（网页试用版）无法连接邮箱。
      status = "idle",
      account = null,
      available = true,
      loadError = "",
      working = false,
      loadToken = 0;
    // 邮件列表、阅读、草稿、客户往来、写信的状态。
    let list = { key: "", loading: false, error: "", items: [], total: 0, page: 1, pageSize: 50 },
      listToken = 0,
      query = "",
      counts = null,
      reading = null,
      readToken = 0,
      drafts = { loading: false, error: "", items: [], loaded: false },
      customerName = "",
      thread = { name: "", loading: false, error: "", items: [] },
      threadToken = 0,
      compose = null,
      confirmTarget = null,
      // 群发：批次列表、正在查看的批次、新建群发窗口的状态。
      bulk = { loading: false, error: "", items: [] },
      batch = null,
      batchToken = 0,
      pendingBatch = "",
      bulkToken = 0,
      bulkDraft = null;
    const BULK_STATUS = { sending: "发送中", done: "已完成", stopped: "已停止", cancelled: "已手动停止", interrupted: "已中断" };
    const ITEM_STATUS = { pending: "待发送", sent: "已发送", failed: "失败", skipped: "未发送" };
    const current = () => folders.find((item) => item.id === folder);
    const option = (item, selected) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${E(item.label)}</option>`;
    const onMailPage = () => ctx.isActive?.() !== false;
    const rerender = () => {
      if (onMailPage()) render();
    };

    // ---- 客户与邮箱地址的对应 ----
    function customers() {
      const all = (ctx.getCustomers && ctx.getCustomers()) || {};
      const rows = [];
      for (const name of Object.keys(all)) {
        if (ctx.isArchived && ctx.isArchived(all[name])) continue;
        const addresses = customerAddresses(all[name]);
        if (!addresses.length) continue;
        // 群发时用的称呼：邮箱对应的联系人姓名，其次主要联系人。
        const contacts = Array.isArray(all[name].contacts) ? all[name].contacts.filter((item) => item && typeof item === "object") : [];
        const matched = contacts.find((item) => String(item.email ?? "").trim().toLowerCase() === addresses[0]);
        const contact = String((matched && (matched.contact || matched.name)) || all[name].contact || (contacts[0] && (contacts[0].contact || contacts[0].name)) || "").trim();
        rows.push({ name, addresses, contact });
      }
      return rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    }
    function addressIndex() {
      const index = new Map();
      for (const row of customers()) for (const address of row.addresses) if (!index.has(address)) index.set(address, row.name);
      return index;
    }
    function customerOf(message, index) {
      const candidates = message.box === "sent" ? [...(message.to || []), ...(message.cc || [])] : [message.from, ...(message.to || []), ...(message.cc || [])];
      for (const item of candidates) if (item && index.has(item.address)) return index.get(item.address);
      return "";
    }

    // ---- 与本机服务通信 ----
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
    const withQuery = (path, params) => path + "?" + Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && value !== null).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    function accept(data) {
      account = data.account || null;
      available = data.available !== false;
      status = "ready";
      loadError = "";
    }
    function resetMail() {
      list = { key: "", loading: false, error: "", items: [], total: 0, page: 1, pageSize: 50 };
      counts = null;
      reading = null;
      query = "";
      thread = { name: "", loading: false, error: "", items: [] };
      bulk = { loading: false, error: "", items: [] };
      batch = null;
      listToken++;
      readToken++;
      threadToken++;
      batchToken++;
    }
    async function loadAccount() {
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
      if (status === "ready" && account) return loadCurrent();
      rerender();
    }
    const serverFolder = () => folder === "inbox" || folder === "unread" || folder === "pending" || folder === "sent";
    async function loadList(page = 1) {
      const token = ++listToken;
      const key = `${folder}|${query}|${page}`,
        scope = `${folder}|${query}`;
      // 换了文件夹或搜索词时先清空，避免加载期间显示上一个列表的内容。
      list = { ...list, key, scope, loading: true, error: "", page, ...(list.scope === scope ? {} : { items: [], total: 0 }) };
      rerender();
      try {
        const data = await call(withQuery("/api/mail/messages", { folder, page, query }));
        if (token !== listToken) return;
        list = { key, scope, loading: false, error: "", items: data.items || [], total: data.total || 0, page: data.page || page, pageSize: data.pageSize || 50 };
        if (data.counts) counts = data.counts;
      } catch (error) {
        if (token !== listToken) return;
        list = { ...list, loading: false, error: error.message, items: [], total: 0 };
      }
      rerender();
    }
    async function loadDrafts() {
      drafts = { ...drafts, loading: true, error: "" };
      rerender();
      try {
        drafts = { loading: false, error: "", items: (await call("/api/mail/drafts")).items || [], loaded: true };
      } catch (error) {
        drafts = { loading: false, error: error.message, items: [], loaded: true };
      }
      rerender();
    }
    async function loadThread(name) {
      const token = ++threadToken;
      const row = customers().find((item) => item.name === name);
      if (!row) {
        thread = { name: "", loading: false, error: "", items: [] };
        return rerender();
      }
      thread = { name, loading: true, error: "", items: [] };
      rerender();
      try {
        const data = await call(withQuery("/api/mail/correspondence", { addresses: row.addresses.slice(0, 20).join(",") }));
        if (token !== threadToken) return;
        thread = { name, loading: false, error: "", items: data.items || [] };
      } catch (error) {
        if (token !== threadToken) return;
        thread = { name, loading: false, error: error.message, items: [] };
      }
      rerender();
    }
    // 按当前页签与文件夹读取需要的内容。
    function loadCurrent() {
      if (!account) return rerender();
      if (view === "customer") return customerName ? loadThread(customerName) : rerender();
      if (view !== "mail") return rerender();
      if (folder === "drafts") return loadDrafts();
      if (serverFolder()) return loadList(1);
      if (folder === "bulk") return batch ? loadBatch(batch.id) : loadBulk();
      return rerender();
    }
    async function loadBulk() {
      const token = ++bulkToken;
      bulk = { ...bulk, loading: true, error: "" };
      rerender();
      try {
        const items = (await call("/api/mail/bulk")).items || [];
        if (token !== bulkToken) return;
        bulk = { loading: false, error: "", items };
      } catch (error) {
        if (token !== bulkToken) return;
        bulk = { loading: false, error: error.message, items: [] };
      }
      rerender();
      // 有批次还在发送时，列表也自动更新进度。
      if (bulk.items.some((item) => item.status === "sending"))
        root.setTimeout(() => {
          if (token === bulkToken && !batch && onMailPage() && view === "mail" && folder === "bulk") loadBulk();
        }, ctx.pollMs ?? 2500);
    }
    // 读取一批群发的进度；还在发送时每隔几秒自动再读一次，离开这个页面就停。
    async function loadBatch(id) {
      const token = ++batchToken;
      if (!batch || batch.id !== id) batch = { id, loading: true, error: "", data: null };
      rerender();
      try {
        const data = await call(withQuery("/api/mail/bulk/batch", { id }));
        if (token !== batchToken || !batch || batch.id !== id) return;
        batch = { id, loading: false, error: "", data: data.batch };
      } catch (error) {
        if (token !== batchToken || !batch || batch.id !== id) return;
        batch = { id, loading: false, error: error.message, data: batch.data };
      }
      rerender();
      if (batch.data && batch.data.status === "sending" && !batch.error)
        root.setTimeout(() => {
          if (token === batchToken && batch && batch.id === id && onMailPage() && view === "mail" && folder === "bulk") loadBatch(id);
        }, ctx.pollMs ?? 2500);
    }

    // ---- 标记：导航 ----
    function subnav() {
      const badge = (id) => {
        const n = counts && (id === "unread" || id === "inbox" ? counts.unread : id === "pending" ? counts.pending : 0);
        return n ? `<span class="mail-count">${n > 999 ? "999+" : n}</span>` : "";
      };
      let below;
      if (view === "mail")
        below =
          `<div class="mail-folders" role="list">` +
          folders
            .map(
              (item) =>
                `<button type="button" role="listitem" class="nav-entry ${item.id === folder ? "active" : ""}" data-mail-folder="${item.id}" ${item.id === folder ? 'aria-current="page"' : ""}>${icon(item.icon)}<span class="mail-folder-label">${E(item.label)}</span>${badge(item.id)}</button>`,
            )
            .join("") +
          `</div>`;
      else if (view === "customer") {
        const rows = customers();
        below = rows.length
          ? `<input class="mail-customer-filter" id="mail-customer-filter" type="search" placeholder="搜索客户" aria-label="搜索客户" autocomplete="off"><div class="mail-customers" role="list">` +
            rows
              .map(
                (row) =>
                  `<button type="button" role="listitem" class="nav-entry ${row.name === customerName ? "active" : ""}" data-mail-action="customer-select" data-name="${E(row.name)}" title="${E(row.name)}"><span class="mail-folder-label">${E(row.name)}</span></button>`,
              )
              .join("") +
            `</div>`
          : `<p class="subnav-empty mail-view-note">还没有填写了邮箱的客户。在客户资料里填上邮箱后，这里会按客户归集往来邮件。</p>`;
      } else below = `<p class="subnav-empty mail-view-note">查看下属邮件需要公司账号和上下级关系，来财目前是单机版。</p>`;
      return (
        `<div class="mail-views" role="tablist" aria-label="邮件视图">` +
        views.map((item) => `<button type="button" role="tab" class="mail-view ${item.id === view ? "active" : ""}" data-mail-view="${item.id}" aria-selected="${item.id === view}">${E(item.label)}</button>`).join("") +
        `</div>` +
        `<button type="button" class="primary mail-compose" data-mail-action="compose">写 信</button>` +
        below
      );
    }

    // ---- 标记：主体 ----
    const empty = (iconName, title, note, actions = "") => `<div class="empty mail-unbound"><div class="mail-unbound-art">${icon(iconName)}</div><strong>${E(title)}</strong><span>${E(note)}</span>${actions}</div>`;
    const pagebar = (title, actions = "", before = "") => `<div class="pagebar mail-pagebar">${before}<div class="page-tabs"><h1>${E(title)}</h1></div><div class="page-actions">${actions}</div></div>`;
    // account.demo 只会出现在网页试用版：那里是一组示例邮件，发信不会真的发出。
    const accountButton = () => (account ? `${account.demo ? '<span class="mail-demo-tag" title="网页试用版无法连接真实邮箱">示例邮箱 · 不会真的发信</span>' : ""}<button type="button" class="text-button" data-mail-action="account" title="${E(account.email)}">${icon("settings")}邮箱设置</button>` : "");
    function gate() {
      if (status === "idle" || status === "loading") return `<div class="empty mail-unbound" aria-busy="true"><span>正在读取邮箱绑定状态…</span></div>`;
      if (status === "error") return empty("mail", "无法读取邮箱绑定状态", loadError, `<button type="button" class="primary" data-mail-action="reload">重试</button>`);
      if (!account) return empty("mail", "未绑定邮箱", "绑定 Zoho 邮箱后，可在这里收发邮件，并按客户查看往来邮件。", `<button type="button" class="primary" data-mail-action="bind">绑定邮箱</button>`);
      return "";
    }
    function rowMarkup(message, index, showBox) {
      const sent = message.box === "sent";
      const who = sent ? (message.to || []).map(person).join("、") || "（无收件人）" : person(message.from) || "（未知发件人）";
      const customer = customerOf(message, index);
      return (
        `<div class="mail-row ${message.seen ? "" : "unread"}" role="listitem">` +
        (sent
          ? `<span class="mail-pending-slot"></span>`
          : `<button type="button" class="mail-pending ${message.pending ? "on" : ""}" data-mail-action="toggle-pending" data-box="${message.box}" data-uid="${message.uid}" aria-pressed="${!!message.pending}" aria-label="${message.pending ? "取消待处理" : "标为待处理"}" title="${message.pending ? "取消待处理" : "标为待处理"}">${icon("star")}</button>`) +
        `<button type="button" class="mail-row-main" data-mail-action="open" data-box="${message.box}" data-uid="${message.uid}">` +
        (showBox ? `<span class="mail-direction ${sent ? "out" : "in"}">${sent ? "发" : "收"}</span>` : "") +
        `<span class="mail-row-who">${sent && !showBox ? "发给 " : ""}${E(who)}</span>` +
        `<span class="mail-row-subject">${E(message.subject || "（无主题）")}${message.hasAttachment ? `<span class="mail-clip" title="有附件">${icon("folder")}</span>` : ""}</span>` +
        `<span class="mail-row-time">${E(shortTime(message.date))}</span></button>` +
        (customer ? `<button type="button" class="mail-customer-chip" data-mail-action="customer-open" data-name="${E(customer)}" title="打开客户资料">${E(customer)}</button>` : `<span class="mail-customer-chip none"></span>`) +
        `</div>`
      );
    }
    function listPage() {
      const title = current().label + (list.total && !list.loading ? `（${list.total}）` : "");
      const search =
        `<form class="mail-search" id="mail-search-form" role="search"><input id="mail-search-input" name="query" type="search" value="${E(query)}" placeholder="搜索主题、发件人、收件人" aria-label="搜索邮件" autocomplete="off"><button type="submit" aria-label="搜索">${icon("search")}</button></form>` +
        `<button type="button" data-mail-action="refresh" ${list.loading ? "disabled" : ""}>${icon("refresh")}刷新</button>` +
        accountButton();
      let body;
      if (list.loading && !list.items.length) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在读取邮件…</span></div>`;
      else if (list.error) body = empty("mail", "读取邮件失败", list.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!list.items.length) body = empty("mail", query ? "没有符合搜索条件的邮件" : `「${current().label}」里没有邮件`, query ? "换个关键词再试，或清除搜索。" : folder === "pending" ? "在收件箱里点邮件前面的星标，可以把它标为待处理。" : "", query ? `<button type="button" data-mail-action="clear-search">清除搜索</button>` : "");
      else {
        const index = addressIndex();
        const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
        body =
          `<div class="mail-list ${list.loading ? "loading" : ""}" role="list">${list.items.map((message) => rowMarkup(message, index, false)).join("")}</div>` +
          `<div class="mail-pager"><span>共 ${list.total} 封 · 第 ${list.page} / ${pages} 页</span><button type="button" data-mail-action="page-prev" ${list.page <= 1 || list.loading ? "disabled" : ""}>上一页</button><button type="button" data-mail-action="page-next" ${list.page >= pages || list.loading ? "disabled" : ""}>下一页</button></div>`;
      }
      return pagebar(title, search) + `<section class="module-page mail-page mail-list-page">${body}</section>`;
    }
    function draftsPage() {
      let body;
      if (drafts.loading && !drafts.items.length) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在读取草稿…</span></div>`;
      else if (drafts.error) body = empty("note", "读取草稿失败", drafts.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!drafts.items.length) body = empty("note", "草稿箱是空的", "写信时点「存草稿」，或没发出就关闭，内容会保存在这里。草稿只保存在这台电脑上。");
      else
        body =
          `<div class="mail-list" role="list">` +
          drafts.items
            .map(
              (draft) =>
                `<div class="mail-row" role="listitem"><span class="mail-pending-slot"></span><button type="button" class="mail-row-main" data-mail-action="draft-open" data-id="${E(draft.id)}"><span class="mail-row-who">${E(draft.to ? "发给 " + draft.to : "（未填收件人）")}</span><span class="mail-row-subject">${E(draft.subject || "（无主题）")}</span><span class="mail-row-time">${E(shortTime(draft.updatedAt))}</span></button><button type="button" class="mail-customer-chip" data-mail-action="draft-delete" data-id="${E(draft.id)}">删除</button></div>`,
            )
            .join("") +
          `</div>`;
      return pagebar(`草稿箱${drafts.items.length ? `（${drafts.items.length}）` : ""}`, `<button type="button" data-mail-action="refresh">${icon("refresh")}刷新</button>` + accountButton()) + `<section class="module-page mail-page mail-list-page">${body}</section>`;
    }
    function frameDocument(html) {
      return (
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank">` +
        `<style>html{color-scheme:light}body{margin:16px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d273e;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #d9dde5;color:#53617b}a{color:#0a6aff}</style></head><body>${html}</body></html>`
      );
    }
    function readerPage() {
      const back = `<button type="button" class="mail-back" data-mail-action="back">${icon("back")}返回</button>`;
      if (reading.loading) return pagebar("正在打开邮件…", "", back) + `<section class="module-page mail-page"><div class="empty mail-unbound" aria-busy="true"><span>正在读取邮件内容…</span></div></section>`;
      if (reading.error) return pagebar("无法打开邮件", "", back) + `<section class="module-page mail-page">${empty("mail", "无法打开这封邮件", reading.error, `<button type="button" class="primary" data-mail-action="back">返回列表</button>`)}</section>`;
      const m = reading.message,
        sent = m.box === "sent",
        customer = customerOf(m, addressIndex());
      const fact = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : "");
      const actions =
        `<button type="button" class="primary" data-mail-action="reply">回复</button><button type="button" data-mail-action="reply-all">回复全部</button><button type="button" data-mail-action="forward">转发</button>` +
        (sent ? "" : `<button type="button" data-mail-action="mark-unread">标为未读</button><button type="button" data-mail-action="toggle-pending" data-box="${m.box}" data-uid="${m.uid}" aria-pressed="${!!m.pending}">${m.pending ? "取消待处理" : "标为待处理"}</button>`) +
        `<button type="button" data-mail-action="delete">删除</button>`;
      const attachments = (m.attachments || []).length
        ? `<div class="mail-attachments"><h3>附件（${m.attachments.length}）</h3><ul>${m.attachments.map((item) => `<li><span class="mail-attachment-name">${icon("folder")}${E(item.filename)}</span><span class="mail-attachment-size">${fileSize(item.size)}</span><button type="button" data-mail-action="attachment-save" data-index="${item.index}">保存到「下载」</button></li>`).join("")}</ul><div class="error" id="mail-attachment-error" role="alert"></div></div>`
        : "";
      const content = m.html
        ? `<iframe class="mail-body-frame" title="邮件正文" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${E(frameDocument(m.html))}"></iframe><p class="mail-body-note">为保护隐私，邮件里的远程图片不会加载。</p>`
        : `<div class="mail-body-text">${E(m.text || "（这封邮件没有正文）")}</div>`;
      return (
        pagebar(m.subject || "（无主题）", "", back) +
        `<section class="module-page mail-page mail-reader"><div class="mail-reader-actions">${actions}</div><div class="error" id="mail-reader-error" role="alert"></div>` +
        `<dl class="mail-reader-facts">${fact("发件人", E(addressLine([m.from])))}${fact("收件人", E(addressLine(m.to)))}${fact("抄送", E(addressLine(m.cc)))}${fact("时间", E(fullTime(m.date)))}${fact("客户", customer ? `<button type="button" class="company-link" data-mail-action="customer-open" data-name="${E(customer)}">${E(customer)}</button>` : "")}</dl>` +
        attachments +
        content +
        `</section>`
      );
    }
    function customerPage() {
      const rows = customers();
      if (!rows.length) return pagebar("客户邮件", accountButton()) + `<section class="module-page mail-page">${empty("people", "还没有填写了邮箱的客户", "在客户资料里填上公司邮箱或联系人邮箱后，这里会按客户归集往来邮件。")}</section>`;
      const row = rows.find((item) => item.name === customerName);
      if (!row) return pagebar("客户邮件", accountButton()) + `<section class="module-page mail-page">${empty("people", "选择一个客户", `左侧列出了 ${rows.length} 个填写了邮箱的客户，点一个查看与它的往来邮件。`)}</section>`;
      const actions = `<button type="button" class="primary" data-mail-action="customer-compose">写信给该客户</button><button type="button" data-mail-action="customer-open" data-name="${E(row.name)}">查看客户资料</button><button type="button" data-mail-action="refresh" ${thread.loading ? "disabled" : ""}>${icon("refresh")}刷新</button>` + accountButton();
      let body;
      if (thread.loading) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在查找往来邮件…</span></div>`;
      else if (thread.error) body = empty("mail", "读取往来邮件失败", thread.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!thread.items.length) body = empty("mail", "还没有往来邮件", `在收件箱和已发送里没有找到与 ${row.addresses.join("、")} 有关的邮件。`);
      else body = `<p class="mail-thread-note">${E(row.addresses.join("、"))} · 收件箱与已发送中最近的 ${thread.items.length} 封</p><div class="mail-list" role="list">${thread.items.map((message) => rowMarkup(message, new Map(), true)).join("")}</div>`;
      return pagebar(row.name, actions) + `<section class="module-page mail-page mail-list-page">${body}</section>`;
    }
    const bulkProgress = (b) => `已发 ${b.sent} / 共 ${b.total}${b.failed ? ` · 失败 ${b.failed}` : ""}${b.skipped ? ` · 未发 ${b.skipped}` : ""}`;
    const bulkTag = (b) => `<span class="mail-bulk-tag ${E(b.status)}">${E(BULK_STATUS[b.status] || b.status)}</span>`;
    function bulkPage() {
      const actions = `<button type="button" class="primary" data-mail-action="bulk-new">新建群发</button><button type="button" data-mail-action="refresh" ${bulk.loading ? "disabled" : ""}>${icon("refresh")}刷新</button>` + accountButton();
      let body;
      if (bulk.loading && !bulk.items.length) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在读取群发记录…</span></div>`;
      else if (bulk.error) body = empty("people", "读取群发记录失败", bulk.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!bulk.items.length) body = empty("people", "还没有群发记录", "群发会给每位客户单独发一封，对方看不到其他收件人；正文里可以用 {{姓名}}、{{公司}} 自动换成每位客户自己的。", `<button type="button" class="primary" data-mail-action="bulk-new">新建群发</button>`);
      else
        body =
          `<div class="mail-list" role="list">` +
          bulk.items
            .map(
              (b) =>
                `<div class="mail-row" role="listitem"><span class="mail-pending-slot"></span><button type="button" class="mail-row-main" data-mail-action="bulk-open" data-id="${E(b.id)}"><span class="mail-row-who">${bulkTag(b)} ${E(bulkProgress(b))}</span><span class="mail-row-subject">${E(b.subject || "（无主题）")}</span><span class="mail-row-time">${E(shortTime(b.createdAt))}</span></button></div>`,
            )
            .join("") +
          `</div>`;
      return pagebar(`群发箱${bulk.items.length ? `（${bulk.items.length}）` : ""}`, actions) + `<section class="module-page mail-page mail-list-page">${body}</section>`;
    }
    function batchPage() {
      const back = `<button type="button" class="mail-back" data-mail-action="bulk-back">${icon("back")}返回</button>`;
      const b = batch.data;
      if (!b) return pagebar(batch.error ? "无法打开群发记录" : "正在打开…", "", back) + `<section class="module-page mail-page">${batch.error ? empty("people", "无法打开这批群发", batch.error, `<button type="button" class="primary" data-mail-action="bulk-back">返回群发箱</button>`) : `<div class="empty mail-unbound" aria-busy="true"><span>正在读取发送进度…</span></div>`}</section>`;
      const actions = (b.status === "sending" ? `<button type="button" data-mail-action="bulk-cancel">停止发送</button>` : "") + `<button type="button" data-mail-action="refresh">${icon("refresh")}刷新</button>`;
      const rows = b.items
        .map(
          (item) =>
            `<tr class="${E(item.status)}"><td>${item.customer ? `<button type="button" class="company-link" data-mail-action="customer-open" data-name="${E(item.customer)}">${E(item.customer)}</button>` : "—"}</td><td>${E(item.name || "—")}</td><td>${E(item.address)}</td><td><span class="mail-item-status ${E(item.status)}">${E(ITEM_STATUS[item.status] || item.status)}</span></td><td>${E(item.status === "sent" ? fullTime(item.sentAt) : item.error || "")}</td></tr>`,
        )
        .join("");
      return (
        pagebar(b.subject || "（无主题）", actions, back) +
        `<section class="module-page mail-page mail-reader mail-batch"><div class="mail-batch-summary">${bulkTag(b)}<strong>${E(bulkProgress(b))}</strong><span>${E(fullTime(b.createdAt))} 开始${b.stopReason ? ` · ${E(b.stopReason)}` : ""}</span></div>` +
        (batch.error ? `<div class="error visible" role="alert">${E(batch.error)}</div>` : "") +
        (b.status === "sending" ? `<p class="mail-body-note">正在逐封发送，这个页面会自动更新。可以离开去做别的事，发送不会中断；关闭来财应用则会中断。</p>` : "") +
        `<div class="mail-batch-table"><table class="order-table"><thead><tr><th>客户</th><th>称呼</th><th>邮箱</th><th>状态</th><th>发送时间／原因</th></tr></thead><tbody>${rows}</tbody></table></div>` +
        `<details class="mail-batch-text"><summary>查看这批邮件的正文${(b.attachmentNames || []).length ? `（附件 ${b.attachmentNames.length} 个）` : ""}</summary><div class="mail-body-text">${E(b.text || "")}</div>${(b.attachmentNames || []).length ? `<p class="mail-body-note">附件：${E(b.attachmentNames.join("、"))}</p>` : ""}</details></section>`
      );
    }
    function page() {
      if (view === "team") return pagebar("下属邮件") + `<section class="module-page mail-page">${empty("lead", "查看下属的邮件", "这需要公司账号和上下级关系。来财目前是单机版，还没有这部分。")}</section>`;
      const blocked = gate();
      if (blocked) return pagebar(view === "customer" ? "客户邮件" : current().label) + `<section class="module-page mail-page">${blocked}</section>`;
      if (reading) return readerPage();
      if (view === "customer") return customerPage();
      if (folder === "drafts") return draftsPage();
      if (folder === "bulk") return batch ? batchPage() : bulkPage();
      return listPage();
    }
    function render() {
      ctx.mount(page());
      const search = document.getElementById("mail-search-form");
      if (search)
        search.addEventListener("submit", (event) => {
          event.preventDefault();
          query = String(search.elements.query.value || "").trim();
          return loadList(1);
        });
      const filter = document.getElementById("mail-customer-filter");
      if (filter && filter.addEventListener)
        filter.addEventListener("input", () => {
          const needle = String(filter.value || "").trim().toLowerCase();
          document.querySelectorAll(".mail-customers [data-name]").forEach((button) => {
            button.hidden = !!needle && !button.dataset.name.toLowerCase().includes(needle);
          });
        });
    }
    function showError(id, message) {
      const box = document.getElementById(id);
      if (!box) return false;
      box.textContent = message;
      box.classList.toggle("visible", !!message);
      return true;
    }

    // ---- 阅读、标记、删除、附件 ----
    function findMessage(box, uid) {
      return [...list.items, ...thread.items].filter((item) => item.box === box && item.uid === uid);
    }
    async function openMessage(box, uid) {
      const token = ++readToken;
      reading = { loading: true, error: "", message: null, ref: { box, uid } };
      rerender();
      try {
        const data = await call(withQuery("/api/mail/message", { box, uid }));
        if (token !== readToken) return;
        reading = { loading: false, error: "", message: data.message, ref: { box, uid } };
        for (const item of findMessage(box, uid)) {
          if (!item.seen && counts && box === "inbox") counts = { ...counts, unread: Math.max(0, counts.unread - 1) };
          item.seen = true;
        }
      } catch (error) {
        if (token !== readToken) return;
        reading = { loading: false, error: error.message, message: null, ref: { box, uid } };
      }
      rerender();
    }
    function closeReader(reload) {
      reading = null;
      readToken++;
      if (reload) return loadCurrent();
      rerender();
    }
    async function togglePending(box, uid) {
      const known = findMessage(box, uid),
        open = reading && reading.message && reading.message.box === box && reading.message.uid === uid ? reading.message : null;
      const next = !(open ? open.pending : known[0] && known[0].pending);
      try {
        await call("/api/mail/flags", { box, uid, pending: next });
      } catch (error) {
        if (!showError("mail-reader-error", error.message)) ctx.toast(error.message);
        return;
      }
      for (const item of known) item.pending = next;
      if (open) open.pending = next;
      if (counts) counts = { ...counts, pending: Math.max(0, counts.pending + (next ? 1 : -1)) };
      if (folder === "pending" && !reading && view === "mail") return loadList(list.page);
      rerender();
    }
    async function markUnread() {
      const m = reading && reading.message;
      if (!m) return;
      try {
        await call("/api/mail/flags", { box: m.box, uid: m.uid, seen: false });
      } catch (error) {
        return showError("mail-reader-error", error.message);
      }
      closeReader(true);
    }
    function confirmDelete(pointerActivated) {
      const m = reading && reading.message;
      if (!m) return;
      confirmTarget = { box: m.box, uid: m.uid };
      ctx.dialog(
        "删除邮件",
        `<div class="drawer-body"><p>删除「${E(m.subject || "（无主题）")}」？</p><div class="module-note">邮件会移到 Zoho 邮箱的「已删除」文件夹，可以在 Zoho 里恢复。</div><div class="error" id="mail-confirm-error" role="alert"></div></div>`,
        `<button type="button" data-action="close-modal">取消</button><button type="button" class="primary" data-mail-action="delete-confirm">删除</button>`,
        "mail-confirm",
        pointerActivated,
      );
    }
    async function deleteMessage() {
      if (!confirmTarget || working) return;
      working = true;
      try {
        await call("/api/mail/trash", confirmTarget);
      } catch (error) {
        working = false;
        return showError("mail-confirm-error", error.message);
      }
      working = false;
      confirmTarget = null;
      ctx.closeDialog();
      ctx.toast("已移到「已删除」");
      closeReader(true);
    }
    async function saveAttachment(index) {
      const m = reading && reading.message;
      if (!m) return;
      showError("mail-attachment-error", "");
      try {
        const data = await call("/api/mail/attachment/save", { box: m.box, uid: m.uid, index });
        ctx.toast(`已保存到「下载」：${data.filename}`);
      } catch (error) {
        showError("mail-attachment-error", error.message);
      }
    }

    // ---- 写信 ----
    function composeFields() {
      const form = document.getElementById("mail-compose-form");
      if (!form) return null;
      const value = (name) => String(form.elements[name]?.value ?? "");
      return { to: value("to").trim(), cc: value("cc").trim(), bcc: value("bcc").trim(), subject: value("subject").trim(), text: value("text"), fromName: value("fromName").trim(), forwardAttachments: form.elements.forwardAttachments ? !!form.elements.forwardAttachments.checked : true };
    }
    const composeSnapshot = (fields) => JSON.stringify([fields.to, fields.cc, fields.bcc, fields.subject, fields.text]);
    function renderFileList(id, files, removeAction) {
      const box = document.getElementById(id);
      if (!box) return;
      box.innerHTML = files.map((file, index) => `<li><span class="mail-attachment-name">${icon("folder")}${E(file.name)}</span><span class="mail-attachment-size">${fileSize(file.size)}</span><button type="button" data-mail-action="${removeAction}" data-index="${index}">移除</button></li>`).join("");
    }
    // 把选中的文件读进 holder.files；合计超过 10 MB 的不加。
    function readFiles(fileList, holder, errorId, redraw) {
      let total = holder.files.reduce((sum, file) => sum + file.size, 0);
      for (const file of Array.from(fileList || [])) {
        if (total + file.size > MAX_ATTACHMENT_BYTES) {
          showError(errorId, `附件合计不能超过 10 MB，「${file.name}」没有添加。`);
          continue;
        }
        total += file.size;
        const entry = { name: file.name, type: file.type || "application/octet-stream", size: file.size, base64: "", ready: false };
        holder.files.push(entry);
        const reader = new root.FileReader();
        reader.onload = () => {
          entry.base64 = String(reader.result || "").replace(/^data:[^,]*,/, "");
          entry.ready = true;
        };
        reader.onerror = () => {
          const index = holder.files.indexOf(entry);
          if (index >= 0) holder.files.splice(index, 1);
          redraw();
          showError(errorId, `无法读取「${file.name}」。`);
        };
        reader.readAsDataURL(file);
      }
      redraw();
    }
    function renderFiles() {
      if (compose) renderFileList("mail-compose-file-list", compose.files, "file-remove");
    }
    function addFiles(fileList) {
      if (compose) readFiles(fileList, compose, "mail-compose-error", renderFiles);
    }
    // 写信类入口共用：没读过绑定状态就先读；没有可用邮箱时提示并打开绑定窗口。
    async function ready(pointerActivated) {
      if (status === "idle" || status === "error") {
        const token = ++loadToken;
        status = "loading";
        try {
          const data = await call("/api/mail-account");
          if (token === loadToken) accept(data);
        } catch (error) {
          if (token === loadToken) {
            status = "error";
            loadError = error.message;
          }
        }
      }
      if (status === "ready" && account) return true;
      ctx.toast(status !== "ready" ? "无法读取邮箱绑定状态，请到邮件页重试" : available ? "请先绑定邮箱" : "网页试用版无法收发邮件");
      if (status === "ready") bindDialog(pointerActivated);
      return false;
    }
    const withSignature = (text) => (account && account.signature ? `\n\n${account.signature}${text || ""}` : text || "");
    function openCompose(initial = {}, pointerActivated = false) {
      if (status !== "ready" || !account) {
        ctx.toast(available ? "请先绑定邮箱" : "网页试用版无法收发邮件");
        return status === "ready" ? bindDialog(pointerActivated) : undefined;
      }
      // 新写、回复、转发时带上签名；继续写草稿时不重复加。
      // （下面各个 <textarea> 开头多写一个换行，是因为浏览器会吃掉紧跟标签的第一个换行。）
      if (!initial.id) initial = { ...initial, text: withSignature(initial.text) };
      compose = { draftId: initial.id || "", inReplyTo: initial.inReplyTo || "", references: initial.references || "", forwardOf: initial.forwardOf || null, forwardCount: initial.forwardCount || 0, files: [], sending: false, force: false, snapshot: "" };
      const field = (label, name, value, extra = "") => `<label class="field">${label}<input name="${name}" id="mail-compose-${name}" value="${E(value || "")}" autocomplete="off" spellcheck="false" ${extra}></label>`;
      ctx.dialog(
        initial.title || "写信",
        `<form class="drawer-body mail-compose-form" id="mail-compose-form" autocomplete="off" novalidate>` +
          field("收件人", "to", initial.to, 'placeholder="多个地址用逗号分隔"') +
          `<div class="form-grid">${field("抄送", "cc", initial.cc)}${field("密送", "bcc", initial.bcc)}</div>` +
          field("主题", "subject", initial.subject, 'maxlength="500"') +
          `<label class="field">正文<textarea name="text" id="mail-compose-text" rows="14">\n${E(initial.text || "")}</textarea></label>` +
          `<div class="mail-compose-files"><label class="mail-file-pick">${icon("plus")}添加附件<input type="file" id="mail-compose-file" multiple hidden></label><span class="muted tiny">合计不超过 10 MB</span><ul id="mail-compose-file-list"></ul>` +
          (compose.forwardOf && compose.forwardCount ? `<label class="mail-forward-attachments"><input type="checkbox" name="forwardAttachments" checked> 附带原邮件的 ${compose.forwardCount} 个附件</label>` : "") +
          `</div>` +
          `<div class="form-grid">${field("发件人名称", "fromName", account.senderName || "", 'maxlength="80" placeholder="收件人看到的名字"')}<label class="field">发件邮箱<input value="${E(account.email)}" disabled></label></div>` +
          `<div class="error" id="mail-compose-error" role="alert"></div></form>`,
        `<button type="button" data-mail-action="compose-close">取消</button><button type="button" data-mail-action="compose-draft">存草稿</button><button class="primary" type="submit" form="mail-compose-form" id="mail-compose-submit">发送</button>`,
        "mail-compose",
        pointerActivated,
      );
      const form = document.getElementById("mail-compose-form");
      if (!form) return;
      // 打开时的内容作为基准：只有用户改动过才算有未保存内容。
      compose.snapshot = composeSnapshot(composeFields());
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        return sendCompose();
      });
      const picker = document.getElementById("mail-compose-file");
      if (picker && picker.addEventListener)
        picker.addEventListener("change", () => {
          addFiles(picker.files);
          picker.value = "";
        });
    }
    const draftPayload = (fields) => ({ id: compose.draftId || undefined, to: fields.to, cc: fields.cc, bcc: fields.bcc, subject: fields.subject, text: fields.text, inReplyTo: compose.inReplyTo, references: compose.references, forwardOf: compose.forwardOf });
    async function saveDraft(close) {
      const fields = composeFields();
      if (!compose || !fields || compose.sending) return;
      try {
        const data = await call("/api/mail/drafts/save", draftPayload(fields));
        compose.draftId = data.draft.id;
        compose.snapshot = composeSnapshot(fields);
        compose.force = false;
        drafts.loaded = false;
      } catch (error) {
        compose.force = close;
        showError("mail-compose-error", `草稿保存失败：${error.message}${close ? " 再点一次「取消」将放弃这封信。" : ""}`);
        return false;
      }
      if (close) {
        compose = null;
        ctx.closeDialog();
      }
      ctx.toast(compose && compose.files.length ? "已存入草稿箱（附件不随草稿保存）" : "已存入草稿箱");
      if (folder === "drafts" && view === "mail" && !reading) loadDrafts();
      return true;
    }
    function closeCompose() {
      if (!compose || compose.sending) return;
      const fields = composeFields();
      const dirty = fields && (composeSnapshot(fields) !== compose.snapshot || compose.files.length > 0);
      if (dirty && !compose.force && (fields.to || fields.cc || fields.bcc || fields.subject || fields.text.trim())) return saveDraft(true);
      compose = null;
      ctx.closeDialog();
    }
    async function sendCompose() {
      const fields = composeFields();
      if (!compose || !fields || compose.sending) return;
      if (!fields.to && !fields.cc && !fields.bcc) return showError("mail-compose-error", "请至少填写一位收件人");
      if (!fields.subject && !fields.text.trim()) return showError("mail-compose-error", "主题和正文不能都为空");
      if (compose.files.some((file) => !file.ready)) return showError("mail-compose-error", "附件还在读取，请稍候再发送");
      const submit = document.getElementById("mail-compose-submit");
      compose.sending = true;
      showError("mail-compose-error", "");
      if (submit) {
        submit.disabled = true;
        submit.textContent = "正在发送…";
      }
      try {
        const data = await call("/api/mail/send", { ...draftPayload(fields), id: undefined, draftId: compose.draftId || undefined, fromName: fields.fromName, forwardAttachments: fields.forwardAttachments, attachments: compose.files.map((file) => ({ filename: file.name, contentType: file.type, contentBase64: file.base64 })) });
        if (account) account = { ...account, senderName: fields.fromName };
        compose = null;
        drafts.loaded = false;
        ctx.closeDialog();
        ctx.toast(account && account.demo ? "示例邮箱：邮件没有真的发出，已放入发件箱" : `邮件已发送给 ${data.recipients.length} 位收件人`);
        if (!reading && view === "mail" && (folder === "sent" || folder === "drafts")) loadCurrent();
      } catch (error) {
        if (compose) compose.sending = false;
        showError("mail-compose-error", error.message);
        if (submit && submit.isConnected !== false) {
          submit.disabled = false;
          submit.textContent = "发送";
        }
      }
    }
    function replyTo(mode, pointerActivated) {
      const m = reading && reading.message;
      if (!m) return;
      const me = account ? account.email : "";
      const header = `在 ${fullTime(m.date)}，${addressLine([m.from])} 写道：`;
      const ids = { inReplyTo: m.messageId || "", references: [m.references, m.messageId].filter(Boolean).join(" ") };
      if (mode === "forward")
        return openCompose({ title: "转发", subject: replySubject(m.subject, "Fwd"), text: `\n\n---------- 转发的邮件 ----------\n发件人：${addressLine([m.from])}\n时间：${fullTime(m.date)}\n主题：${m.subject || ""}\n收件人：${addressLine(m.to)}\n\n${m.text || ""}`, forwardOf: { box: m.box, uid: m.uid }, forwardCount: (m.attachments || []).length }, pointerActivated);
      const target = m.box === "sent" ? m.to || [] : (m.replyTo && m.replyTo.length ? m.replyTo : [m.from]).filter(Boolean);
      const others = mode === "all" ? [...(m.box === "sent" ? [] : m.to || []), ...(m.cc || [])].filter((item) => item.address !== me && !target.some((t) => t.address === item.address)) : [];
      openCompose({ title: mode === "all" ? "回复全部" : "回复", to: addressLine(target), cc: addressLine(others), subject: replySubject(m.subject, "Re"), text: `\n\n${header}\n${quote(m.text)}`, ...ids }, pointerActivated);
    }

    // ---- 绑定、设置 ----
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
          `</ol><p>来财用它登录你的邮箱来收信和发信。密码保存在这台电脑的来财数据库里，数据库备份文件也会包含它。</p></details>` +
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
        const payload = { email: String(fields.email.value || "").trim(), password: String(fields.password.value || ""), site: fields.site.value, accountType: fields.accountType.value };
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
          resetMail();
          ctx.closeDialog();
          ctx.toast("邮箱已绑定");
          await loadCurrent();
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
    function accountDialog(pointerActivated, message = "") {
      if (!account) return;
      const row = (label, value) => `<div><dt>${label}</dt><dd>${E(value)}</dd></div>`;
      ctx.dialog(
        "邮箱设置",
        `<div class="drawer-body mail-account"><div class="mail-bound-head"><div class="mail-unbound-art">${icon("mail")}</div><div><span class="mail-bound-tag">${icon("check")}${account.demo ? "示例" : "已绑定"}</span><strong>${E(account.email)}</strong></div></div>` +
          `<dl class="mail-bound-facts">${row("邮箱服务", account.demo ? "示例邮箱（网页试用版）" : "Zoho 邮箱")}${row("收信服务器", account.demo ? "无（不连接任何服务器）" : `${account.host}:${account.port}`)}${row("绑定时间", fullTime(account.boundAt))}${row("最近验证通过", fullTime(account.verifiedAt))}</dl>` +
          `<label class="field">发件人名称<input id="mail-settings-name" value="${E(account.senderName || "")}" maxlength="80" placeholder="收件人看到的名字" autocomplete="off"></label>` +
          `<label class="field">签名<textarea id="mail-settings-signature" rows="5" maxlength="2000" placeholder="写信、回复时自动加在正文末尾">\n${E(account.signature || "")}</textarea></label>` +
          `<div class="mail-bound-actions"><button type="button" class="primary" data-mail-action="settings-save">保存名称与签名</button></div>` +
          `<div class="error ${message ? "visible" : ""}" id="mail-account-error" role="alert">${E(message)}</div>` +
          (account.demo
            ? `<div class="module-note">这是网页试用版自带的示例邮箱，里面是示例邮件，写信和回复不会真的发出，刷新页面后恢复原样。真实邮箱要在 Mac 上安装的来财应用里绑定。</div></div>`
            : `<div class="mail-bound-actions"><button type="button" data-mail-action="verify" ${working ? "disabled" : ""}>${working ? "正在验证…" : "重新验证"}</button><button type="button" data-mail-action="bind">更换邮箱</button><button type="button" data-mail-action="unbind">解除绑定</button></div></div>`),
        `<button type="button" class="primary" data-action="close-modal">关闭</button>`,
        "mail-account",
        pointerActivated,
      );
    }
    async function saveSettings() {
      const name = document.getElementById("mail-settings-name"),
        signature = document.getElementById("mail-settings-signature");
      if (!account || !name || !signature) return;
      try {
        accept(await call("/api/mail-account/settings", { senderName: String(name.value || ""), signature: String(signature.value || "") }));
        showError("mail-account-error", "");
        ctx.toast("已保存");
      } catch (error) {
        showError("mail-account-error", error.message);
      }
    }

    // ---- 群发 ----
    const bulkRecipients = () => customers().map((row) => ({ customer: row.name, name: row.contact, address: row.addresses[0] }));
    const bulkFill = (text, item) => String(text).replace(/\{\{\s*姓名\s*\}\}/g, item.name || item.customer || "").replace(/\{\{\s*公司\s*\}\}/g, item.customer || "");
    function bulkListMarkup() {
      return bulkDraft.all
        .map((item) => {
          const on = bulkDraft.selected.has(item.customer);
          return `<button type="button" role="checkbox" class="mail-bulk-pick ${on ? "on" : ""}" aria-checked="${on}" data-mail-action="bulk-toggle" data-name="${E(item.customer)}"><span class="mail-bulk-box">${on ? icon("check") : ""}</span><span class="mail-bulk-name">${E(item.customer)}</span><span class="mail-bulk-address">${E(item.name ? `${item.name} · ${item.address}` : item.address)}</span></button>`;
        })
        .join("");
    }
    function bulkRefresh() {
      const listBox = document.getElementById("mail-bulk-recipients"),
        count = document.getElementById("mail-bulk-count"),
        submit = document.getElementById("mail-bulk-submit");
      if (listBox) listBox.innerHTML = bulkListMarkup();
      if (count) count.textContent = `已选 ${bulkDraft.selected.size} / ${bulkDraft.all.length} 位客户`;
      bulkDraft.confirm = false;
      if (submit) submit.textContent = "发送";
    }
    function bulkDialog(names, pointerActivated) {
      const all = bulkRecipients();
      if (!all.length) return ctx.toast("还没有填写了邮箱的客户，无法群发");
      const known = new Set(all.map((item) => item.customer));
      bulkDraft = { all, selected: new Set((names || []).filter((name) => known.has(name))), files: [], confirm: false, sending: false };
      ctx.dialog(
        "新建群发",
        `<form class="drawer-body mail-compose-form" id="mail-bulk-form" autocomplete="off" novalidate>` +
          `<div class="module-note">每位客户单独收到一封，看不到其他收件人。主题和正文里的 <b>{{姓名}}</b> 会换成联系人姓名（没有就用公司名），<b>{{公司}}</b> 换成客户名称。一批最多 200 位。</div>` +
          `<div class="field"><div class="mail-bulk-toolbar"><span id="mail-bulk-count">已选 ${bulkDraft.selected.size} / ${all.length} 位客户</span><button type="button" data-mail-action="bulk-all">全选</button><button type="button" data-mail-action="bulk-none">清空</button><input id="mail-bulk-filter" type="search" placeholder="搜索客户" aria-label="搜索客户" autocomplete="off"></div><div class="mail-bulk-recipients" id="mail-bulk-recipients" role="group" aria-label="收件客户">${bulkListMarkup()}</div></div>` +
          `<label class="field">主题<input name="subject" id="mail-bulk-subject" maxlength="500" autocomplete="off"></label>` +
          `<label class="field">正文<textarea name="text" id="mail-bulk-text" rows="10">\n${E(withSignature(""))}</textarea></label>` +
          `<div class="mail-compose-files"><label class="mail-file-pick">${icon("plus")}添加附件<input type="file" id="mail-bulk-file" multiple hidden></label><span class="muted tiny">合计不超过 10 MB，每封都会带上</span><ul id="mail-bulk-file-list"></ul></div>` +
          `<div class="mail-bulk-preview-row"><button type="button" data-mail-action="bulk-preview">预览第一封</button></div><div class="mail-body-text mail-bulk-preview" id="mail-bulk-preview" hidden></div>` +
          `<div class="error" id="mail-bulk-error" role="alert"></div></form>`,
        `<button type="button" data-action="close-modal">取消</button><button class="primary" type="submit" form="mail-bulk-form" id="mail-bulk-submit">发送</button>`,
        "mail-bulk",
        pointerActivated,
      );
      const form = document.getElementById("mail-bulk-form");
      if (!form) return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        return bulkSend();
      });
      const picker = document.getElementById("mail-bulk-file");
      if (picker && picker.addEventListener)
        picker.addEventListener("change", () => {
          const holder = { files: bulkDraft.files };
          readFiles(picker.files, holder, "mail-bulk-error", () => renderFileList("mail-bulk-file-list", bulkDraft.files, "bulk-file-remove"));
          picker.value = "";
        });
      const filter = document.getElementById("mail-bulk-filter");
      if (filter && filter.addEventListener)
        filter.addEventListener("input", () => {
          const needle = String(filter.value || "").trim().toLowerCase();
          document.querySelectorAll("#mail-bulk-recipients [data-name]").forEach((button) => {
            button.hidden = !!needle && !button.textContent.toLowerCase().includes(needle);
          });
        });
    }
    function bulkFields() {
      const form = document.getElementById("mail-bulk-form");
      if (!form || !bulkDraft) return null;
      return { subject: String(form.elements.subject.value || "").trim(), text: String(form.elements.text.value || ""), recipients: bulkDraft.all.filter((item) => bulkDraft.selected.has(item.customer)) };
    }
    function bulkPreview() {
      const fields = bulkFields(),
        box = document.getElementById("mail-bulk-preview");
      if (!fields || !box) return;
      const first = fields.recipients[0];
      box.hidden = false;
      box.textContent = first ? `收件人：${first.name ? first.name + " " : ""}<${first.address}>\n主题：${bulkFill(fields.subject, first)}\n\n${bulkFill(fields.text, first)}` : "先选择至少一位客户，再预览。";
    }
    async function bulkSend() {
      const fields = bulkFields();
      if (!fields || bulkDraft.sending) return;
      const submit = document.getElementById("mail-bulk-submit");
      if (!fields.recipients.length) return showError("mail-bulk-error", "请至少选择一位客户");
      if (fields.recipients.length > 200) return showError("mail-bulk-error", "一批群发最多 200 位，请分批发送");
      if (!fields.subject) return showError("mail-bulk-error", "请填写主题");
      if (!fields.text.trim()) return showError("mail-bulk-error", "请填写正文");
      if (bulkDraft.files.some((file) => !file.ready)) return showError("mail-bulk-error", "附件还在读取，请稍候再发送");
      showError("mail-bulk-error", "");
      // 发出去收不回来：第一次点只是确认人数，再点一次才真的开始发。
      if (!bulkDraft.confirm) {
        bulkDraft.confirm = true;
        if (submit) submit.textContent = `确认向 ${fields.recipients.length} 位客户分别发送`;
        return;
      }
      bulkDraft.sending = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = "正在开始…";
      }
      try {
        const data = await call("/api/mail/bulk/start", { subject: fields.subject, text: fields.text, recipients: fields.recipients, attachments: bulkDraft.files.map((file) => ({ filename: file.name, contentType: file.type, contentBase64: file.base64 })) });
        bulkDraft = null;
        ctx.closeDialog();
        ctx.toast(account && account.demo ? "示例邮箱：群发不会真的发出" : `已开始向 ${data.batch.total} 位客户发送`);
        view = "mail";
        folder = "bulk";
        reading = null;
        batch = null;
        if (onMailPage()) return loadBatch(data.batch.id);
        // 从客户页发起的：跳到群发箱并直接打开这一批的进度。
        pendingBatch = data.batch.id;
        if (ctx.openMail) return ctx.openMail("bulk");
      } catch (error) {
        if (bulkDraft) {
          bulkDraft.sending = false;
          bulkDraft.confirm = false;
        }
        showError("mail-bulk-error", error.message);
        if (submit && submit.isConnected !== false) {
          submit.disabled = false;
          submit.textContent = "发送";
        }
      }
    }
    // 从客户列表、客户详情进来的「写邮件」：一位客户直接写信，多位客户走群发。
    async function composeFor(names, pointerActivated = false) {
      const wanted = [...new Set(names || [])];
      if (!wanted.length || !(await ready(pointerActivated))) return;
      const rows = customers().filter((row) => wanted.includes(row.name));
      if (!rows.length) return ctx.toast(wanted.length === 1 ? "这位客户还没有填写邮箱" : "选中的客户都没有填写邮箱");
      if (wanted.length === 1) return openCompose({ to: rows[0].contact ? `${rows[0].contact} <${rows[0].addresses[0]}>` : rows[0].addresses[0] }, pointerActivated);
      if (rows.length < wanted.length) ctx.toast(`${wanted.length - rows.length} 位客户没有填写邮箱，已略过`);
      return bulkDialog(rows.map((row) => row.name), pointerActivated);
    }

    async function verify() {
      if (working || !account) return;
      working = true;
      accountDialog(false);
      let failure = "";
      try {
        accept(await call("/api/mail-account/verify", {}));
        ctx.toast("验证通过，邮箱连接正常");
      } catch (error) {
        if (error.code === "not_bound") account = null;
        failure = error.message;
      }
      working = false;
      if (account) accountDialog(false, failure);
      else {
        ctx.closeDialog();
        rerender();
      }
    }
    function unbindDialog(pointerActivated) {
      if (!account) return;
      ctx.dialog(
        "解除绑定",
        `<div class="drawer-body"><p>解除 ${E(account.email)} 的绑定？</p><div class="module-note">保存在这台电脑上的邮箱密码会一并删除，本机草稿保留。Zoho 里的邮件不受影响；之前的数据库备份文件里仍可能留有这个密码。</div><div class="error" id="mail-unbind-error" role="alert"></div></div>`,
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
        resetMail();
        ctx.closeDialog();
        ctx.toast("已解除绑定");
        rerender();
      } catch (error) {
        working = false;
        showError("mail-unbind-error", error.message);
      }
    }

    function action(name, pointerActivated = false, el = null) {
      const data = (el && el.dataset) || {};
      if (name === "bind") return bindDialog(pointerActivated);
      if (name === "account") return accountDialog(pointerActivated);
      if (name === "verify") return verify();
      if (name === "settings-save") return saveSettings();
      if (name === "bulk-new") return ready(pointerActivated).then((ok) => ok && bulkDialog([], pointerActivated));
      if (name === "bulk-open") {
        batch = null;
        return loadBatch(data.id);
      }
      if (name === "bulk-back") {
        batch = null;
        batchToken++;
        return loadBulk();
      }
      if (name === "bulk-cancel")
        return batch
          ? call("/api/mail/bulk/cancel", { id: batch.id }).then(
              () => loadBatch(batch.id),
              (error) => ctx.toast(error.message),
            )
          : undefined;
      if (name === "bulk-toggle" && bulkDraft) {
        if (bulkDraft.selected.has(data.name)) bulkDraft.selected.delete(data.name);
        else bulkDraft.selected.add(data.name);
        return bulkRefresh();
      }
      if (name === "bulk-all" && bulkDraft) {
        bulkDraft.selected = new Set(bulkDraft.all.map((item) => item.customer));
        return bulkRefresh();
      }
      if (name === "bulk-none" && bulkDraft) {
        bulkDraft.selected = new Set();
        return bulkRefresh();
      }
      if (name === "bulk-preview") return bulkPreview();
      if (name === "bulk-file-remove" && bulkDraft) {
        bulkDraft.files.splice(Number(data.index), 1);
        return renderFileList("mail-bulk-file-list", bulkDraft.files, "bulk-file-remove");
      }
      if (name === "unbind") return unbindDialog(pointerActivated);
      if (name === "unbind-confirm") return unbind();
      if (name === "reload") {
        const pending = loadAccount();
        render();
        return pending;
      }
      if (name === "compose") return openCompose({}, pointerActivated);
      if (name === "compose-close") return closeCompose();
      if (name === "compose-draft") return saveDraft(false);
      if (name === "file-remove") {
        if (compose) compose.files.splice(Number(data.index), 1);
        return renderFiles();
      }
      if (name === "refresh") return reading ? openMessage(reading.ref.box, reading.ref.uid) : view === "mail" && serverFolder() ? loadList(list.page) : loadCurrent();
      if (name === "clear-search") {
        query = "";
        return loadList(1);
      }
      if (name === "page-prev") return loadList(Math.max(1, list.page - 1));
      if (name === "page-next") return loadList(list.page + 1);
      if (name === "open") return openMessage(data.box, Number(data.uid));
      if (name === "back") return closeReader(false);
      if (name === "toggle-pending") return togglePending(data.box, Number(data.uid));
      if (name === "mark-unread") return markUnread();
      if (name === "delete") return confirmDelete(pointerActivated);
      if (name === "delete-confirm") return deleteMessage();
      if (name === "attachment-save") return saveAttachment(Number(data.index));
      if (name === "reply") return replyTo("one", pointerActivated);
      if (name === "reply-all") return replyTo("all", pointerActivated);
      if (name === "forward") return replyTo("forward", pointerActivated);
      if (name === "draft-open") {
        const draft = drafts.items.find((item) => item.id === data.id);
        return draft ? openCompose({ ...draft, title: "继续写信" }, pointerActivated) : undefined;
      }
      if (name === "draft-delete")
        return call("/api/mail/drafts/delete", { id: data.id }).then(
          () => loadDrafts(),
          (error) => ctx.toast(error.message),
        );
      if (name === "customer-select") {
        customerName = data.name || "";
        reading = null;
        return account ? loadThread(customerName) : rerender();
      }
      if (name === "customer-open") return ctx.openCustomer && ctx.openCustomer(data.name);
      if (name === "customer-compose") {
        const row = customers().find((item) => item.name === customerName);
        return openCompose({ to: row ? row.addresses[0] : "" }, pointerActivated);
      }
    }
    function enter() {
      reading = null;
      readToken++;
      const pending = status === "idle" || status === "error" ? loadAccount() : status === "ready" ? loadCurrent() : null;
      render();
      return pending;
    }
    return {
      subnav,
      page,
      render,
      action,
      showView(next) {
        view = views.some((item) => item.id === next) ? next : "mail";
        return enter();
      },
      view: () => view,
      select(next) {
        view = "mail";
        folder = normalize(next);
        query = "";
        batch = folder === "bulk" && pendingBatch ? { id: pendingBatch, loading: true, error: "", data: null } : null;
        pendingBatch = "";
        batchToken++;
        return enter();
      },
      folder: () => folder,
      account: () => account,
      busy: () => working || !!(compose && compose.sending),
      composing: () => !!compose,
      composeFor,
    };
  }
  root.LaiMailUI = { create, folders, views, DEFAULT_FOLDER, customerAddresses };
})(typeof window === "undefined" ? globalThis : window);
