(function (root) {
  "use strict";
  // 邮件页：绑定 Zoho 邮箱后，读取收件箱／未读／待处理／已发送，阅读、回复、转发、写信、附件、草稿，以及按客户查看往来邮件。
  // 版面是三栏：左边文件夹，中间邮件列表（发件人、主题、正文预览），右边阅读区；阅读区右侧还有这位客户的资料和最近往来。窗口窄时退回单栏。
  // 只通过本机服务通信；密码只在绑定时提交给本机服务，界面不保存、不回显。邮件正文放在禁用脚本的隔离框里显示，远程图片不加载。
  const folders = [
    { id: "inbox", label: "收件箱", icon: "mail" },
    { id: "pending", label: "待处理邮件", icon: "check" },
    { id: "unread", label: "未读邮件", icon: "bell" },
    { id: "drafts", label: "草稿箱", icon: "note" },
    { id: "sent", label: "发件箱", icon: "send" },
    { id: "bulk", label: "群发箱", icon: "people" },
  ];
  const DEFAULT_FOLDER = folders[0].id;
  // 发件箱用纸飞机；公共图标表里没有，就在这里画一个。
  const sendIcon = `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M21 3L10 14 M21 3l-7 18-4-7-7-4z"/></svg>`;
  const folderIcon = (name, draw) => (name === "send" ? sendIcon : draw(name));
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
  // 自动记往来邮件：从一批邮件里挑出该记到客户动态的。
  // 对方地址（收件箱看发件人，已发送看第一个收件人）只对上一位「在用」客户（不含公海、回收站）时才记；
  // 早于开启时间（since）的不记；已经记过的不再记。邮件数据缺字段时跳过，不报错。
  function autoRecordPlan({ customers, messages, since, isRecorded, isActive } = {}) {
    const sinceMs = Date.parse(since);
    if (!Number.isFinite(sinceMs) || !Array.isArray(messages)) return [];
    const active = typeof isActive === "function" ? isActive : (profile) => !["pool", "trash"].includes(profile?.laiBucket);
    const index = new Map();
    for (const [name, profile] of Object.entries(customers && typeof customers === "object" ? customers : {})) {
      // 公海、回收站客户也进索引：同一个地址对得上两位客户就不记，免得记错人。
      if (!profile || typeof profile !== "object") continue;
      const extra = Array.isArray(profile.extraContacts) ? profile.extraContacts.map((item) => String(item?.email ?? "").trim().toLowerCase()).filter(validAddress) : [];
      for (const address of new Set([...customerAddresses(profile), ...extra])) {
        if (!index.has(address)) index.set(address, new Set());
        index.get(address).add(name);
      }
    }
    const plan = [], seen = new Set();
    for (const message of messages) {
      try {
        if (!message || typeof message !== "object" || (message.box !== "inbox" && message.box !== "sent")) continue;
        const sent = message.box === "sent";
        const counterpart = sent ? (Array.isArray(message.to) ? message.to[0] : null) : message.from;
        const address = String(counterpart?.address ?? "").trim().toLowerCase();
        const names = index.get(address);
        if (!names || names.size !== 1) continue;
        const sentAt = Date.parse(message.date);
        if (!Number.isFinite(sentAt) || sentAt < sinceMs) continue;
        const [name] = names;
        if (!active(customers[name])) continue;
        const mail = { box: message.box, uid: message.uid, messageId: message.messageId || "", subject: message.subject || "", snippet: message.snippet || "", date: message.date, from: message.from || null, to: Array.isArray(message.to) ? message.to : [] };
        const key = String(mail.messageId).replace(/\s+/g, " ").trim() || (mail.uid ? `${mail.box}|${mail.uid}` : "");
        if (!key || seen.has(name + "\u0001" + key)) continue;
        if (typeof isRecorded === "function" && isRecorded(name, mail)) continue;
        seen.add(name + "\u0001" + key);
        plan.push({ name, mail });
      } catch (_) {
        /* 这封邮件的数据不对，跳过 */
      }
    }
    return plan;
  }
  const replySubject = (subject, prefix) => (new RegExp(`^\\s*${prefix === "Re" ? "(re|回复|答复)" : "(fwd?|转发)"}\\s*[:：]`, "i").test(subject || "") ? subject : `${prefix}: ${subject || ""}`);
  // 头像：名字或地址的第一个字，底色由地址算出来，同一个人总是同一种颜色。
  const initial = (item) => (Array.from(String((item && (item.name || item.address)) || "?").trim())[0] || "?").toUpperCase();
  const hue = (text) => {
    let n = 0;
    for (const ch of String(text || "")) n = (n * 31 + ch.codePointAt(0)) % 360;
    return n;
  };
  const sameRef = (a, b) => !!a && !!b && a.box === b.box && Number(a.uid) === Number(b.uid);
  const refKey = (item) => `${item.box}|${item.uid}`;
  // 会话串联：一封信的 Message-ID、它回复的那封（In-Reply-To）、它所在那一串（References）里只要有一个编号相同，就算同一个会话。
  // 只按编号归并，不按主题猜，免得把两件不相干但主题一样的事并到一起。返回的各组保持原来的先后顺序。
  const messageIds = (item) => [item.messageId, item.inReplyTo, ...(String(item.references || "").match(/<[^<>\s]+>/g) || [])].map((value) => String(value || "").trim()).filter(Boolean);
  function groupThreads(items) {
    const parent = new Map();
    const find = (id) => {
      let top = id;
      while (parent.get(top) !== top) top = parent.get(top);
      for (let at = id; parent.get(at) !== top; ) {
        const next = parent.get(at);
        parent.set(at, top);
        at = next;
      }
      return top;
    };
    const own = (item) => String(item.messageId || "").trim() || "#" + refKey(item);
    for (const item of items) {
      const key = own(item);
      if (!parent.has(key)) parent.set(key, key);
      for (const id of messageIds(item)) {
        if (!parent.has(id)) parent.set(id, id);
        const a = find(key),
          b = find(id);
        if (a !== b) parent.set(a, b);
      }
    }
    const groups = new Map();
    for (const item of items) {
      const top = find(own(item));
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push(item);
    }
    return [...groups.values()];
  }
  // 自带的几封示例模板（外贸常用的英文信）。{{姓名}}、{{公司}} 会换成收件客户自己的。
  const BUILTIN_TEMPLATES = [
    { id: "builtin:first", name: "首次回复询盘", subject: "Re: your inquiry", text: "Dear {{姓名}},\n\nThank you for your interest in our products. I would be glad to learn more about what {{公司}} is looking for — the items, quantities and your target delivery date — so that I can prepare a suitable offer.\n\nLooking forward to your reply.\n\nBest regards," },
    { id: "builtin:quote", name: "报价跟进", subject: "Following up on our quotation", text: "Dear {{姓名}},\n\nI am following up on the quotation I sent earlier. Please let me know if you have any questions about the price, lead time or payment terms — I am happy to adjust the offer to fit your needs.\n\nBest regards," },
    { id: "builtin:sample", name: "样品寄出通知", subject: "Your samples have been shipped", text: "Dear {{姓名}},\n\nThe samples for {{公司}} have been shipped today. I will send you the tracking number as soon as it is available. Please let me know once they arrive and share your feedback.\n\nBest regards," },
    { id: "builtin:payment", name: "付款提醒", subject: "Payment reminder", text: "Dear {{姓名}},\n\nThis is a friendly reminder that the payment for your recent order is now due. If it has already been arranged, please ignore this message and kindly send us the bank slip for our records.\n\nThank you for your cooperation.\n\nBest regards," },
  ];
  const HAS_VARIABLE = /\{\{\s*(姓名|公司)\s*\}\}/;
  const base64Size = (text) => {
    const clean = String(text || "").replace(/\s+/g, "");
    return Math.max(0, Math.floor((clean.length * 3) / 4) - (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0));
  };
  const CACHE_LIMIT = 40,
    RELATED_FRESH_MS = 120000,
    LIST_MIN = 280,
    LIST_MAX = 560;

  function create(ctx) {
    const E = ctx.escape,
      icon = ctx.icon;
    // 写信、回复、转发、群发都要“邮件·写信和回复”权限（角色预览用）。ctx.can(key) 没传时都允许。
    const canSend = () => typeof ctx.can !== "function" || ctx.can("mail.send") !== false;
    const noSend = () => ctx.toast((root.LaiRoleModel && root.LaiRoleModel.denied("mail.send")) || "你的角色没有写信和回复的权限，请找系统管理员开通");
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
      // 读过的邮件留在内存里，再点同一封不用重新下载；related 是阅读区右侧「最近往来」的内容。
      cache = new Map(),
      related = { key: "", loading: false, error: "", items: [] },
      relatedToken = 0,
      relatedCache = new Map(),
      // 右侧客户栏：auto（窗口够宽才显示）｜on｜off；listWidth 是拖动分隔线后的列表宽度。
      contactMode = "auto",
      listWidth = 0,
      revealSelected = false,
      // 会话模式（同一来往的邮件合成一行）；多选时勾中的邮件；上次检查到的“下一封新邮件编号”。
      threadMode = true,
      picked = new Map(),
      lastUidNext = 0,
      checkTimer = 0,
      checking = false,
      // 模板；客户详情页里「邮箱里的往来邮件」那一块的内容；从客户详情点开某封邮件时要去的地方。
      templates = { items: [], loading: false, error: "" },
      templateArmed = "",
      panel = { name: "", loading: false, error: "", items: [] },
      panelToken = 0,
      pendingOpen = null,
      // 每次解绑、换邮箱加一：之前发出去的检查回来时对不上就作废。
      epoch = 0;
    const BULK_STATUS = { sending: "发送中", done: "已完成", stopped: "已停止", cancelled: "已手动停止", interrupted: "已中断" };
    const ITEM_STATUS = { pending: "待发送", sent: "已发送", failed: "失败", skipped: "未发送" };
    const current = () => folders.find((item) => item.id === folder);
    const option = (item, selected) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${E(item.label)}</option>`;
    const onMailPage = () => ctx.isActive?.() !== false;
    // 正在写信时不重画页面（后台读完的列表只更新状态），免得打断输入。
    const rerender = () => {
      if (onMailPage() && !compose) render();
    };

    // ---- 客户与邮箱地址的对应 ----
    function customers() {
      const all = (ctx.getCustomers && ctx.getCustomers()) || {};
      // 客群、阶段、国家来自客户列表算好的结果，群发时按它们筛选。
      const facts = new Map(((ctx.customerRows && ctx.customerRows()) || []).map((row) => [row.name, { group: String(row.group || ""), stage: String(row.stage || ""), country: String(row.country || "") }]));
      const rows = [];
      for (const name of Object.keys(all)) {
        if (ctx.isArchived && ctx.isArchived(all[name])) continue;
        // 只看本人客户的账号：群发、收件人、客户匹配里也不出现别人的客户（客户列表已经按账号筛过）。
        if (ctx.canSeeCustomer && !ctx.canSeeCustomer(name, all[name])) continue;
        const addresses = customerAddresses(all[name]);
        if (!addresses.length) continue;
        // 群发时用的称呼：邮箱对应的联系人姓名，其次主要联系人。
        const contacts = Array.isArray(all[name].contacts) ? all[name].contacts.filter((item) => item && typeof item === "object") : [];
        const matched = contacts.find((item) => String(item.email ?? "").trim().toLowerCase() === addresses[0]);
        const contact = String((matched && (matched.contact || matched.name)) || all[name].contact || (contacts[0] && (contacts[0].contact || contacts[0].name)) || "").trim();
        rows.push({ name, addresses, contact, ...(facts.get(name) || { group: "", stage: "", country: "" }) });
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
      setCounts(null);
      reading = null;
      query = "";
      thread = { name: "", loading: false, error: "", items: [] };
      bulk = { loading: false, error: "", items: [] };
      batch = null;
      cache = new Map();
      relatedCache = new Map();
      related = { key: "", loading: false, error: "", items: [] };
      relatedToken++;
      picked = new Map();
      lastUidNext = 0;
      panel = { name: "", loading: false, error: "", items: [] };
      panelToken++;
      epoch++;
      listToken++;
      readToken++;
      threadToken++;
      batchToken++;
    }
    // 读取绑定状态。邮件页、写信入口、客户详情、启动时的检查都可能来读：同一时间只发一个请求，大家等同一个结果。
    let accountLoading = null;
    function fetchAccount() {
      if (accountLoading) return accountLoading;
      const token = ++loadToken;
      status = "loading";
      const mine = (async () => {
        try {
          const data = await call("/api/mail-account");
          if (token === loadToken) accept(data);
        } catch (error) {
          if (token === loadToken) {
            status = "error";
            loadError = error.status === 404 ? "当前版本的本机服务还不支持邮箱绑定，请更新应用后再试。" : error.message;
          }
        } finally {
          if (accountLoading === mine) accountLoading = null;
        }
      })();
      accountLoading = mine;
      return mine;
    }
    async function loadAccount() {
      await fetchAccount();
      if (status === "ready" && account) return loadCurrent();
      rerender();
    }
    const serverFolder = () => folder === "inbox" || folder === "unread" || folder === "pending" || folder === "sent";
    // 未读数、待处理数一变就告诉外壳（左侧「邮件」图标上的未读数）。
    function setCounts(next) {
      const changed = !counts || !next || counts.unread !== next.unread || counts.pending !== next.pending;
      counts = next;
      if (changed && ctx.onCounts) ctx.onCounts(counts);
      return changed;
    }
    async function loadList(page = 1) {
      const token = ++listToken;
      const key = `${folder}|${query}|${page}`,
        scope = `${folder}|${query}`;
      // 换了文件夹或搜索词时先清空，避免加载期间显示上一个列表的内容。
      if (list.scope !== scope || list.page !== page) picked = new Map();
      list = { ...list, key, scope, loading: true, error: "", page, ...(list.scope === scope ? {} : { items: [], total: 0 }) };
      rerender();
      try {
        const data = await call(withQuery("/api/mail/messages", { folder, page, query }));
        if (token !== listToken) return;
        list = { key, scope, loading: false, error: "", items: data.items || [], total: data.total || 0, page: data.page || page, pageSize: data.pageSize || 50 };
        if (data.counts) setCounts(data.counts);
        autoRecord(list.items);
      } catch (error) {
        if (token !== listToken) return;
        list = { ...list, loading: false, error: error.message, items: [], total: 0 };
      }
      rerender();
    }
    // 客户设置里开了「自动记往来邮件」时，读到的新邮件自动记到对应客户的动态里（记了就刷新一下列表上的“已记录”状态）。
    function autoRecord(items) {
      if (!ctx.autoRecordMails) return;
      Promise.resolve()
        .then(() => ctx.autoRecordMails(items))
        .then((count) => { if (count) rerender(); })
        .catch(() => {});
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
    const badge = (id) => {
      const n = counts && (id === "unread" || id === "inbox" ? counts.unread : id === "pending" ? counts.pending : 0);
      return n ? `<span class="mail-count">${n > 999 ? "999+" : n}</span>` : "";
    };
    // 只把文件夹旁边的数字换掉，不重画整页（后台检查到数字变了时用：正在看的邮件、正在打的搜索词都不受影响）。
    function paintCounts() {
      if (!onMailPage() || typeof document === "undefined" || !document.querySelectorAll) return;
      document.querySelectorAll(".mail-folders [data-mail-folder]").forEach((button) => {
        const old = button.querySelector(".mail-count");
        if (old) old.remove();
        const html = badge(button.dataset.mailFolder);
        if (html) button.insertAdjacentHTML("beforeend", html);
      });
    }
    function subnav() {
      let below;
      if (view === "mail")
        below =
          `<div class="mail-folders" role="list">` +
          folders
            .map(
              (item) =>
                // 右侧的心形由页面外壳提供（设为常用）；没提供时（例如单独测试）这一行就没有心形。
                `<div class="nav-row" role="listitem"><button type="button" class="nav-entry ${item.id === folder ? "active" : ""}" data-mail-folder="${item.id}" ${item.id === folder ? 'aria-current="page"' : ""}>${folderIcon(item.icon, icon)}<span class="mail-folder-label">${E(item.label)}</span>${badge(item.id)}</button>${ctx.favoriteHeart ? ctx.favoriteHeart("mail:" + item.id, item.label) : ""}</div>`,
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
        (canSend() ? `<button type="button" class="primary mail-compose" data-mail-action="compose">写 信</button>` : "") +
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
    const rowTool = (action, iconName, label, attrs = "") => `<button type="button" class="mail-row-tool" data-mail-action="${action}" ${attrs} aria-label="${label}" title="${label}">${icon(iconName)}</button>`;
    // 列表里显示的行：会话模式下同一会话的邮件合成一行（最新的一封在前），否则一封一行。
    const rowsOf = (items) => (threadMode ? groupThreads(items) : items.map((item) => [item]));
    const visibleRows = () => rowsOf(currentItems());
    const rowOf = (ref) => visibleRows().find((items) => items.some((item) => sameRef(item, ref))) || null;
    // 列表里的一行：第一行发件人与时间，第二行主题，第三行正文预览；右下角是客户标签和鼠标移上去才出现的快捷操作。
    // items 是这一行代表的邮件（会话时有多封），显示最新的那封，行上的操作对整组生效。
    function rowMarkup(items, index, showBox) {
      const message = items[0],
        many = items.length > 1,
        sent = message.box === "sent";
      const names = many
        ? [...new Set(items.slice().reverse().map((item) => (item.box === "sent" ? "我" : person(item.from) || "（未知发件人）")))]
        : [];
      const who = many ? names.slice(0, 3).join("、") + (names.length > 3 ? " 等" : "") : sent ? (message.to || []).map(person).join("、") || "（无收件人）" : person(message.from) || "（未知发件人）";
      const customer = items.map((item) => customerOf(item, index)).find(Boolean) || "";
      const selected = !!reading && items.some((item) => sameRef(reading.ref, item));
      const unread = items.some((item) => item.box !== "sent" && !item.seen),
        pending = items.some((item) => item.box !== "sent" && item.pending),
        on = items.every((item) => picked.has(refKey(item))),
        inboxOnly = items.some((item) => item.box !== "sent");
      const ref = `data-box="${message.box}" data-uid="${message.uid}"`;
      return (
        `<div class="mail-row ${unread ? "unread" : ""}${selected ? " selected" : ""}${on ? " picked" : ""}" role="listitem">` +
        `<button type="button" class="mail-row-main" data-mail-action="open" ${ref}${selected ? ' aria-current="true"' : ""}>` +
        `<span class="mail-row-top"><span class="mail-dot"${unread ? ' title="未读"' : ""}></span>` +
        (showBox && !many ? `<span class="mail-direction ${sent ? "out" : "in"}">${sent ? "发" : "收"}</span>` : "") +
        `<span class="mail-row-who">${sent && !showBox && !many ? "发给 " : ""}${E(who)}</span>` +
        (many ? `<span class="mail-thread-count" title="这个会话里有 ${items.length} 封邮件">${items.length}</span>` : "") +
        (items.some((item) => item.hasAttachment) ? `<span class="mail-clip" title="有附件">${icon("clip")}</span>` : "") +
        `<span class="mail-row-time">${E(shortTime(message.date))}</span></span>` +
        `<span class="mail-row-subject">${E(message.subject || "（无主题）")}</span>` +
        `<span class="mail-row-snippet">${E(message.snippet || "")}</span></button>` +
        `<button type="button" role="checkbox" class="mail-check${on ? " on" : ""}" data-mail-action="pick" ${ref} aria-checked="${on}" aria-label="${many ? "选择这个会话" : "选择这封邮件"}">${on ? icon("check") : ""}</button>` +
        `<span class="mail-row-side">` +
        (customer ? `<button type="button" class="mail-customer-chip" data-mail-action="customer-open" data-name="${E(customer)}" title="打开客户资料：${E(customer)}">${E(customer)}</button>` : "") +
        `<span class="mail-row-tools">` +
        (inboxOnly
          ? `<button type="button" class="mail-pending ${pending ? "on" : ""}" data-mail-action="toggle-pending" ${ref} aria-pressed="${pending}" aria-label="${pending ? "取消待处理" : "标为待处理"}" title="${pending ? "取消待处理" : "标为待处理"}">${icon("star")}</button>` +
            rowTool("row-read", "mail", unread ? "标为已读" : "标为未读", ref)
          : `<span class="mail-pending-slot"></span>`) +
        rowTool("row-delete", "trash", "删除", ref) +
        `</span></span></div>`
      );
    }
    // 勾选了邮件之后，列表上方出现的批量操作条。
    function bulkBar() {
      if (!picked.size) return "";
      const refs = [...picked.values()],
        inbox = refs.some((ref) => ref.box !== "sent");
      const button = (action, label) => `<button type="button" data-mail-action="${action}">${label}</button>`;
      return (
        `<div class="mail-bulkbar" role="toolbar" aria-label="批量操作"><strong>已选 ${refs.length} 封</strong>` +
        (inbox ? button("bulk-read", "标为已读") + button("bulk-unread", "标为未读") + button("bulk-pending", "待处理") + button("bulk-unpending", "取消待处理") : "") +
        button("bulk-delete", "删除") +
        `<span class="mail-bar-gap"></span>${button("pick-all", "全选本页")}${button("pick-none", "取消选择")}</div>`
      );
    }
    const threadButton = () => `<button type="button" data-mail-action="thread-toggle" aria-pressed="${threadMode}" title="${threadMode ? "现在同一来往的邮件合成一行，点一下改回一封一行" : "现在一封一行，点一下把同一来往的邮件合成一行"}">${icon("chat")}${threadMode ? "会话" : "逐封"}</button>`;
    // 三栏里的中间和右边：列表栏、可拖动的分隔线、阅读栏。
    const split = (listHtml) =>
      `<section class="module-page mail-page mail-split${reading ? " reading" : ""}${picked.size ? " picking" : ""} contact-${contactMode}"${listWidth ? ` style="--mail-list-width:${listWidth}px"` : ""}>` +
      `<div class="mail-list-pane">${listHtml}</div><div class="mail-divider" id="mail-divider" role="separator" aria-orientation="vertical" aria-label="拖动调整列表宽度" title="拖动调整列表宽度"></div>` +
      `<div class="mail-reader-pane">${readerPane()}</div></section>`;
    function listPage() {
      const title = current().label + (list.total && !list.loading ? `（${list.total}）` : "");
      const search =
        `<form class="mail-search" id="mail-search-form" role="search"><input id="mail-search-input" name="query" type="search" value="${E(query)}" placeholder="搜索主题、发件人、收件人" aria-label="搜索邮件" autocomplete="off"><button type="submit" aria-label="搜索">${icon("search")}</button></form>` +
        threadButton() +
        `<button type="button" data-mail-action="refresh" ${list.loading ? "disabled" : ""}>${icon("refresh")}刷新</button>` +
        accountButton();
      let body;
      if (list.loading && !list.items.length) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在读取邮件…</span></div>`;
      else if (list.error) body = empty("mail", "读取邮件失败", list.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!list.items.length) body = empty("mail", query ? "没有符合搜索条件的邮件" : `「${current().label}」里没有邮件`, query ? "换个关键词再试，或清除搜索。" : folder === "pending" ? "在收件箱里点邮件上的星标，可以把它标为待处理。" : "", query ? `<button type="button" data-mail-action="clear-search">清除搜索</button>` : "");
      else {
        const index = addressIndex();
        const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
        body =
          bulkBar() +
          `<div class="mail-list ${list.loading ? "loading" : ""}" id="mail-list" role="list">${rowsOf(list.items).map((items) => rowMarkup(items, index, false)).join("")}</div>` +
          `<div class="mail-pager"><span>共 ${list.total} 封 · 第 ${list.page} / ${pages} 页</span><button type="button" data-mail-action="page-prev" ${list.page <= 1 || list.loading ? "disabled" : ""}>上一页</button><button type="button" data-mail-action="page-next" ${list.page >= pages || list.loading ? "disabled" : ""}>下一页</button></div>`;
      }
      return pagebar(title, search) + split(body);
    }
    // 草稿、群发记录用的宽行：和邮件列表同一种样式，只是没有阅读栏。
    const plainRow = (action, id, who, subject, snippet, time, tools = "") =>
      `<div class="mail-row" role="listitem"><button type="button" class="mail-row-main" data-mail-action="${action}" data-id="${E(id)}"><span class="mail-row-top"><span class="mail-dot"></span><span class="mail-row-who">${who}</span><span class="mail-row-time">${E(time)}</span></span><span class="mail-row-subject">${E(subject || "（无主题）")}</span><span class="mail-row-snippet">${E(snippet || "")}</span></button>${tools ? `<span class="mail-row-side"><span class="mail-row-tools">${tools}</span></span>` : ""}</div>`;
    function draftsPage() {
      let body;
      if (drafts.loading && !drafts.items.length) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在读取草稿…</span></div>`;
      else if (drafts.error) body = empty("note", "读取草稿失败", drafts.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!drafts.items.length) body = empty("note", "草稿箱是空的", "写信时点「存草稿」，或没发出就关闭，内容和附件会保存在这里。草稿只保存在这台电脑上。");
      else
        body =
          `<div class="mail-list wide" role="list">` +
          drafts.items.map((draft) => plainRow("draft-open", draft.id, E(draft.to ? "发给 " + draft.to : "（未填收件人）") + ((draft.attachments || []).length ? `<span class="mail-clip" title="带 ${draft.attachments.length} 个附件">${icon("clip")}</span>` : ""), draft.subject, String(draft.text || "").replace(/\s+/g, " ").trim().slice(0, 140), shortTime(draft.updatedAt), rowTool("draft-delete", "trash", "删除草稿", `data-id="${E(draft.id)}"`))).join("") +
          `</div>`;
      return pagebar(`草稿箱${drafts.items.length ? `（${drafts.items.length}）` : ""}`, `<button type="button" data-mail-action="refresh">${icon("refresh")}刷新</button>` + accountButton()) + `<section class="module-page mail-page mail-list-page">${body}</section>`;
    }
    function frameDocument(html) {
      return (
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank">` +
        `<style>html{color-scheme:light}body{margin:4px 0 16px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d273e;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #d9dde5;color:#53617b}a{color:#0a6aff}</style></head><body>${html}</body></html>`
      );
    }
    // 这封邮件的“对方”：是客户就给出客户和它的全部邮箱，否则就是发件人（已发送的邮件取第一位收件人）。
    function counterpart(m) {
      const name = customerOf(m, addressIndex());
      if (name) {
        const row = customers().find((item) => item.name === name);
        if (row) return { name, contact: row.contact, addresses: row.addresses.slice(0, 20) };
      }
      const other = m.box === "sent" ? (m.to || [])[0] : m.from;
      if (!other || !validAddress(other.address) || (account && other.address === account.email)) return null;
      return { name: "", person: other, addresses: [other.address] };
    }
    // 「记到动态」：把这封邮件记进客户资料的动态里（往来邮件）。记过的显示为已记录。
    const recordButton = (name, item) => {
      if (!ctx.recordMail) return "";
      const done = !!(ctx.isMailRecorded && ctx.isMailRecorded(name, item));
      return `<button type="button" data-mail-action="record" data-name="${E(name)}" data-box="${item.box}" data-uid="${item.uid}" ${done ? "disabled" : ""} title="${done ? "这封邮件已经在客户动态里了" : "把这封邮件记到这位客户的动态里"}">${done ? "已记录" : "记到动态"}</button>`;
    };
    // 阅读区右侧：对方是谁、能做什么、最近和他的往来邮件。
    function contactPanel(m) {
      const who = counterpart(m);
      if (!who) return "";
      const head = who.name
        ? `<span class="mail-avatar large" style="background:hsl(${hue(who.name)} 45% 46%)">${E(initial({ name: who.name }))}</span><strong>${E(who.name)}</strong>` +
          (who.contact ? `<span class="mail-contact-line">${E(who.contact)}</span>` : "") +
          who.addresses.slice(0, 3).map((address) => `<span class="mail-contact-line">${E(address)}</span>`).join("") +
          `<div class="mail-contact-actions"><button type="button" data-mail-action="customer-open" data-name="${E(who.name)}">客户资料</button>${canSend() ? `<button type="button" data-mail-action="contact-compose" data-to="${E(who.contact ? `${who.contact} <${who.addresses[0]}>` : who.addresses[0])}">写信</button>` : ""}${recordButton(who.name, m)}</div>`
        : `<span class="mail-avatar large" style="background:hsl(${hue(who.person.address)} 45% 46%)">${E(initial(who.person))}</span><strong>${E(person(who.person))}</strong><span class="mail-contact-line">${E(who.person.address)}</span><span class="mail-contact-note">这个邮箱还不在客户资料里。</span>` +
          (canSend() ? `<div class="mail-contact-actions"><button type="button" data-mail-action="contact-compose" data-to="${E(who.person.name ? `${who.person.name} <${who.person.address}>` : who.person.address)}">写信</button></div>` : "");
      const others = related.key === who.addresses.join(",") ? related.items.filter((item) => !sameRef(item, m)).slice(0, 8) : [];
      const recent = related.key !== who.addresses.join(",") || related.loading
        ? `<span class="mail-contact-note">正在查找…</span>`
        : related.error
          ? `<span class="mail-contact-note">${E(related.error)}</span>`
          : others.length
            ? others.map((item) => `<button type="button" class="mail-contact-item" data-mail-action="open" data-box="${item.box}" data-uid="${item.uid}"><span class="mail-direction ${item.box === "sent" ? "out" : "in"}">${item.box === "sent" ? "发" : "收"}</span><span class="mail-contact-subject">${E(item.subject || "（无主题）")}</span><span class="mail-row-time">${E(shortTime(item.date))}</span></button>`).join("")
            : `<span class="mail-contact-note">没有其他往来邮件。</span>`;
      // 客户页签里左边的列表就是往来邮件，这里不重复列。
      return `<aside class="mail-contact" aria-label="联系人"><div class="mail-contact-head">${head}</div>${view === "customer" ? "" : `<h3>最近往来</h3><div class="mail-contact-list">${recent}</div>`}</aside>`;
    }
    // 正在看的这封所在的会话：列表里和「最近往来」里编号连得上的邮件，按时间从早到晚。只有一封时返回空。
    function conversation(m) {
      const seen = new Set(),
        pool = [];
      for (const item of [...currentItems(), ...related.items, m]) {
        if (seen.has(refKey(item))) continue;
        seen.add(refKey(item));
        pool.push(item);
      }
      const mine = groupThreads(pool).find((items) => items.some((item) => sameRef(item, m))) || [];
      return mine.length > 1 ? mine.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.uid - b.uid) : [];
    }
    const stripItem = (item) =>
      `<button type="button" class="mail-thread-item" data-mail-action="open" data-box="${item.box}" data-uid="${item.uid}"><span class="mail-avatar small" style="background:hsl(${hue(item.from && item.from.address)} 45% 46%)">${E(item.box === "sent" ? "我" : initial(item.from))}</span><span class="mail-thread-who">${E(item.box === "sent" ? "我" : person(item.from) || "（未知发件人）")}</span><span class="mail-thread-snippet">${E(item.snippet || item.subject || "")}</span><span class="mail-row-time">${E(shortTime(item.date))}</span></button>`;
    function readerPane() {
      if (!reading)
        return `<div class="empty mail-unbound mail-reader-empty"><div class="mail-unbound-art">${icon("mail")}</div><strong>选择一封邮件</strong><span>在左边的列表里点一封，内容会显示在这里。</span><span class="mail-keys">快捷键：↑ ↓ 上一封／下一封，R 回复，A 回复全部，F 转发，S 待处理，U 标为未读，Delete 删除，C 写信，/ 搜索</span></div>`;
      const back = `<button type="button" class="mail-back" data-mail-action="back" title="返回列表">${icon("back")}返回</button>`;
      if (reading.loading) return `<div class="mail-reader-main"><div class="mail-reader-bar">${back}</div><div class="empty mail-unbound" aria-busy="true"><span>正在读取邮件内容…</span></div></div>`;
      if (reading.error) return `<div class="mail-reader-main"><div class="mail-reader-bar">${back}</div>${empty("mail", "无法打开这封邮件", reading.error, `<button type="button" class="primary" data-mail-action="back">返回列表</button>`)}</div>`;
      const m = reading.message,
        sent = m.box === "sent",
        customer = customerOf(m, addressIndex()),
        ref = `data-box="${m.box}" data-uid="${m.uid}"`;
      // 左边三个主要操作带文字；右边几个次要操作只有图标，文字放在提示里，窄的时候也排得下。
      const tool = (action, iconName, label, attrs = "", compact = false) => `<button type="button" class="mail-tool${compact ? " compact" : ""}" data-mail-action="${action}" ${attrs} title="${label}"${compact ? ` aria-label="${label}"` : ""}>${icon(iconName)}${compact ? "" : `<span>${label}</span>`}</button>`;
      const panel = contactPanel(m);
      const bar =
        `<div class="mail-reader-bar" role="toolbar" aria-label="邮件操作">${back}${canSend() ? tool("reply", "reply", "回复") + tool("reply-all", "replyAll", "回复全部") + tool("forward", "forward", "转发") : ""}<span class="mail-bar-gap"></span>` +
        (sent ? "" : tool("toggle-pending", "star", m.pending ? "取消待处理" : "标为待处理", `${ref} data-single="1" aria-pressed="${!!m.pending}"`, true) + tool("mark-unread", "mail", "标为未读", "", true)) +
        tool("delete", "trash", "删除", "", true) +
        (panel ? tool("contact-toggle", "people", "显示或收起联系人栏", `aria-pressed="${contactMode !== "off"}"`, true) : "") +
        `</div>`;
      const fact = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : "");
      const attachments = (m.attachments || []).length
        ? `<div class="mail-attachments"><h3>附件（${m.attachments.length}）</h3><ul>${m.attachments.map((item) => `<li><span class="mail-attachment-name">${icon("clip")}${E(item.filename)}</span><span class="mail-attachment-size">${fileSize(item.size)}</span><button type="button" data-mail-action="attachment-save" data-index="${item.index}">保存到「下载」</button></li>`).join("")}</ul><div class="error" id="mail-attachment-error" role="alert"></div></div>`
        : "";
      const content = m.html
        ? `<iframe class="mail-body-frame" title="邮件正文" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${E(frameDocument(m.html))}"></iframe><p class="mail-body-note">为保护隐私，邮件里的远程图片不会加载。</p>`
        : `<div class="mail-body-text">${E(m.text || "（这封邮件没有正文）")}</div>`;
      const target = sent ? (m.to || [])[0] : (m.replyTo && m.replyTo[0]) || m.from;
      // 会话里的其他邮件：比这封早的折叠在上面，比这封晚的折叠在下面，点一下换成看那一封。
      const talk = conversation(m),
        at = talk.findIndex((item) => sameRef(item, m));
      const earlier = at > 0 ? `<div class="mail-thread-strip" aria-label="这个会话里更早的邮件">${talk.slice(0, at).map(stripItem).join("")}</div>` : "",
        later = at >= 0 && at < talk.length - 1 ? `<div class="mail-thread-strip" aria-label="这个会话里更晚的邮件">${talk.slice(at + 1).map(stripItem).join("")}</div>` : "";
      return (
        `<div class="mail-reader-main">${bar}<div class="mail-reader-scroll"><div class="error" id="mail-reader-error" role="alert"></div>` +
        `<h2 class="mail-reader-subject">${E(m.subject || "（无主题）")}${talk.length ? `<span class="mail-thread-count" title="这个会话里有 ${talk.length} 封邮件">${talk.length}</span>` : ""}</h2>` +
        earlier +
        `<div class="mail-reader-from"><span class="mail-avatar" style="background:hsl(${hue(m.from && m.from.address)} 45% 46%)">${E(initial(m.from))}</span>` +
        `<div class="mail-reader-who"><strong class="mail-reader-name">${E(person(m.from) || "（未知发件人）")}</strong>${m.from && m.from.name ? `<span class="mail-reader-address">${E(m.from.address)}</span>` : ""}` +
        (customer ? `<button type="button" class="mail-customer-chip" data-mail-action="customer-open" data-name="${E(customer)}" title="打开客户资料">${E(customer)}</button>` : "") +
        `</div><span class="mail-reader-time">${E(fullTime(m.date))}</span></div>` +
        `<dl class="mail-reader-facts">${fact("收件人", E(addressLine(m.to)))}${fact("抄送", E(addressLine(m.cc)))}</dl>` +
        attachments +
        content +
        later +
        `</div>${canSend() ? `<div class="mail-quick"><button type="button" class="mail-quick-reply" data-mail-action="reply">${icon("reply")}<span>回复 ${E(person(target) || "发件人")}…</span></button><button type="button" data-mail-action="forward">转发</button></div>` : ""}</div>` +
        panel
      );
    }
    function customerPage() {
      const rows = customers();
      if (!rows.length) return pagebar("客户邮件", accountButton()) + `<section class="module-page mail-page">${empty("people", "还没有填写了邮箱的客户", "在客户资料里填上公司邮箱或联系人邮箱后，这里会按客户归集往来邮件。")}</section>`;
      const row = rows.find((item) => item.name === customerName);
      if (!row) return pagebar("客户邮件", accountButton()) + `<section class="module-page mail-page">${empty("people", "选择一个客户", `左侧列出了 ${rows.length} 个填写了邮箱的客户，点一个查看与它的往来邮件。`)}</section>`;
      const actions = (canSend() ? `<button type="button" class="primary" data-mail-action="customer-compose">写信给该客户</button>` : "") + `<button type="button" data-mail-action="customer-open" data-name="${E(row.name)}">查看客户资料</button>${threadButton()}<button type="button" data-mail-action="refresh" ${thread.loading ? "disabled" : ""}>${icon("refresh")}刷新</button>` + accountButton();
      let body;
      if (thread.loading) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在查找往来邮件…</span></div>`;
      else if (thread.error) body = empty("mail", "读取往来邮件失败", thread.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!thread.items.length) body = empty("mail", "还没有往来邮件", `在收件箱和已发送里没有找到与 ${row.addresses.join("、")} 有关的邮件。`);
      else body = `<p class="mail-thread-note">${E(row.addresses.join("、"))} · 收件箱与已发送中最近的 ${thread.items.length} 封</p>${bulkBar()}<div class="mail-list" id="mail-list" role="list">${rowsOf(thread.items).map((items) => rowMarkup(items, new Map(), true)).join("")}</div>`;
      return pagebar(row.name, actions) + split(body);
    }
    const bulkProgress = (b) => `已发 ${b.sent} / 共 ${b.total}${b.failed ? ` · 失败 ${b.failed}` : ""}${b.skipped ? ` · 未发 ${b.skipped}` : ""}`;
    const bulkTag = (b) => `<span class="mail-bulk-tag ${E(b.status)}">${E(BULK_STATUS[b.status] || b.status)}</span>`;
    function bulkPage() {
      const actions = (canSend() ? `<button type="button" class="primary" data-mail-action="bulk-new">新建群发</button>` : "") + `<button type="button" data-mail-action="refresh" ${bulk.loading ? "disabled" : ""}>${icon("refresh")}刷新</button>` + accountButton();
      let body;
      if (bulk.loading && !bulk.items.length) body = `<div class="empty mail-unbound" aria-busy="true"><span>正在读取群发记录…</span></div>`;
      else if (bulk.error) body = empty("people", "读取群发记录失败", bulk.error, `<button type="button" class="primary" data-mail-action="refresh">重试</button>`);
      else if (!bulk.items.length) body = empty("people", "还没有群发记录", "群发会给每位客户单独发一封，对方看不到其他收件人；正文里可以用 {{姓名}}、{{公司}} 自动换成每位客户自己的。", `<button type="button" class="primary" data-mail-action="bulk-new">新建群发</button>`);
      else
        body =
          `<div class="mail-list wide" role="list">` +
          bulk.items.map((b) => plainRow("bulk-open", b.id, `${bulkTag(b)} ${E(bulkProgress(b))}`, b.subject, "", shortTime(b.createdAt))).join("") +
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
      if (compose) return composePage();
      if (view === "team") return pagebar("下属邮件") + `<section class="module-page mail-page">${empty("lead", "查看下属的邮件", "这需要公司账号和上下级关系。来财目前是单机版，还没有这部分。")}</section>`;
      const blocked = gate();
      if (blocked) return pagebar(view === "customer" ? "客户邮件" : current().label) + `<section class="module-page mail-page">${blocked}</section>`;
      if (view === "customer") return customerPage();
      if (folder === "drafts") return draftsPage();
      if (folder === "bulk") return batch ? batchPage() : bulkPage();
      return listPage();
    }
    function render() {
      capture();
      // 重画前记下列表滚到哪里，画完放回去：点开一封邮件时列表不会跳回顶部。
      const before = document.getElementById("mail-list");
      const kept = before && before.dataset ? { scope: before.dataset.scope, top: Number(before.scrollTop) || 0 } : null;
      ctx.mount(page());
      if (compose) return mountCompose();
      const listBox = document.getElementById("mail-list");
      if (listBox && listBox.dataset) {
        listBox.dataset.scope = view === "customer" ? "customer|" + customerName : list.scope || "";
        if (kept && kept.scope === listBox.dataset.scope && kept.top) listBox.scrollTop = kept.top;
        if (revealSelected && listBox.querySelector) {
          const row = listBox.querySelector(".mail-row.selected");
          if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
        }
      }
      revealSelected = false;
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
      mountDivider();
    }
    // 拖动列表和阅读区之间的分隔线来调整列表宽度；宽度只在这次打开应用期间记住。
    function mountDivider() {
      const divider = document.getElementById("mail-divider"),
        section = divider && divider.parentElement,
        pane = section && section.firstElementChild;
      if (!divider || !divider.addEventListener || !section || !pane || !pane.getBoundingClientRect) return;
      divider.addEventListener("pointerdown", (event) => {
        if (event.button) return;
        event.preventDefault();
        const startX = event.clientX,
          startWidth = pane.getBoundingClientRect().width;
        let width = startWidth;
        const move = (next) => {
          width = Math.round(Math.max(LIST_MIN, Math.min(LIST_MAX, startWidth + next.clientX - startX)));
          section.style.setProperty("--mail-list-width", width + "px");
        };
        const stop = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", stop);
          document.removeEventListener("pointercancel", stop);
          divider.classList.remove("dragging");
          listWidth = width;
        };
        divider.classList.add("dragging");
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
        document.addEventListener("pointercancel", stop);
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
      return [...list.items, ...thread.items, ...related.items, ...panel.items].filter((item) => item.box === box && item.uid === uid);
    }
    // 当前这一栏列表里的邮件（键盘上下切换、删除后选下一封都按它来）。
    const currentItems = () => (view === "customer" ? thread.items : view === "mail" && serverFolder() ? list.items : []);
    // 同一封邮件可能同时出现在几个列表里（文件夹、客户往来、最近往来）：一起改，未读数只动一次。
    function markSeen(box, uid) {
      const items = findMessage(box, uid);
      if (items.some((item) => !item.seen) && counts && box === "inbox") setCounts({ ...counts, unread: Math.max(0, counts.unread - 1) });
      for (const item of items) item.seen = true;
    }
    function remember(box, uid, message) {
      const key = `${box}|${uid}`;
      cache.delete(key);
      cache.set(key, message);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }
    // 阅读区右侧的「最近往来」：客户页签里直接用已经查到的往来列表，其余情况向本机服务查一次，两分钟内不重复查。
    async function loadRelated(m, token) {
      const who = counterpart(m);
      if (!who) {
        related = { key: "", loading: false, error: "", items: [] };
        return;
      }
      const key = who.addresses.join(",");
      if (view === "customer") {
        related = { key, loading: false, error: "", items: [] };
        return;
      }
      const known = relatedCache.get(key);
      if (known && Date.now() - known.at < RELATED_FRESH_MS) {
        related = { key, loading: false, error: "", items: known.items };
        return rerender();
      }
      const mine = ++relatedToken;
      related = { key, loading: true, error: "", items: [] };
      rerender();
      try {
        const data = await call(withQuery("/api/mail/correspondence", { addresses: key }));
        relatedCache.set(key, { at: Date.now(), items: data.items || [] });
        if (mine !== relatedToken || token !== readToken) return;
        related = { key, loading: false, error: "", items: data.items || [] };
      } catch (error) {
        if (mine !== relatedToken || token !== readToken) return;
        related = { key, loading: false, error: "读取往来邮件失败：" + error.message, items: [] };
      }
      rerender();
    }
    // 打开一封邮件。读过的直接从内存里拿；options.fresh 强制重新读，options.wait 是键盘连续切换时稍等一下再去读，免得每按一下都连一次邮箱。
    async function openMessage(box, uid, options = {}) {
      const token = ++readToken,
        known = options.fresh ? null : cache.get(`${box}|${uid}`);
      if (known) {
        const wasUnread = findMessage(box, uid).some((item) => !item.seen);
        reading = { loading: false, error: "", message: known, ref: { box, uid } };
        markSeen(box, uid);
        rerender();
        // 之前被标成未读、现在又点开：正文不用重新下载，但要告诉邮箱它已读。
        if (wasUnread) call("/api/mail/flags", { box, uid, seen: true }).catch(() => {});
        return loadRelated(known, token);
      }
      reading = { loading: true, error: "", message: null, ref: { box, uid } };
      rerender();
      if (options.wait) {
        await new Promise((resolve) => root.setTimeout(resolve, options.wait));
        if (token !== readToken) return;
      }
      try {
        const data = await call(withQuery("/api/mail/message", { box, uid }));
        if (token !== readToken) return;
        reading = { loading: false, error: "", message: data.message, ref: { box, uid } };
        remember(box, uid, data.message);
        markSeen(box, uid);
      } catch (error) {
        if (token !== readToken) return;
        reading = { loading: false, error: error.message, message: null, ref: { box, uid } };
      }
      rerender();
      if (reading && reading.message) return loadRelated(reading.message, token);
    }
    function closeReader(reload) {
      reading = null;
      readToken++;
      if (reload) return loadCurrent();
      rerender();
    }
    // 键盘上下键：选中相邻的一行并显示（会话模式下一行是一个会话，显示其中最新的一封）。
    function step(delta) {
      const rows = visibleRows();
      if (!rows.length) return;
      const at = reading ? rows.findIndex((items) => items.some((item) => sameRef(item, reading.ref))) : -1;
      const next = rows[at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + delta))];
      if (!next || (reading && next.some((item) => sameRef(item, reading.ref)))) return;
      revealSelected = true;
      return openMessage(next[0].box, next[0].uid, { wait: ctx.keyDelayMs ?? 160 });
    }
    // 向邮箱提交标记改动：同一个文件夹里的多封合成一次请求。
    const byBox = (refs) => {
      const boxes = new Map();
      for (const ref of refs) boxes.set(ref.box, [...(boxes.get(ref.box) || []), Number(ref.uid)]);
      return [...boxes];
    };
    async function sendFlags(refs, change) {
      for (const [box, uids] of byBox(refs)) await call("/api/mail/flags", uids.length === 1 ? { box, uid: uids[0], ...change } : { box, uids, ...change });
    }
    const flagError = (error) => {
      if (!showError("mail-reader-error", error.message)) ctx.toast(error.message);
      return false;
    };
    // 改待处理标记。只对收到的邮件有意义；界面上的数字按实际改动的封数增减。
    async function setPending(refs, pending) {
      const targets = refs.filter((ref) => ref.box !== "sent");
      if (!targets.length) return false;
      try {
        await sendFlags(targets, { pending });
      } catch (error) {
        return flagError(error);
      }
      let moved = 0;
      for (const ref of targets) {
        const known = findMessage(ref.box, Number(ref.uid)),
          stored = cache.get(refKey(ref));
        const before = known[0] ? !!known[0].pending : !!(stored && stored.pending);
        if (before !== pending) moved++;
        for (const item of known) item.pending = pending;
        if (stored) stored.pending = pending;
      }
      if (counts && moved) setCounts({ ...counts, pending: Math.max(0, counts.pending + (pending ? moved : -moved)) });
      return true;
    }
    // 改已读标记。
    async function setSeen(refs, seen) {
      const targets = refs.filter((ref) => ref.box !== "sent");
      if (!targets.length) return false;
      try {
        await sendFlags(targets, { seen });
      } catch (error) {
        return flagError(error);
      }
      let moved = 0;
      for (const ref of targets) {
        const known = findMessage(ref.box, Number(ref.uid));
        if (known.length && (seen ? known.some((item) => !item.seen) : known.every((item) => item.seen)) && ref.box === "inbox") moved++;
        for (const item of known) item.seen = seen;
      }
      if (counts && moved) setCounts({ ...counts, unread: Math.max(0, counts.unread + (seen ? -moved : moved)) });
      return true;
    }
    const afterFlags = (kind) => (view === "mail" && folder === kind ? loadList(list.page) : rerender());
    // 行上或阅读区的星标。阅读区（single）只改正在看的这一封；列表行在会话模式下改整个会话。
    async function togglePending(box, uid, single) {
      const row = single ? null : rowOf({ box, uid });
      const refs = row ? row.filter((item) => item.box !== "sent") : [{ box, uid }];
      const known = findMessage(box, uid)[0] || cache.get(`${box}|${uid}`);
      const next = row ? !row.some((item) => item.box !== "sent" && item.pending) : !(known && known.pending);
      if (await setPending(refs, next)) return afterFlags("pending");
    }
    async function markUnread() {
      const m = reading && reading.message;
      if (!m || !(await setSeen([m], false))) return;
      closeReader(true);
    }
    // 行上的「标为已读／未读」：有未读就全部标为已读，否则全部标为未读。正在看的那封被标为未读时收起阅读区（否则它马上又会被当成已读）。
    async function toggleRowSeen(box, uid) {
      const row = rowOf({ box, uid }) || findMessage(box, uid).slice(0, 1);
      if (!row.length) return;
      const seen = row.some((item) => item.box !== "sent" && !item.seen);
      if (!(await setSeen(row, seen))) return;
      if (!seen && reading && row.some((item) => sameRef(reading.ref, item))) {
        reading = null;
        readToken++;
      }
      return afterFlags("unread");
    }
    // ---- 多选 ----
    function togglePick(box, uid) {
      const row = rowOf({ box, uid }) || [{ box, uid }];
      const on = row.every((item) => picked.has(refKey(item)));
      for (const item of row) {
        if (on) picked.delete(refKey(item));
        else picked.set(refKey(item), { box: item.box, uid: Number(item.uid) });
      }
      rerender();
    }
    async function bulkFlag(kind, value) {
      const refs = [...picked.values()];
      if (!refs.length) return;
      if (!(await (kind === "seen" ? setSeen(refs, value) : setPending(refs, value)))) return;
      if (kind === "seen" && !value && reading && refs.some((ref) => sameRef(ref, reading.ref))) {
        reading = null;
        readToken++;
      }
      picked = new Map();
      return afterFlags(kind === "seen" ? "unread" : "pending");
    }
    // 删除前确认。refs 是要删的邮件；同时记下列表里它们后面的那一行，删完正在看的那封后自动显示它。
    function confirmDelete(pointerActivated, refs) {
      const targets = (refs || (reading && reading.message ? [reading.message] : [])).map((item) => ({ box: item.box, uid: Number(item.uid) }));
      if (!targets.length) return;
      const gone = (items) => items.every((item) => targets.some((ref) => sameRef(ref, item)));
      const rows = visibleRows(),
        last = rows.reduce((found, items, index) => (items.some((item) => targets.some((ref) => sameRef(ref, item))) ? index : found), -1);
      const after = last < 0 ? null : rows.slice(last + 1).find((items) => !gone(items)) || rows.slice(0, last).reverse().find((items) => !gone(items)) || null;
      const first = findMessage(targets[0].box, targets[0].uid)[0] || (reading && reading.message && sameRef(reading.message, targets[0]) ? reading.message : null);
      confirmTarget = { refs: targets, next: after ? { box: after[0].box, uid: after[0].uid } : null };
      ctx.dialog(
        "删除邮件",
        `<div class="drawer-body"><p>${targets.length > 1 ? `删除这 ${targets.length} 封邮件？` : `删除「${E((first && first.subject) || "（无主题）")}」？`}</p><div class="module-note">邮件会移到 Zoho 邮箱的「已删除」文件夹，可以在 Zoho 里恢复。</div><div class="error" id="mail-confirm-error" role="alert"></div></div>`,
        `<button type="button" data-action="close-modal">取消</button><button type="button" class="primary" data-mail-action="delete-confirm">删除</button>`,
        "mail-confirm",
        pointerActivated,
      );
    }
    async function deleteMessage() {
      if (!confirmTarget || working) return;
      const target = confirmTarget;
      working = true;
      const moved = [];
      const forget = (refs) => {
        for (const ref of refs) {
          cache.delete(refKey(ref));
          picked.delete(refKey(ref));
        }
        relatedCache = new Map();
      };
      try {
        for (const [box, uids] of byBox(target.refs)) {
          await call("/api/mail/trash", uids.length === 1 ? { box, uid: uids[0] } : { box, uids });
          moved.push(...uids.map((uid) => ({ box, uid })));
        }
      } catch (error) {
        working = false;
        // 两个文件夹里各有几封时，可能前一个删成了、后一个没成：已经删掉的从界面上去掉，剩下的留着可以再试。
        if (moved.length) {
          forget(moved);
          confirmTarget = { ...target, refs: target.refs.filter((ref) => !moved.some((done) => sameRef(done, ref))) };
          if (reading && moved.some((ref) => sameRef(reading.ref, ref))) {
            reading = null;
            readToken++;
          }
          await loadCurrent();
          return showError("mail-confirm-error", `${moved.length} 封已移到「已删除」，其余 ${confirmTarget.refs.length} 封没有删掉：${error.message}`);
        }
        return showError("mail-confirm-error", error.message);
      }
      working = false;
      confirmTarget = null;
      forget(target.refs);
      ctx.closeDialog();
      ctx.toast(target.refs.length > 1 ? `${target.refs.length} 封邮件已移到「已删除」` : "已移到「已删除」");
      const wasOpen = !!reading && target.refs.some((ref) => sameRef(reading.ref, ref));
      if (wasOpen) {
        reading = null;
        readToken++;
      }
      await loadCurrent();
      // 删的是正在看的那封：接着显示列表里的下一行。
      if (wasOpen && target.next && !reading && currentItems().some((item) => sameRef(item, target.next))) return openMessage(target.next.box, target.next.uid);
    }
    // ---- 新邮件检查：每隔一会儿问一下收件箱概况，有新邮件就提示，并更新未读数 ----
    async function check() {
      if (checking || status !== "ready" || !account || account.autoCheck === false || compose) return false;
      if (typeof document !== "undefined" && document.hidden) return false;
      checking = true;
      const began = epoch;
      try {
        const data = await call("/api/mail/status");
        if (began !== epoch || !account) return false;
        const fresh = lastUidNext && data.uidNext > lastUidNext ? data.uidNext - lastUidNext : 0;
        lastUidNext = data.uidNext || lastUidNext;
        const changed = setCounts({ unread: data.unread, pending: data.pending });
        if (fresh) ctx.toast(`收到 ${fresh} 封新邮件`);
        // 正停在收件箱或未读的第一页、又没在搜索时，顺手把列表也更新了（正在看的那封不受影响）。
        if (fresh && onMailPage() && view === "mail" && (folder === "inbox" || folder === "unread") && list.page === 1 && !query && !list.loading) await loadList(1);
        else if (changed) paintCounts();
        return true;
      } catch (_) {
        // 自动检查失败不打扰用户；下次打开邮件或手动刷新时会看到具体原因。
        return false;
      } finally {
        checking = false;
      }
    }
    // 应用启动时调用一次：悄悄读取绑定状态，绑定了就开始定时检查。
    async function start() {
      if (status === "idle") await fetchAccount();
      const every = ctx.checkMs ?? 60000;
      if (every > 0 && !checkTimer && root.setInterval) checkTimer = root.setInterval(check, every);
      return check();
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

    // ---- 写信（独立页面，富文本） ----
    const textToHtml = (text) => String(text ?? "").split("\n").map((line) => `<div>${E(line) || "<br>"}</div>`).join("");
    // 签名带一个记号，存模板时好把它去掉（不然用模板时会出现两份签名）。
    const signatureHtml = () => (account && account.signature ? `<div><br></div><div class="lai-signature">${textToHtml(account.signature)}</div>` : "");
    const WRAP = `font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;color:#1d273e`;
    const QUOTE = `margin:8px 0 0 .8ex;border-left:2px solid #ccd3de;padding-left:1.2ex;color:#53617b`;
    // 发出的 HTML：包一层基本字体，引用块写上内联样式（收件方的邮箱不认我们的样式表）。
    const outgoingHtml = (html) => `<div style="${WRAP}">${String(html || "").replace(/<blockquote(?![^>]*\bstyle=)/gi, `<blockquote style="${QUOTE}"`)}</div>`;
    function renderFileList(id, files, removeAction) {
      const box = document.getElementById(id);
      if (!box) return;
      box.innerHTML = files.map((file, index) => `<li><span class="mail-attachment-name">${icon("clip")}${E(file.name)}</span><span class="mail-attachment-size">${fileSize(file.size)}</span><button type="button" data-mail-action="${removeAction}" data-index="${index}">移除</button></li>`).join("");
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
    // 写信类入口共用：没读过绑定状态就先读；没有可用邮箱时提示并打开绑定窗口。
    async function ready(pointerActivated) {
      if (status !== "ready") await fetchAccount();
      if (status === "ready" && account) return true;
      ctx.toast(status !== "ready" ? "无法读取邮箱绑定状态，请到邮件页重试" : available ? "请先绑定邮箱" : "网页试用版无法收发邮件");
      if (status === "ready") bindDialog(pointerActivated);
      return false;
    }
    // 把页面上正在填的内容收进 compose.values，这样页面被重画也不丢。
    function capture() {
      if (!compose) return null;
      // 这封信自己的页面画出来之后才读表单：刚新开的一封不能把屏幕上还留着的上一封的内容读进来。
      const form = compose.mounted ? document.getElementById("mail-compose-form") : null;
      if (form) {
        const value = (name, fallback) => (form.elements[name] ? String(form.elements[name].value ?? "") : fallback);
        const v = compose.values;
        compose.values = { ...v, to: value("to", v.to).trim(), cc: value("cc", v.cc).trim(), bcc: value("bcc", v.bcc).trim(), subject: value("subject", v.subject).trim(), fromName: value("fromName", v.fromName).trim(), forwardAttachments: form.elements.forwardAttachments ? !!form.elements.forwardAttachments.checked : v.forwardAttachments };
      }
      if (compose.editor) {
        compose.values.html = compose.editor.getHTML();
        // 纯文字那一份里，连续的空行收成一行（编辑器里的一个空行读出来常是两个）。
        compose.values.text = String(compose.editor.getText() ?? "").replace(/\n{3,}/g, "\n\n");
      }
      return compose.values;
    }
    const composeSnapshot = () => JSON.stringify([compose.values.to, compose.values.cc, compose.values.bcc, compose.values.subject, compose.values.html, compose.mode === "bulk" ? [...compose.selected].sort() : 0, compose.files.filter((file) => file.ready).map((file) => `${file.name}:${file.size}`)]);
    const composeHasContent = () => !!(compose.values.to || compose.values.cc || compose.values.bcc || compose.values.subject || String(compose.values.text || "").trim() || compose.files.length);
    // 还没显示出来的写信页（snapshot 为空）不算有改动。
    const composeDirty = () => !!compose && !!compose.snapshot && !!capture() && composeSnapshot() !== compose.snapshot && composeHasContent();
    function renderFiles() {
      if (compose) renderFileList("mail-compose-file-list", compose.files, "file-remove");
    }
    // 群发的收件客户：按客群、阶段、国家和关键词筛选后显示的那些。
    function bulkShown() {
      const f = compose.filter,
        needle = String(f.text || "").trim().toLowerCase();
      return compose.all.filter((item) => {
        const facts = compose.facts.get(item.customer) || {};
        if (f.group && facts.group !== f.group) return false;
        if (f.stage && facts.stage !== f.stage) return false;
        if (f.country && facts.country !== f.country) return false;
        return !needle || `${item.customer} ${item.name} ${item.address}`.toLowerCase().includes(needle);
      });
    }
    const bulkFiltered = () => !!(compose.filter.group || compose.filter.stage || compose.filter.country || String(compose.filter.text || "").trim());
    const bulkCountText = () => `已选 ${compose.selected.size} / ${compose.all.length} 位客户` + (bulkFiltered() ? `（筛选后显示 ${bulkShown().length} 位）` : "");
    // 一个筛选下拉框；这一项所有客户都没填时不显示。
    function bulkFacet(key, label) {
      const values = [...new Set(compose.all.map((item) => (compose.facts.get(item.customer) || {})[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
      if (!values.length) return "";
      return `<select id="mail-bulk-${key}" name="bulk-${key}" aria-label="按${label}筛选"><option value="">全部${label}</option>${values.map((value) => `<option value="${E(value)}" ${value === compose.filter[key] ? "selected" : ""}>${E(value)}</option>`).join("")}</select>`;
    }
    function bulkListMarkup() {
      const shown = bulkShown();
      if (!shown.length) return `<span class="mail-bulk-empty">没有符合筛选条件的客户</span>`;
      return shown
        .map((item) => {
          const on = compose.selected.has(item.customer);
          return `<button type="button" role="checkbox" class="mail-bulk-pick ${on ? "on" : ""}" aria-checked="${on}" data-mail-action="bulk-toggle" data-name="${E(item.customer)}"><span class="mail-bulk-box">${on ? icon("check") : ""}</span><span class="mail-bulk-name">${E(item.customer)}</span><span class="mail-bulk-address">${E(item.name ? `${item.name} · ${item.address}` : item.address)}</span></button>`;
        })
        .join("");
    }
    function composePage() {
      const v = compose.values,
        bulkMode = compose.mode === "bulk";
      const back = `<button type="button" class="mail-back" data-mail-action="compose-close">${icon("back")}返回</button>`;
      const actions = `<button type="button" data-mail-action="template-open">${icon("note")}模板</button>` + (bulkMode ? `<button type="button" data-mail-action="bulk-preview">预览第一封</button>` : `<button type="button" data-mail-action="compose-draft">存草稿</button>`) + `<button class="primary" type="submit" form="mail-compose-form" id="mail-compose-submit">${compose.confirm ? `确认向 ${compose.selected.size} 位客户分别发送` : "发送"}</button>`;
      const row = (label, name, value, extra = "") => `<label class="mail-compose-row"><span>${label}</span><input name="${name}" id="mail-compose-${name}" value="${E(value || "")}" autocomplete="off" spellcheck="false" ${extra}></label>`;
      const who = bulkMode
        ? `<div class="module-note">每位客户单独收到一封，看不到其他收件人。主题和正文里的 <b>{{姓名}}</b> 会换成联系人姓名（没有就用公司名），<b>{{公司}}</b> 换成客户名称。一批最多 200 位。</div>` +
          `<div class="mail-compose-row tall"><span>收件客户</span><div class="mail-bulk-picker"><div class="mail-bulk-toolbar"><span id="mail-bulk-count">${E(bulkCountText())}</span><button type="button" data-mail-action="bulk-all">全选</button><button type="button" data-mail-action="bulk-none">清空</button>${bulkFacet("group", "客群")}${bulkFacet("stage", "阶段")}${bulkFacet("country", "国家")}<input id="mail-bulk-filter" type="search" value="${E(compose.filter.text)}" placeholder="搜索客户" aria-label="搜索客户" autocomplete="off"></div><div class="mail-bulk-recipients" id="mail-bulk-recipients" role="group" aria-label="收件客户">${bulkListMarkup()}</div></div></div>`
        : row("收件人", "to", v.to, 'placeholder="多个地址用逗号分隔"') +
          (compose.showCc ? row("抄送", "cc", v.cc) + row("密送", "bcc", v.bcc) : `<div class="mail-compose-row slim"><span></span><button type="button" class="text-button" data-mail-action="compose-cc">添加抄送／密送</button></div>`);
      return (
        pagebar(compose.title, actions, back) +
        `<section class="module-page mail-page mail-compose-page"><form class="mail-compose-form" id="mail-compose-form" autocomplete="off" novalidate>` +
        `<div class="error" id="mail-compose-error" role="alert"></div>` +
        who +
        row("主题", "subject", v.subject, 'maxlength="500"') +
        (ctx.editorToolbar ? ctx.editorToolbar() : "") +
        `<div class="mail-editor" id="mail-compose-editor" role="textbox" aria-multiline="true" aria-label="正文"></div>` +
        (bulkMode ? `<div class="mail-body-text mail-bulk-preview" id="mail-bulk-preview" hidden></div>` : "") +
        `<div class="mail-compose-files"><label class="mail-file-pick">${icon("plus")}添加附件<input type="file" id="mail-compose-file" multiple hidden></label><span class="muted tiny">合计不超过 10 MB${bulkMode ? "，每封都会带上" : ""}</span><ul id="mail-compose-file-list"></ul>` +
        (compose.forwardOf && compose.forwardCount ? `<label class="mail-forward-attachments"><input type="checkbox" name="forwardAttachments" ${v.forwardAttachments ? "checked" : ""}> 附带原邮件的 ${compose.forwardCount} 个附件</label>` : "") +
        `</div>` +
        `<div class="mail-compose-from">${row("发件人名称", "fromName", v.fromName, 'maxlength="80" placeholder="收件人看到的名字"')}<span class="mail-compose-address">${E(account ? account.email : "")}</span></div>` +
        `</form></section>`
      );
    }
    // 页面画好之后接上编辑器、附件选择和表单提交。
    function mountCompose() {
      const form = document.getElementById("mail-compose-form"),
        node = document.getElementById("mail-compose-editor");
      if (!compose || !form || !node) return;
      compose.mounted = true;
      if (compose.editor && compose.editor.destroy) compose.editor.destroy();
      compose.editor = ctx.createEditor(node, document.querySelector ? document.querySelector(".mail-editor-toolbar") : null, compose.values.html);
      renderFiles();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        return compose && compose.mode === "bulk" ? bulkSend() : sendCompose();
      });
      if (form.addEventListener) form.addEventListener("mail-editor-error", (event) => showError("mail-compose-error", event.detail));
      const picker = document.getElementById("mail-compose-file");
      if (picker && picker.addEventListener)
        picker.addEventListener("change", () => {
          if (compose) readFiles(picker.files, compose, "mail-compose-error", renderFiles);
          picker.value = "";
        });
      // 群发的筛选：改了条件就重画收件客户列表（已经勾上的不受影响）。
      const filter = document.getElementById("mail-bulk-filter");
      if (filter && filter.addEventListener)
        filter.addEventListener("input", () => {
          if (!compose) return;
          compose.filter.text = String(filter.value || "");
          bulkRefresh();
        });
      for (const key of ["group", "stage", "country"]) {
        const select = document.getElementById("mail-bulk-" + key);
        if (select && select.addEventListener)
          select.addEventListener("change", () => {
            if (!compose) return;
            compose.filter[key] = String(select.value || "");
            bulkRefresh();
          });
      }
      // 打开时的内容作为基准：只有改动过才算有未保存内容。
      if (!compose.snapshot) {
        capture();
        compose.snapshot = composeSnapshot();
      }
    }
    // 打开写信页。已有一封在写时先把它存成草稿。
    async function openCompose(initial = {}) {
      if (!canSend()) return noSend();
      if (status !== "ready" || !account) {
        ctx.toast(available && status === "ready" ? "请先绑定邮箱" : available ? "无法读取邮箱绑定状态，请到邮件页重试" : "网页试用版无法收发邮件");
        return status === "ready" ? bindDialog(false) : undefined;
      }
      if (compose && !(await leaveCompose())) return;
      const bulkMode = initial.mode === "bulk";
      // 新写、回复、转发时带上签名；继续写草稿时不重复加。
      const html = initial.id ? initial.html || textToHtml(initial.text) : `<div><br></div>${signatureHtml()}${initial.html || ""}`;
      compose = {
        mode: bulkMode ? "bulk" : "mail", title: initial.title || (bulkMode ? "新建群发" : "写信"), draftId: initial.id || "", inReplyTo: initial.inReplyTo || "", references: initial.references || "",
        forwardOf: initial.forwardOf || null, forwardCount: initial.forwardCount || 0, sending: false,
        // 继续写草稿时把存着的附件带回来。
        files: (initial.files || []).filter((file) => file && typeof file.contentBase64 === "string").map((file) => ({ name: String(file.filename || "attachment"), type: String(file.contentType || "application/octet-stream"), size: base64Size(file.contentBase64), base64: file.contentBase64, ready: true })), force: false, snapshot: "", editor: null, origin: initial.origin || null,
        showCc: !!(initial.cc || initial.bcc), confirm: false, all: initial.all || [], selected: new Set(initial.selected || []), facts: initial.facts || new Map(), filter: { group: "", stage: "", country: "", text: "" },
        values: { to: initial.to || "", cc: initial.cc || "", bcc: initial.bcc || "", subject: initial.subject || "", fromName: account.senderName || "", forwardAttachments: true, html, text: "" },
      };
      if (!onMailPage() && ctx.openMail) {
        compose.fresh = true;
        return ctx.openMail(folder);
      }
      render();
    }
    // 离开写信页后回到哪里：从客户页进来的回客户页，否则留在邮件页。
    function afterCompose(origin) {
      if (origin) return origin();
      if (onMailPage()) return loadCurrent();
    }
    const draftPayload = () => ({ id: compose.draftId || undefined, to: compose.values.to, cc: compose.values.cc, bcc: compose.values.bcc, subject: compose.values.subject, text: compose.values.text, html: compose.values.html, inReplyTo: compose.inReplyTo, references: compose.references, forwardOf: compose.forwardOf });
    // 只算读完了的附件；还在读的那些读完后会让这封信重新变成“有改动”，下次保存时带上。
    const filePayload = () => compose.files.filter((file) => file.ready).map((file) => ({ filename: file.name, contentType: file.type, contentBase64: file.base64 }));
    async function saveDraft(close) {
      if (!compose || compose.sending || compose.mode === "bulk") return false;
      capture();
      try {
        const data = await call("/api/mail/drafts/save", { ...draftPayload(), attachments: filePayload() });
        compose.draftId = data.draft.id;
        compose.snapshot = composeSnapshot();
        compose.force = false;
        drafts.loaded = false;
      } catch (error) {
        compose.force = close;
        showError("mail-compose-error", `草稿保存失败：${error.message}${close ? " 再点一次「返回」将放弃这封信。" : ""}`);
        return false;
      }
      ctx.toast("已存入草稿箱");
      return true;
    }
    // 关闭写信页：改过的普通邮件自动存草稿；群发没有草稿，改过的要再点一次才放弃。成功离开返回 true。
    async function leaveCompose() {
      if (!compose) return true;
      if (compose.sending) return false;
      // 附件还没读完就离开，这个附件会丢：先拦住。
      if (compose.files.some((file) => !file.ready) && !compose.force) {
        showError("mail-compose-error", "附件还在读取，请稍等一下再离开。");
        return false;
      }
      if (composeDirty() && !compose.force) {
        if (compose.mode === "bulk") {
          compose.force = true;
          showError("mail-compose-error", "群发内容还没发送，离开后不会保存。再点一次「返回」放弃。");
          return false;
        }
        if (!(await saveDraft(true))) return false;
      }
      if (compose.editor && compose.editor.destroy) compose.editor.destroy();
      compose = null;
      return true;
    }
    async function closeCompose() {
      const origin = compose && compose.origin;
      if (!(await leaveCompose())) return false;
      await afterCompose(origin);
      return true;
    }
    async function sendCompose() {
      if (!compose || compose.sending) return;
      const v = capture();
      if (!v.to && !v.cc && !v.bcc) return showError("mail-compose-error", "请至少填写一位收件人");
      if (!v.subject && !String(v.text).trim()) return showError("mail-compose-error", "主题和正文不能都为空");
      if (compose.files.some((file) => !file.ready)) return showError("mail-compose-error", "附件还在读取，请稍候再发送");
      // 用了模板却没把称呼换掉就发出去，很难收回来：先拦住。
      if (HAS_VARIABLE.test(v.subject + "\n" + v.text)) return showError("mail-compose-error", "主题或正文里还有没替换的 {{姓名}} 或 {{公司}}，请改成实际内容再发送。");
      const submit = document.getElementById("mail-compose-submit");
      compose.sending = true;
      showError("mail-compose-error", "");
      if (submit) {
        submit.disabled = true;
        submit.textContent = "正在发送…";
      }
      try {
        const data = await call("/api/mail/send", { ...draftPayload(), id: undefined, html: outgoingHtml(v.html), draftId: compose.draftId || undefined, fromName: v.fromName, forwardAttachments: v.forwardAttachments, attachments: filePayload() });
        if (account) account = { ...account, senderName: v.fromName };
        const origin = compose.origin;
        if (compose.editor && compose.editor.destroy) compose.editor.destroy();
        compose = null;
        drafts.loaded = false;
        const rejected = data.rejected || [];
        ctx.toast(account && account.demo ? "示例邮箱：邮件没有真的发出，已放入发件箱" : rejected.length ? `已发送给 ${data.recipients.length} 位收件人；${rejected.join("、")} 被服务器拒绝，没有收到` : `邮件已发送给 ${data.recipients.length} 位收件人`);
        await afterCompose(origin);
      } catch (error) {
        if (compose) compose.sending = false;
        showError("mail-compose-error", error.message);
        if (submit && submit.isConnected !== false) {
          submit.disabled = false;
          submit.textContent = "发送";
        }
      }
    }
    function replyTo(mode) {
      const m = reading && reading.message;
      if (!m) return;
      const me = account ? account.email : "";
      // 引用原邮件：有 HTML 用 HTML（放进编辑器前会净化），否则用文字。
      const original = m.html || textToHtml(m.text);
      const ids = { inReplyTo: m.messageId || "", references: [m.references, m.messageId].filter(Boolean).join(" ") };
      if (mode === "forward")
        return openCompose({ title: "转发", subject: replySubject(m.subject, "Fwd"), html: `<div><br></div><div>---------- 转发的邮件 ----------</div><div>发件人：${E(addressLine([m.from]))}</div><div>时间：${E(fullTime(m.date))}</div><div>主题：${E(m.subject || "")}</div><div>收件人：${E(addressLine(m.to))}</div><div><br></div>${original}`, forwardOf: { box: m.box, uid: m.uid }, forwardCount: (m.attachments || []).length });
      const target = m.box === "sent" ? m.to || [] : (m.replyTo && m.replyTo.length ? m.replyTo : [m.from]).filter(Boolean);
      const others = mode === "all" ? [...(m.box === "sent" ? [] : m.to || []), ...(m.cc || [])].filter((item) => item.address !== me && !target.some((t) => t.address === item.address)) : [];
      return openCompose({ title: mode === "all" ? "回复全部" : "回复", to: addressLine(target), cc: addressLine(others), subject: replySubject(m.subject, "Re"), html: `<div><br></div><div>在 ${E(fullTime(m.date))}，${E(addressLine([m.from]))} 写道：</div><blockquote>${original}</blockquote>`, ...ids });
    }

    // ---- 模板 ----
    // 用函数做替换：客户名里的 $ 不会被当成替换记号。
    const fillVariables = (text, who, asHtml) => {
      const put = (value) => (asHtml ? E(value) : value);
      return String(text ?? "").replace(/\{\{\s*姓名\s*\}\}/g, () => put(who.name || who.customer || "")).replace(/\{\{\s*公司\s*\}\}/g, () => put(who.customer || ""));
    };
    // 存模板时只留自己写的内容：去掉签名、引用的原邮件和末尾的空行。
    function templateContent(html) {
      if (!root.DOMParser) return { html, changed: false };
      const doc = new root.DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      const extra = doc.body.querySelectorAll(".lai-signature, blockquote");
      extra.forEach((node) => node.remove());
      let trimmed = false;
      for (let last = doc.body.lastElementChild; last && !last.textContent.trim() && !last.querySelector("img"); last = doc.body.lastElementChild) {
        last.remove();
        trimmed = true;
      }
      return { html: doc.body.innerHTML, changed: extra.length > 0 || trimmed };
    }
    // 写信页唯一的那位收件人对应的客户（用来把模板里的称呼直接换好）。有多位收件人、抄送或密送时不换，
    // 免得把一个人的名字发给所有人；群发时也不换，由发送时逐封替换。
    function composeCustomer() {
      if (!compose || compose.mode === "bulk") return null;
      const v = compose.values,
        pieces = String(v.to || "").split(/[,;]/).map((piece) => piece.trim()).filter(Boolean);
      if (pieces.length !== 1 || String(v.cc || "").trim() || String(v.bcc || "").trim()) return null;
      const first = pieces[0],
        match = /<([^<>]+)>\s*$/.exec(first),
        address = String(match ? match[1] : first).trim().toLowerCase();
      const name = addressIndex().get(address);
      if (!name) return null;
      const row = customers().find((item) => item.name === name);
      return { customer: name, name: (row && row.contact) || name };
    }
    function templateDialog(pointerActivated, message = "") {
      if (!compose) return;
      const line = (t, own) =>
        `<div class="mail-template-row"><div><strong>${E(t.name)}</strong><span>${E(t.subject || String(t.text || "").replace(/\s+/g, " ").slice(0, 80) || "（无主题）")}</span></div><button type="button" class="primary" data-mail-action="template-use" data-id="${E(t.id)}">使用</button>` +
        (own ? `<button type="button" data-mail-action="template-delete" data-id="${E(t.id)}">${templateArmed === t.id ? "再点一次删除" : "删除"}</button>` : "") +
        `</div>`;
      const mine = templates.loading && !templates.items.length ? `<p class="mail-template-note">正在读取模板…</p>` : templates.error ? `<p class="mail-template-note">${E(templates.error)}</p>` : templates.items.length ? templates.items.map((t) => line(t, true)).join("") : `<p class="mail-template-note">还没有保存过模板。写好一封信后，在下面起个名字存起来，下次直接用。</p>`;
      ctx.dialog(
        "邮件模板",
        `<div class="drawer-body mail-templates"><div class="error ${message ? "visible" : ""}" id="mail-template-error" role="alert">${E(message)}</div>` +
          `<h3>我的模板</h3>${mine}<h3>示例模板</h3>${BUILTIN_TEMPLATES.map((t) => line(t, false)).join("")}` +
          `<h3>把现在写的内容存为模板</h3><div class="mail-template-save"><input id="mail-template-name" maxlength="80" placeholder="模板名称，例如：报价跟进" aria-label="模板名称" autocomplete="off"><button type="button" class="primary" data-mail-action="template-save">保存</button></div>` +
          `<div class="module-note">模板里可以写 {{姓名}} 和 {{公司}}。给一位客户写信时，使用模板会直接换成这位客户的联系人和公司名；群发时每封换成各自的。模板只保存在这台电脑上。</div></div>`,
        `<button type="button" class="primary" data-action="close-modal">关闭</button>`,
        "mail-templates",
        pointerActivated,
      );
    }
    async function openTemplates(pointerActivated) {
      if (!compose) return;
      capture();
      templateArmed = "";
      templates = { ...templates, loading: true, error: "" };
      templateDialog(pointerActivated);
      try {
        templates = { items: (await call("/api/mail/templates")).items || [], loading: false, error: "" };
      } catch (error) {
        templates = { items: [], loading: false, error: "读取模板失败：" + error.message };
      }
      if (compose) templateDialog(false);
    }
    // 使用模板：主题还空着就填上模板的主题；正文放在最前面，签名和引用的原文留在后面。
    function useTemplate(id) {
      const t = [...templates.items, ...BUILTIN_TEMPLATES].find((item) => item.id === id);
      if (!t || !compose) return;
      capture();
      const who = composeCustomer();
      const fill = (text, asHtml) => (who ? fillVariables(text, who, asHtml) : String(text ?? ""));
      if (!compose.values.subject && t.subject) {
        compose.values.subject = fill(t.subject, false);
        const form = document.getElementById("mail-compose-form");
        if (form && form.elements.subject) form.elements.subject.value = compose.values.subject;
      }
      compose.values.html = (t.html ? fill(t.html, true) : fill(textToHtml(t.text), true)) + compose.values.html;
      if (compose.editor) compose.editor.setHTML(compose.values.html);
      ctx.closeDialog();
      ctx.toast(who ? `已插入模板，称呼已换成 ${who.name}` : compose.mode === "bulk" ? "已插入模板" : HAS_VARIABLE.test((t.subject || "") + (t.html || t.text || "")) ? "已插入模板，记得把 {{姓名}}、{{公司}} 改成实际内容" : "已插入模板");
    }
    async function saveTemplate() {
      const input = document.getElementById("mail-template-name");
      if (!compose || !input) return;
      const v = capture(),
        name = String(input.value || "").trim();
      if (!name) return showError("mail-template-error", "请给模板起个名字");
      const content = templateContent(v.html);
      try {
        // 去掉了签名或引用之后，纯文字那一份交给本机服务从 HTML 重新生成。
        await call("/api/mail/templates/save", { name, subject: v.subject, html: content.html, text: content.changed ? "" : v.text });
      } catch (error) {
        return showError("mail-template-error", error.message);
      }
      ctx.toast(`已保存为模板「${name}」`);
      return openTemplates(false);
    }
    async function deleteTemplate(id) {
      // 删掉就没有了：第一次点只是让按钮变成「再点一次删除」。
      if (templateArmed !== id) {
        templateArmed = id;
        return templateDialog(false);
      }
      templateArmed = "";
      try {
        await call("/api/mail/templates/delete", { id });
      } catch (error) {
        return templateDialog(false, error.message);
      }
      return openTemplates(false);
    }

    // ---- 客户详情页里的「邮箱里的往来邮件」 ----
    function customerPanel(name) {
      const row = customers().find((item) => item.name === name);
      const wrap = (inner, actions = "") => `<section class="lcd-mail-panel" aria-label="邮箱里的往来邮件"><div class="lcd-mail-head"><strong>邮箱里的往来邮件</strong><span>${actions}</span></div>${inner}</section>`;
      const note = (text) => `<p class="lcd-mail-note">${E(text)}</p>`;
      if (status === "idle" || status === "loading") return wrap(note("正在读取邮箱绑定状态…"));
      if (status === "error") return wrap(note("无法读取邮箱绑定状态：" + loadError), `<button type="button" data-mail-action="panel-reload" data-name="${E(name)}">重试</button>`);
      if (!account) return wrap(note("还没有绑定邮箱。绑定后这里会显示和这位客户的往来邮件。"), `<button type="button" data-mail-action="goto-mail">去绑定邮箱</button>`);
      if (!row) return wrap(note("这位客户还没有填写邮箱。在客户资料里填上公司邮箱或联系人邮箱后，这里会显示往来邮件。"));
      const actions = `<button type="button" data-feature="写邮件">写邮件</button><button type="button" data-mail-action="panel-reload" data-name="${E(name)}" ${panel.loading ? "disabled" : ""}>刷新</button>`;
      if (panel.name !== name || panel.loading) return wrap(note("正在查找往来邮件…"), actions);
      if (panel.error) return wrap(note("读取往来邮件失败：" + panel.error), actions);
      if (!panel.items.length) return wrap(note(`邮箱里没有找到和 ${row.addresses.join("、")} 有关的邮件。`), actions);
      const rows = panel.items
        .slice(0, 30)
        .map((item) => {
          const sent = item.box === "sent";
          return (
            `<div class="lcd-mail-row"><button type="button" class="lcd-mail-open" data-mail-action="panel-open" data-name="${E(name)}" data-box="${item.box}" data-uid="${item.uid}" title="在邮件页打开">` +
            `<span class="mail-direction ${sent ? "out" : "in"}">${sent ? "发" : "收"}</span><span class="lcd-mail-subject">${E(item.subject || "（无主题）")}</span><span class="lcd-mail-snippet">${E(item.snippet || "")}</span><span class="mail-row-time">${E(shortTime(item.date))}</span></button>` +
            recordButton(name, item) +
            `</div>`
          );
        })
        .join("");
      return wrap(`<p class="lcd-mail-note">${E(row.addresses.join("、"))} · 收件箱与已发送中最近的 ${panel.items.length} 封${panel.items.length > 30 ? "，这里显示前 30 封" : ""}</p>${rows}`, actions);
    }
    async function loadCustomerPanel(name, force = false) {
      const token = ++panelToken;
      const done = () => ctx.refreshCustomerPanel && ctx.refreshCustomerPanel(name);
      if (status !== "ready") {
        const loading = fetchAccount();
        done();
        await loading;
      }
      const row = customers().find((item) => item.name === name);
      if (token !== panelToken) return;
      if (status !== "ready" || !account || !row) {
        panel = { name, loading: false, error: "", items: [] };
        return done();
      }
      const key = row.addresses.slice(0, 20).join(","),
        known = relatedCache.get(key);
      if (!force && known && Date.now() - known.at < RELATED_FRESH_MS) {
        panel = { name, loading: false, error: "", items: known.items };
        return done();
      }
      panel = { name, loading: true, error: "", items: [] };
      done();
      try {
        const data = await call(withQuery("/api/mail/correspondence", { addresses: key }));
        relatedCache.set(key, { at: Date.now(), items: data.items || [] });
        if (token !== panelToken) return;
        panel = { name, loading: false, error: "", items: data.items || [] };
      } catch (error) {
        if (token !== panelToken) return;
        panel = { name, loading: false, error: error.message, items: [] };
      }
      done();
    }
    // 把一封邮件记到客户动态里。保存由外壳完成（和别的客户资料改动走同一条路）。
    async function recordMail(name, box, uid) {
      const open = reading && reading.message && sameRef(reading.message, { box, uid }) ? reading.message : null;
      const item = findMessage(box, uid)[0] || open;
      if (!item || !ctx.recordMail) return;
      const saved = await ctx.recordMail(name, { box: item.box, uid: item.uid, messageId: item.messageId || "", subject: item.subject || "", snippet: item.snippet || (open ? String(open.text || "").replace(/\s+/g, " ").trim().slice(0, 140) : ""), date: item.date || "", from: item.from || null, to: item.to || [] });
      if (!saved) return;
      if (onMailPage()) rerender();
      else if (ctx.refreshCustomerPanel) ctx.refreshCustomerPanel(name);
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
          `<label class="mail-setting-check"><input type="checkbox" id="mail-settings-autocheck" ${account.autoCheck === false ? "" : "checked"}> 自动检查新邮件（每分钟一次，有新邮件时提示）</label>` +
          `<div class="mail-bound-actions"><button type="button" class="primary" data-mail-action="settings-save">保存设置</button></div>` +
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
        const auto = document.getElementById("mail-settings-autocheck");
        accept(await call("/api/mail-account/settings", { senderName: String(name.value || ""), signature: String(signature.value || ""), ...(auto ? { autoCheck: !!auto.checked } : {}) }));
        showError("mail-account-error", "");
        ctx.toast("已保存");
      } catch (error) {
        showError("mail-account-error", error.message);
      }
    }

    // ---- 群发（在写信页里，收件人换成勾选客户） ----
    const bulkRecipients = () => customers().map((row) => ({ customer: row.name, name: row.contact, address: row.addresses[0] }));
    const bulkFill = (text, item) => String(text).replace(/\{\{\s*姓名\s*\}\}/g, () => item.name || item.customer || "").replace(/\{\{\s*公司\s*\}\}/g, () => item.customer || "");
    function bulkRefresh() {
      const listBox = document.getElementById("mail-bulk-recipients"),
        count = document.getElementById("mail-bulk-count"),
        submit = document.getElementById("mail-compose-submit");
      if (listBox) listBox.innerHTML = bulkListMarkup();
      if (count) count.textContent = bulkCountText();
      compose.confirm = false;
      if (submit) submit.textContent = "发送";
    }
    function openBulk(names, origin) {
      const all = bulkRecipients();
      if (!all.length) return ctx.toast("还没有填写了邮箱的客户，无法群发");
      const known = new Set(all.map((item) => item.customer));
      return openCompose({ mode: "bulk", all, facts: new Map(customers().map((row) => [row.name, { group: row.group, stage: row.stage, country: row.country }])), selected: (names || []).filter((name) => known.has(name)), origin });
    }
    const bulkSelected = () => compose.all.filter((item) => compose.selected.has(item.customer));
    function bulkPreview() {
      const box = document.getElementById("mail-bulk-preview");
      if (!compose || compose.mode !== "bulk" || !box) return;
      const v = capture(),
        first = bulkSelected()[0];
      box.hidden = false;
      box.textContent = first ? `收件人：${first.name ? first.name + " " : ""}<${first.address}>\n主题：${bulkFill(v.subject, first)}\n\n${bulkFill(v.text, first)}` : "先选择至少一位客户，再预览。";
    }
    async function bulkSend() {
      if (!compose || compose.mode !== "bulk" || compose.sending) return;
      const v = capture(),
        recipients = bulkSelected(),
        submit = document.getElementById("mail-compose-submit");
      if (!recipients.length) return showError("mail-compose-error", "请至少选择一位客户");
      if (recipients.length > 200) return showError("mail-compose-error", "一批群发最多 200 位，请分批发送");
      if (!v.subject) return showError("mail-compose-error", "请填写主题");
      if (!String(v.text).trim()) return showError("mail-compose-error", "请填写正文");
      if (compose.files.some((file) => !file.ready)) return showError("mail-compose-error", "附件还在读取，请稍候再发送");
      showError("mail-compose-error", "");
      // 发出去收不回来：第一次点只是确认人数，再点一次才真的开始发。
      if (!compose.confirm) {
        compose.confirm = true;
        if (submit) submit.textContent = `确认向 ${recipients.length} 位客户分别发送`;
        return;
      }
      compose.sending = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = "正在开始…";
      }
      try {
        const data = await call("/api/mail/bulk/start", { subject: v.subject, text: v.text, html: outgoingHtml(v.html), fromName: v.fromName, recipients, attachments: filePayload() });
        if (compose.editor && compose.editor.destroy) compose.editor.destroy();
        compose = null;
        ctx.toast(account && account.demo ? "示例邮箱：群发不会真的发出" : `已开始向 ${data.batch.total} 位客户发送`);
        view = "mail";
        folder = "bulk";
        reading = null;
        batch = null;
        if (onMailPage()) return loadBatch(data.batch.id);
        pendingBatch = data.batch.id;
        if (ctx.openMail) return ctx.openMail("bulk");
      } catch (error) {
        if (compose) {
          compose.sending = false;
          compose.confirm = false;
        }
        showError("mail-compose-error", error.message);
        if (submit && submit.isConnected !== false) {
          submit.disabled = false;
          submit.textContent = "发送";
        }
      }
    }
    // 从客户列表、客户详情进来的「写邮件」：一位客户直接写信，多位客户走群发。origin 用来在写完后回到原来的客户页。
    async function composeFor(names, pointerActivated = false, origin = null) {
      const wanted = [...new Set(names || [])];
      if (!wanted.length || !(await ready(pointerActivated))) return;
      const rows = customers().filter((row) => wanted.includes(row.name));
      if (!rows.length) return ctx.toast(wanted.length === 1 ? "这位客户还没有填写邮箱" : "选中的客户都没有填写邮箱");
      if (wanted.length === 1) return openCompose({ to: rows[0].contact ? `${rows[0].contact} <${rows[0].addresses[0]}>` : rows[0].addresses[0], origin });
      if (rows.length < wanted.length) ctx.toast(`${wanted.length - rows.length} 位客户没有填写邮箱，已略过`);
      return openBulk(rows.map((row) => row.name), origin);
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
      if (name === "bulk-new") return ready(pointerActivated).then((ok) => ok && openBulk([]));
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
      if (name === "bulk-toggle" && compose && compose.mode === "bulk") {
        if (compose.selected.has(data.name)) compose.selected.delete(data.name);
        else compose.selected.add(data.name);
        return bulkRefresh();
      }
      // 「全选」选的是当前筛选出来的这些客户，之前勾上的保留。
      if (name === "bulk-all" && compose && compose.mode === "bulk") {
        for (const item of bulkShown()) compose.selected.add(item.customer);
        return bulkRefresh();
      }
      if (name === "bulk-none" && compose && compose.mode === "bulk") {
        compose.selected = new Set();
        return bulkRefresh();
      }
      if (name === "bulk-preview") return bulkPreview();
      if (name === "compose-cc" && compose) {
        capture();
        compose.showCc = true;
        return render();
      }
      if (name === "unbind") return unbindDialog(pointerActivated);
      if (name === "unbind-confirm") return unbind();
      if (name === "reload") {
        const pending = loadAccount();
        render();
        return pending;
      }
      if (name === "compose") return openCompose({});
      if (name === "compose-close") return closeCompose();
      if (name === "compose-draft") return saveDraft(false);
      if (name === "file-remove") {
        if (compose) compose.files.splice(Number(data.index), 1);
        return renderFiles();
      }
      if (name === "refresh") {
        relatedCache = new Map();
        return reading ? openMessage(reading.ref.box, reading.ref.uid, { fresh: true }) : view === "mail" && serverFolder() ? loadList(list.page) : loadCurrent();
      }
      if (name === "row-read") return toggleRowSeen(data.box, Number(data.uid));
      if (name === "row-delete") return confirmDelete(pointerActivated, rowOf({ box: data.box, uid: Number(data.uid) }) || [{ box: data.box, uid: Number(data.uid) }]);
      if (name === "pick") return togglePick(data.box, Number(data.uid));
      if (name === "pick-all") {
        for (const item of currentItems()) picked.set(refKey(item), { box: item.box, uid: Number(item.uid) });
        return rerender();
      }
      if (name === "pick-none") {
        picked = new Map();
        return rerender();
      }
      if (name === "bulk-read") return bulkFlag("seen", true);
      if (name === "bulk-unread") return bulkFlag("seen", false);
      if (name === "bulk-pending") return bulkFlag("pending", true);
      if (name === "bulk-unpending") return bulkFlag("pending", false);
      if (name === "bulk-delete") return confirmDelete(pointerActivated, [...picked.values()]);
      if (name === "thread-toggle") {
        threadMode = !threadMode;
        return rerender();
      }
      if (name === "contact-toggle") {
        // 窗口够宽时默认显示，点一下收起；窗口窄时默认收起，点一下显示。
        const shown = contactMode === "on" || (contactMode === "auto" && !!root.matchMedia && root.matchMedia("(min-width: 1360px)").matches);
        contactMode = shown ? "off" : "on";
        return rerender();
      }
      if (name === "contact-compose") return openCompose({ to: data.to || "" });
      if (name === "clear-search") {
        query = "";
        return loadList(1);
      }
      if (name === "page-prev") return loadList(Math.max(1, list.page - 1));
      if (name === "page-next") return loadList(list.page + 1);
      if (name === "open") return openMessage(data.box, Number(data.uid));
      if (name === "back") return closeReader(false);
      if (name === "toggle-pending") return togglePending(data.box, Number(data.uid), !!data.single);
      if (name === "mark-unread") return markUnread();
      if (name === "delete") return confirmDelete(pointerActivated);
      if (name === "delete-confirm") return deleteMessage();
      if (name === "attachment-save") return saveAttachment(Number(data.index));
      if (name === "reply") return replyTo("one");
      if (name === "reply-all") return replyTo("all");
      if (name === "forward") return replyTo("forward");
      if (name === "draft-open") {
        const draft = drafts.items.find((item) => item.id === data.id);
        if (!draft) return undefined;
        // 附件内容不在草稿列表里，打开时再取。
        return call(withQuery("/api/mail/draft", { id: draft.id })).then(
          (full) => openCompose({ ...(full.draft || draft), title: "继续写信", files: full.attachments || [] }),
          (error) => ctx.toast("打不开这份草稿：" + error.message),
        );
      }
      if (name === "template-open") return openTemplates(pointerActivated);
      if (name === "template-use") return useTemplate(data.id);
      if (name === "template-save") return saveTemplate();
      if (name === "template-delete") return deleteTemplate(data.id);
      if (name === "record") return recordMail(data.name, data.box, Number(data.uid));
      if (name === "panel-reload") return loadCustomerPanel(data.name, true);
      if (name === "goto-mail") return ctx.openMail && ctx.openMail(folder);
      if (name === "panel-open") {
        if (!ctx.openMail) return undefined;
        pendingOpen = { name: data.name, box: data.box, uid: Number(data.uid) };
        // 没去成邮件页（比如当前页有没保存的内容被拦住了）：这次点击作废，不能留到下次进邮件页时突然生效。
        return Promise.resolve(ctx.openMail(folder)).then(
          (went) => {
            if (went === false) pendingOpen = null;
            return went;
          },
          (error) => {
            pendingOpen = null;
            throw error;
          },
        );
      }
      if (name === "draft-delete")
        return call("/api/mail/drafts/delete", { id: data.id }).then(
          () => loadDrafts(),
          (error) => ctx.toast(error.message),
        );
      if (name === "customer-select") {
        customerName = data.name || "";
        picked = new Map();
        reading = null;
        return account ? loadThread(customerName) : rerender();
      }
      if (name === "customer-open") return ctx.openCustomer && ctx.openCustomer(data.name);
      if (name === "customer-compose") {
        const row = customers().find((item) => item.name === customerName);
        return openCompose({ to: row ? row.addresses[0] : "" });
      }
    }
    // 键盘快捷键（和常见邮件客户端一致）。在输入框、写信页、弹窗里不生效。
    function onKey(event) {
      if (!onMailPage() || compose || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (ctx.hasDialog && ctx.hasDialog()) return;
      const target = event.target || {},
        tag = String(target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
        if (event.key === "Escape" && target.blur) target.blur();
        return;
      }
      const pressed = String(event.key || ""),
        key = pressed.length === 1 ? pressed.toLowerCase() : pressed,
        open = reading && reading.message,
        splitView = (view === "mail" && serverFolder()) || (view === "customer" && !!customerName);
      let handled = true;
      if (key === "c") openCompose({});
      else if (!account || !splitView) handled = false;
      else if (key === "ArrowDown" || key === "j") step(1);
      else if (key === "ArrowUp" || key === "k") step(-1);
      else if (key === "/" && view === "mail") {
        const input = document.getElementById("mail-search-input");
        if (input && input.focus) input.focus();
      } else if (key === "Escape" && reading) closeReader(false);
      else if (!open) handled = false;
      else if (key === "r") replyTo("one");
      else if (key === "a") replyTo("all");
      else if (key === "f") replyTo("forward");
      else if (key === "s" && open.box !== "sent") togglePending(open.box, open.uid, true);
      else if (key === "x") togglePick(open.box, open.uid);
      else if (key === "u" && open.box !== "sent") markUnread();
      else if (key === "Delete" || key === "Backspace" || key === "#") confirmDelete(false);
      else handled = false;
      if (handled && event.preventDefault) event.preventDefault();
      return handled;
    }
    if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);
    function enter() {
      reading = null;
      readToken++;
      // 绑定状态正由别处读着（启动检查、客户详情）时，等它读完再读邮件，不能就这么空着。
      const pending = status === "ready" ? loadCurrent() : loadAccount();
      render();
      return pending;
    }
    return {
      subnav,
      page,
      render,
      action,
      // 切换页签或文件夹前先收好正在写的信（自动存草稿）；存不下来就留在写信页。
      showView(next) {
        const go = () => {
          view = views.some((item) => item.id === next) ? next : "mail";
          picked = new Map();
          return enter();
        };
        return compose ? leaveCompose().then((left) => (left ? go() : false)) : go();
      },
      view: () => view,
      select(next) {
        // 刚从别的页面发起写信：进入邮件页后直接显示写信页。
        if (compose && compose.fresh) {
          compose.fresh = false;
          pendingOpen = null;
          return render();
        }
        // 从客户详情点开某封邮件：进到「客户」页签、这位客户的往来邮件里，并打开那一封。
        if (pendingOpen && !compose) {
          const want = pendingOpen;
          pendingOpen = null;
          view = "customer";
          customerName = want.name;
          picked = new Map();
          return Promise.resolve(enter()).then(() => (account ? openMessage(want.box, want.uid) : undefined));
        }
        const go = () => {
          view = "mail";
          folder = normalize(next);
          picked = new Map();
          query = "";
          batch = folder === "bulk" && pendingBatch ? { id: pendingBatch, loading: true, error: "", data: null } : null;
          pendingBatch = "";
          batchToken++;
          return enter();
        };
        return compose ? leaveCompose().then((left) => (left ? go() : false)) : go();
      },
      folder: () => folder,
      account: () => account,
      busy: () => working || !!(compose && compose.sending),
      composing: () => !!compose,
      composeDirty,
      key: onKey,
      start,
      check,
      counts: () => counts,
      customerPanel,
      loadCustomerPanel,
      leave: leaveCompose,
      composeFor,
    };
  }
  root.LaiMailUI = { create, folders, views, DEFAULT_FOLDER, customerAddresses, autoRecordPlan, groupThreads, BUILTIN_TEMPLATES };
})(typeof window === "undefined" ? globalThis : window);
