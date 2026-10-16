(() => {
  "use strict";
  const APP_VERSION = "1.4.126";
  const importPreviewEnabled = window.__laiImportPreview === true;
  const nativeWindowBridge = () => !!window.webkit?.messageHandlers?.windowDragRegions;
  const separateCustomerWindow = nativeWindowBridge() && new URLSearchParams(location.search).has("customer");
  const CT = window.LaiCustomerTools;
  const CS = window.LaiCustomerSettings;
  const M = window.PreviewModel,
    S = window.PreviewSegments,
    C = window.LaiCustomerFields,
    I = window.LaiCustomerImport,
    E = M.escapeHtml,
    V = window.LaiCustomerMotion,
    NF = window.LaiNavFavorites,
    RM = window.LaiRailMenu,
    $ = (q, root = document) => root.querySelector(q);
  const icons = {
    grid: "M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z",
    people:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87",
    mail: "M3 5h18v14H3z M3 5l9 7 9-7",
    chart: "M3 3v18h18 M7 16v-5 M12 16V7 M17 16V3",
    box: "M3 7l9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10",
    building: "M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5v15 M15 10h3.5a1.5 1.5 0 0 1 1.5 1.5v9 M3 20.5h18 M8.5 8h3 M8.5 11.5h3 M8.5 15h3",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
    search: "M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14",
    filter: "M3 4h18l-7 8v7l-4 2v-9z",
    plus: "M12 5v14 M5 12h14",
    plusCircle: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M8 12h8 M12 8v8",
    minusCircle: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M8 12h8",
    close: "M6 6l12 12 M6 18L18 6",
    back: "M15 5l-7 7 7 7",
    next: "M9 5l7 7-7 7",
    star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
    heart: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
    folder: "M3 6h7l2 2h9v12H3z",
    globe:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M2 12h20 M12 2c-6 5-6 15 0 20 M12 2c6 5 6 15 0 20",
    clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6l4 2",
    sort: "M5 5v14 M2 16l3 3 3-3 M13 6h8 M13 11h6 M13 16h4",
    check: "M5 12l4 4L19 6",
    phone: "M5 3h4l1 5-3 2a16 16 0 0 0 7 7l2-3 5 1v4c-9 4-22-9-16-16",
    note: "M5 3h11l3 3v15H5z M8 10h8 M8 14h8 M8 18h5",
    more: "M5 12h.1 M12 12h.1 M19 12h.1",
    chat: "M4 3h16v13H9l-5 5V3 M8 7h8 M8 11h5",
    bot: "M5 8h14v12H5z M12 3v5 M9 13h.1 M15 13h.1 M9 17h6",
    bell: "M6 8a6 6 0 0 1 12 0v8l3 2H3l3-2V8 M10 21h4",
    lead: "M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4",
    help: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 3 M12 17h.01",
    refresh: "M20 6v5h-5 M4 18v-5h5 M18.5 9a7 7 0 0 0-12-2L4 11 M5.5 15a7 7 0 0 0 12 2l2.5-4",
    trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
    reply: "M9 6l-6 6 6 6 M3 12h11a7 7 0 0 1 7 7",
    replyAll: "M7 6l-5 6 5 6 M12 6l-5 6 5 6 M7 12h8a6 6 0 0 1 6 6",
    forward: "M15 6l6 6-6 6 M21 12H10a7 7 0 0 0-7 7",
    clip: "M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7",
  };
  const icon = (name) =>
    `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${icons[name] || icons.grid}"/></svg>`;
  // 新界面（粉色、橙色）的菜单图标：统一的线条 + 淡色底（tint 是填充层，line 是描边层）。
  // 同一个位置两种图标都输出，由 CSS 按皮肤显示其中一种（skin-glass.css 的 .icon-duo）；小满主题仍是上面的线条图标。
  const duoIcons = {
    sliders: { tint: "M15 4.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M9 9.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M17 14.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z", line: "M4 7h8.8 M17.2 7H20 M4 12h2.8 M11.2 12H20 M4 17h10.8 M19.2 17H20 M15 4.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M9 9.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M17 14.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z" },
    heart: { tint: "M12 20.5S3.5 15.5 3.5 9.5A4.5 4.5 0 0 1 12 7.5a4.5 4.5 0 0 1 8.5 2c0 6-8.5 11-8.5 11z", line: "M12 20.5S3.5 15.5 3.5 9.5A4.5 4.5 0 0 1 12 7.5a4.5 4.5 0 0 1 8.5 2c0 6-8.5 11-8.5 11z" },
    grid: { tint: "M4 4h6.5v6.5H4z M13.5 13.5H20V20h-6.5z", line: "M4 5.5A1.5 1.5 0 0 1 5.5 4h3.5A1.5 1.5 0 0 1 10.5 5.5V9A1.5 1.5 0 0 1 9 10.5H5.5A1.5 1.5 0 0 1 4 9z M13.5 5.5A1.5 1.5 0 0 1 15 4h3.5A1.5 1.5 0 0 1 20 5.5V9a1.5 1.5 0 0 1-1.5 1.5H15A1.5 1.5 0 0 1 13.5 9z M4 15a1.5 1.5 0 0 1 1.5-1.5H9a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 9 20H5.5A1.5 1.5 0 0 1 4 18.5z M13.5 15a1.5 1.5 0 0 1 1.5-1.5h3.5A1.5 1.5 0 0 1 20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5z" },
    mail: { tint: "M3.5 7a2.5 2.5 0 0 1 2.5-2.5h12A2.5 2.5 0 0 1 20.5 7v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17z", line: "M3.5 7a2.5 2.5 0 0 1 2.5-2.5h12A2.5 2.5 0 0 1 20.5 7v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17z M4.5 7.5l7.5 5.5 7.5-5.5" },
    chat: { tint: "M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9.5A1.5 1.5 0 0 1 19 17h-6.5L8 20.5V17H5A1.5 1.5 0 0 1 3.5 15.5V6A1.5 1.5 0 0 1 5 4.5z", line: "M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9.5A1.5 1.5 0 0 1 19 17h-6.5L8 20.5V17H5A1.5 1.5 0 0 1 3.5 15.5V6A1.5 1.5 0 0 1 5 4.5z M8 9.5h8 M8 12.8h5" },
    lead: { tint: "M4 5h16l-6 7.5V19l-4 1.5v-8z", line: "M4 5h16l-6 7.5V19l-4 1.5v-8z" },
    people: { tint: "M9 4.8a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z", line: "M9 4.8a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z M3 20a6 6 0 0 1 12 0 M16 5.2a3.2 3.2 0 0 1 0 6.2 M17.5 14.4c2.1.6 3.5 2.4 3.5 5.1" },
    globe: { tint: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z", line: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8z M12 11.1a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z" },
    search: { tint: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", line: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M15.4 15.4L20.5 20.5 M8 10.5h5 M10.5 8v5" },
    note: { tint: "M5.5 8h13l-.9 11.2a1.5 1.5 0 0 1-1.5 1.3H7.9a1.5 1.5 0 0 1-1.5-1.3z", line: "M5.5 8h13l-.9 11.2a1.5 1.5 0 0 1-1.5 1.3H7.9a1.5 1.5 0 0 1-1.5-1.3z M9 8V7a3 3 0 0 1 6 0v1" },
    chart: { tint: "M4.5 12.5h3.5v7H4.5z M10.2 5.5h3.6v14h-3.6z M16 9.5h3.5v10H16z", line: "M5.5 12.5h1.5a1 1 0 0 1 1 1v6H4.5v-6a1 1 0 0 1 1-1z M11.2 5.5h1.6a1 1 0 0 1 1 1v13h-3.6v-13a1 1 0 0 1 1-1z M17 9.5h1.5a1 1 0 0 1 1 1v9H16v-9a1 1 0 0 1 1-1z" },
    folder: { tint: "M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z", line: "M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" },
    calendar: { tint: "M3.5 8.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18z", line: "M3.5 8.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18z M3.5 11h17 M8 3.5v4 M16 3.5v4" },
    building: { tint: "M5 5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20.5H5z", line: "M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5v15 M15 10h3.5a1.5 1.5 0 0 1 1.5 1.5v9 M3 20.5h18 M8.5 8h3 M8.5 11.5h3 M8.5 15h3" },
  };
  // 新界面里要换成淡色底图标的名字 -> 淡色底图标名（其余图标原样输出）
  const duoNames = { grid: "grid", mail: "mail", chart: "chart", box: "note", folder: "folder", people: "people", chat: "chat", lead: "lead", globe: "globe", search: "search", heart: "heart", note: "note" };
  const menuIcon = (name, duoName = duoNames[name]) => {
    const d = duoIcons[duoName];
    return d
      ? icon(name).replace("class=\"icon\"", "class=\"icon icon-classic\"") +
          `<svg class="icon icon-duo" aria-hidden="true" viewBox="0 0 24 24"><path class="tint" d="${d.tint}"/><path d="${d.line}"/></svg>`
      : icon(name);
  };
  const date = (v) => {
    if (!v) return "—";
    const raw = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.replace(" ", "T"));
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("sv-SE") : raw.slice(0, 10);
  },
    money = (v) =>
      v === null
        ? "待换算"
        : new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(v || 0);
  const opt = (v, label, selected) =>
    `<option value="${E(v)}" ${selected === v ? "selected" : ""}>${E(label)}</option>`;
  let mail = null;
  let business = null,
    activeRoute = "customers",
    favoritesMode = false;
  let state = {},
    revision = 0,
    rows = [],
    pending = null,
    selected = new Set(),
    currentName = "",
    tab = "info",
    activityFilter = "all",
    activityQuery = "",
    activitySearchDraft = "",
    documentQuery = "",
    documentPage = 1,
    documentPageSize = 20,
    documentSelected = new Set(),
    activitySearchOpen = false,
    activityGroupState = {},
    activitySort = "newest",
    activityAdvanced = {},
    activityRefreshInProgress = false,
    modal = null,
    lastFocus = null,
    companyReturnOverlay = null,
    companyReturnFocus = null,
    companyDisplayDraftCache = null,
    page = 1,
    pageSize = 20;
  let filters = {
    query: "",
    field: "name",
    country: "",
    owner: "",
    stage: "",
    tag: "",
    group: "all",
    sort: "recent",
    sortField: "",
    sortDirection: "",
  };
  let globalSearch = { field: "all", query: "" };
  let importDraft = null, importRecordsPage = 1;
  let groupTab = "groups",
    groupsCollapsed = false,
    groupMotionTimer = null,
    groupPointerPress = null,
    team = "team",
    filterMode = "normal",
    advancedSpec = null,
    filterDraft = null;
  const followupDrafts = new Map();
  // 只有正在看的客户详情页上写了一半的跟进才算「没保存的内容」；其他客户留下的草稿只留在内存里，不拦着换页。
  const openFollowupDraft = () =>
    activeRoute === "customers" && !!currentName && !!followupDrafts.get(currentName)?.text.trim();
  const collapsedInfoSections = new Set();
  const collapsedDetailCards = new Set();
  const stageLabels = {
    quote: "报价",
    deposit: "定金",
    production: "生产中",
    balance: "尾款",
    shipment: "已发货",
    done: "已完成",
  };
  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3000);
  }
  // ---- 角色权限（测试账号）：当前账号能看哪些客户、能做哪些操作。规则都在 role-model.js，这里只在界面上用上。 ----
  const R = window.LaiRoleModel;
  const can = (key) => R.can(state, key);
  // 有权限返回 true；没有就提示原因并返回 false，调用处直接 return。
  const allow = (key) => can(key) || (toast(R.denied(key)), false);
  // 没权限的按钮不画出来。
  const showIf = (key, html) => (can(key) ? html : "");
  function status(text, error = false) {
    const el = $("#save-status");
    if (el) {
      el.textContent = text;
      el.classList.toggle("save-failed", error);
    }
  }
  // 界面配色：laiSettings.theme 存「pink」（默认）、「orange」或「xiaoman」（原来的蓝色），写到 <html data-theme>，颜色全部由 ui-tokens.css 的变量决定。
  const THEME_IDS = ["pink", "orange", "xiaoman"];
  function applyTheme(id) {
    const theme = THEME_IDS.includes(id) ? id : "pink";
    document.documentElement.dataset.theme = theme;
    // 粉色、橙色用新界面（悬浮玻璃面板），小满保持原来的界面。
    document.documentElement.dataset.skin = theme === "xiaoman" ? "classic" : "glass";
  }
  // 已保存数据的快照（见 model.js 的 snapshotState）：保存时只把和它不同的部分发给本机服务。
  let savedSnapshot = null;
  function adoptServerState(data, serverRevision) {
    state = data;
    revision = serverRevision;
    savedSnapshot = M.snapshotState(data);
  }
  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, result: await res.json().catch(() => ({})) };
  }
  // 自动备份：保存后由本机服务排队备份。备份没成功时在页面底部提示，可以点「重试」；不显示原始的英文错误。
  let backupWarning = false;
  let backupStatusTimer = null, backupStatusGeneration = 0;
  function scheduleBackupStatus(result, generation) {
    if (!result.pending) return;
    const delay = Math.max(1000, Math.min(60000, (Number(result.nextAttemptAt) || Date.now() + 60000) - Date.now() + 250));
    backupStatusTimer = setTimeout(async () => {
      backupStatusTimer = null;
      try {
        const response = await fetch("/api/backup-status", { cache: "no-store" });
        if (!response.ok) throw new Error("backup status unavailable");
        const data = await response.json();
        if (!data.backup) throw new Error("backup status unavailable");
        if (generation === backupStatusGeneration) updateBackupNotice(data.backup);
      } catch (_) {
        if (generation === backupStatusGeneration) scheduleBackupStatus({ pending: true, nextAttemptAt: Date.now() + 60000 }, generation);
      }
    }, delay);
  }
  function updateBackupNotice(result) {
    if (!result) return;
    if (backupStatusTimer !== null) clearTimeout(backupStatusTimer);
    backupStatusTimer = null;
    scheduleBackupStatus(result, ++backupStatusGeneration);
    if (result.ok === false) backupWarning = true;
    else if (!result.skipped) backupWarning = false;
    let notice = document.getElementById("backup-warning");
    if (!backupWarning) { if (notice) notice.hidden = true; return; }
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "backup-warning";
      notice.className = "backup-warning";
      notice.setAttribute("role", "alert");
      notice.innerHTML = '<span>备份没有成功，数据已保存。</span><button type="button">重试</button>';
      document.body.appendChild(notice);
      notice.querySelector("button").addEventListener("click", async () => {
        const button = notice.querySelector("button");
        button.disabled = true;
        try {
          const response = await fetch("/api/manual-backup", { method: "POST" });
          const backup = await response.json();
          updateBackupNotice(backup);
          toast(backup.ok ? "备份已完成" : "备份还是没有成功，请稍后再试");
        } catch (_) { toast("备份还是没有成功，请稍后再试"); }
        finally { button.disabled = false; }
      });
    }
    notice.hidden = false;
  }
  // 版本冲突（别处先保存了）：取最新数据；这次改动碰到的客户、订单、设置都没被别处改过时，
  // 把改动套到最新数据上返回，由调用处再存一次；否则告诉用户是哪些被改了，正在填的表单不关。
  async function rebaseAfterConflict(diff) {
    const generic = "数据刚在别处更新过，这次的修改还没有保存。请核对后再保存。";
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error(generic);
    const payload = await response.json();
    if (!payload.data || !Array.isArray(payload.data.orders) || !payload.data.customers || !Number.isInteger(payload.revision))
      throw new Error(generic);
    const result = diff ? M.rebaseChanges(savedSnapshot, diff.changes, payload.data) : { ok: false, conflicts: [] };
    adoptServerState(payload.data, payload.revision);
    rebuildRows();
    if (result.ok) return result.data;
    const names = [...new Set(result.conflicts.map((item) =>
      item.kind === "customer" ? `客户「${item.name}」` : item.kind === "order" ? `订单「${item.num}」` : item.kind === "orderList" ? "订单列表" : item.kind === "lookups" ? "物流查询记录" : "设置"))];
    if (!names.length) throw new Error(generic);
    throw new Error(`数据已发生变化：${names.slice(0, 3).join("、")}${names.length > 3 ? "等" : ""}刚在别处改过，你的修改还没有保存。已载入最新内容，请核对后再保存。`);
  }
  async function persist(next, importLog = null) {
    if (pending) throw new Error("上一项修改正在保存，请稍候");
    status("正在保存…");
    pending = (async () => {
      const send = async (data) => {
        const diff = savedSnapshot ? M.diffState(savedSnapshot, data) : null;
        let sent = null;
        if (diff && diff.empty && !importLog) {
          sent = { res: { ok: true, status: 200 }, result: { ok: true, revision } };
        } else if (diff) {
          sent = await postJson("/api/save-changes", {
            changes: diff.changes,
            baseRevision: revision,
            ...(importLog ? {importLog} : {}),
          });
          // 只传改动没走通（旧版服务、核对没过）时，退回整包保存；版本冲突不退回。
          if ([400, 404, 422, 500].includes(sent.res.status)) sent = null;
        }
        if (!sent) {
          sent = await postJson("/api/save", {
            state: { app: "laicai-lai", version: APP_VERSION, data },
            baseRevision: revision,
            ...(importLog ? {importLog} : {}),
          });
        }
        return { diff, ...sent };
      };
      let attempt = await send(next);
      // 版本冲突只自动重试一次。
      if (attempt.res.status === 409) {
        next = await rebaseAfterConflict(attempt.diff);
        attempt = await send(next);
      }
      const { res, result, diff } = attempt;
      if (!res.ok || !result.ok)
        throw new Error(
          res.status === 409
            ? "数据刚在别处更新过，这次的修改还没有保存。请稍后再保存一次。"
            : result.message || result.error || "保存失败，请重试",
        );
      state = next;
      revision = result.revision;
      savedSnapshot = diff ? diff.snapshot : M.snapshotState(next);
      applyTheme(state.laiSettings?.theme);
      rebuildRows();
      updateBackupNotice(result.backup);
      status(backupWarning ? "已保存 · 备份没有成功" : "已保存到来财", backupWarning);
      return true;
    })();
    try {
      return await pending;
    } catch (error) {
      status("保存失败 · 内容尚未保存", true);
      if (error instanceof TypeError && [
        "Failed to fetch", "Load failed",
        "NetworkError when attempting to fetch resource.",
      ].includes(error.message)) {
        throw new Error("无法连接来财本地数据服务，内容尚未保存，请重试。");
      }
      throw error;
    } finally {
      pending = null;
    }
  }
  window.flushPendingSave = async () => {
    try {
      while (pending) {
        await pending;
        // Let the successful save caller close its editor and clear its draft.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch {
      return false;
    }
    if (
      business?.hasDraft() ||
      ["edit", "segment", "columns", "membership", "transition", "import", "mail-bind"].includes(
        modal,
      ) ||
      mail?.composeDirty() ||
      openFollowupDraft()
    ) {
      toast("请先保存或取消正在编辑的内容");
      return false;
    }
    return true;
  };
  async function refreshApplication() {
    if (!(await window.flushPendingSave())) return false;
    status("正在刷新…");
    window.location.reload();
    return true;
  }
  function customerNavToggle(collapse) {
    const expanded = !$("#app").classList.contains("nav-collapsed");
    const action = collapse ? "collapse-subnav" : "expand-subnav";
    const label = collapse ? "收起客户导航" : "展开客户导航";
    const path = collapse
      ? "M24 36 12 24l12-12m12 24L24 24l12-12"
      : "m12 12 12 12-12 12m12-24 12 12-12 12";
    return `<button type="button" class="subnav-toggle ${collapse ? "subnav-collapse" : "subnav-restore"}" data-action="${action}" aria-label="${label}" aria-expanded="${expanded}" aria-controls="app-subnav"><svg aria-hidden="true" viewBox="0 0 48 48" fill="none"><path d="${path}" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  }
  // 工作台只有它自己一个入口，二级导航没有内容可放，整栏不显示（常用模式下仍显示常用列表）。
  function shell(content) {
    const scope = C.globalSearchFields.find((field) => field.id === globalSearch.field)?.label || "客户";
    const searchScope = globalSearch.field === "all" ? "客户" : scope;
    return `<header class="topbar"><div class="topbar-left-drag-region"><div class="brand" aria-label="来财Lai"><svg class="brand-mark" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path fill="#16121A" d="M46.00,0.00 H154.00 A46,46 0 0 1 200.00,46.00 V154.00 A46,46 0 0 1 154.00,200.00 H46.00 A46,46 0 0 1 0.00,154.00 V46.00 A46,46 0 0 1 46.00,0.00 Z"/><path fill="#FF4F9A" fill-rule="evenodd" d="M51.00,108.00 H149.00 A25,25 0 0 1 174.00,133.00 V133.00 A25,25 0 0 1 149.00,158.00 H51.00 A25,25 0 0 1 26.00,133.00 V133.00 A25,25 0 0 1 51.00,108.00 Z M58.00,127.00 H142.00 A6,6 0 0 1 148.00,133.00 V133.00 A6,6 0 0 1 142.00,139.00 H58.00 A6,6 0 0 1 52.00,133.00 V133.00 A6,6 0 0 1 58.00,127.00 Z"/><path fill="#16121A" d="M129.00,29.00 L130.57,29.09 L132.12,29.35 L133.62,29.79 L135.07,30.39 L136.45,31.15 L137.73,32.05 L138.90,33.10 L139.95,34.27 L140.85,35.55 L141.61,36.93 L142.21,38.38 L142.65,39.88 L142.91,41.43 L143.00,43.00 L143.00,127.00 L57.00,127.00 L57.00,43.00 L57.09,41.43 L57.35,39.88 L57.79,38.38 L58.39,36.93 L59.15,35.55 L60.05,34.27 L61.10,33.10 L62.27,32.05 L63.55,31.15 L64.93,30.39 L66.38,29.79 L67.88,29.35 L69.43,29.09 L71.00,29.00 Z"/><path fill="#0B080D" d="M58.00,127.00 H142.00 A6,6 0 0 1 148.00,133.00 V133.00 A6,6 0 0 1 142.00,139.00 H58.00 A6,6 0 0 1 52.00,133.00 V133.00 A6,6 0 0 1 58.00,127.00 Z"/><path fill="#FFC23D" d="M129.00,34.00 L130.01,34.06 L131.00,34.23 L131.97,34.51 L132.90,34.89 L133.79,35.38 L134.61,35.96 L135.36,36.64 L136.04,37.39 L136.62,38.21 L137.11,39.10 L137.49,40.03 L137.77,41.00 L137.94,41.99 L138.00,43.00 L138.00,133.00 L62.00,133.00 L62.00,43.00 L62.06,41.99 L62.23,41.00 L62.51,40.03 L62.89,39.10 L63.38,38.21 L63.96,37.39 L64.64,36.64 L65.39,35.96 L66.21,35.38 L67.10,34.89 L68.03,34.51 L69.00,34.23 L69.99,34.06 L71.00,34.00 Z"/><path fill="#16121A" fill-rule="evenodd" d="M125.00,42.00 L125.56,42.03 L126.11,42.13 L126.65,42.28 L127.17,42.50 L127.66,42.77 L128.12,43.09 L128.54,43.46 L128.91,43.88 L129.23,44.34 L129.50,44.83 L129.72,45.35 L129.87,45.89 L129.97,46.44 L130.00,47.00 L130.00,133.00 L70.00,133.00 L70.00,47.00 L70.03,46.44 L70.13,45.89 L70.28,45.35 L70.50,44.83 L70.77,44.34 L71.09,43.88 L71.46,43.46 L71.88,43.09 L72.34,42.77 L72.83,42.50 L73.35,42.28 L73.89,42.13 L74.44,42.03 L75.00,42.00 Z M123.50,46.00 L123.78,46.02 L124.06,46.06 L124.33,46.14 L124.58,46.25 L124.83,46.38 L125.06,46.55 L125.27,46.73 L125.45,46.94 L125.62,47.17 L125.75,47.42 L125.86,47.67 L125.94,47.94 L125.98,48.22 L126.00,48.50 L126.00,133.00 L74.00,133.00 L74.00,48.50 L74.02,48.22 L74.06,47.94 L74.14,47.67 L74.25,47.42 L74.38,47.17 L74.55,46.94 L74.73,46.73 L74.94,46.55 L75.17,46.38 L75.42,46.25 L75.67,46.14 L75.94,46.06 L76.22,46.02 L76.50,46.00 Z"/><path fill="#16121A" d="M101.67 102.58V107.00H98.17V102.52Q92.38 102.03 88.83 99.05Q85.28 96.08 85.06 90.95H95.00Q95.33 94.22 98.17 95.15V86.52Q93.91 85.43 91.37 84.39Q88.83 83.35 86.92 81.06Q85.01 78.77 85.01 74.78Q85.01 69.81 88.70 66.81Q92.38 63.81 98.17 63.42V59.00H101.67V63.42Q107.40 63.86 110.73 66.75Q114.06 69.65 114.44 74.78H104.45Q104.12 71.83 101.67 70.96V79.42Q106.20 80.68 108.66 81.66Q111.11 82.65 113.05 84.91Q114.99 87.18 114.99 91.11Q114.99 94.11 113.43 96.65Q111.88 99.19 108.85 100.80Q105.82 102.41 101.67 102.58ZM98.17 78.28V70.69Q96.64 70.96 95.77 71.86Q94.89 72.76 94.89 74.34Q94.89 75.71 95.74 76.64Q96.59 77.57 98.17 78.28ZM105.22 91.44Q105.22 90.02 104.31 89.12Q103.41 88.22 101.67 87.56V95.31Q103.30 95.04 104.26 94.00Q105.22 92.97 105.22 91.44Z"/></svg><svg class="brand-cn" viewBox="0 0 54 32" aria-hidden="true" focusable="false"><text x="27" y="24" text-anchor="middle">来财</text></svg><sup>AI</sup><button type="button" class="app-version" data-action="version-history" aria-haspopup="dialog" aria-label="当前版本 ${APP_VERSION}，查看版本更新历史">v${APP_VERSION}</button></div></div><form class="global-search" id="global-search-form"><button type="button" data-action="global-search-scope" aria-label="搜索范围" aria-haspopup="menu" aria-expanded="false"><span class="global-search-label" title="${E(searchScope)}">${E(searchScope)}</span><span class="dd-caret" aria-hidden="true"></span></button><input name="query" aria-label="全局客户搜索" placeholder="请输入搜索关键字" value="${E(globalSearch.query)}"><button type="submit" aria-label="搜索客户">${icon("search")}</button></form><div class="top-actions">${showIf("customer.create", `<button class="text-button" data-action="new" aria-label="快速新建">${icon("plus")}</button>`)}<i></i><button class="text-button" data-action="about">${icon("help")} 帮助</button><i></i><button class="avatar" data-action="profile-menu" aria-label="当前账号：${E(R.meName(state))}" title="当前账号：${E(R.meName(state))}" aria-haspopup="menu">${icon("people")}</button></div><span id="save-status" class="save-status" role="status"></span></header><nav class="rail" aria-label="模块导航">${appNav()}</nav><aside class="subnav" id="app-subnav"${activeRoute === "dashboard" && !favoritesMode ? " hidden" : ""}>${subnav()}</aside>${activeRoute === "customers" ? customerNavToggle(false) : ""}<main class="main ${activeRoute === "customers" ? "customer-main" : ""}">${content}</main>`;
  }
  // 当前账号打不开的页面：只显示原因，不显示页面内容。
  function blockedPage(title, message, hint = "可以点右上角头像，切换到别的测试账号。") {
    window.LaiActivityCategoryNavigation.mount(null);
    closeDropdowns();
    removePopover();
    $("#app").innerHTML = shell(
      `<div class="pagebar"><div class="page-tabs"><h1>${E(title)}</h1></div></div><section class="module-page"><div class="empty role-blocked" role="status"><strong>${E(message)}</strong><span>${E(hint)}</span></div></section>`,
    );
  }
  const SCREEN_TITLES = { active: "客户列表", pool: "公海客户", trash: "客户回收站", duplicates: "客户查重", "customer-settings": "客户设置" };
  // 客户页面需要的权限不够：显示提示页并返回 true。
  function screenBlocked(screen) {
    const key = R.pagePerm("screen", screen);
    if (!key || can(key)) return false;
    customerScreen = screen;
    currentName = "";
    selected.clear();
    blockedPage(SCREEN_TITLES[screen] || "客户", R.denied(key));
    return true;
  }
  function closeDropdowns() {
    window.LaiCustomerSelect?.close();
    window.LaiCustomerSuggestions?.close();
    closeActivitySortMenu();
    closeActivityAdvancedFilterMenu();
  }
  function enhanceDropdowns(root) {
    if (!root) return;
    window.LaiCustomerSelect?.watch?.();
    window.LaiCustomerSelect?.enhance(root);
    window.LaiCustomerSuggestions?.enhance(root);
  }
  const customerListViewport = { groups: { groups: 0, ai: 0 }, horizontal: 0, vertical: 0, signature: "" };
  function rememberCustomerListViewport() {
    const panel = $("#app .replica-panel");
    if (!panel) return;
    const activeTab = panel.querySelector(".group-tabs .active")?.dataset.groupTab || "groups";
    customerListViewport.groups[activeTab] = panel.querySelector(".group-scroll")?.scrollTop || 0;
    customerListViewport.horizontal = panel.querySelector(".table-wrap")?.scrollLeft || 0;
    customerListViewport.vertical = panel.querySelector(".table-wrap")?.scrollTop || 0;
  }
  function list(motion = "") {
    window.LaiActivityCategoryNavigation.mount(null);
    closeDropdowns();
    removePopover();
    rememberCustomerListViewport();

    customerScreen = "active";
    currentName = "";
    if (screenBlocked("active")) return;
    const p = M.paginate(filteredRows(), page, pageSize);
    page = p.page;
    const viewportSignature = JSON.stringify([page, pageSize, filters, advancedSpec]);
    const counts = Object.fromEntries(
      segmentList()
        .filter((g) => g.kind === "rules" && !g.archived)
        .map((g) => [g.id, S.resolveMembers(rows, g).length]),
    );
    $("#app").innerHTML = shell(
      window.LaiCustomerList.render({
        rows,
        p,
        filters,
        globalSearch,
        advancedSpec,
        selected,
        pageSize,
        segments: segmentList(),
        groupTab,
        groupsCollapsed,
        expanded,
        team,
        ruleCounts: counts,
        lapsedCount: groupRows("lapsed").length,
        followupCount: groupRows("followup").length,
        icon,
        escape: E,
        countryLabel: C.countryLabel,
        tableMarkup,
        importEnabled: importPreviewEnabled,
        can,
      }),
    );
    enhanceDropdowns($("#app"));
    const panel = $("#app .replica-panel");
    window.LaiCustomerList.observePagination(panel);
    if (panel) {
      panel.querySelector(".group-scroll").scrollTop = customerListViewport.groups[groupTab] || 0;
      const table = panel.querySelector(".table-wrap");
      table.scrollLeft = customerListViewport.horizontal;
      if (viewportSignature === customerListViewport.signature) table.scrollTop = customerListViewport.vertical;
    }
    customerListViewport.signature = viewportSignature;
    if (motion) V?.enter($("#app"), motion);
    const search = $("#search");
    if (search)
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          filters.query = e.target.value;
          filters.quickCountries = [];
          page = 1;
          list();
        }
      });
  }
  // 客户详情页里的商机：数字来自商机模块；detailOpp 记住当前显示的是第几个进行中的商机。
  const detailOpp = { name: "", index: 0 };
  function customerOpportunities(name) {
    const stats = window.LaiOpportunityModel.customerStats(state, name);
    if (detailOpp.name !== name) Object.assign(detailOpp, { name, index: 0 });
    detailOpp.index = Math.min(Math.max(0, detailOpp.index), Math.max(0, stats.activeOpportunities.length - 1));
    return { ...stats, activeOpportunityIndex: detailOpp.index };
  }
  // 详情页上原来只弹提示的商机按钮：添加／新建、全部、上一个／下一个、更多操作、点阶段调整。返回 true 表示已处理。
  function customerOpportunityFeature(feature) {
    if (!currentName || activeRoute !== "customers" || !window.LaiOpportunityModel) return false;
    if (feature === "添加商机" || feature === "新建商机") return business.newOpportunity(currentName), true;
    if (feature === "全部商机") return business.showOpportunities(currentName), true;
    const known = ["上一个商机", "下一个商机", "商机更多操作"].includes(feature) || feature.startsWith("商机阶段：");
    if (!known) return false;
    const stats = customerOpportunities(currentName), active = stats.activeOpportunities, current = active[stats.activeOpportunityIndex];
    if (!current) return true;
    if (feature === "上一个商机" || feature === "下一个商机") {
      if (active.length < 2) return toast("这个客户只有一个进行中的商机"), true;
      detailOpp.index = (detailOpp.index + (feature === "下一个商机" ? 1 : -1) + active.length) % active.length;
      return detail(currentName, true, ""), true;
    }
    if (feature === "商机更多操作") return business.opportunityMenu(current.id, currentName), true;
    // 阶段按当前商机所在销售流程的阶段名称找（详情页上显示的就是这些名称）。
    const stage = (current.stages || window.LaiOpportunityModel.STAGES).find((item) => item.label === feature.slice("商机阶段：".length));
    if (stage) business.moveOpportunity(current.id, stage.id, currentName);
    return true;
  }
  function detailMarkup(c) {
    c = window.LaiOpportunityModel ? { ...c, ...customerOpportunities(c.name) } : c;
    return window.LaiCustomerDetail.render(c, {
      sideColumn: true,
      tab,
      icon,
      escape: E,
      money,
      date,
      state,
      followupDraft: followupDrafts.get(c.name),
      activityFilter,
      activityQuery,
      activitySearchDraft,
      documentQuery,
      documentPage,
      documentPageSize,
      documentSelected: [...documentSelected],
      collapsedInfoSections: [...collapsedInfoSections],
      collapsedDetailCards: [...collapsedDetailCards],
      activitySearchOpen,
      activityGroupState,
      activitySort,
      activityAdvanced,
      // 动态里选了「往来邮件」时，上面多一块从邮箱实时查到的往来邮件。
      mailPanel: tab === "activity" && activityFilter === "email" && mail ? mail.customerPanel(c.name) : "",
    });
  }
  function setDetailCardCollapsed(card, closed) {
    if (!card || card.dataset.collapsed === String(closed)) return;
    const id = card.dataset.detailCard;
    if (id === "contacts" && closed) {
      filterDetailContacts();
      closeContactSearch(false, false);
    }
    if (closed) collapsedDetailCards.add(id);
    else collapsedDetailCards.delete(id);
    card.dataset.collapsed = String(closed);
    const button = card.querySelector(".lcd-card-toggle");
    button.setAttribute("aria-expanded", String(!closed));
    button.querySelector(".lcd-caret").textContent = closed ? "›" : "⌄";
    const panel = card.querySelector(".lcd-card-panel");
    panel.setAttribute("aria-hidden", String(closed));
    panel.inert = closed;
  }
  function detail(name, keepTab = false, motion = keepTab ? "" : "detail") {
    closeDropdowns();
    removePopover();
    rememberCustomerListViewport();
    const viewKey = L.bucket(state.customers?.[name]) === "pool" ? "pool.view" : "customer.view";
    if (!can(viewKey)) {
      currentName = "";
      return blockedPage("客户详情", R.denied(viewKey));
    }
    if (customerHidden(name)) {
      currentName = "";
      return blockedPage("客户详情", "这位客户不在你名下，你的角色只能看自己跟进的客户。");
    }
    if (currentName !== name) {
      collapsedInfoSections.clear();
      collapsedDetailCards.clear();
      activityFilter = "all";
      activityQuery = "";
      activitySearchDraft = "";
      documentQuery = "";
      documentPage = 1;
      documentSelected.clear();
      activitySearchOpen = false;
      activityGroupState = {};
      activitySort = "newest";
      const savedTypes = state.laiSettings?.activityTypeDefaults;
      activityAdvanced = savedTypes?.enabled && Array.isArray(savedTypes.types)
        ? { types: [...savedTypes.types] } : {};
    }
    currentName = name;
    if (!keepTab) tab = "info";
    const c = allCustomerRows().find((c) => c.name === name);
    if (!c) return list();
    $("#app").innerHTML = shell(detailMarkup(c));
    updateDocumentSelectAll();
    syncDetailTabOverflow();
    window.LaiActivityCategoryNavigation.mount($(".lcd-root"));
    V?.placeTabIndicator($("#app"));
    if (motion) V?.enter($("#app"), motion);
  }
  function replaceDetailBody(c, refreshSummary = false) {
    const body = $(".lcd-root .lcd-body");
    if (!body) return false;
    const summary = refreshSummary ? $(".lcd-root .lcd-summary") : null;
    const active = document.activeElement;
    const focusAttribute = summary?.contains(active) &&
      ["data-action", "data-feature", "data-follow"].find((attribute) => active.hasAttribute(attribute));
    const focusValue = focusAttribute ? active.getAttribute(focusAttribute) : null;
    const template = document.createElement("template");
    template.innerHTML = detailMarkup(c);
    if (refreshSummary) {
      replaceDetailContacts(template);
      replaceDetailSchedule(template);
    }
    const nextBody = template.content.querySelector(".lcd-body");
    const focusedDateForm = refreshSummary && tab === "activity" ? body.querySelector("#followup-form") : null;
    const currentFilters = refreshSummary ? body.querySelector(".lcd-activity-filters") : null;
    const nextForm = nextBody.querySelector("#followup-form");
    const nextFilters = nextBody.querySelector(".lcd-activity-filters");
    if (focusedDateForm?.parentElement === body && nextForm?.parentElement === nextBody &&
        currentFilters?.parentElement === body && nextFilters?.parentElement === nextBody) {
      // Keep both anchors connected: native date segments and category focus
      // survive server refresh while surrounding results and tools update.
      syncActivityFilters(nextFilters);
      const before = [], middle = [], after = [];
      let section = before;
      for (const node of [...nextBody.childNodes]) {
        if (node === nextForm) section = middle;
        else if (node === nextFilters) section = after;
        else section.push(node);
      }
      for (const node of [...body.childNodes])
        if (node !== focusedDateForm && node !== currentFilters) node.remove();
      focusedDateForm.before(...before);
      focusedDateForm.after(...middle);
      currentFilters.after(...after);
      const input = focusedDateForm.querySelector("[name='nextFollow']");
      const nextDate = nextForm.querySelector("[name='nextFollow']").value;
      if (active !== input && input.value !== nextDate) input.value = nextDate;
    } else body.replaceWith(nextBody);
    if (summary) {
      const nextSummary = template.content.querySelector(".lcd-summary");
      summary.replaceWith(nextSummary);
      if (focusAttribute) {
        [...nextSummary.querySelectorAll("button")]
          .find((button) => button.getAttribute(focusAttribute) === focusValue)
          ?.focus({ preventScroll: true });
      }
    }
    updateDocumentSelectAll();
    window.LaiActivityCategoryNavigation.mount($(".lcd-root"));
    return true;
  }
  function replaceDetailContacts(template) {
    const contacts = $(".lcd-contacts");
    const current = contacts?.querySelector(".lcd-card-panel-inner");
    const next = template.content.querySelector(".lcd-contacts .lcd-card-panel-inner");
    if (!current || !next) return;
    // The menu actions contain old indices; discard them before accepting
    // reordered records, while retaining their trigger's logical focus.
    closeContactMenu();
    const active = document.activeElement;
    const focusedCard = active?.closest(".lcd-contact");
    let replacement;
    if (focusedCard && current.contains(focusedCard)) {
      const oldCards = [...current.querySelectorAll(".lcd-contact")];
      const nextCards = [...next.querySelectorAll(".lcd-contact")];
      const id = focusedCard.dataset.contactId;
      const search = focusedCard.dataset.contactSearch;
      const matches = id
        ? (card) => card.dataset.contactId === id
        : (card) => Boolean(search) && card.dataset.contactSearch === search;
      const candidates = nextCards.filter(matches);
      if (oldCards.filter(matches).length === 1 && candidates.length === 1) {
        replacement = [...candidates[0].querySelectorAll("button")].find((button) =>
          active.hasAttribute("data-contact-more")
            ? button.hasAttribute("data-contact-more")
            : active.hasAttribute("data-feature") && button.dataset.feature === active.dataset.feature);
      }
    }
    current.replaceWith(next);
    // Refresh the applied filter, not an unsubmitted search input draft.
    filterDetailContacts(contacts.dataset.contactQuery || "");
    if (focusedCard && current.contains(focusedCard)) {
      const target = replacement?.checkVisibility() && !replacement.closest("[inert]")
        ? replacement : contacts.querySelector(".lcd-card-toggle");
      target?.focus({ preventScroll: true });
    }
  }
  function replaceDetailSchedule(template) {
    const current = $(".lcd-schedule");
    const next = template.content.querySelector(".lcd-schedule");
    if (!current || !next) return;
    const active = document.activeElement;
    const action = current.contains(active) ? active.dataset.action : null;
    current.replaceWith(next);
    if (action) {
      const target = [...next.querySelectorAll("[data-action]")]
        .find((button) => button.dataset.action === action)
        || next.querySelector("[data-action='schedule-edit']");
      target?.focus({ preventScroll: true });
    }
  }
  function updateDocumentSelectAll() {
    const root = $("#document-results");
    const selectAll = root?.querySelector("[data-document-select-all]");
    if (!selectAll) return;
    const checkboxes = [...root.querySelectorAll("[data-document-select]")];
    selectAll.indeterminate = checkboxes.some((item) => item.checked) && !checkboxes.every((item) => item.checked);
  }
  function syncActivityFilters(next) {
    const current = $(".lcd-activity-filters");
    if (!current || !next) return;
    for (const button of current.querySelectorAll("[data-activity-filter]")) {
      const replacement = next.querySelector(`[data-activity-filter="${button.dataset.activityFilter}"]`);
      button.querySelector(".lcd-activity-label").textContent = replacement.textContent;
      button.classList.toggle("selected", replacement.classList.contains("selected"));
      button.setAttribute("aria-pressed", replacement.getAttribute("aria-pressed"));
    }
  }
  function animateActivityResults(pointerActivated) {
    if (!pointerActivated) return;
    const results = $("#activity-results");
    results.classList.add("lcd-filter-enter");
    const clear = () => results.classList.remove("lcd-filter-enter");
    results.addEventListener("animationend", clear, { once: true });
    setTimeout(clear, 180);
  }
  function replaceActivityResults(immediate = false) {
    const current = $("#activity-results");
    const customer = allCustomerRows().find((row) => row.name === currentName);
    if (!current || !customer) return;
    const template = document.createElement("template");
    template.innerHTML = detailMarkup(customer);
    const next = template.content.querySelector("#activity-results");
    current.replaceWith(next);
    syncActivityFilters(template.content.querySelector(".lcd-activity-filters"));
    window.LaiActivityCategoryNavigation.update($("[data-activity-filter][aria-pressed='true']"), immediate);
    const count = next.querySelectorAll(".lcd-timeline article").length;
    $("#activity-search-status").textContent = activityQuery.trim() ? `找到 ${count} 条动态` : "";
  }
  function replaceDocumentResults(pointerActivated = false) {
    const current = $("#document-results");
    const customer = allCustomerRows().find((row) => row.name === currentName);
    if (!current || !customer) return;
    const template = document.createElement("template");
    template.innerHTML = detailMarkup(customer);
    const next = template.content.querySelector("#document-results");
    current.replaceWith(next);
    updateDocumentSelectAll();
    if (pointerActivated) {
      next.classList.add("lcd-filter-enter");
      const clear = () => next.classList.remove("lcd-filter-enter");
      next.addEventListener("animationend", clear, { once: true });
      setTimeout(clear, 180);
    }
  }
  function closeActivitySearch() {
    const row = $("#activity-search-row");
    if (!row || row.hidden) return;
    activitySearchOpen = false;
    const trigger = $("[data-action='activity-search']");
    trigger?.setAttribute("aria-expanded", "false");
    row.hidden = true;
    $(".lcd-activity-tools-buttons").hidden = false;
  }
  function commitActivitySearch() {
    activitySearchDraft = $("#activity-search-input")?.value || "";
    activityQuery = activitySearchDraft;
    activityFilter = "all";
    replaceActivityResults();
  }
  function clearActivitySearch() {
    activitySearchDraft = "";
    activityQuery = "";
    activityFilter = "all";
    $("#activity-search-input").value = "";
    // Move focus before hiding the clear button; otherwise its blur can close
    // the now-empty row during the same click.
    $("#activity-search-input").focus();
    $("[data-action='clear-activity-search']").hidden = true;
    replaceActivityResults();
  }
  async function refreshActivity(pointerActivated = false) {
    if (tab !== "activity" || !currentName) return;
    if (activityRefreshInProgress) return toast("动态正在刷新，请稍候");
    if (pending) return toast("上一项修改正在保存，请稍候");
    const name = currentName;
    const button = $("[data-action='refresh-activity']");
    let restoreRefreshFocus = !pointerActivated && document.activeElement === button;
    let refreshedButton;
    activityRefreshInProgress = true;
    button.disabled = true;
    if (pointerActivated) button.classList.add("lcd-activity-refreshing");
    $("#activity-results")?.setAttribute("aria-busy", "true");
    $("#activity-refresh-status").textContent = "正在刷新…";
    let message = "已是最新";
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) throw new Error("本地数据服务连接失败");
      const payload = await response.json();
      if (!payload.data || !Array.isArray(payload.data.orders) || !payload.data.customers ||
          typeof payload.data.customers !== "object" || Array.isArray(payload.data.customers) ||
          !Number.isInteger(payload.revision) || payload.revision < revision || pending)
        throw new Error("客户数据暂时无法刷新");
      if (tab !== "activity" || currentName !== name || modal ||
          $("[data-action='refresh-activity']") !== button) {
        message = "刷新已取消";
        return;
      }
      if (payload.revision !== revision) {
        adoptServerState(payload.data, payload.revision);
        rebuildRows();
        message = "动态已更新";
        if (tab === "activity" && currentName === name) {
          const customer = allCustomerRows().find((row) => row.name === name);
          if (!customer) {
            list();
            toast("当前客户已不在客户列表中");
          } else {
            // Read the current input context when the response arrives, since
            // the user may have continued typing while the request was pending.
            const active = document.activeElement;
            const inputSelector = ["followup-text", "activity-search-input"].includes(active?.id)
              ? "#" + active.id
              : active?.matches?.("#followup-form [name='nextFollow']")
                ? "#followup-form [name='nextFollow']" : null;
            const inputFocus = inputSelector
              ? { selector: inputSelector, start: active.selectionStart, end: active.selectionEnd,
                  direction: active.selectionDirection, top: active.scrollTop, left: active.scrollLeft }
              : null;
            restoreRefreshFocus = active === button || active === document.body;
            replaceDetailBody(customer, true);
            refreshedButton = $("[data-action='refresh-activity']");
            if (inputFocus) {
              const input = $(inputFocus.selector);
              input?.focus({ preventScroll: true });
              if (typeof inputFocus.start === "number" && typeof inputFocus.end === "number")
                input?.setSelectionRange(inputFocus.start, inputFocus.end, inputFocus.direction);
              if (input) {
                input.scrollTop = inputFocus.top;
                input.scrollLeft = inputFocus.left;
              }
            }
          }
        }
      }
    } catch {
      message = "刷新失败，请重试";
    } finally {
      activityRefreshInProgress = false;
      if (tab === "activity" && currentName === name) {
        const currentButton = $("[data-action='refresh-activity']");
        currentButton.disabled = false;
        currentButton.classList.remove("lcd-activity-refreshing");
        if (restoreRefreshFocus && !modal && document.activeElement === document.body &&
            (currentButton === button || currentButton === refreshedButton)) {
          currentButton.focus({ preventScroll: true });
        }
        $("#activity-results")?.removeAttribute("aria-busy");
        const label = $("#activity-refresh-status");
        label.textContent = message;
        setTimeout(() => {
          if (label.isConnected && label.textContent === message) label.textContent = "";
        }, 2500);
      }
    }
  }
  function switchDetailTab(nextTab, pointerActivated, keepOverflowOpen = false) {
    if (!keepOverflowOpen) closeDetailTabOverflow();
    if (nextTab === tab) return;
    const c = allCustomerRows().find((row) => row.name === currentName);
    const root = $(".lcd-root");
    if (!c || !root?.querySelector(".lcd-body")) return;
    closeActivitySortMenu();
    closeActivityAdvancedFilterMenu();
    closeDocumentSizeMenu();
    tab = nextTab;
    replaceDetailBody(c);
    const nav = root.querySelector(".lcd-tabs");
    const instantTabs = !pointerActivated;
    if (instantTabs) nav.classList.add("lcd-tabs-instant-commit");
    for (const button of root.querySelectorAll(".lcd-tabs button[data-tab]")) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    V?.placeTabIndicator(root, pointerActivated && !instantTabs);
    nav.classList.remove("lcd-tabs-instant-commit");
    syncDetailTabOverflow();
  }
  let detailTabOverflowCursor = -1;
  function setDetailTabOverflowCursor(index) {
    const menu = $(".lcd-tabs-overflow-menu");
    if (!menu) return;
    detailTabOverflowCursor = index;
    const visible = [...menu.querySelectorAll("[data-overflow-tab]")].filter((item) => !item.hidden);
    for (const item of menu.querySelectorAll("[data-overflow-tab]")) {
      if (index >= 0 && visible[index] === item) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    }
  }
  function closeDetailTabOverflow(restoreFocus = false) {
    const menu = $(".lcd-tabs-overflow-menu");
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    setDetailTabOverflowCursor(-1);
    const more = $("[data-action='detail-tabs-more']");
    more?.setAttribute("aria-expanded", "false");
    if (restoreFocus) more?.focus({ preventScroll: true });
    return true;
  }
  function updateDetailTabOverflowItems() {
    const nav = $(".lcd-tabs");
    const menu = $(".lcd-tabs-overflow-menu");
    if (!nav || !menu) return;
    const visible = nav.getBoundingClientRect();
    for (const item of menu.querySelectorAll("[data-overflow-tab]")) {
      const button = nav.querySelector(`[data-tab="${item.dataset.overflowTab}"]`);
      const bounds = button?.getBoundingClientRect();
      item.hidden = !bounds || (bounds.left >= visible.left - 0.5 && bounds.right <= visible.right + 0.5);
    }
    setDetailTabOverflowCursor(-1);
  }
  function syncDetailTabOverflow() {
    const nav = $(".lcd-tabs");
    const more = $("[data-action='detail-tabs-more']");
    const card = nav?.closest(".lcd-tabs-card");
    if (!nav || !more || !card) return;
    const buttons = [...nav.querySelectorAll("button[data-tab]")];
    const last = buttons.at(-1);
    const needed = !!last && last.offsetLeft + last.offsetWidth > card.clientWidth - 32 + 0.5;
    nav.classList.toggle("has-overflow", needed);
    more.hidden = !needed;
    if (!needed) closeDetailTabOverflow();
    else if (!$(".lcd-tabs-overflow-menu")?.hidden) updateDetailTabOverflowItems();
  }
  function toggleDetailTabOverflow() {
    const menu = $(".lcd-tabs-overflow-menu");
    const more = $("[data-action='detail-tabs-more']");
    if (!menu || !more || more.hidden) return;
    if (!menu.hidden) return closeDetailTabOverflow(true);
    updateDetailTabOverflowItems();
    menu.hidden = false;
    more.setAttribute("aria-expanded", "true");
  }
  let customerViewTransitioning = false;
  async function openCustomer(name, trigger, pointerActivated) {
    if (nativeWindowBridge()) {
      window.webkit.messageHandlers.openCustomerDetail.postMessage({ name });
      return;
    }
    if (customerViewTransitioning) return;
    if (!pointerActivated) {
      detail(name, false, "");
      return;
    }
    customerViewTransitioning = true;
    trigger?.classList.add("customer-opening");
    try {
      const leaving = await V?.exitList($("#app"));
      if (activeRoute !== "customers" || leaving?.isConnected === false) return;
      detail(name);
    } finally {
      customerViewTransitioning = false;
    }
  }
  async function returnToCustomerList(pointerActivated) {
    if (separateCustomerWindow) {
      if (await window.flushPendingSave())
        window.webkit.messageHandlers.closeCustomerDetail.postMessage(null);
      return;
    }
    if (customerViewTransitioning) return;
    if (!pointerActivated) {
      if (customerScreen === "active") list();
      else showCustomerScreen(customerScreen);
      return;
    }
    customerViewTransitioning = true;
    try {
      const leaving = await V?.exitDetail($("#app"));
      if (activeRoute !== "customers" || leaving?.isConnected === false) return;
      if (customerScreen === "active") list("list");
      else {
        showCustomerScreen(customerScreen);
        V?.enter($("#app"), "list");
      }
    } finally {
      customerViewTransitioning = false;
    }
  }
  function refresh() {
    if (activeRoute !== "customers") return business.refresh();
    if (currentName) detail(currentName, true);
    else showCustomerScreen(customerScreen);
  }
  function companyDisplayLayoutFromPanel(panel) {
    const ids = (group) => [...panel.querySelectorAll(`[data-company-list="${group}"] [data-company-field-id]`)]
      .map((row) => row.dataset.companyFieldId);
    return { common: ids("common"), other: ids("other") };
  }
  function positionCustomerUnsavedWarning(warning, warningPanel = warning.closest(".customer-editor"), headerInset = 12) {
    const trigger = warning._trigger;
    if (!trigger?.isConnected) return;
    const anchor = trigger.getBoundingClientRect();
    const box = warning.getBoundingClientRect();
    const panel = warningPanel.getBoundingClientRect();
    const header = !!trigger.closest(".drawer-head");
    warning.dataset.placement = header ? "left" : "top";
    warning.style.left = Math.max(8, Math.min(innerWidth - box.width - 8,
      header ? anchor.left - box.width - 8 : anchor.left + anchor.width / 2 - box.width / 2)) - panel.left + "px";
    warning.style.top = Math.max(8, Math.min(innerHeight - box.height - 8,
      header ? Math.max(headerInset, anchor.top + anchor.height / 2 - box.height / 2) : anchor.top - box.height - 8)) - panel.top + "px";
  }
  function showCustomerUnsavedWarning(panel, trigger) {
    const existing = panel.querySelector(".customer-editor-unsaved");
    if (existing) {
      existing.remove();
      trigger?.focus();
      return;
    }
    panel.insertAdjacentHTML("beforeend", `<div class="company-display-unsaved customer-editor-unsaved" role="alertdialog" aria-label="未保存的客户资料"><div class="company-display-unsaved-message"><svg aria-hidden="true" viewBox="0 0 48 48"><path d="M24 5 2 43h44L24 5Z" fill="#F4A127" stroke="#F4A127" stroke-width="4" stroke-linejoin="round"/><path d="M24 35v1m0-17 .008 10" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg><strong>表单中有信息未保存，是否关闭？</strong></div><div class="company-display-unsaved-actions"><button type="button" data-action="discard-customer-editor">关 闭</button><button type="button" class="primary" data-action="continue-customer-editor">继续编辑</button></div></div>`);
    const warning = panel.querySelector(".customer-editor-unsaved");
    warning._trigger = trigger || panel.querySelector('.ce-footer [data-action="close-modal"]');
    positionCustomerUnsavedWarning(warning);
    warning.querySelector('[data-action="continue-customer-editor"]').focus();
  }
  function closeModal(pointerActivated = false, confirmed = false, trigger) {
    if (pending) return;
    if (modal === "segment" && !confirmed && $("#segment-form")) {
      readSegment();
      if (segmentCloseSnapshot(segmentDraft) !== segmentInitialSnapshot) {
        showSegmentUnsavedWarning(trigger);
        return;
      }
    }
    if (modal === "edit" && !confirmed && $("#customer-form")?.dataset.hasChanges === "true") {
      showCustomerUnsavedWarning($(".customer-editor"), trigger);
      return;
    }
    if (modal === "company-display" && !confirmed) {
      const panel = $(".company-display");
      const existing = panel?.querySelector(".company-display-unsaved");
      if (existing) {
        existing.remove();
        panel.querySelector('.drawer-footer [data-action="close-modal"]')?.focus();
        return;
      }
      if (panel && JSON.stringify(companyDisplayLayoutFromPanel(panel)) !== panel.dataset.initialLayout) {
        panel.querySelector(".drawer-footer").insertAdjacentHTML("beforebegin", `<div class="company-display-unsaved" role="alertdialog" aria-label="未保存的显示设置"><div class="company-display-unsaved-message"><span aria-hidden="true">⚠</span><strong>表单中有信息未保存，是否关闭？</strong></div><div class="company-display-unsaved-actions"><button type="button" data-action="discard-company-display">关 闭</button><button type="button" class="primary" data-action="continue-company-display">继续编辑</button></div></div>`);
        panel.querySelector('[data-action="continue-company-display"]')?.focus();
        return;
      }
    }
    closeDropdowns();
    if (modal === "company-display" && companyReturnOverlay) {
      const returning = companyReturnOverlay;
      const focus = companyReturnFocus;
      companyReturnOverlay = null;
      companyReturnFocus = null;
      $("#overlay-root").replaceChildren(returning);
      modal = "edit";
      focus?.focus();
      return;
    }
    if (String(modal).startsWith("business-")) business?.discardDraft();
    if (modal === "import") importDraft = null;
    if (modal === "segment") {
      segmentDraft = null;
      segmentInitialSnapshot = null;
    }
    const root = $("#overlay-root");
    const overlay = root.querySelector?.(".overlay");
    const focusTarget = lastFocus;
    modal = null;
    filterDraft = null;
    if (pointerActivated && overlay?.classList.contains("modal-motion")) {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        overlay.remove();
        if (!root.querySelector?.(".overlay")) focusTarget?.focus();
      };
      if (!overlay.classList.contains("modal-open")) return finish();
      overlay.classList.add("modal-closing");
      overlay.classList.remove("modal-open");
      const closingDialog = overlay.querySelector('[role="dialog"]');
      if (closingDialog) {
        closingDialog.inert = true;
        closingDialog.setAttribute("aria-hidden", "true");
      }
      overlay.addEventListener("transitionend", (event) => {
        if (event.target === overlay && event.propertyName === "opacity") finish();
        else if (event.target === closingDialog && (event.propertyName === "opacity" || event.propertyName === "transform")) finish();
      });
      const duration = Math.max(...getComputedStyle(closingDialog || overlay).transitionDuration.split(",").map(value => Number.parseFloat(value) * 1000));
      setTimeout(finish, (Number.isFinite(duration) ? duration : 160) + 50);
    } else {
      root.innerHTML = "";
      focusTarget?.focus();
    }
  }
  function drawer(title, body, footer, type, pointerActivated = false) {
    closeDropdowns();
    const previousOverlay = $("#overlay-root .overlay");
    const previousPopover = $(".popover");
    if (!previousOverlay?.contains(document.activeElement))
      lastFocus = previousPopover?.contains(document.activeElement)
        ? previousPopover._trigger
        : document.activeElement;
    removePopover();
    modal = type;
    $("#overlay-root").innerHTML =
      `<div class="overlay${pointerActivated ? " modal-motion" : ""}"><section class="drawer ${["filter", "actions", "company-display", "segment"].includes(type) ? type : ""}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1"><div class="drawer-head"><h2>${title}</h2>${type === "edit" ? '<button type="button" class="text-button editor-follow" data-action="editor-follow" aria-label="关注客户" aria-pressed="false">♡</button>' : ""}<button class="text-button" data-action="close-modal" aria-label="关闭">${icon("close")}</button></div>${body}<div class="drawer-footer">${footer}</div></section></div>`;
    const dialog = $(".drawer");
    enhanceDropdowns(dialog);
    if (pointerActivated) {
      const overlay = $("#overlay-root .overlay");
      const open = () => {
        if (!overlay.isConnected || overlay.classList.contains("modal-closing") || overlay.classList.contains("modal-open")) return;
        void getComputedStyle(dialog).transform;
        overlay.classList.add("modal-open");
      };
      requestAnimationFrame(open);
      setTimeout(open, 50);
    }
    setTimeout(() => {
      if (dialog?.isConnected && !dialog.contains?.(document.activeElement)) dialog.focus();
    }, 30);
  }
  const POOL_EDIT_BLOCKED = "公海客户不能编辑（客户设置 → 公海管理）";
  // 公海规则里关掉了「显示公海联系人」时，公海客户不能编辑（编辑页会露出联系人）。
  const poolEditBlocked = (name) =>
    L.bucket(state.customers?.[name] || {}) === "pool" && !CT.poolContactsVisible(state);
  function editForm(isNew = false, pointerActivated = false, customerName = currentName) {
    if (!allow(isNew ? "customer.create" : L.bucket(state.customers?.[customerName] || {}) === "pool" ? "pool.edit" : "customer.edit")) return;
    if (!isNew && L.bucket(state.customers?.[customerName] || {}) === "trash")
      return toast("请先恢复回收站客户");
    if (!isNew && poolEditBlocked(customerName)) return toast(POOL_EDIT_BLOCKED);
    // 本人范围的账号新建客户，跟进人默认是自己，否则建完在自己的列表里就看不到了。
    const c = isNew
      ? R.scopeOf(state) === "self" && R.meName(state) ? { owner: R.meName(state) } : {}
      : allCustomerRows().find((c) => c.name === customerName) || {};
    const form = window.LaiCustomerEditor.render(c, {
      isNew,
      escape: E,
      opt,
      state,
    });
    drawer(isNew ? "新建客户" : "编辑客户", form.body, form.footer, "edit", pointerActivated);
    $(".drawer").classList.add("customer-editor");
    $(".drawer").classList.toggle("customer-create", isNew);
    setEditorFollowUI($(".drawer-head .editor-follow"), c.followed === true || c.previewFollowed === true);
    window.LaiCustomerEditor.bind?.($(".drawer"));
    const editor = $(".drawer");
    const markChanged = (e) => {
      const form = editor.querySelector("#customer-form");
      if ((e.target.form === form || e.target.closest("#customer-form") === form) &&
          (e.target.name || e.target.matches("[data-method-value],[data-method-select]")))
        form.dataset.hasChanges = "true";
    };
    editor.addEventListener("input", markChanged);
    editor.addEventListener("change", markChanged);
    $(".drawer").addEventListener("click", (e) => {
      if (["add-contact", "remove-contact", "add-method", "remove-method"].includes(e.target.closest("[data-editor-action]")?.dataset.editorAction))
        editor.querySelector("#customer-form").dataset.hasChanges = "true";
      if (e.target.closest("[data-editor-action]"))
        queueMicrotask(() => enhanceDropdowns($(".drawer")));
    });
  }
  function setEditorFollowUI(button, followed) {
    if (!button) return;
    button.textContent = followed ? "♥" : "♡";
    button.classList.toggle("is-followed", followed);
    button.setAttribute("aria-label", followed ? "取消关注客户" : "关注客户");
    button.setAttribute("aria-pressed", String(followed));
  }
  function editContact(index, pointerActivated = false) {
    editForm(false, pointerActivated);
    const card = $(`#customer-form [data-contact-card="${index}"]`);
    if (!card) return;
    card.querySelector('[name="contact"], [name="contactExtra"]')?.focus();
    card.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  function filterDetailContacts(value = $("#contact-search-input")?.value || "") {
    const input = $("#contact-search-input");
    if (!input) return;
    const query = value.trim().toLocaleLowerCase();
    $(".lcd-contacts").dataset.contactQuery = value;
    let matches = 0;
    for (const card of document.querySelectorAll(".lcd-contacts .lcd-contact")) {
      card.hidden = Boolean(query) && !card.dataset.contactSearch.toLocaleLowerCase().includes(query);
      if (!card.hidden) matches += 1;
    }
    $("#contact-search-empty").hidden = !query || matches > 0;
    $("#contact-search-status").textContent = query ? `找到 ${matches} 位联系人` : "";
    $("#contact-count-label").textContent = `联系人(${matches})`;
    $("[data-action='clear-contact-search']").hidden = !input.value;
    return matches;
  }
  function commitContactSearch() {
    const previous = [...document.querySelectorAll(".lcd-contacts .lcd-contact")].filter((card) => !card.hidden).length;
    const matches = filterDetailContacts();
    if (matches !== previous) closeContactSearch(false, false);
    else $("#contact-search-input")?.focus();
  }
  function closeContactSearch(clearQuery = true, restoreFocus = true) {
    const row = $(".lcd-contact-search-row");
    if (!row || row.hidden) return;
    if (clearQuery) {
      $("#contact-search-input").value = "";
      filterDetailContacts();
    }
    row.hidden = true;
    row.inert = true;
    const controls = row.parentElement.querySelector(".lcd-contact-search-controls");
    controls.inert = false;
    controls.removeAttribute("aria-hidden");
    const trigger = $("[data-action='contact-search']");
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger?.focus();
  }
  // 客户阶段可选值：客户设置里的阶段，加上没手填时系统按订单算出的「已成交／未成交」。
  const stageChoices = () => [...new Set([...CS.get(state).stages, "已成交", "未成交"])];
  function filterForm(pointerActivated = false) {
    if (!filterDraft) {
      filterDraft = {
        normal: { ...filters },
        advanced: structuredClone(
          advancedSpec || {
            match: "all",
            rules: [{ field: "name", op: "contains", value: "" }],
          },
        ),
      };
      filterMode = advancedSpec ? "advanced" : "normal";
    }
    const draft = filterDraft.normal;
    const field = (name, label, values) =>
      `<label class="field"><span>${label}</span>${values ? `<select name="${name}">${opt("", "请选择", draft[name] || "")}${values.map((v) => opt(v, name === "country" ? C.countryLabel(v) : v, draft[name])).join("")}</select>` : `<input name="${name}" value="${E(draft[name] || "")}" placeholder="${name === "name" || name === "email" ? "请输入" : "请选择"}">`}</label>`;
    const normal = `<div class="filter-fields">${field("name", "公司名称")}${field("email", "邮箱")}<div class="field"><span>客户标签</span><div class="tag-match-options">${["包含任一", "包含全部"].map((v) => `<label><input type="radio" name="tagMode" value="${v}" ${(draft.tagMode || "包含任一") === v ? "checked" : ""}>${v}标签</label>`).join("")}</div><input name="tag" value="${E(draft.tag || "")}" placeholder="请选择"></div>${field("customerGroup", "客户分组")}${field("alibabaIdentity", "阿里买家身份")}${field("country", "国家地区", [...new Set(rows.map((c) => c.country).filter(Boolean))].sort())}${field("source", "客户来源", [...new Set(rows.map((c) => c.source).filter(Boolean))])}${field("stage", "客户阶段", stageChoices())}${field("customerStars", "客户星级", ["1", "2", "3", "4", "5"])}<div class="field"><span>是否关注</span><div class="follow-options">${[
      ["", "不限"],
      ["false", "未关注"],
      ["true", "已关注"],
    ]
      .map(
        ([v, l]) =>
          `<label><input type="radio" name="followed" value="${v}" ${(draft.followed || "") === v ? "checked" : ""}>${l}</label>`,
      )
      .join("")}</div></div></div>`;
    const spec = filterDraft.advanced;
    const advanced = `<div class="advanced-filter"><p><select name="match">${opt("all", "满足全部条件", spec.match)}${opt("any", "满足任一条件", spec.match)}</select></p><div id="advanced-rules">${spec.rules
      .map(
        (r, i) =>
          `<div class="advanced-row" data-advanced-rule="${i}"><select data-advanced-prop="field">${S.catalog.map((f) => opt(f.id, C.catalog.find((c) => c.id === f.id)?.label || f.label, r.field)).join("")}</select><select data-advanced-prop="op">${ops(
            r.field,
          )
            .map((op) => opt(op, opLabels[op], r.op))
            .join(
              "",
            )}</select>${fieldById.get(r.field)?.type === "boolean" ? `<select data-advanced-prop="value" aria-label="条件${i + 1}值" ${["empty", "notEmpty"].includes(r.op) ? "disabled" : ""}>${opt("true", "是", String(r.value))}${opt("false", "否", String(r.value))}</select>` : `<input data-advanced-prop="value" value="${E(r.value ?? "")}" type="${r.op === "olderDays" || fieldById.get(r.field)?.type === "number" ? "number" : fieldById.get(r.field)?.type === "date" ? "date" : "text"}" ${r.op === "olderDays" || fieldById.get(r.field)?.type === "number" ? 'step="any"' : ""} ${["empty", "notEmpty"].includes(r.op) ? "disabled" : ""}>`}<button class="text-button" type="button" data-remove-advanced="${i}" aria-label="移除条件">⊖</button></div>`,
      )
      .join(
        "",
      )}</div><button type="button" class="text-button" data-action="add-advanced">＋ 添加条件</button></div>`;
    drawer(
      "筛选条件",
      `<form id="filter-form" class="drawer-body filter-body"><div class="filter-switch"><button type="button" data-filter-mode="normal" class="${filterMode === "normal" ? "active" : ""}">普通筛选</button><button type="button" data-filter-mode="advanced" class="${filterMode === "advanced" ? "active" : ""}">高级筛选</button></div>${filterMode === "normal" ? normal : advanced}<div id="filter-error" class="error" role="alert"></div></form>`,
      `<div class="filter-footer"><button class="text-button" data-action="filter-segment">将所选条件生成为客群</button><button data-action="reset-filter-form">清空</button><button class="primary" type="submit" form="filter-form">筛选</button></div>`,
      "filter",
      pointerActivated,
    );
  }
  function readAdvanced() {
    const form = $("#filter-form");
    return {
      match: form.elements.match?.value || "all",
      rules: [...form.querySelectorAll("[data-advanced-rule]")].map((el) =>
        Object.fromEntries(
          [...el.querySelectorAll("[data-advanced-prop]")].map((input) => [
            input.dataset.advancedProp,
            input.value,
          ]),
        ),
      ),
    };
  }
  async function follow(names, value) {
    if (!value && !allow("customer.unfollow")) return;
    if (names.some((name) => L.bucket(state.customers?.[name] || {}) === "trash"))
      return toast("请先恢复回收站客户");
    const next = { ...state, customers: { ...state.customers } };
    for (const n of names) {
      const old = next.customers[n] || {};
      next.customers[n] = { ...old, client: n, previewFollowed: value };
    }
    try {
      await persist(next);
      refresh();
      toast(value ? "已关注客户" : "已取消关注");
    } catch (e) {
      toast(e.message);
    }
  }
  function toggleGroupPanel(el, pointerActivated) {
    if (groupMotionTimer !== null) clearTimeout(groupMotionTimer);
    groupMotionTimer = null;
    groupsCollapsed = !groupsCollapsed;
    const panel = $(".panel");
    panel?.classList.toggle("groups-collapsed", groupsCollapsed);
    panel?.classList.toggle("groups-motion", pointerActivated);
    const viewport = $(".groups-viewport");
    if (viewport) {
      viewport.inert = groupsCollapsed;
      viewport.setAttribute("aria-hidden", String(groupsCollapsed));
    }
    el.querySelector(".collapse-groups-glyph").textContent = groupsCollapsed ? "›" : "‹";
    el.setAttribute("aria-label", groupsCollapsed ? "展开客群" : "收起客群");
    el.setAttribute("aria-expanded", String(!groupsCollapsed));
    if (pointerActivated) {
      groupMotionTimer = setTimeout(() => {
        panel?.classList.remove("groups-motion");
        groupMotionTimer = null;
      }, 320);
    }
  }
  document.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "font-weight" ||
        !e.target.matches?.(".lcd-tabs button[data-tab]")) return;
    V?.placeTabIndicator(e.target.closest(".lcd-root"));
  });
  document.addEventListener("pointerdown", (e) => {
    const searchButton = e.target.closest?.('.lcd-contact-search-row button');
    if (searchButton && !searchButton.disabled && e.button === 0) {
      // WebKit on macOS can blur to null when clicking a button. Preserve the
      // input until click commits/clears; keyboard button focus still works.
      e.preventDefault();
      return;
    }
    const el = e.target.closest?.('button[data-action="collapse-groups"]');
    if (!el || el.disabled || e.button !== 0) return;
    groupPointerPress = el;
    toggleGroupPanel(el, true);
  });
  document.addEventListener("pointerup", () => {
    if (groupPointerPress) setTimeout(() => { groupPointerPress = null; }, 0);
  });
  document.addEventListener("pointercancel", () => { groupPointerPress = null; });
  // 点弹窗外面自动关闭，但正在填写的弹窗（表单、商机、客户信息等）不关，免得填到一半丢了。
  // 按下和松手都要在外面：从里面拖到外面、或从外面拖进里面，都不算点外面。
  let overlayPressTarget = null;
  let overlayReleaseTarget = null;
  document.addEventListener("pointerdown", (e) => { overlayPressTarget = e.target; overlayReleaseTarget = null; }, true);
  document.addEventListener("pointerup", (e) => { overlayReleaseTarget = e.target; }, true);
  const closesOnOutsideClick = (overlay) =>
    modal === "columns" || modal === "feature" ||
    !["edit", "import", "segment", "company-display"].includes(modal) &&
    !overlay.querySelector('.drawer form, .drawer textarea, .drawer select, .drawer input:not([type="hidden"])');
  document.addEventListener("click", async (e) => {
    const overlay = $("#overlay-root .overlay");
    if (modal && e.target === overlay && overlayPressTarget === overlay && overlayReleaseTarget === overlay && closesOnOutsideClick(overlay))
      return closeModal(e.detail > 0);
    if (!e.target.closest?.(".lcd-tabs-more,.lcd-tabs-overflow-menu"))
      closeDetailTabOverflow();
    const el = e.target.closest("button,[data-group]");
    if (!el || el.disabled) return;
    if (el.dataset.open !== undefined)
      return openCustomer(el.dataset.open, el, e.detail > 0);
    if (el.dataset.group) {
      filters.group = el.dataset.group;
      page = 1;
      selected.clear();
      list();
      const selectedGroupButton = [...document.querySelectorAll("#app .replica-panel button[data-group]")]
        .find((button) => button.dataset.group === el.dataset.group &&
          button.classList.contains("nested") === el.classList.contains("nested"));
      selectedGroupButton?.focus({ preventScroll: true });
      if (el.dataset.toggleBranch) {
        const toggle = $(`[data-expand="${el.dataset.toggleBranch}"]`);
        toggleGroupBranch(toggle, e.detail > 0);
        $(`[data-toggle-branch="${el.dataset.toggleBranch}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (el.dataset.action === "detail-tabs-more") return toggleDetailTabOverflow();
    if (el.dataset.overflowTab) {
      const nextTab = el.dataset.overflowTab;
      switchDetailTab(nextTab, e.detail > 0);
      $(".lcd-tabs button[data-tab='" + nextTab + "']")?.focus({ preventScroll: true });
      return;
    }
    if (el.dataset.tab) return switchDetailTab(el.dataset.tab, e.detail > 0);
    if (el.dataset.documentSize) {
      const size = Number(el.dataset.documentSize);
      if (![10, 20, 50, 100].includes(size)) return;
      documentPageSize = size;
      documentPage = 1;
      closeDocumentSizeMenu(false, e.detail > 0);
      replaceDocumentResults();
      $("[data-action='document-page-size']")?.focus();
      return;
    }
    if (el.dataset.activityFilter) {
      if (tab !== "activity" || activityFilter === el.dataset.activityFilter) return;
      const c = allCustomerRows().find((row) => row.name === currentName);
      if (!c) return;
      activityFilter = el.dataset.activityFilter;
      if (activityFilter === "email") mail?.loadCustomerPanel(currentName);
      replaceActivityResults(e.detail === 0);
      window.LaiActivityCategoryNavigation.update(el, e.detail === 0);
      animateActivityResults(e.detail > 0);
      return;
    }
    if (el.dataset.activitySort) {
      const next = el.dataset.activitySort;
      if (!["newest", "oldest"].includes(next)) return;
      const changed = activitySort !== next;
      activitySort = next;
      closeActivitySortMenu(true, e.detail > 0);
      if (changed) {
        replaceActivityResults();
        animateActivityResults(e.detail > 0);
      }
      return;
    }
    if (el.dataset.follow !== undefined) {
      const c = allCustomerRows().find((c) => c.name === el.dataset.follow);
      return follow([c.name], !c.followed);
    }
    if (el.dataset.templateItem !== undefined) return insertFollowupTemplate(el.dataset.templateItem);
    const a = el.dataset.action;
    if (!a) return;
    if (a === "followup-templates") return followupTemplatePicker(el);
    if (a === "followup-templates-settings") {
      removePopover();
      csTab = "followup";
      csEditing = null;
      return customerSettings();
    }
    if (a === "toggle-info-section") {
      const id = el.dataset.infoId;
      const section = el.closest("[data-info-section]");
      if (!section || section.dataset.infoSection !== id) return;
      const closed = section.dataset.collapsed !== "true";
      if (closed) collapsedInfoSections.add(id);
      else collapsedInfoSections.delete(id);
      section.dataset.collapsed = String(closed);
      el.setAttribute("aria-expanded", String(!closed));
      el.querySelector(".lcd-caret").textContent = closed ? "›" : "⌄";
      const panel = section.querySelector(".lcd-info-panel");
      panel.setAttribute("aria-hidden", String(closed));
      panel.inert = closed;
      return;
    }
    if (a === "toggle-detail-card") {
      const id = el.dataset.cardId;
      const card = el.closest("[data-detail-card]");
      if (!card || card.dataset.detailCard !== id) return;
      setDetailCardCollapsed(card, card.dataset.collapsed !== "true");
      return;
    }
    if (a === "editor-follow") {
      const input = $("#customer-form [name='previewFollowed']");
      if (!input) return;
      const next = input.value !== "true";
      input.value = String(next);
      input.form.dataset.hasChanges = "true";
      setEditorFollowUI(el, next);
      return;
    }
    if (a === "cancel-followup") {
      followupDrafts.delete(currentName);
      detail(currentName, true);
      return;
    }
    if (a === "list") return returnToCustomerList(e.detail > 0);
    if (a === "new") return editForm(true, e.detail > 0);
    if (a === "import-customers") return importPreviewEnabled ? importCustomers(e.detail > 0) : undefined;
    if (a === "import-records") return importRecords(e.detail > 0);
    if (a === "import-record-page") {
      importRecordsPage += Number(el.dataset.pageDelta) || 0;
      renderImportRecords();
      return;
    }
    if (a === "import-failure-log") return downloadImportFailures(Number(el.dataset.recordIndex));
    if (a === "choose-import-file") return $("#customer-import-file")?.click();
    if (a === "import-template") return downloadImportTemplate();
    if (a === "import-next") return advanceImport(e.detail > 0);
    if (a === "import-back") {
      if (importDraft?.step > 1 && importDraft.step < 4) {
        importDraft.step--;
        importDraft.error = '';
        renderImportDrawer(e.detail > 0);
      }
      return;
    }
    if (a === "import-save") return saveImport(e.detail > 0);
    if (a === "edit") return editForm(false, e.detail > 0);
    if (a === "summary-fields") return summaryFieldsDialog(e.detail > 0);
    if (a === "company-display-settings") return companyDisplaySettingsDialog(e.detail > 0);
    if (a === "continue-company-display") {
      $(".company-display-unsaved")?.remove();
      $(".company-display .drawer-footer [data-action='close-modal']")?.focus();
      return;
    }
    if (a === "discard-company-display") {
      const panel = $(".company-display");
      if (panel) companyDisplayDraftCache = companyDisplayLayoutFromPanel(panel);
      return closeModal(e.detail > 0, true);
    }
    if (a === "continue-customer-editor") {
      const warning = $(".customer-editor-unsaved");
      const trigger = warning?._trigger;
      warning?.remove();
      trigger?.focus();
      return;
    }
    if (a === "discard-customer-editor") return closeModal(e.detail > 0, true);
    if (a === "continue-segment-editor") {
      const warning = $(".segment-editor-unsaved");
      const trigger = warning?._trigger;
      warning?.remove();
      trigger?.focus();
      return;
    }
    if (a === "discard-segment-editor") return closeModal(e.detail > 0, true);
    if (a === "save-company-display") {
      const panel = $(".company-display");
      if (!panel) return;
      const next = C.normalizeCompanyDisplayLayout(companyDisplayLayoutFromPanel(panel));
      return workspaceSave(() => ({ ...state, previewCompanyDisplayLayout: next }), () => {
        companyDisplayDraftCache = null;
        applyCompanyDisplayToEditor(next);
      });
    }
    if (a === "schedule-edit") return scheduleDialog(e.detail > 0);
    if (a === "schedule-view") {
      const name = currentName;
      const date = String(state.customers?.[name]?.nextFollow || "").slice(0, 10);
      let event;
      try {
        event = window.LaiBusinessModel.calendarEvents(state, date.slice(0, 7))
          .find((entry) => entry.kind === "followup" && entry.customer === name && entry.date === date);
      } catch { /* Legacy invalid dates have no calendar event. */ }
      if (!event) return toast("该日程日期无效，请重新设置");
      if (await navigateApp("calendar")) business.selectCalendarDate(event.date);
      return;
    }
    if (a === "add-contact") {
      editForm(false, e.detail > 0);
      $(".ce-add-contact")?.click();
      if (e.detail > 0)
        $("#customer-form [data-contact-card]:last-child")?.classList.add("ce-contact-enter");
      return;
    }
    if (a === "contact-search") {
      setDetailCardCollapsed($(".lcd-contacts[data-detail-card='contacts']"), false);
      const row = $(".lcd-contact-search-row");
      if (!row.hidden) return closeContactSearch();
      row.hidden = false;
      row.inert = false;
      el.setAttribute("aria-expanded", "true");
      $("#contact-search-input").focus();
      const controls = row.parentElement.querySelector(".lcd-contact-search-controls");
      controls.inert = true;
      controls.setAttribute("aria-hidden", "true");
      return;
    }
    if (a === "apply-contact-search") {
      commitContactSearch();
      return;
    }
    if (a === "activity-search") {
      const row = $("#activity-search-row");
      if (activitySearchOpen) return;
      activitySearchOpen = true;
      row.hidden = false;
      $(".lcd-activity-tools-buttons").hidden = true;
      el.setAttribute("aria-expanded", "true");
      $("#activity-search-input").focus();
      return;
    }
    if (a === "document-search") {
      documentQuery = $("#document-search-input")?.value || "";
      documentPage = 1;
      documentSelected.clear();
      replaceDocumentResults(e.detail > 0);
      $("#document-search-input")?.focus();
      return;
    }
    if (a === "toggle-operation") {
      const article = el.closest(".lcd-operation-record");
      const panel = document.getElementById(el.getAttribute("aria-controls"));
      if (!article || !panel || tab !== "history") return;
      const expanded = el.getAttribute("aria-expanded") !== "true";
      article.classList.toggle("is-expanded", expanded);
      el.setAttribute("aria-expanded", String(expanded));
      panel.setAttribute("aria-hidden", String(!expanded));
      return;
    }
    if (a === "toggle-activity-detail") {
      const article = el.closest(".lcd-activity-record");
      const panel = document.getElementById(el.getAttribute("aria-controls"));
      if (!article || !panel || tab !== "activity") return;
      const expanded = el.getAttribute("aria-expanded") !== "true";
      article.classList.toggle("lcd-activity-instant", e.detail === 0);
      article.classList.toggle("is-expanded", expanded);
      el.setAttribute("aria-expanded", String(expanded));
      panel.setAttribute("aria-hidden", String(!expanded));
      return;
    }
    if (a === "document-prev" || a === "document-next") {
      documentPage = Math.max(1, documentPage + (a === "document-next" ? 1 : -1));
      replaceDocumentResults();
      $(a === "document-next" ? "[data-action='document-next']" : "[data-action='document-prev']")?.focus();
      return;
    }
    if (a === "document-clear-selection") {
      documentSelected.clear();
      replaceDocumentResults();
      return;
    }
    if (a === "document-page-size") {
      const currentMenu = $(".document-size-menu");
      if (currentMenu && !currentMenu.classList.contains("document-size-closing"))
        return closeDocumentSizeMenu(true, e.detail > 0);
      const menu = popover(el,
        [10, 20, 50, 100].map((size) => `<button type="button" role="menuitemradio" aria-checked="${size === documentPageSize}" data-document-size="${size}">${size} 条/页</button>`).join(""),
        `document-size-menu${e.detail > 0 ? " document-size-motion" : ""}`);
      const anchor = el.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(anchor.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 16)) + "px";
      menu.style.top = (anchor.top >= menu.offsetHeight + 12
        ? anchor.top - menu.offsetHeight - 4
        : Math.min(anchor.bottom + 4, innerHeight - menu.offsetHeight - 12)) + "px";
      menu.setAttribute("role", "menu");
      el.setAttribute("aria-expanded", "true");
      if (e.detail === 0) menu.querySelector("[data-document-size]")?.focus();
      return;
    }
    if (a === "refresh-activity") return refreshActivity(e.detail > 0);
    if (a === "activity-advanced-filter") {
      const menu = $(".activity-filter-popover");
      if (menu && !menu.classList.contains("activity-filter-closing"))
        return closeActivityAdvancedFilterMenu(true, e.detail > 0);
      return activityAdvancedFilterMenu(el, e.detail > 0);
    }
    if (a === "activity-sort") {
      const currentMenu = $(".activity-sort-popover");
      if (currentMenu && !currentMenu.classList.contains("activity-sort-closing"))
        return closeActivitySortMenu(true, e.detail > 0);
      const box = popover(el,
        `<button type="button" data-activity-sort="newest" aria-pressed="${activitySort === "newest"}"><span>按最近日期排序</span>${icon("check")}</button><button type="button" data-activity-sort="oldest" aria-pressed="${activitySort === "oldest"}"><span>按最远日期排序</span>${icon("check")}</button>`,
        "activity-sort-popover",
      );
      const anchor = el.getBoundingClientRect();
      const opensAbove = anchor.bottom + 4 + box.offsetHeight > innerHeight - 12;
      box.style.top = `${Math.max(8, opensAbove ? anchor.top - box.offsetHeight - 4 : anchor.bottom + 4)}px`;
      box.style.left = `${Math.max(8, Math.min(anchor.right - box.offsetWidth, innerWidth - box.offsetWidth - 16))}px`;
      box.style.transformOrigin = opensAbove ? "left bottom" : "left top";
      box.id = "activity-sort-menu";
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", "动态排序");
      if (e.detail > 0) box.classList.add("activity-sort-popover-motion");
      el.setAttribute("aria-expanded", "true");
      box.querySelector('[aria-pressed="true"]')?.focus();
      return;
    }
    if (a === "toggle-activity-group") {
      const id = el.dataset.groupId;
      const panel = document.getElementById(el.getAttribute("aria-controls"));
      if (!panel || !id) return;
      const expanded = el.getAttribute("aria-expanded") !== "true";
      activityGroupState = { ...activityGroupState, [id]: expanded };
      el.setAttribute("aria-expanded", String(expanded));
      el.querySelector(".lcd-caret").textContent = expanded ? "⌄" : "›";
      panel.hidden = !expanded;
      return;
    }
    if (a === "apply-activity-search") return commitActivitySearch();
    if (a === "clear-activity-search") return clearActivitySearch();
    if (a === "clear-contact-search") {
      $("#contact-search-input").value = "";
      $("#contact-search-input").focus();
      commitContactSearch();
      return;
    }
    if (a === "filter") return filterForm(e.detail > 0);
    if (a === "settings") return settings(e.detail > 0);
    if (a === "close-modal") return closeModal(e.detail > 0, false, el);
    if (a === "write-followup") {
      tab = "activity";
      detail(currentName, true);
      $("#followup-text").focus();
      return;
    }
    if (a === "clear-query") {
      // 清掉筛选值时要连筛选条件一起清掉，列表立刻刷新。
      filters.query = "";
      filters.quickCountries = [];
      page = 1;
      list();
      $("#search")?.focus();
      return;
    }
    if (a === "reset-filters" || a === "reset-all") {
      Object.assign(filters, { country: "", owner: "", stage: "", tag: "" });
      team = "team";
      selected.clear();
      if (a === "reset-all")
        Object.assign(filters, {
          query: "",
          quickCountries: [],
          name: "",
          email: "",
          source: "",
          level: "",
          customerStars: "",
          customerGroup: "",
          followed: "",
          alibabaIdentity: "",
        });
      advancedSpec = null;
      page = 1;
      return list();
    }
    if (a === "reset-filter-form") {
      if (filterMode === "advanced") {
        filterDraft.advanced = {
          match: "all",
          rules: [{ field: "name", op: "contains", value: "" }],
        };
        return filterForm();
      }
      for (const field of $("#filter-form").elements) {
        if (field.type === "radio")
          field.checked =
            field.name === "tagMode"
              ? field.value === "包含任一"
              : field.value === "";
        else if (field.type === "checkbox") field.checked = false;
        else if (!["button", "submit", "reset"].includes(field.type))
          field.value = field.name === "tagMode" ? "包含任一" : "";
      }
      enhanceDropdowns($("#filter-form"));
      return;
    }
    if (a === "prev" || a === "next") {
      page += a === "prev" ? -1 : 1;
      return list();
    }
    if (a === "clear-selection") {
      selected.clear();
      return list();
    }
    if (a === "batch-follow" || a === "batch-unfollow")
      return follow([...selected], a === "batch-follow");
    if (a === "version-history")
      return drawer(
        "版本更新历史",
        window.LaiChangelog.render(),
        `<button class="primary" data-action="close-modal">知道了</button>`,
        "about",
        e.detail > 0,
      );
    if (a === "about")
      drawer(
        "关于来财Lai",
        `<div class="drawer-body"><h2>来财Lai ${APP_VERSION}</h2><p>独立的客户与经营管理软件。</p><div class="drawer-note">客户、订单、工作台、统计、日历与设置共享来财本地数据库。程序、窗口、菜单及数据目录均独立。</div><h3>使用说明</h3><p>客户客群、横向字段、跟进、公海和回收站，与订单、统计、日历使用同一套界面。所有模块共享来财本地数据。</p><h3>字体</h3><p>中文使用小米 MiSans 字体，英文和数字使用 Inter 字体。</p></div>`,
        `<button class="primary" data-action="close-modal">知道了</button>`,
        "about",
        e.detail > 0,
      );
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "contact-search-input") {
      $("[data-action='clear-contact-search']").hidden = !e.target.value;
      return;
    }
    if (e.target.id === "activity-search-input") {
      activitySearchDraft = e.target.value;
      $("[data-action='clear-activity-search']").hidden = !activitySearchDraft;
      return;
    }
    if (e.target.id === "document-search-input") {
      documentQuery = e.target.value;
      documentPage = 1;
      documentSelected.clear();
      replaceDocumentResults();
      return;
    }
    if (e.target.closest("#followup-form")) {
      const form = $("#followup-form");
      form.classList.toggle("has-draft", !!form.elements.text.value);
      followupDrafts.set(currentName, {
        text: form.elements.text.value,
        nextFollow: form.elements.nextFollow.value,
        time: form.elements.followupTime?.value || "",
      });
    }
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches?.("[data-document-select], [data-document-select-all]")) {
      if (el.hasAttribute("data-document-select-all")) {
        for (const checkbox of $("#document-results")?.querySelectorAll("[data-document-select]") || []) {
          if (el.checked) documentSelected.add(checkbox.dataset.documentSelect);
          else documentSelected.delete(checkbox.dataset.documentSelect);
        }
      } else if (el.checked) documentSelected.add(el.dataset.documentSelect);
      else documentSelected.delete(el.dataset.documentSelect);
      const key = el.dataset.documentSelect;
      replaceDocumentResults();
      if (e.detail === 0) {
        const target = key
          ? [...document.querySelectorAll("[data-document-select]")].find((item) => item.dataset.documentSelect === key)
          : $("[data-document-select-all]");
        target?.focus();
      }
      return;
    }
    if (el.id === "search" && el.tagName === "SELECT") {
      filters.query = el.value;
      filters.quickCountries = [];
      page = 1;
      list();
    } else if (el.id === "search-field") {
      filters.field = el.value;
      filters.quickCountries = [];
      filters.query = "";
      page = 1;
      list();
    } else if (el.id === "sort") {
      filters.sort = el.value;
      filters.sortField = "";
      filters.sortDirection = "";
      page = 1;
      list();
    } else if (el.id === "page-size") {
      pageSize = Number(el.value);
      page = 1;
      list();
    } else if (el.dataset.select !== undefined) {
      el.checked
        ? selected.add(el.dataset.select)
        : selected.delete(el.dataset.select);
      list();
    } else if (el.id === "select-page") {
      for (const c of M.paginate(filteredRows(), page, pageSize).items)
        el.checked ? selected.add(c.name) : selected.delete(c.name);
      list();
    }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!["customer-form", "filter-form", "followup-form"].includes(form.id))
      return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    let wantOpportunity = false;
    const saveContinue = e.submitter?.value === "continue";
    if (form.id === "customer-form") {
      if (form.dataset.oldName) {
        for (const control of form.querySelectorAll('[data-editor-date]:not([name$="Extra"])'))
          if (window.LaiCustomerEditor.isUnchangedDate(control)) delete data[control.name];
      }
      // An unchanged displayed stage may be derived from orders, not a manual value.
      if (form.dataset.oldName && data.customerStage === form.dataset.originalStage)
        delete data.customerStage;
      // 没选星级时表单带的是「0」，模型只认 1–5，空着就当没填。
      if (data.customerStars === "0") data.customerStars = "";
      const fd = new FormData(form);
      const cards = [...form.querySelectorAll("[data-contact-card]")];
      const readMethods = (card, kind) =>
        [...(card?.querySelectorAll(`[data-method-list="${kind}"] [data-method-row]`) || [])].map((row) =>
          kind === "phone"
            ? { id: row.dataset.methodId, phoneCountryCode: row.querySelector("[data-method-select]").value, phone: row.querySelector("[data-method-value]").value }
            : { id: row.dataset.methodId, socialPlatform: row.querySelector("[data-method-select]").value, socialAccount: row.querySelector("[data-method-value]").value },
        );
      data.additionalPhones = readMethods(cards[0], "phone");
      data.additionalSocialAccounts = readMethods(cards[0], "social");
      data.extraContacts = cards.slice(1).map((card) =>
        Object.fromEntries([
          ["id", card.querySelector('[name="contactIdExtra"]').value],
          ["additionalPhones", readMethods(card, "phone")],
          ["additionalSocialAccounts", readMethods(card, "social")],
          ...[
            "contact",
            "email",
            "phone",
            "address",
            "alibabaId",
            "contactPaymentMethod",
            "contactNote",
            "contactTitle",
            "contactGender",
            "socialPlatform",
            "socialAccount",
            "primaryContactMethod",
            "phoneCountryCode",
            "alternateEmail",
            "birthday",
          ].flatMap((key) => {
            const control = card.querySelector(`[name="${key}Extra"]`);
            if (key === "birthday" && form.dataset.oldName &&
                window.LaiCustomerEditor.isUnchangedDate(control)) return [];
            return control ? [[key, control.value]] : [];
          }),
        ]),
      );
      // 勾选了「同时新建商机」：客户保存成功后直接打开新建商机表单，客户已填好。
      wantOpportunity = !!fd.get("createOpportunity");
    }

    if (form.id === "filter-form") {
      if (filterMode === "advanced") {
        try {
          const spec = readAdvanced();
          S.filterByRules(rows, spec);
          advancedSpec = spec;
        } catch (error) {
          const el = $("#filter-error");
          el.textContent = error.message;
          el.classList.add("visible");
          return;
        }
      } else {
        Object.assign(filters, data);
        advancedSpec = null;
      }
      page = 1;
      closeModal();
      list();
      return;
    }
    const error = $(
      form.id === "customer-form" ? "#form-error" : "#followup-error",
    );
    error.classList.remove("visible");
    const buttons = [
      ...document.querySelectorAll("button,input,select,textarea"),
    ];
    buttons.forEach((b) => {
      b.dataset.wasDisabled = String(b.disabled);
      b.disabled = true;
    });
    try {
      if (form.id === "customer-form" && form.dataset.oldName && poolEditBlocked(form.dataset.oldName))
        throw new Error(POOL_EDIT_BLOCKED);
      if (form.id === "customer-form") {
        const oldName = form.dataset.oldName;
        R.assert(state, !oldName ? "customer.create" : L.bucket(state.customers?.[oldName] || {}) === "pool" ? "pool.edit" : "customer.edit");
        if (!oldName && R.scopeOf(state) === "self" && (!can("customer.reassign") || !String(data.owner || "").trim()))
          data.owner = R.meName(state);
        if (oldName && !can("customer.reassign")) {
          const before = String(allCustomerRows().find((row) => row.name === oldName)?.owner || "").trim();
          if (String(data.owner || "").trim() !== before) throw new Error(R.denied("customer.reassign"));
        }
      }
      const next =
        form.id === "customer-form"
          ? S.setEditorGroup(
              S.renameMember(
                M.upsertCustomer(state, form.dataset.oldName, data),
                form.dataset.oldName,
                data.name.trim(),
              ),
              data.name.trim(),
              data.previewGroup,
              form.dataset.originalGroup,
            )
          : M.addFollowup(state, currentName, data.text, data.nextFollow, CS.checkFollowupTime(state, data.followupTime));
      await persist(next);
      buttons.forEach((b) => (b.disabled = b.dataset.wasDisabled === "true"));
      if (form.id === "customer-form") {
        const editing = !!form.dataset.oldName;
        const oldName = form.dataset.oldName,
          newName = data.name.trim();
        if (oldName !== newName && followupDrafts.has(oldName)) {
          followupDrafts.set(newName, followupDrafts.get(oldName));
          followupDrafts.delete(oldName);
        }
        closeModal(false, true);
        if (editing && currentName) detail(data.name.trim(), true);
        else if (saveContinue) editForm(true);
        else list();
      } else {
        followupDrafts.delete(currentName);
        detail(currentName, true);
      }
      enhanceDropdowns($(".drawer") || $("#app"));
      toast("已保存到来财");
      if (wantOpportunity && form.id === "customer-form") business.newOpportunity(data.name.trim());
    } catch (err) {
      error.textContent = err.message;
      error.classList.add("visible");
      error.scrollIntoView({ block: "nearest" });
      buttons.forEach((b) => (b.disabled = b.dataset.wasDisabled === "true"));
    }
  });
  document.addEventListener("focusin", (e) => {
    const button = e.target.closest?.(".lcd-tabs button[data-tab]");
    const detailTabs = button?.closest(".lcd-tabs");
    if (!detailTabs || detailTabs !== $(".lcd-tabs")) return;
    const bounds = button.getBoundingClientRect();
    const tabBounds = detailTabs.getBoundingClientRect();
    if (bounds.left < tabBounds.left) detailTabs.scrollLeft -= tabBounds.left - bounds.left;
    else if (bounds.right > tabBounds.left + detailTabs.clientWidth)
      detailTabs.scrollLeft += bounds.right - tabBounds.left - detailTabs.clientWidth;
  });
  document.addEventListener("focusout", (e) => {
    const detailTabs = e.target.closest?.(".lcd-tabs");
    if (detailTabs && detailTabs === $(".lcd-tabs") && !detailTabs.contains(e.relatedTarget)) {
      V?.placeTabIndicator(detailTabs.closest(".lcd-root"));
    }
    const activityRow = e.target.closest?.(".lcd-activity-search-row");
    if (activityRow && activityRow === $(".lcd-activity-search-row") && !activityRow.hidden && !activityRow.contains(e.relatedTarget) && !activitySearchDraft) {
      closeActivitySearch();
    }
    const row = e.target.closest?.(".lcd-contact-search-row");
    if (row && row === $(".lcd-contact-search-row") && !row.hidden && !row.contains(e.relatedTarget)) {
      filterDetailContacts();
      closeContactSearch(false, false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (["contact-search-input", "activity-search-input"].includes(e.target.id) && (e.isComposing || e.keyCode === 229)) return;
    if (e.key === "Enter" && !modal && e.target.id === "activity-search-input") {
      e.preventDefault();
      commitActivitySearch();
      return;
    }
    if (e.key === "Enter" && !modal && e.target.id === "contact-search-input") {
      e.preventDefault();
      commitContactSearch();
      return;
    }
    const detailTabMore = !modal && e.target.closest?.("[data-action='detail-tabs-more']");
    if (detailTabMore && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const menu = $(".lcd-tabs-overflow-menu");
      if (!menu || menu.hidden) {
        toggleDetailTabOverflow();
        return;
      }
      const items = [...menu.querySelectorAll("[data-overflow-tab]")].filter((item) => !item.hidden);
      if (!items.length) return;
      const direction = e.key === "ArrowDown" ? 1 : -1;
      const next = detailTabOverflowCursor < 0
        ? (direction > 0 ? 0 : items.length - 1)
        : (detailTabOverflowCursor + direction + items.length) % items.length;
      setDetailTabOverflowCursor(next);
      return;
    }
    if (detailTabMore && (e.key === "Enter" || e.key === " ") && detailTabOverflowCursor >= 0) {
      const menu = $(".lcd-tabs-overflow-menu");
      if (menu && !menu.hidden) {
        e.preventDefault();
        const item = [...menu.querySelectorAll("[data-overflow-tab]")].filter((item) => !item.hidden)[detailTabOverflowCursor];
        if (item) {
          switchDetailTab(item.dataset.overflowTab, false, true);
          setDetailTabOverflowCursor(-1);
          detailTabMore.focus({ preventScroll: true });
        }
        return;
      }
    }
    if (e.key === "Escape") {
      const picker = $(".followup-template-popover");
      if (picker) {
        e.preventDefault();
        const trigger = picker._trigger;
        removePopover();
        if (trigger?.isConnected) trigger.focus();
        return;
      }
      if (closeDetailTabOverflow(true)) {
        e.preventDefault();
        return;
      }
      if (!modal && document.activeElement?.closest(".lcd-activity-search-row")) {
        e.preventDefault();
        return;
      }
      if (!modal && document.activeElement?.closest(".lcd-contact-search-row")) {
        e.preventDefault();
        closeContactSearch();
        return;
      }
      if (modal) closeModal();
      else {
        const box = $(".popover");
        const trigger = box?._trigger;
        if (box?.classList.contains("activity-sort-popover")) closeActivitySortMenu(true);
        else if (box?.classList.contains("activity-filter-popover")) closeActivityAdvancedFilterMenu(true);
        else if (box?.classList.contains("document-size-menu")) closeDocumentSizeMenu(true);
        else if (box?.classList.contains("tag-popover")) closeCustomerTagEditor(true);
        else if (box?.classList.contains("contact-menu")) closeContactMenu(true);
        else if (box?.classList.contains("global-search-scope-menu")) closeGlobalSearchScope(false, true);
        else {
          box?.remove();
          trigger?.setAttribute("aria-expanded", "false");
          if (trigger?.isConnected) trigger.focus();
        }
      }
    }
    if (e.key === "Tab" && modal) {
      const focusables = [
        ...$(".drawer").querySelectorAll("button,input,select,textarea"),
      ].filter(
        (x) => !x.disabled && x.getClientRects().length && x.tabIndex !== -1,
      );
      const first = focusables[0],
        last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  // 有没保存的修改、正在保存或写了一半的内容时，后台自动做的事（公海规则、自动记邮件）先不动，下次再做。
  const hasUnsavedWork = () =>
    !!(pending || modal || business?.hasDraft() || mail?.composeDirty() ||
      openFollowupDraft());
  // 每天自动按公海规则移一次客户；没有要移的也记下今天已执行，一天只跑一次。
  async function autoRunPoolRules() {
    try {
      if (separateCustomerWindow || hasUnsavedWork() || !CT.autoRunDue(state)) return;
      const result = CT.applyPoolRules(state);
      await persist(CT.markAutoRun(result.state));
      if (result.moved.length) {
        if (activeRoute === "customers") refresh();
        toast(`按公海规则移入 ${result.moved.length} 位客户`);
      }
    } catch (_) {
      // 这次没成功就算了，下次打开再试；不留“保存失败”的提示。
      status("");
    }
  }
  // 跟进时间不能晚于“现在”：页面开久了，“现在”也要跟着往后走。
  document.addEventListener("focusin", (event) => {
    if (event.target?.matches?.('input[name="followupTime"]')) event.target.max = window.LaiCustomerDetail.localInputTime(new Date());
  });
  // 客户设置里开了「自动记往来邮件」：把新读到的邮件一次记到对应客户的动态里，返回记了几封。
  let autoRecordingMail = false;
  async function autoRecordMails(items) {
    const since = CS.autoMailSince(state);
    if (!since || autoRecordingMail || hasUnsavedWork()) return 0;
    const plan = window.LaiMailUI.autoRecordPlan({
      customers: state.customers,
      messages: items,
      since,
      isRecorded: (name, mail) => M.mailRecorded(state, name, mail),
      isActive: (profile) => L.bucket(profile) === "active",
    });
    if (!plan.length) return 0;
    autoRecordingMail = true;
    try {
      let next = state, count = 0;
      for (const { name, mail } of plan) {
        try { next = M.addMailActivity(next, name, mail); count++; } catch (_) { /* 记不了的跳过 */ }
      }
      if (!count) return 0;
      await persist(next);
      toast(`已自动记录 ${count} 封邮件到客户动态`);
      return count;
    } catch (_) {
      return 0;
    } finally {
      autoRecordingMail = false;
    }
  }
  async function boot() {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) throw new Error("本地数据服务连接失败");
      const payload = await response.json();
      if (!payload.data || !Array.isArray(payload.data.orders) || !payload.data.customers)
        throw new Error("客户数据格式不完整");
      adoptServerState(payload.data, payload.revision);
      applyTheme(state.laiSettings?.theme);
      rebuildRows();
      // 上次的自动备份没成功时，一打开就提示（网页试用版没有备份，不查）。
      if (!window.LaiWebTrial)
        fetch("/api/backup-status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => updateBackupNotice(d?.backup)).catch(() => {});
      const initialCustomer = new URLSearchParams(location.search).get("customer");
      if (location.hash === "#favorites") await openFavorites();
      else await navigateApp(location.hash.slice(1) || "customers", initialCustomer, false);
      await autoRunPoolRules();
      // 绑定了邮箱就开始定时检查新邮件（没绑定或关掉了自动检查时什么也不做）。
      mail?.start().catch(() => {});
    } catch (err) {
      $("#app").innerHTML =
        `<div class="boot"><div><h3>暂时无法载入客户</h3><p>${E(err.message)}</p><p class="muted tiny">请关闭后重新打开来财Lai。</p></div></div>`;
    }
  }
  // Customer segments and persistent horizontal table preferences.
  const fieldById = new Map(C.catalog.map((f) => [f.id, f]));
  const segmentOriginalDateValues = new WeakMap();
  let expanded = new Set(),
    columnDraft = null,
    segmentDraft = null,
    segmentInitialSnapshot = null,
    segmentIsNew = false;
  const segmentList = () => state.previewSegments || [];
  const tablePrefs = () => ({
    ...{ striped: true, compact: true, verticalLines: true },
    ...state.previewTable,
    ...C.normalizeColumns(state.previewTable),
  });
  function groupRows(id) {
    if (id.startsWith("segment:"))
      return S.resolveMembers(
        rows,
        segmentList().find((s) => s.id === id.slice(8)),
      );
    if (id.startsWith("country:"))
      return rows.filter((row) => row.orderCount > 0 && C.countryLabel(row.country) === id.slice(8));
    if (id === "lapsed")
      return S.filterByRules(rows, {
        rules: [{ field: "latestOrderDate", op: "olderDays", value: 45 }],
      });
    return M.filterCustomers(rows, { group: id });
  }
  function filteredRows() {
    let result = C.filter(groupRows(filters.group), filters);
    result = C.globalCustomerSearch(result, globalSearch);
    if (advancedSpec) result = S.filterByRules(result, advancedSpec);
    result = M.filterCustomers(result, { sort: filters.sort, group: "all" });
    return filters.sortField
      ? C.sortRows(result, filters.sortField, filters.sortDirection)
      : result;
  }

  function customerLevelForRow(c) {
    return c.displayLevel ?? M.customerLevelForRow(c);
  }

  function levelIconClass(level) {
    return (
      {
        "A级钻石客户": "level-a",
        "B级翡翠客户": "level-b",
        "C级白金客户": "level-c",
        "D级黄金客户": "level-d",
        "E级白银客户": "level-e",
        "F级青铜客户": "level-f",
      }[level] || "level-custom"
    );
  }

  const plainNumberFields = new Set([
    "customerStars", "score", "contactCount", "orderCount",
    "opportunityCount", "activeOpportunityCount", "poolEntryCount",
  ]);
  function booleanLabel(value) {
    if (value === true || value === "true") return "是";
    if (value === false || value === "false") return "否";
    return "—";
  }
  function displayCell(c, f) {
    if (f.id === "name") {
      const customerLevel = customerLevelForRow(c);
      const badge = customerLevel ? `<span class="level-icon ${levelIconClass(customerLevel)}" aria-label="客户等级：${E(customerLevel)}" title="客户等级：${E(customerLevel)}"></span>` : '';
      return `${badge}<button class="company-link" data-open="${E(c.name)}" title="${E(c.name)}">${E(c.name)}</button>`;
    }
    if (f.id === "level") return E(customerLevelForRow(c) || '—');
    if (f.id === "tags")
      return (
        c.tags.map((t) => `<span class="tag">${E(t)}</span>`).join("") || "—"
      );
    if (f.id === "country") return E(C.countryLabel(c.country));
    if (f.type === "boolean") return booleanLabel(c[f.id]);
    if (f.type === "date") return E(date(c[f.id]));
    if (f.type === "number") {
      if (c[f.id] === undefined || c[f.id] === null || c[f.id] === "") return "—";
      const numeric = Number(c[f.id]);
      if (!Number.isFinite(numeric)) return "—";
      return plainNumberFields.has(f.id) ? String(numeric) : money(numeric);
    }
    return E(Array.isArray(c[f.id]) ? c[f.id].length ? c[f.id].join("、") : "—" : c[f.id] || "—");
  }
  function tableMarkup(p) {
    // 新界面（粉色、橙色）的选择列收窄：只放一个复选框，不需要 84px
    const selectionWidth = document.documentElement.dataset.skin === "glass" ? 48 : 84, actionsWidth = 52;
    const prefs = tablePrefs(),
      fields = prefs.order.map((id) => ({
        ...fieldById.get(id),
        width:
          fieldById.get(id).width * (prefs.compactWidth === false ? 1.25 : 1),
      }));
    let offset = selectionWidth;
    const attrs = new Map(
      fields.map((f) => {
        const freeze = prefs.frozen.includes(f.id),
          left = offset;
        if (freeze) offset += f.width;
        return [
          f.id,
          `class="${freeze ? "frozen" : ""}" style="width:${f.width}px;${freeze ? "left:" + left + "px;" : ""}"`,
        ];
      }),
    );
    const sourceUnsortableFields = new Set(["contact", "tags", "owner", "latestActivity"]);
    const headerCell = (field) => {
      if (sourceUnsortableFields.has(field.id)) {
        return `<th ${attrs.get(field.id)}><span class="column-header column-header-static"><span class="column-header-flow"><span class="column-label" title="${E(field.label)}">${E(field.label)}</span></span></span></th>`;
      }
      const direction = filters.sortField === field.id ? filters.sortDirection : "";
      const sortAttribute = direction
        ? ` aria-sort="${direction === "desc" ? "descending" : "ascending"}"`
        : "";
      return `<th ${attrs.get(field.id)}${sortAttribute}><button type="button" class="column-header" data-sort-field="${field.id}" aria-label="按${E(field.label)}排序${direction ? `，当前${direction === "asc" ? "升序" : "降序"}` : ""}" aria-pressed="${Boolean(direction)}"><span class="column-header-flow"><span><span class="column-label" title="${E(field.label)}">${E(field.label)}</span></span><span class="column-sort" aria-hidden="true"><span class="sort-up ${direction === "asc" ? "active" : ""}"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m12 29 12-12 12 12H12Z" stroke-width="4" stroke-linejoin="round" fill="currentColor" stroke="currentColor"/></svg></span><span class="sort-down ${direction === "desc" ? "active" : ""}"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M36 19 24 31 12 19h24Z" stroke-width="4" stroke-linejoin="round" fill="currentColor" stroke="currentColor"/></svg></span></span></span></button></th>`;
    };
    const tooltip = (c, f) => f.id === "level" ? customerLevelForRow(c)
      : f.type === "boolean" ? booleanLabel(c[f.id])
      : Array.isArray(c[f.id]) ? c[f.id].join("、") : (c[f.id] ?? "");
    const body = p.items.map((c) => `<tr><td class="check-col frozen" style="left:0"><input type="checkbox" data-select="${E(c.name)}" aria-label="选择 ${E(c.name)}" ${selected.has(c.name) ? "checked" : ""}></td>${fields.map((f) => `<td ${attrs.get(f.id)} title="${E(tooltip(c, f))}">${displayCell(c, f)}</td>`).join("")}<td class="actions-col"><button class="text-button row-more" data-row-more="${E(c.name)}" aria-label="${E(c.name)}的操作">⋮</button></td></tr>`).join("");
    return `<table class="customer-table ${prefs.striped ? "striped" : ""} ${prefs.compact ? "compact" : ""} ${prefs.verticalLines ? "vertical-lines" : ""}" style="width:${fields.reduce((n, f) => n + f.width, selectionWidth + actionsWidth)}px"><colgroup><col style="width:${selectionWidth}px">${fields.map((f) => `<col style="width:${f.width}px">`).join("")}<col style="width:${actionsWidth}px"></colgroup><thead><tr><th class="check-col frozen" style="left:0"><input type="checkbox" aria-label="选择本页客户" id="select-page" ${p.items.length && p.items.every((c) => selected.has(c.name)) ? "checked" : ""}></th>${fields.map((f) => headerCell(f)).join("")}<th class="actions-col">操作</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  function settings(pointerActivated = false) {
    columnDraft = tablePrefs();
    renderColumns(pointerActivated);
  }
  function renderColumns(pointerActivated = false) {
    const d = columnDraft;
    drawer(
      "设置「全部客户」显示字段",
      `<div class="drawer-body columns-body"><div class="columns-layout"><section><div class="column-search-wrap">${icon("search")}<input id="column-search" aria-label="搜索字段名称" placeholder="可输入字段搜索"></div><h3>可选字段</h3><div class="available-fields">${[
        ...new Set(C.catalog.map((f) => f.category)),
      ]
        .map(
          (cat) =>
            `<h4>${E(cat)}</h4>${C.catalog
              .filter((f) => f.category === cat)
              .map(
                (f) =>
                  `<label data-field-label="${E(f.label)}"><input type="checkbox" data-column-toggle="${f.id}" ${d.order.includes(f.id) ? "checked" : ""} ${f.id === "name" ? "disabled" : ""}>${E(f.label)}</label>`,
              )
              .join("")}`,
        )
        .join("")}</div></section><section><h3>已选字段</h3>${[
        "冻结列",
        "非冻结列",
      ]
        .map(
          (title, j) =>
            `<h4>${title}</h4><div class="selected-fields">${d.order
              .filter((id) => d.frozen.includes(id) === (j === 0))
              .map(
                (id) =>
                  `<div class="selected-field" draggable="${id !== "name"}" data-drag-field="${id}"><span class="drag-handle" aria-hidden="true"><svg viewBox="0 0 48 48" width="16" height="16" fill="currentColor" focusable="false"><path d="M19 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm22-32a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg></span><span>${E(fieldById.get(id).label)}</span>${id === "name" ? "" : `<button class="text-button" data-column-move="${id}" data-step="-1" aria-label="上移${E(fieldById.get(id).label)}">↑</button><button class="text-button" data-column-move="${id}" data-step="1" aria-label="下移${E(fieldById.get(id).label)}">↓</button><button class="text-button freeze-button" data-column-freeze="${id}" aria-label="${j === 0 ? "取消冻结" : "冻结"}${E(fieldById.get(id).label)}">${j === 0 ? "取消冻结" : "冻结"}</button><button class="text-button" data-column-remove="${id}" aria-label="移除${E(fieldById.get(id).label)}">×</button>`}</div>`,
              )
              .join("")}</div>`,
        )
        .join(
          "",
        )}</section></div><div class="error" id="workspace-error" role="alert"></div></div>`,
      `<button data-action="close-modal">取消</button><button data-action="save-columns-all">确定并应用到其它客群</button><button class="primary" data-action="save-columns">确定</button>`,
      "columns",
      pointerActivated,
    );
    $(".drawer").classList.add("center-dialog", "columns-dialog");
  }
  const opLabels = {
    eq: "等于",
    neq: "不等于",
    contains: "包含",
    containsAny: "包含任一标签",
    containsAll: "包含全部标签",
    notContains: "不包含",
    empty: "为空",
    notEmpty: "不为空",
    gte: "大于等于",
    lte: "小于等于",
    before: "早于",
    after: "晚于",
    olderDays: "距今超过（天）",
  };
  function ops(field) {
    return field === "tags"
      ? ["eq", "neq", "contains", "containsAny", "containsAll", "notContains", "empty", "notEmpty"]
      : fieldById.get(field)?.type === "boolean"
        ? ["eq", "neq", "empty", "notEmpty"]
      : fieldById.get(field)?.type === "number"
      ? ["eq", "neq", "gte", "lte", "empty", "notEmpty"]
      : fieldById.get(field)?.type === "date"
        ? ["eq", "neq", "before", "after", "olderDays", "empty", "notEmpty"]
        : ["eq", "neq", "contains", "notContains", "empty", "notEmpty"];
  }
  function segmentEditor(id, kind = "rules", rules, match = "all", pointerActivated = false) {
    const old = segmentList().find((s) => s.id === id);
    segmentIsNew = !old;
    segmentDraft = old
      ? structuredClone(old)
      : {
          id: crypto.randomUUID(),
          name: "",
          kind,
          match,
          rules: rules || [{ field: "country", op: "contains", value: "" }],
          members: [],
        };
    segmentInitialSnapshot = segmentCloseSnapshot(segmentDraft);
    renderSegment(pointerActivated);
  }
  function segmentCloseSnapshot(draft) {
    let rules = draft.kind === "rules" ? (draft.rules || []).map(rule => ({
      field: rule.field, op: rule.op,
      value: ["empty", "notEmpty"].includes(rule.op) ? "" : String(rule.value ?? ""),
    })) : [];
    // New forms start with implicit empty country rows, unlike explicitly chosen conditions.
    if (segmentIsNew) rules = rules.filter(rule =>
      rule.field !== "country" || rule.op !== "contains" || rule.value !== "");
    const noRules = draft.kind === "rules" && !draft.rules?.length;
    return JSON.stringify({
      name: draft.name || "", kind: draft.kind, rules, noRules,
      match: segmentIsNew && !draft.name && !rules.length && !noRules ? null : draft.match || "all",
    });
  }
  function showSegmentUnsavedWarning(trigger) {
    const panel = $(".drawer.segment");
    const existing = panel.querySelector(".segment-editor-unsaved");
    if (existing) { existing.remove(); trigger?.focus(); return; }
    panel.insertAdjacentHTML("beforeend", `<div class="company-display-unsaved segment-editor-unsaved" role="alertdialog" aria-label="未保存的客群"><div class="company-display-unsaved-message"><svg aria-hidden="true" viewBox="0 0 48 48"><path d="M24 5 2 43h44L24 5Z" fill="#F4A127" stroke="#F4A127" stroke-width="4" stroke-linejoin="round"/><path d="M24 35v1m0-17 .008 10" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg><strong>表单中有信息未保存，是否关闭？</strong></div><div class="company-display-unsaved-actions"><button type="button" data-action="discard-segment-editor">关 闭</button><button type="button" class="primary" data-action="continue-segment-editor">继续编辑</button></div></div>`);
    const warning = panel.querySelector(".segment-editor-unsaved");
    warning._trigger = trigger || panel.querySelector('.drawer-footer [data-action="close-modal"]');
    positionCustomerUnsavedWarning(warning, panel, 18);
    warning.querySelector('[data-action="continue-segment-editor"]').focus();
  }
  function segmentRuleInputType(field, rule) {
    if (rule.op === "olderDays" || field.type === "number") return "number";
    if (field.type !== "date") return "text";
    const original = segmentOriginalDateValues.get(rule);
    if (original?.field === rule.field) return original.inputType;
    // The model also accepts dates that native date inputs cannot display.
    // Keep those original values visible instead of letting the browser erase them.
    const value = String(rule.value ?? "");
    if (!value) return "date";
    const probe = document.createElement("input");
    probe.type = "date";
    probe.value = value;
    return probe.value === value ? "date" : "text";
  }
  function renderSegment(pointerActivated = false, enteringRule = -1) {
    const d = segmentDraft;
    // Accepted historical groups may omit match; other invalid values stay invalid.
    const match = d.match === undefined ? "all" : d.match;
    const previousScroll = $("#segment-form")?.scrollTop || 0;
    drawer(
      segmentList().some((s) => s.id === d.id) ? "编辑客群" : "新建客群",
      `<form id="segment-form" class="drawer-body"><div class="form-grid"><label class="field wide">客群名称<input name="name" value="${E(d.name)}" required maxlength="80" placeholder="如：美国重点客户"></label><label class="field">客群类型<select name="kind" ${segmentList().some((s) => s.id === d.id) ? "disabled" : ""}>${opt("rules", "条件客群 · 自动更新", d.kind)}${opt("manual", "手动分组 · 指定成员", d.kind)}</select></label></div>${
        d.kind === "rules"
          ? `<fieldset class="segment-match"><legend>条件规则</legend><div class="segment-match-options"><label><input type="radio" name="match" value="all" ${match === "all" ? "checked" : ""}><span>满足全部条件</span></label><label><input type="radio" name="match" value="any" ${match === "any" ? "checked" : ""}><span>满足任一条件</span></label></div></fieldset><div id="rules">${d.rules
              .map((r, i) => {
                const f = fieldById.get(r.field);
                const disabled = ["empty", "notEmpty"].includes(r.op) ? "disabled" : "";
                const valueControl = f.type === "boolean"
                  ? `<select data-rule-prop="value" aria-label="条件${i + 1}值" ${disabled}>${opt("true", "是", String(r.value))}${opt("false", "否", String(r.value))}</select>`
                  : `<input data-rule-prop="value" aria-label="条件${i + 1}值" type="${segmentRuleInputType(f, r)}" value="${E(r.value ?? "")}" ${r.op === "olderDays" || f.type === "number" ? 'step="any"' : ""} ${disabled}>`;
                return `<div class="rule-row" data-rule="${i}"><span class="rule-index" aria-hidden="true">${i + 1}</span><select data-rule-prop="field" aria-label="条件${i + 1}字段">${S.catalog.map((f) => opt(f.id, f.label, r.field)).join("")}</select><select data-rule-prop="op" aria-label="条件${i + 1}运算">${ops(
                  r.field,
                )
                  .map((op) => opt(op, opLabels[op], r.op))
                  .join(
                    "",
                  )}</select>${valueControl}<button type="button" class="text-button rule-remove" data-remove-rule="${i}" aria-label="删除条件${i + 1}">${icon("minusCircle")}</button></div>`;
              })
              .join(
                "",
              )}</div><button type="button" class="text-button segment-add-rule" data-action="add-rule">${icon("plusCircle")}添加条件</button><div class="match-preview" id="match-preview"></div>`
          : `<div class="drawer-note rule-title">创建后，在客户列表勾选客户，通过“加入客群”添加成员。已有 ${d.members.length} 位成员。</div>`
      }<div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button data-action="close-modal">取消</button><button class="primary" type="submit" form="segment-form">保存客群</button>`,
      "segment",
      pointerActivated && enteringRule < 0,
    );
    const form = $("#segment-form");
    for (const input of form?.querySelectorAll('[data-rule-prop="value"]') || []) {
      const rule = d.rules[Number(input.closest("[data-rule]").dataset.rule)];
      if (fieldById.get(rule.field)?.type === "date" && rule.op !== "olderDays" &&
          !segmentOriginalDateValues.has(rule)) {
        // Keep the model value paired with the actual first-rendered control value.
        // Single-line text inputs also remove CR/LF; that is not a user edit.
        segmentOriginalDateValues.set(rule, {
          field: rule.field, op: rule.op, value: rule.value, displayed: input.value,
          inputType: input.type,
        });
      }
    }
    if (form) form.scrollTop = previousScroll;
    if (enteringRule >= 0)
      form?.querySelector(`[data-rule="${enteringRule}"] [data-rule-prop="value"]`)?.focus();
    updateMatch();
  }
  function readSegment() {
    const form = $("#segment-form");
    if (!form) return;
    segmentDraft.name = form.elements.name.value;
    segmentDraft.kind = form.elements.kind.value;
    if (form.elements.match) segmentDraft.match = form.elements.match.value;
    for (const el of form.querySelectorAll("[data-rule-prop]")) {
      const rule = segmentDraft.rules[Number(el.closest("[data-rule]").dataset.rule)];
      const original = segmentOriginalDateValues.get(rule);
      if (el.dataset.ruleProp === "value" && original &&
          rule.field === original.field && rule.op === original.op &&
          el.value === original.displayed) {
        rule.value = original.value;
        continue;
      }
      rule[el.dataset.ruleProp] = el.value;
    }
  }
  function updateMatch() {
    const el = $("#match-preview");
    if (!el) return;
    try {
      el.textContent = `当前匹配 ${S.filterByRules(rows, segmentDraft).length} 个客户 · 保存后随资料变化自动更新`;
    } catch {
      el.textContent = "填写完整条件后显示匹配人数";
    }
  }
  function manageSegments(pointerActivated = false) {
    drawer(
      "管理客群",
      `<div class="drawer-body"><p class="drawer-note">归档仅隐藏客群，不删除客户。系统客群根据现有客户资料自动统计。</p><div class="segment-management">${
        segmentList()
          .map(
            (s) =>
              `<div><span><strong>${E(s.name)}</strong><small>${s.kind === "rules" ? "条件客群" : "手动分组"} · ${s.archived ? "已归档" : S.resolveMembers(rows, s).length + " 位客户"}</small></span>${s.archived ? `<button data-restore-segment="${E(s.id)}">恢复</button>` : `<button data-edit-segment="${E(s.id)}">编辑</button><button data-archive-segment="${E(s.id)}">归档</button>`}</div>`,
          )
          .join("") || '<div class="empty">暂无自定义客群，点击下方新建。</div>'
      }</div><div class="error" id="workspace-error" role="alert"></div></div>`,
      `<button data-action="new-manual">新建分组</button><button class="primary" data-action="new-segment">新建条件客群</button>`,
      "manage",
      pointerActivated,
    );
  }
  function membershipDialog(mode, pointerActivated = false) {
    const groups = segmentList().filter(
      (s) => !s.archived && s.kind === "manual",
    );
    drawer(
      mode === "add" ? "加入客群" : "移出客群",
      `<form id="membership-form" class="drawer-body" data-mode="${mode}"><p>已选择 ${selected.size} 位客户</p><label class="field">选择手动分组<select name="segment" required>${groups.map((s) => opt(s.id, s.name, filters.group.slice(8))).join("")}</select></label>${groups.length ? "" : '<p class="muted">请先新建一个手动分组。</p>'}<div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button data-action="new-manual">新建分组</button><button class="primary" type="submit" form="membership-form" ${groups.length ? "" : "disabled"}>确定</button>`,
      "membership",
      pointerActivated,
    );
  }
  function summaryFieldsDialog(pointerActivated = false) {
    const detail = window.LaiCustomerDetail;
    const chosen = new Set(detail.normalizeSummaryFields(state.previewDetailSummaryFields));
    drawer(
      "客户摘要字段设置",
      `<form id="summary-fields-form" class="drawer-body columns-body summary-fields-form"><div class="columns-layout summary-fields-layout"><section><div class="column-search-wrap">${icon("search")}<input id="summary-field-search" type="search" aria-label="搜索摘要字段名称" placeholder="可输入字段搜索" autocomplete="off"></div><h3>可选字段</h3><fieldset><legend class="summary-options-heading">显示字段</legend><div class="available-fields summary-options">${detail.summaryFieldOptions.map(({id,label}) => `<label><input type="checkbox" name="summaryField" value="${E(id)}" ${chosen.has(id) ? "checked" : ""}><span>${E(label)}</span></label>`).join("")}</div></fieldset><p class="summary-search-empty" hidden>未找到字段</p></section><section class="summary-selected" aria-label="已选摘要字段"><h3>已选 <span id="summary-selected-count"></span></h3><ul id="summary-selected-fields"></ul><p class="summary-settings-scope">设置对所有客户生效</p></section></div><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" id="reset-summary-fields">恢复默认</button><button type="button" data-action="close-modal">取消</button><button type="submit" form="summary-fields-form" class="primary">保存</button>`,
      "actions",
      pointerActivated,
    );
    $(".drawer").classList.add("center-dialog", "summary-dialog");
    const form = $("#summary-fields-form");
    const updateSelection = () => {
      const fields = [...form.querySelectorAll('[name="summaryField"]:checked')].map((input) => input.value);
      $("#summary-selected-count").textContent = String(fields.length);
      $("#summary-selected-fields").innerHTML = fields.map((id) => `<li data-summary-selected="${E(id)}">${E(detail.summaryFieldOptions.find((field) => field.id === id).label)}</li>`).join("");
    };
    form.addEventListener("change", (event) => {
      if (event.target.name === "summaryField") updateSelection();
    });
    $("#summary-field-search").addEventListener("input", (event) => {
      const query = M.norm(event.target.value);
      const labels = [...form.querySelectorAll(".summary-options label")];
      labels.forEach((label) => { label.hidden = !M.norm(label.textContent).includes(query); });
      $(".summary-search-empty").hidden = labels.some((label) => !label.hidden);
    });
    updateSelection();
    $("#reset-summary-fields").addEventListener("click", () => {
      const defaults = new Set(detail.defaultSummaryFields);
      form.querySelectorAll('[name="summaryField"]').forEach((input) => {
        input.checked = defaults.has(input.value);
      });
      $("#workspace-error").textContent = "";
      updateSelection();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const fields = [...form.querySelectorAll('[name="summaryField"]:checked')]
        .map((input) => input.value);
      if (!fields.length) {
        const error = $("#workspace-error");
        error.textContent = "请至少保留一个摘要字段";
        error.classList.add("visible");
        return;
      }
      workspaceSave(() => ({ ...state, previewDetailSummaryFields: fields }));
    });
  }
  function applyCompanyDisplayToEditor(layout) {
    const form = $("#customer-form");
    if (!form) return;
    for (const [group, ids] of Object.entries(layout)) {
      const holder = form.querySelector(`[data-company-${group}]`);
      if (!holder) continue;
      for (const id of ids) {
        const field = form.querySelector(`[data-company-field="${id}"]`);
        if (field) holder.append(field);
      }
    }
  }
  function companyDisplaySettingsDialog(pointerActivated = false) {
    const labels = new Map(C.companyDisplayFields.map((field) => [field.id, field]));
    const layout = companyDisplayDraftCache || C.normalizeCompanyDisplayLayout(state.previewCompanyDisplayLayout);
    if (modal === "edit") {
      companyReturnOverlay = $("#overlay-root .overlay");
      companyReturnFocus = document.activeElement;
    }
    const rows = (group) => layout[group].map((id) => {
      const field = labels.get(id);
      return `<li class="company-display-row${field.required ? " is-required" : ""}" draggable="true" tabindex="0" data-company-field-id="${id}"><span class="company-display-grip" aria-hidden="true">⋮⋮</span><span>${E(field.label)}</span>${field.required ? '<span class="company-display-lock" aria-label="必填字段">*</span>' : `<button type="button" data-company-move="${id}" aria-label="移至${group === "common" ? "公司其它信息" : "公司常用信息"}" title="移至${group === "common" ? "公司其它信息" : "公司常用信息"}">⇄</button>`}</li>`;
    }).join("");
    drawer("显示设置", `<div class="drawer-body company-display-body"><p class="company-display-note"><svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 7v4M8 4.5v.5" stroke="white" stroke-width="1.5"/></svg><span>编辑时设置为「常用信息」的字段默认显示；「其他信息」字段默认隐藏，但可点击「展开更多信息」填写。</span></p><section><h3>公司常用信息</h3><ul data-company-list="common">${rows("common")}</ul></section><section><h3>公司其它信息</h3><ul data-company-list="other">${rows("other")}</ul></section><div id="workspace-error" class="error" role="alert"></div></div>`, `<button type="button" data-action="close-modal">取消</button><button type="button" class="primary" data-action="save-company-display">确定</button>`, "company-display", pointerActivated);
    const panel = $(".company-display");
    panel.dataset.initialLayout = JSON.stringify(layout);
    const motionStyle = getComputedStyle(panel);
    const easing = motionStyle.getPropertyValue("--ease-out").trim();
    const reorderDuration = parseFloat(motionStyle.getPropertyValue("--motion-field-reorder"));
    const moveDuration = parseFloat(motionStyle.getPropertyValue("--motion-normal"));
    const move = (id, targetGroup, beforeId = "", animate = false) => {
      const row = panel.querySelector(`[data-company-field-id="${id}"]`);
      const list = panel.querySelector(`[data-company-list="${targetGroup}"]`);
      if (!row || !list || labels.get(id).required && targetGroup !== "common") return;
      const sameGroup = row.parentElement === list;
      if (sameGroup && beforeId === id) return;
      const canAnimate = animate;
      const beforeRects = canAnimate && sameGroup
        ? new Map([...list.children].map((item) => [item, item.getBoundingClientRect()]))
        : null;
      if (canAnimate) panel.querySelectorAll(".company-display-row").forEach((item) => {
        for (const animation of item.getAnimations())
          if (animation.effect?.getKeyframes().some((frame) => frame.transform)) animation.cancel();
      });
      const before = beforeId && beforeId !== id ? list.querySelector(`[data-company-field-id="${beforeId}"]`) : null;
      list.insertBefore(row, before);
      if (!labels.get(id).required) {
        const button = row.querySelector("[data-company-move]");
        const opposite = targetGroup === "common" ? "公司其它信息" : "公司常用信息";
        button?.setAttribute("aria-label", `移至${opposite}`);
        button?.setAttribute("title", `移至${opposite}`);
      }
      row.focus({ preventScroll: sameGroup && canAnimate });
      if (canAnimate && sameGroup) {
        for (const [item, oldRect] of beforeRects) {
          const dy = oldRect.top - item.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) continue;
          item.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
            { duration: reorderDuration, easing });
        }
      } else if (canAnimate) {
        row.animate([{ transform: "translateY(-8px)", opacity: .72 }, { transform: "translateY(0)", opacity: 1 }],
          { duration: moveDuration, easing });
      }
    };
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-company-move]");
      if (!button) return;
      const row = button.closest("[data-company-field-id]");
      move(row.dataset.companyFieldId, row.parentElement.dataset.companyList === "common" ? "other" : "common", "", event.detail > 0);
    });
    panel.addEventListener("keydown", (event) => {
      const row = event.target.closest("[data-company-field-id]");
      if (!row || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const id = row.dataset.companyFieldId;
      const group = row.parentElement.dataset.companyList;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        move(id, group === "common" ? "other" : "common");
      } else if (event.key === "ArrowUp" && row.previousElementSibling) {
        row.parentElement.insertBefore(row, row.previousElementSibling); row.focus();
      } else if (event.key === "ArrowDown" && row.nextElementSibling) {
        row.parentElement.insertBefore(row.nextElementSibling, row); row.focus();
      }
    });
    panel.addEventListener("dragstart", (event) => {
      const row = event.target.closest("[data-company-field-id]");
      if (!row) return;
      event.dataTransfer.setData("text/plain", row.dataset.companyFieldId);
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("is-dragging");
    });
    panel.addEventListener("dragend", () => panel.querySelectorAll(".is-dragging,.is-drop-target").forEach((el) => el.classList.remove("is-dragging", "is-drop-target")));
    panel.addEventListener("dragover", (event) => {
      const list = event.target.closest("[data-company-list]");
      if (!list) return;
      event.preventDefault();
      panel.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      (event.target.closest("[data-company-field-id]") || list).classList.add("is-drop-target");
    });
    panel.addEventListener("drop", (event) => {
      const list = event.target.closest("[data-company-list]");
      if (!list) return;
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain");
      if (!labels.has(id)) return;
      const target = event.target.closest("[data-company-field-id]");
      const afterTarget = target && event.clientY >= target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      const beforeId = afterTarget ? target.nextElementSibling?.dataset.companyFieldId : target?.dataset.companyFieldId;
      move(id, list.dataset.companyList, beforeId, true);
      panel.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    });
  }
  function scheduleDialog(pointerActivated = false) {
    if (!allow("customer.edit")) return;
    const name = currentName;
    const savedDate = String(state.customers?.[name]?.nextFollow || "").slice(0, 10);
    if (!allCustomerRows().some((row) => row.name === name)) return toast("客户不存在");
    drawer(
      savedDate ? "调整客户跟进日程" : "安排客户跟进日程",
      `<form id="customer-schedule-form" class="drawer-body batch-tags-form"><p class="batch-tags-count">客户：<strong>${E(name)}</strong></p><label class="field" for="customer-schedule-date"><span>下次跟进日期</span><input id="customer-schedule-date" type="date" name="date" value="${E(savedDate)}" required></label><p class="muted tiny">保存后同步更新客户详情、列表和来财日历；不会新增一条已完成的跟进记录。</p><div id="workspace-error" class="error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button>${savedDate ? '<button type="button" id="clear-customer-schedule">清除日期</button>' : ""}<button type="submit" form="customer-schedule-form" class="primary">保存日程</button>`,
      "actions",
      pointerActivated,
    );
    $("#customer-schedule-form").addEventListener("submit", (event) => {
      event.preventDefault();
      workspaceSave(() => M.setCustomerNextFollow(state, name, event.currentTarget.elements.date.value));
    });
    $("#clear-customer-schedule")?.addEventListener("click", () => {
      workspaceSave(() => M.setCustomerNextFollow(state, name, ""));
    });
  }
  function batchScheduleDialog(pointerActivated = false) {
    if (!allow("customer.edit")) return;
    const names=[...selected];
    if(!names.length)return toast("请先选择客户");
    drawer(
      "批量新建日程",
      `<form id="batch-schedule-form" class="drawer-body batch-tags-form batch-schedule-form"><p class="batch-tags-count">为 <strong>${names.length}</strong> 位客户安排下次跟进</p><div class="transition-names">${names.slice(0,4).map(name=>`<div>${E(name)}</div>`).join("")}${names.length>4?`<div>还有 ${names.length-4} 位客户</div>`:""}</div><label class="field" for="batch-schedule-date"><span>下次跟进日期</span><input id="batch-schedule-date" type="date" name="date" required></label><p class="muted tiny">保存后同步到所选客户资料与来财日历；不会新增已完成的跟进记录。已有相同日期的客户保持不变。</p><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="batch-schedule-form" class="primary">保存到 ${names.length} 位客户</button>`,
      "actions",
      pointerActivated,
    );
    $("#batch-schedule-form").addEventListener("submit",event=>{
      event.preventDefault();
      workspaceSave(
        ()=>M.batchSetCustomerNextFollow(state,names,event.currentTarget.elements.date.value),
        ()=>selected.clear(),
      );
    });
  }
  function batchTagsDialog(pointerActivated = false) {
    if (!allow("customer.edit")) return;
    const names = [...selected];
    if (!names.length) return toast("请先选择客户");
    drawer(
      "设置标签",
      `<form id="batch-tags-form" class="drawer-body batch-tags-form"><p class="batch-tags-count">将标签应用到 <strong>${names.length}</strong> 位客户</p><div class="transition-names">${names.slice(0, 4).map(name => `<div>${E(name)}</div>`).join("")}${names.length > 4 ? `<div>还有 ${names.length - 4} 位客户</div>` : ""}</div><fieldset><legend>操作方式</legend><label><input type="radio" name="mode" value="add" checked>添加标签</label><label><input type="radio" name="mode" value="remove">移除标签</label></fieldset><label class="field" for="batch-tags-input"><span>客户标签</span><input id="batch-tags-input" name="tags" maxlength="400" required placeholder="输入标签，多个用逗号分隔" autocomplete="off"></label><p class="muted tiny">仅修改所选客户的标签，其他客户资料保持原样。</p><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="batch-tags-form" class="primary">应用到 ${names.length} 位客户</button>`,
      "actions",
      pointerActivated,
    );
    $("#batch-tags-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const mode = form.querySelector('[name="mode"]:checked').value;
      const value = form.elements.tags.value;
      workspaceSave(
        () => M.batchUpdateCustomerTags(state, names, value, mode),
        () => selected.clear(),
      );
    });
  }
  function batchFieldDialog(pointerActivated = false) {
    if (!allow("customer.edit")) return;
    const names = [...selected];
    if (!names.length) return toast("请先选择客户");
    drawer(
      "批量编辑字段",
      `<form id="batch-field-form" class="drawer-body batch-tags-form batch-field-form"><p class="batch-tags-count">将字段应用到 <strong>${names.length}</strong> 位客户</p><div class="transition-names">${names.slice(0, 4).map(name => `<div>${E(name)}</div>`).join("")}${names.length > 4 ? `<div>还有 ${names.length - 4} 位客户</div>` : ""}</div><label class="field" for="batch-field-name"><span>客户字段</span><select id="batch-field-name" name="field" required><option value="">请选择字段</option>${M.batchEditableCustomerFields.map(field => `<option value="${E(field.id)}">${E(field.label)}</option>`).join("")}</select></label><label class="field" for="batch-field-value"><span>新值</span><input id="batch-field-value" name="value" list="batch-field-suggestions" maxlength="500" required placeholder="输入要设置的值" autocomplete="off"></label><datalist id="batch-field-suggestions"></datalist><label class="batch-field-clear"><input type="checkbox" name="clear"> 清空所选字段</label><p class="muted tiny" id="batch-field-hint">仅修改所选客户的一个档案字段；跟进人、标签和分组请使用对应操作。</p><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="batch-field-form" class="primary">应用到 ${names.length} 位客户</button>`,
      "actions",
      pointerActivated,
    );
    const form = $("#batch-field-form");
    const fieldInput = form.elements.namedItem("field");
    const valueInput = form.elements.namedItem("value");
    const clearInput = form.elements.namedItem("clear");
    const suggestions = {
      customerStage: stageChoices(),
      level: ["自动判断", "A级钻石客户", "B级翡翠客户", "C级白金客户", "D级黄金客户", "E级白银客户", "F级青铜客户"],
      customerStars: ["1", "2", "3", "4", "5"],
    };
    fieldInput.addEventListener("change", () => {
      $("#batch-field-suggestions").innerHTML = (suggestions[fieldInput.value] || [])
        .map(value => `<option value="${E(value)}"></option>`).join("");
      $("#batch-field-hint").textContent = fieldInput.value === "level"
        ? "请选择完整等级标签，或输入“自动判断”恢复自动等级。"
        : fieldInput.value === "customerStars"
          ? "客户星级填写 1–5；如需移除星级，请勾选清空字段。"
          : "仅修改所选客户的一个档案字段；跟进人、标签和分组请使用对应操作。";
    });
    clearInput.addEventListener("change", () => {
      valueInput.disabled = clearInput.checked;
      valueInput.required = !clearInput.checked;
      if (clearInput.checked) valueInput.value = "";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      workspaceSave(
        () => M.batchEditCustomerField(state, names, fieldInput.value, valueInput.value, clearInput.checked),
        () => selected.clear(),
      );
    });
  }
  // 选择跟进模板：列出客户设置里的常用语，点一条放进跟进内容（已有内容就另起一行）。
  function followupTemplatePicker(anchor) {
    if ($(".followup-template-popover")) return removePopover();
    const box = popover(anchor, window.LaiCustomerDetail.followupTemplateList(state, E), "followup-template-popover");
    box._target = modal ? $("#batch-followup-text") : $("#followup-text");
    anchor.setAttribute("aria-expanded", "true");
    box.querySelector("button")?.focus();
  }
  function insertFollowupTemplate(id) {
    const target = $(".followup-template-popover")?._target;
    removePopover();
    const item = CS.get(state).followup.templates.flatMap((group) => group.items).find((entry) => entry.id === id);
    if (!item || !target?.isConnected) return;
    const current = target.value.replace(/\s+$/, "");
    target.value = current ? `${current}\n${item.text}` : item.text;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
  }
  function batchFollowupDialog(pointerActivated = false) {
    if (!allow("customer.batchFollow")) return;
    const names = [...selected];
    if (!names.length) return toast("请先选择客户");
    const single = names.length === 1;
    const timeInput = window.LaiCustomerDetail.followupTimeInput(state, { id: "batch-followup-time", escape: E });
    drawer(
      single ? "写跟进" : "批量写跟进",
      `<form id="batch-followup-form" class="drawer-body batch-tags-form batch-followup-form"><div class="batch-followup-tools"><button type="button" class="text-button" data-action="followup-templates" aria-haspopup="true" aria-expanded="false">${icon("note")} 选择模板</button></div><label class="field" for="batch-followup-text"><span>跟进内容</span><textarea id="batch-followup-text" name="text" rows="5" maxlength="5000" required placeholder="${single ? "记录这次跟进" : "记录这次共同的跟进进展"}"></textarea></label><label class="field" for="batch-followup-date"><span>下次跟进日期（选填）</span><input id="batch-followup-date" type="date" name="nextFollow"></label>${timeInput ? `<label class="field" for="batch-followup-time"><span>跟进时间（选填，留空为现在）</span>${timeInput}</label>` : ""}<p class="muted tiny">${single ? "日期留空时清除原有的下次跟进日期。" : "日期留空时保留每位客户原有的下次跟进日期。"}</p><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="batch-followup-form" class="primary">确定</button>`,
      "actions",
      pointerActivated,
    );
    $(".drawer").classList.add("feature-dialog", single ? "single-followup-dialog" : "multi-followup-dialog");
    $("#batch-followup-text").focus();
    $("#batch-followup-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      workspaceSave(
        () => {
          const time = CS.checkFollowupTime(state, form.elements.followupTime?.value);
          return single
            ? M.addFollowup(state, names[0], form.elements.text.value, form.elements.nextFollow.value, time)
            : M.batchAddFollowup(state, names, form.elements.text.value, form.elements.nextFollow.value, time);
        },
        () => selected.clear(),
      );
    });
  }
  // ---- 客户管理工具：合并客户、批量建档、标签管理、公海规则（计算在 customer-tools.js） ----
  function ownerChoices() {
    return [...new Set([
      state.laiSettings?.defaultOwner,
      state.orderSettings?.defaultOwner,
      ...allCustomerRows().map((row) => row.owner),
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
  function mergeDialog(names, pointerActivated = false) {
    if (!allow("customer.merge")) return;
    names = [...new Set(names)];
    if (names.length < 2) return toast("请至少选择 2 位客户再合并");
    const rows = new Map(allCustomerRows().map((row) => [row.name, row]));
    const draw = (primary) => {
      let preview;
      try { preview = CT.mergePreview(state, primary, names.filter((n) => n !== primary)); } catch (error) { preview = null; $("#workspace-error") && ($("#workspace-error").textContent = error.message); }
      return preview;
    };
    const first = names.find((n) => (rows.get(n)?.orderCount || 0) > 0) || names[0];
    drawer(
      "合并客户",
      `<form id="merge-form" class="drawer-body merge-form"><p class="batch-tags-count">选择要<strong>保留</strong>的客户，其余 ${names.length - 1} 位并入它：</p><div class="merge-choices">${names.map((n) => { const r = rows.get(n) || {}; return `<label class="merge-choice"><input type="radio" name="primary" value="${E(n)}" ${n === first ? "checked" : ""}><span><strong>${E(n)}</strong><small>${E(r.owner || "未分配")} · ${r.orderCount || 0} 个订单 · ${(r.history || []).length} 条动态${r.email ? " · " + E(r.email) : ""}</small></span></label>`; }).join("")}</div><div id="merge-preview" class="module-note"></div><p class="muted tiny">保留客户的资料优先，空着的资料用其余客户补上；联系人、标签、动态全部并入；订单、任务、商机、客群里的客户名一并改成保留客户。合并后被并入的客户档案会删除，此操作不能撤销，建议先在设置里备份。</p><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="merge-form" class="primary">确认合并</button>`,
      "actions",
      pointerActivated,
    );
    const form = $("#merge-form");
    const update = () => {
      const primary = form.elements.primary.value;
      const p = draw(primary);
      $("#merge-preview").innerHTML = p
        ? `将 <strong>${p.others.map(E).join("、")}</strong> 并入 <strong>${E(primary)}</strong>：${p.count.orders} 个订单、${p.count.tasks} 个任务、${p.count.opportunities} 个商机、${p.count.segments} 个客群、${p.count.contacts} 条联系人资料、${p.count.followups} 条动态`
        : "";
    };
    form.addEventListener("change", update);
    update();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const primary = form.elements.primary.value;
      workspaceSave(
        () => CT.mergeCustomers(state, primary, names.filter((n) => n !== primary)),
        () => { selected.clear(); currentName = ""; customerScreen = "active"; },
      );
    });
  }
  // 客户详情里的「合并客户」：先选要和当前客户合并的其他客户，再走和列表一样的合并确认。
  function mergePickerDialog(name, pointerActivated = false) {
    if (!allow("customer.merge")) return;
    if (!name || !state.customers?.[name]) return;
    const others = allCustomerRows()
      .filter((row) => row.name !== name && L.bucket(state.customers?.[row.name] || {}) !== "trash")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    const picked = new Set();
    drawer(
      "合并客户",
      `<form id="merge-pick-form" class="drawer-body merge-form"><p class="batch-tags-count">选择要和 <strong>${E(name)}</strong> 合并的客户：</p><label class="field"><span>搜索客户</span><input id="merge-pick-search" type="search" placeholder="公司名称、联系人或邮箱" autocomplete="off"></label><div class="merge-choices" id="merge-pick-list"></div><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="merge-pick-form" class="primary">下一步</button>`,
      "actions",
      pointerActivated,
    );
    const form = $("#merge-pick-form");
    const listBox = $("#merge-pick-list");
    const draw = () => {
      const q = $("#merge-pick-search").value.trim().toLowerCase();
      const match = (row) => !q || [row.name, row.contact, row.email].some((v) => String(v || "").toLowerCase().includes(q));
      const shown = [...others.filter((row) => picked.has(row.name)), ...others.filter((row) => !picked.has(row.name) && match(row)).slice(0, 30)];
      listBox.innerHTML = shown.length
        ? shown.map((row) => `<label class="merge-choice"><input type="checkbox" name="other" value="${E(row.name)}" ${picked.has(row.name) ? "checked" : ""}><span><strong>${E(row.name)}</strong><small>${E([row.contact, row.email].filter(Boolean).join(" · ") || "没有联系人资料")}</small></span></label>`).join("")
        : '<p class="muted tiny">没有找到客户</p>';
    };
    draw();
    $("#merge-pick-search").addEventListener("input", draw);
    listBox.addEventListener("change", (event) => {
      const box = event.target;
      if (box.name !== "other") return;
      box.checked ? picked.add(box.value) : picked.delete(box.value);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!picked.size) {
        const err = $("#workspace-error");
        err.textContent = "请至少选一位要合并的客户";
        err.classList.add("visible");
        return;
      }
      mergeDialog([name, ...picked]);
    });
  }
  function batchCreateDialog(pointerActivated = false) {
    if (!allow("customer.create")) return;
    const owners = ownerChoices();
    drawer(
      "批量建档",
      `<form id="batch-create-form" class="drawer-body batch-create-form"><p class="muted tiny">每行一位客户，列之间用 Tab 或逗号分隔：<br><strong>公司名称，联系人，邮箱，电话，国家</strong>（后四列可以省略）。可以直接从 Excel 里复制粘贴。</p><label class="field"><span>客户名单</span><textarea name="text" rows="9" required placeholder="Acme Trading Ltd，Amy Li，amy@acme.com，+1 555 0100，美国&#10;Sunrise GmbH"></textarea></label><div class="form-grid"><label class="field"><span>默认国家地区</span><input name="country" maxlength="60" placeholder="行里没写国家时使用"></label><label class="field"><span>客户来源</span><input name="source" maxlength="60" value="批量建档"></label><label class="field"><span>跟进人</span><input name="owner" list="batch-create-owners" maxlength="60" value="${E(state.laiSettings?.defaultOwner || state.orderSettings?.defaultOwner || "")}"><datalist id="batch-create-owners">${owners.map((o) => `<option value="${E(o)}">`).join("")}</datalist></label><label class="field"><span>标签（逗号分隔）</span><input name="tags" maxlength="200"></label></div><div id="batch-create-result" class="module-note" hidden></div><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="batch-create-form" class="primary">建档</button>`,
      "actions",
      pointerActivated,
    );
    const form = $("#batch-create-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pending) return;
      const err = $("#workspace-error");
      err.textContent = "";
      let result;
      try {
        result = CT.batchCreate(state, form.elements.text.value, {
          country: form.elements.country.value, source: form.elements.source.value,
          owner: form.elements.owner.value, tags: form.elements.tags.value,
        });
      } catch (error) { err.textContent = error.message; err.classList.add("visible"); return; }
      const box = $("#batch-create-result");
      const report = () => {
        box.hidden = false;
        box.innerHTML = `<strong>已建档 ${result.created.length} 位</strong>${result.skipped.length ? `，跳过 ${result.skipped.length} 行：<ul class="batch-skipped">${result.skipped.map((x) => `<li>第 ${x.line} 行「${E(x.raw.slice(0, 40))}」：${E(x.reason)}</li>`).join("")}</ul><p class="tiny muted">可以修改上面的名单后只粘贴被跳过的行再建一次。</p>` : ""}`;
      };
      if (!result.created.length) { report(); err.textContent = "没有可建档的客户"; err.classList.add("visible"); return; }
      try {
        await persist(result.state);
        form.elements.text.value = result.skipped.map((x) => x.raw).join("\n");
        report();
        refresh();
        toast(`已建档 ${result.created.length} 位客户`);
        const btn = document.querySelector('button[form="batch-create-form"]');
        if (btn) btn.textContent = result.skipped.length ? "再建一次（仅跳过的行）" : "完成";
        if (!result.skipped.length) {
          // 名单已经清空：输入框不再必填，「完成」改成普通按钮，直接关掉窗口。
          form.elements.text.required = false;
          if (btn) {
            btn.type = "button";
            btn.removeAttribute("form");
            btn.dataset.action = "close-modal";
          }
        }
      } catch (error) { err.textContent = error.message; err.classList.add("visible"); }
    });
  }
  function tagManagerDialog(pointerActivated = false) {
    if (!allow("customer.edit")) return;
    let editing = "", confirmDelete = "", message = "";
    // 只统计、改名、删除当前账号看得到、也有权限改的客户身上的标签；其他客户的标签原样不动。
    // 客户工具函数不能只传一部分名单，所以先拿一份只含这些客户的数据副本去算，再把改好的客户放回完整数据里。
    const scoped = () => {
      const visible = new Set(allCustomerRows().map((row) => row.name));
      const customers = Object.fromEntries(Object.entries(state.customers || {}).filter(([name]) => visible.has(name) && can(tagEditKey(name))));
      return { ...state, customers };
    };
    const mergeBack = (result) => ({ ...result, state: { ...state, customers: { ...state.customers, ...result.state.customers } } });
    const body = () => {
      const stats = CT.tagStats(scoped());
      const rows = stats.map((t) => {
        if (editing === t.tag) return `<div class="tag-row"><input class="tag-rename-input" value="${E(t.tag)}" maxlength="40" aria-label="新的标签名称"><button type="button" data-tag-save="${E(t.tag)}" class="primary">保存</button><button type="button" data-tag-cancel>取消</button></div>`;
        if (confirmDelete === t.tag) return `<div class="tag-row"><span class="tag-name">${E(t.tag)}</span><span class="muted tiny">从 ${t.count} 位客户身上去掉？</span><button type="button" data-tag-delete-ok="${E(t.tag)}" class="danger">确认删除</button><button type="button" data-tag-cancel>取消</button></div>`;
        return `<div class="tag-row"><span class="tag-name">${E(t.tag)}</span><span class="muted tiny">${t.count} 位客户</span><button type="button" data-tag-rename="${E(t.tag)}">改名</button><button type="button" data-tag-delete="${E(t.tag)}">删除</button></div>`;
      }).join("");
      return `<div class="drawer-body tag-manager">${rows || '<div class="empty"><strong>还没有客户标签</strong><span>在客户资料或批量操作里给客户加标签后，这里就会列出来。</span></div>'}<p class="muted tiny">改名成已有的标签名，就是把两个标签合并。删除只是把标签从客户身上去掉，不影响客户资料。</p><div class="error ${message ? "visible" : ""}" id="workspace-error" role="alert">${E(message)}</div></div>`;
    };
    drawer("标签管理", body(), `<button type="button" data-action="close-modal">完成</button>`, "actions", pointerActivated);
    const root = () => $("#overlay-root .drawer-body.tag-manager");
    const redraw = () => { const old = root(); if (old) old.outerHTML = body(); root()?.querySelector(".tag-rename-input")?.focus(); };
    const run = async (fn) => {
      if (pending) return;
      try {
        await persist(fn().state); message = ""; editing = ""; confirmDelete = "";
        if (activeRoute === "customers" && !currentName && customerScreen === "customer-settings") customerSettings(true);
        else refresh();
        toast("已保存到来财");
      }
      catch (error) { message = error.message; }
      redraw();
    };
    const host = $("#overlay-root .overlay");
    host.addEventListener("click", (event) => {
      const t = event.target.closest("[data-tag-rename],[data-tag-save],[data-tag-delete],[data-tag-delete-ok],[data-tag-cancel]");
      if (!t || !root()) return;
      const d = t.dataset;
      if (d.tagRename !== undefined) { editing = d.tagRename; confirmDelete = ""; message = ""; redraw(); }
      else if (d.tagDelete !== undefined) { confirmDelete = d.tagDelete; editing = ""; message = ""; redraw(); }
      else if (d.tagCancel !== undefined) { editing = ""; confirmDelete = ""; message = ""; redraw(); }
      else if (d.tagSave !== undefined) run(() => mergeBack(CT.renameTag(scoped(), d.tagSave, root().querySelector(".tag-rename-input").value)));
      else if (d.tagDeleteOk !== undefined) run(() => mergeBack(CT.deleteTag(scoped(), d.tagDeleteOk)));
    });
    host.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.classList?.contains("tag-rename-input")) { event.preventDefault(); root().querySelector("[data-tag-save]")?.click(); }
    });
  }
  function batchOwnerDialog(clearOwner = false, pointerActivated = false) {
    if (!allow(clearOwner ? "customer.removeOwner" : "customer.reassign")) return;
    const names = [...selected];
    if (!names.length) return toast("请先选择客户");
    const owners = [...new Set([
      state.laiSettings?.defaultOwner,
      state.orderSettings?.defaultOwner,
      ...allCustomerRows().map((row) => row.owner),
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    drawer(
      clearOwner ? "移除跟进人" : "重新分配跟进人",
      `<form id="batch-owner-form" class="drawer-body batch-tags-form batch-owner-form"><p class="batch-tags-count">将操作应用到 <strong>${names.length}</strong> 位客户</p><div class="transition-names">${names.slice(0, 4).map(name => `<div>${E(name)}</div>`).join("")}${names.length > 4 ? `<div>还有 ${names.length - 4} 位客户</div>` : ""}</div>${clearOwner ? '<p class="muted tiny">仅清空所选客户的跟进人，客户仍保留在当前列表。</p>' : `<label class="field" for="batch-owner-input"><span>新跟进人</span><input id="batch-owner-input" name="owner" list="batch-owner-options" required maxlength="120" autocomplete="off" placeholder="输入或选择跟进人"><datalist id="batch-owner-options">${owners.map(owner => `<option value="${E(owner)}"></option>`).join("")}</datalist></label>`}<div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="batch-owner-form" class="primary">${clearOwner ? "确认移除" : "确认分配"}</button>`,
      "actions",
      pointerActivated,
    );
    $("#batch-owner-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const owner = clearOwner ? "" : event.currentTarget.elements.namedItem("owner").value;
      workspaceSave(
        () => M.batchSetOwner(state, names, owner),
        () => selected.clear(),
      );
    });
  }
  function renderImportDrawer(pointerActivated = false) {
    if (!importDraft || modal !== 'import') return;
    const draft = importDraft;
    const steps = ['上传文件', '匹配字段', '查看导入结果'];
    const current = Math.min(draft.step, 3);
    const progress = `<div class="import-steps" aria-label="导入步骤">${steps.map((label, index) =>
      `<div class="import-step${current === index + 1 ? ' import-step-active' : ''}${current > index + 1 ? ' import-step-done' : ''}"><b>${index + 1}</b> ${label}</div>`).join('')}</div>`;
    let body = '';
    if (draft.step === 1) {
      body = `<div class="import-guidance"><p>多选、标签、国家地区、社交平台、邮箱、座机等字段格式需按规范填写，单次导入数据不可超过 10,000 行。<a class="import-link" href="https://jinyuncrmdevelop.oss-cn-hangzhou.aliyuncs.com/template/customer/250212/%E5%AF%BC%E5%85%A5%E6%A0%BC%E5%BC%8F%E8%A6%81%E6%B1%82.pdf" target="_blank" rel="noopener noreferrer">查看格式要求</a></p><p>若文件表头有合并单元格，请取消合并。导入前建议先下载模板。<button type="button" class="import-link" data-action="import-template">下载模板</button></p></div>
        <fieldset class="import-options"><legend>导入至</legend><label><input type="radio" name="importDestination" value="active"${draft.destination === 'active' ? ' checked' : ''}> 客户列表</label><label><input type="radio" name="importDestination" value="pool"${draft.destination === 'pool' ? ' checked' : ''}> 公海客户</label></fieldset>
        <fieldset class="import-options"><legend>当导入的客户或联系人与已有数据重复时，是否更新数据</legend><label><input type="radio" name="importDuplicate" value="update"${draft.duplicate === 'update' ? ' checked' : ''}> 更新数据</label><label><input type="radio" name="importDuplicate" value="skip"${draft.duplicate === 'skip' ? ' checked' : ''}> 不更新</label></fieldset>
        <input id="customer-import-file" type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>
        <button type="button" class="import-dropzone" data-action="choose-import-file"><span>悬浮至此区域粘贴，或拖拽至此上传，或 <span class="import-link">点击上传</span></span><small>最多只能上传 1 个文件；仅支持 xls、xlsx、csv 文件格式；支持 5 MB 以内的文件</small></button>
        ${draft.parsed ? `<div class="import-file-ready" data-import-file-ready>${E(draft.fileName)} · ${draft.parsed.rows.length} 行</div>` : ''}`;
    } else if (draft.step === 2) {
      body = `<p class="import-hint">为每列选择对应的来财字段。公司名称必选；未匹配的列不会写入。</p><div class="import-map">${draft.parsed.headers.map((header, index) => {
        const selected = Object.entries(draft.mapping).find(([, column]) => column === index)?.[0] || '';
        return `<label><span>${E(header || `第 ${index + 1} 列`)}</span><select data-import-column="${index}" aria-label="${E(header || `第 ${index + 1} 列`)}对应字段"><option value="">不导入</option>${I.fields.map(field => opt(field.id, field.label, selected)).join('')}</select></label>`;
      }).join('')}</div>`;
    } else if (draft.step === 3) {
      const names = I.mappedRecords(draft.parsed, draft.mapping).slice(0, 5);
      body = `<p class="import-hint">请核对导入范围和前 5 行；点击“开始导入”后才保存到来财本地数据库。</p><div class="import-review"><div>目标位置 <strong>${draft.destination === 'pool' ? '公海客户' : '客户列表'}</strong></div><div>重复数据 <strong>${draft.duplicate === 'update' ? '更新数据' : '不更新'}</strong></div><div>文件行数 <strong>${draft.parsed.rows.length}</strong></div></div><table class="import-preview" data-import-preview><thead><tr><th>公司名称</th><th>联系人昵称</th><th>联系人邮箱</th></tr></thead><tbody>${names.map(row => `<tr><td>${E(row.name)}</td><td>${E(row.contact || '—')}</td><td>${E(row.email || '—')}</td></tr>`).join('')}</tbody></table><p class="import-hint">同一公司的不同联系人会合并到同一客户；跨公司重复的邮箱或电话会跳过。</p>`;
    } else {
      const result = draft.result;
      const issues = draft.details.filter(item => item.status === 'skipped');
      body = `<div class="import-result" data-import-result><span class="import-result-icon">✓</span><h3>导入完成</h3><p>成功新建 ${result.created} 位，更新 ${result.updated} 位${result.contactsAdded ? `，新增联系人 ${result.contactsAdded} 位` : ''}，跳过 ${result.skipped} 行。</p></div>
        ${issues.length ? `<div class="import-issue-head"><strong>跳过的客户</strong><button type="button" class="import-link" data-action="import-failure-log" data-record-index="-1">下载失败日志</button></div><div class="import-issue-list">${issues.slice(0, 20).map(item => `<div><span>第 ${item.row} 行 · ${E(item.name)}</span><em>${E(item.reason)}</em></div>`).join('')}</div>${issues.length > 20 ? `<p class="import-hint">这里只显示前 20 条；下载失败日志可查看全部 ${issues.length} 条。</p>` : ''}` : ''}`;
    }
    const foot = draft.step === 4
      ? '<button type="button" class="primary" data-action="close-modal">完成</button>'
      : `<button type="button" data-action="close-modal">取消</button>${draft.step > 1 ? '<button type="button" data-action="import-back">上一步</button>' : ''}<button type="button" class="primary" data-action="${draft.step === 3 ? 'import-save' : 'import-next'}"${draft.step === 1 && !draft.parsed ? ' disabled' : ''}>${draft.step === 3 ? '开始导入' : '下一步'}</button>`;
    const dialog = $('#overlay-root .drawer.customer-import');
    dialog.querySelector('.import-records-link')?.remove();
    dialog.querySelector('.drawer-head h2').insertAdjacentHTML('afterend', '<button type="button" class="import-records-link" data-action="import-records">导入记录</button>');
    dialog.querySelector('.drawer-body').innerHTML = progress + `<div class="import-step-body${pointerActivated ? ' import-step-motion' : ''}">${body}</div>` + `<div class="error import-error${draft.error ? ' visible' : ''}" id="workspace-error" role="alert">${E(draft.error || '')}</div>`;
    if (pointerActivated) {
      const stepBody = dialog.querySelector('.import-step-body');
      stepBody.addEventListener('animationend', event => {
        if (event.target === stepBody) stepBody.classList.remove('import-step-motion');
      }, {once:true});
    }
    dialog.querySelector('.drawer-footer').innerHTML = foot;
  }
  function importCustomers(pointerActivated = false) {
    if (!allow("customer.import")) return;
    importDraft = {step:1, destination:'active', duplicate:'skip', parsed:null, mapping:{}, fileName:'', error:'', result:null, details:[]};
    drawer('导入客户', '<div class="drawer-body import-body"></div>', '', 'import', pointerActivated);
    $('.drawer').classList.add('customer-import');
    renderImportDrawer();
  }
  async function readImportFile(file) {
    if (!importDraft || modal !== 'import') return;
    try {
      if (!file || !/\.(csv|xls|xlsx)$/i.test(file.name)) throw new Error('请选择 XLS、XLSX 或 UTF-8 CSV 文件');
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB');
      const parsed = /\.csv$/i.test(file.name)
        ? I.parseCsv(await file.text())
        : I.parseExcel(await file.arrayBuffer(), window.XLSX);
      if (!importDraft || modal !== 'import') return;
      importDraft.parsed = parsed;
      importDraft.mapping = I.suggestMapping(parsed.headers);
      importDraft.fileName = file.name;
      importDraft.error = '';
    } catch (error) {
      if (!importDraft || modal !== 'import') return;
      importDraft.parsed = null;
      importDraft.error = error.message;
    }
    renderImportDrawer();
  }
  function advanceImport(pointerActivated = false) {
    if (!importDraft || modal !== 'import') return;
    try {
      if (importDraft.step === 1) {
        if (!importDraft.parsed) throw new Error('请先选择 XLS、XLSX 或 UTF-8 CSV 文件');
        importDraft.step = 2;
      } else if (importDraft.step === 2) {
        I.mappedRecords(importDraft.parsed, importDraft.mapping);
        importDraft.step = 3;
      }
      importDraft.error = '';
    } catch (error) { importDraft.error = error.message; }
    renderImportDrawer(pointerActivated && !importDraft.error);
  }
  async function saveImport(pointerActivated = false) {
    if (!allow("customer.import")) return;
    if (!importDraft || importDraft.step !== 3 || pending) return;
    try {
      const prepared = I.applyImport(state, importDraft.parsed, importDraft.mapping,
        {destination:importDraft.destination, duplicate:importDraft.duplicate,
          fileName:importDraft.fileName, recordId:crypto.randomUUID()});
      await persist(prepared.state, {id:prepared.record.id,
        issues:prepared.details.filter(item => item.status === 'skipped')
          .map(({row,name,reason}) => ({row,name,reason}))});
      importDraft.result = prepared.result;
      importDraft.details = prepared.details;
      importDraft.step = 4;
      importDraft.error = '';
      refresh();
    } catch (error) { importDraft.error = error.message; }
    renderImportDrawer(pointerActivated && !importDraft.error);
  }
  function importRecords(pointerActivated = false) {
    if (!allow("customer.import")) return;
    importRecordsPage = 1;
    drawer('客户导入记录', '<div class="drawer-body import-records-body"></div>',
      '<button type="button" data-action="close-modal">取消</button><button type="button" data-action="import-customers">导入客户</button>',
      'import-records', pointerActivated);
    $('.drawer').classList.add('customer-import-records');
    renderImportRecords();
  }
  function renderImportRecords() {
    const records = Array.isArray(state.laiImportHistory) ? state.laiImportHistory : [];
    const pages = Math.max(1, Math.ceil(records.length / 20));
    importRecordsPage = Math.min(Math.max(1, importRecordsPage), pages);
    const start = (importRecordsPage - 1) * 20;
    const rows = records.slice(start, start + 20).map((record, offset) => {
      const index = start + offset;
      const result = record.result || {};
      const success = (result.created || 0) + (result.updated || 0) + (result.contactsAdded || 0);
      const date = new Date(record.time);
      const displayTime = Number.isNaN(date.getTime()) ? String(record.time || '')
        : date.toLocaleString('sv-SE', {hour12:false});
      return `<tr><td title="${E(record.fileName)}">${E(record.fileName)}</td><td>${record.destination === 'pool' ? '公海客户' : '客户列表'}</td><td>${Number(record.expected) || 0}</td><td>导入成功：${success}${result.skipped ? `<br>导入失败：${result.skipped}` : ''}</td><td>${E(displayTime)}</td><td>${result.skipped ? `<button type="button" class="import-link" data-action="import-failure-log" data-record-index="${index}">下载失败日志</button>` : '—'}</td></tr>`;
    }).join('');
    const body = $('#overlay-root .customer-import-records .import-records-body');
    if (!body) return;
    body.innerHTML = records.length ? `<div class="import-records-scroll"><table class="import-records-table"><thead><tr><th>文件名称</th><th>导入到</th><th>预计导入数</th><th>结果</th><th>导入时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div><div class="import-record-pages"><span>共 ${records.length} 条数据</span><div><button type="button" data-action="import-record-page" data-page-delta="-1" aria-label="上一页"${importRecordsPage === 1 ? ' disabled' : ''}>‹</button><span>${importRecordsPage} / ${pages}</span><button type="button" data-action="import-record-page" data-page-delta="1" aria-label="下一页"${importRecordsPage === pages ? ' disabled' : ''}>›</button></div></div>`
      : '<div class="import-record-empty">暂无导入记录</div>';
  }
  async function downloadImportFailures(index) {
    let issues = index === -1
      ? importDraft?.details?.filter(item => item.status === 'skipped')
      : state.laiImportHistory?.[index]?.issues;
    if (index >= 0 && !issues) {
      try {
        const id = state.laiImportHistory?.[index]?.id;
        const response = await fetch(`/api/import-log?id=${encodeURIComponent(id || '')}`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || '读取失败日志失败');
        issues = result.issues;
      } catch (error) { toast(error.message || '读取失败日志失败'); return; }
    }
    if (!Array.isArray(issues) || !issues.length) return;
    const csv = I.failureLogCsv(issues);
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url; link.download = '来财客户导入失败日志.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadImportTemplate() {
    if (!window.XLSX) return toast('Excel 模板组件未加载，请重新打开来财');
    const workbook = window.XLSX.utils.book_new();
    const worksheet = window.XLSX.utils.aoa_to_sheet([I.templateHeaders]);
    window.XLSX.utils.book_append_sheet(workbook,worksheet,'客户');
    const bytes = window.XLSX.write(workbook,{type:'array',bookType:'xlsx'});
    const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link = document.createElement('a');
    link.href = url; link.download = '来财客户导入模板.xlsx'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function workspaceSave(makeNext, after) {
    if (pending) return toast("上一项修改正在保存，请稍候");
    const controls = [
        ...document.querySelectorAll("button,input,select,textarea"),
      ],
      disabled = controls.map((c) => c.disabled);
    controls.forEach((c) => (c.disabled = true));
    try {
      await persist(makeNext());
      controls.forEach((c, i) => (c.disabled = disabled[i]));
      closeModal(false, modal === "company-display" || modal === "segment");
      after?.();
      refresh();
      toast("已保存到来财");
    } catch (error) {
      controls.forEach((c, i) => (c.disabled = disabled[i]));
      const el = $("#workspace-error");
      if (el) {
        el.textContent = error.message;
        el.classList.add("visible");
      } else toast(error.message);
    }
  }
  function toggleGroupBranch(el, pointer) {
    if (!el) return;
    const id = el.dataset.expand;
    const panel = document.getElementById(`group-branch-${id}`);
    if (!panel) return;
    const open = !expanded.has(id);
    if (open) expanded.add(id);
    else expanded.delete(id);
    clearTimeout(panel.motionTimer);
    panel.style.removeProperty("height");
    panel.classList.remove("branch-motion");
    panel.classList.toggle("expanded", open);
    panel.setAttribute("aria-hidden", String(!open));
    panel.inert = !open;
    el.setAttribute("aria-expanded", String(open));
    $(`[data-toggle-branch="${id}"]`)?.setAttribute("aria-expanded", String(open));
    el.querySelector("i").textContent = open ? "▾" : "▸";
    if (open && pointer) {
      const last = panel.firstElementChild?.lastElementChild;
      if (last) {
        panel.style.height = `${Math.max(0, last.getBoundingClientRect().bottom - panel.getBoundingClientRect().top)}px`;
        panel.classList.add("branch-motion");
        panel.motionTimer = setTimeout(() => {
          panel.style.removeProperty("height");
          panel.classList.remove("branch-motion");
        }, 300);
      }
    }
  }
  function normalizeDraft() {
    const scrollTop = $(".columns-dialog .columns-layout")?.scrollTop ?? 0;
    const searchValue = $("#column-search")?.value ?? "";
    const focused = document.activeElement;
    const focusAttribute = ["data-column-toggle", "data-column-move", "data-column-freeze", "data-column-remove"]
      .find((attribute) => focused?.hasAttribute?.(attribute));
    const focusValue = focusAttribute && focused.getAttribute(focusAttribute);
    Object.assign(columnDraft, C.normalizeColumns(columnDraft));
    renderColumns();
    const search = $("#column-search");
    if (searchValue) {
      search.value = searchValue;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    $(".columns-dialog .columns-layout").scrollTop = scrollTop;
    if (focusAttribute) {
      [...document.querySelectorAll(`.columns-dialog [${focusAttribute}]`)]
        .find((element) => element.getAttribute(focusAttribute) === focusValue)
        ?.focus({ preventScroll: true });
    }
  }
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button");
    if (!el || el.disabled) return;
    const d = el.dataset,
      a = d.action;
    if (d.expand) return toggleGroupBranch(el, e.detail > 0);
    if (d.columnFreeze) {
      const id = d.columnFreeze;
      if (!columnDraft.frozen.includes(id) && columnDraft.frozen.length >= 3)
        return toast("最多冻结公司名称及另外两列");
      columnDraft.frozen = columnDraft.frozen.includes(id)
        ? columnDraft.frozen.filter((x) => x !== id)
        : [...columnDraft.frozen, id];
      return normalizeDraft();
    }
    if (d.columnRemove) {
      columnDraft.order = columnDraft.order.filter((x) => x !== d.columnRemove);
      return normalizeDraft();
    }
    if (d.columnMove) {
      const index = columnDraft.order.indexOf(d.columnMove),
        other = index + Number(d.step);
      if (
        other > 0 &&
        other < columnDraft.order.length &&
        columnDraft.frozen.includes(columnDraft.order[index]) ===
          columnDraft.frozen.includes(columnDraft.order[other])
      )
        [columnDraft.order[index], columnDraft.order[other]] = [
          columnDraft.order[other],
          columnDraft.order[index],
        ];
      return normalizeDraft();
    }
    if (d.editSegment) return segmentEditor(d.editSegment, "rules", undefined, "all", e.detail > 0);
    if (d.archiveSegment)
      return workspaceSave(
        () => S.archiveSegment(state, d.archiveSegment),
        () => {
          if (filters.group === "segment:" + d.archiveSegment)
            filters.group = "all";
          manageSegments();
        },
      );
    if (d.restoreSegment)
      return workspaceSave(
        () => S.restoreSegment(state, d.restoreSegment),
        () => manageSegments(),
      );
    if (d.removeRule !== undefined) {
      const index = Number(d.removeRule);
      readSegment();
      segmentDraft.rules.splice(index, 1);
      renderSegment();
      const remainingIndex = Math.min(index, segmentDraft.rules.length - 1);
      const next = remainingIndex >= 0
        ? $(`#segment-form [data-rule="${remainingIndex}"] [data-rule-prop="value"]:not(:disabled)`) || $(`#segment-form [data-rule="${remainingIndex}"] [data-rule-prop="field"]`)
        : $('[data-action="add-rule"]');
      next?.focus();
      return;
    }
    if (a === "new-segment" || a === "new-manual")
      return segmentEditor(null, a === "new-manual" ? "manual" : "rules", undefined, "all", e.detail > 0);
    if (a === "manage-segments") return manageSegments(e.detail > 0);
    if (a === "add-rule") {
      readSegment();
      segmentDraft.rules.push({ field: "country", op: "contains", value: "" });
      return renderSegment(e.detail > 0, segmentDraft.rules.length - 1);
    }
    if (a === "save-columns")
      return workspaceSave(() => ({
        ...state,
        previewTable: { ...columnDraft, ...C.normalizeColumns(columnDraft) },
      }));
    if (a === "reset-columns") {
      columnDraft = {
        ...C.normalizeColumns(),
        striped: true,
        compact: true,
        verticalLines: true,
      };
      return renderColumns();
    }
    if (a === "add-members" || a === "remove-members")
      return membershipDialog(a === "add-members" ? "add" : "remove", e.detail > 0);
    if (a === "filter-segment") {
      try {
        const values = Object.fromEntries(new FormData($("#filter-form")));
        const spec =
          filterMode === "advanced"
            ? readAdvanced()
            : {
                match: "all",
                rules: Object.entries(values)
                  .filter(
                    ([key, value]) =>
                      key !== "tagMode" && String(value).trim() !== "",
                  )
                  .map(([key, value]) => {
                    const field =
                      key === "tag"
                        ? "tags"
                        : key === "customerGroup"
                          ? "group"
                          : key;
                    if (!S.catalog.some((f) => f.id === field))
                      throw new Error(
                        `“${C.catalog.find((f) => f.id === field)?.label || key}”暂不支持生成客群，请保留普通筛选或移除此条件。`,
                      );
                    return {
                      field,
                      op: key === "tag"
                        ? values.tagMode === "包含全部" ? "containsAll" : "containsAny"
                        : ["name", "email", "customerGroup"].includes(key)
                          ? "contains"
                          : "eq",
                      value,
                    };
                  }),
              };
        S.filterByRules(rows, spec);
        if (!spec.rules.length) throw new Error("请先填写至少一个筛选条件");
        return segmentEditor(null, "rules", spec.rules, spec.match, e.detail > 0);
      } catch (error) {
        const el = $("#filter-error");
        el.textContent = error.message;
        el.classList.add("visible");
      }
    }
  });
  document.addEventListener("change", (e) => {
    const d = e.target.dataset;
    if (d.columnToggle) {
      columnDraft.order = e.target.checked
        ? [...columnDraft.order, d.columnToggle]
        : columnDraft.order.filter((x) => x !== d.columnToggle);
      return normalizeDraft();
    }
    if (d.tableOption) {
      columnDraft[d.tableOption] = e.target.checked;
      return;
    }
    if (e.target.closest("#segment-form")) {
      readSegment();
      if (d.ruleProp === "field") {
        const r =
          segmentDraft.rules[
            Number(e.target.closest("[data-rule]").dataset.rule)
          ];
        r.op = ops(r.field)[0];
        r.value = fieldById.get(r.field)?.type === "boolean" ? "true" : "";
      }
      if (
        d.ruleProp === "field" ||
        d.ruleProp === "op" ||
        e.target.name === "kind"
      )
        renderSegment();
      else updateMatch();
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "column-search") {
      const q = e.target.value.toLowerCase();
      document
        .querySelectorAll("[data-field-label]")
        .forEach(
          (el) =>
            (el.hidden = !el.dataset.fieldLabel.toLowerCase().includes(q)),
        );
    }
    if (e.target.closest("#segment-form")) {
      readSegment();
      updateMatch();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "segment-form") {
      e.preventDefault();
      readSegment();
      const savedId = segmentDraft.id;
      workspaceSave(
        () => S.upsertSegment(state, segmentDraft.id, segmentDraft),
        () => {
          filters.group = "segment:" + savedId;
          expanded.add("manual");
          page = 1;
          selected.clear();
        },
      );
    }
    if (e.target.id === "membership-form") {
      e.preventDefault();
      const id = e.target.elements.segment.value,
        mode = e.target.dataset.mode;
      workspaceSave(
        () => S.assignMembers(state, id, [...selected], mode),
        () => selected.clear(),
      );
    }
  });
  let draggedField = "";
  function columnBlankTail(event) {
    const section = event.target.closest(".columns-dialog .columns-layout > section:last-child");
    const group = section?.querySelectorAll(".selected-fields")[1];
    const last = group?.lastElementChild;
    return group && event.clientY >= (last || group).getBoundingClientRect().bottom
      && event.clientY < section.getBoundingClientRect().bottom;
  }
  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest("[data-drag-field]");
    if (el && el.dataset.dragField !== "name") {
      draggedField = el.dataset.dragField;
      e.dataTransfer.setData("text/plain", draggedField);
      e.dataTransfer.effectAllowed = "move";
    }
  });
  document.addEventListener("dragend", () => { draggedField = ""; });
  document.addEventListener("dragover", (e) => {
    if (e.target.closest("[data-drag-field]") || draggedField && columnBlankTail(e)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    const el = e.target.closest("[data-drag-field]");
    const blankTail = !el && columnBlankTail(e);
    if ((!el && !blankTail) || !draggedField || !columnDraft) return;
    e.preventDefault();
    if (blankTail) {
      if (!columnDraft.frozen.includes(draggedField)) {
        columnDraft.order = columnDraft.order.filter((id) => id !== draggedField);
        columnDraft.order.push(draggedField);
        normalizeDraft();
      }
      draggedField = "";
      return;
    }
    const target = el.dataset.dragField;
    if (
      target !== "name" &&
      columnDraft.frozen.includes(target) ===
        columnDraft.frozen.includes(draggedField)
    ) {
      const from = columnDraft.order.indexOf(draggedField);
      const to = columnDraft.order.indexOf(target);
      columnDraft.order = columnDraft.order.filter((x) => x !== draggedField);
      columnDraft.order.splice(
        columnDraft.order.indexOf(target) + (from < to ? 1 : 0),
        0,
        draggedField,
      );
      normalizeDraft();
    }
    draggedField = "";
  });

  const L = window.LaiModules;
  let customerScreen = "active";
  let csTab = "groups", csEditing = null, csDedupeSub = "customer";
  // 本人范围的账号只看自己做跟进人的客户；公海客户没有跟进人，看有没有“公海查看”权限。
  const customerVisible = (c) =>
    L.bucket(state.customers?.[c.name]) === "pool" ? can("pool.view") : R.canSee(state, c.owner);
  // 整个客户表重算一遍很贵，而详情页上每点一下都会问一次：同一份数据、同一个账号下只算一次。
  // 数据每次保存都会换成新对象（persist / adoptServerState），所以按数据对象和当前账号缓存就够了。
  let rowCache = { state: null, member: "", day: "", every: null, visible: null };
  const rowCacheFresh = () => {
    const member = R.currentMember(state)?.id || "";
    // 客群里按天数算的条件（如“超过 N 天未跟进”）跨过零点会变，所以日期也算进缓存。
    const day = new Date().toDateString();
    if (rowCache.state !== state || rowCache.member !== member || rowCache.day !== day) rowCache = { state, member, day, every: null, visible: null };
    return rowCache;
  };
  const everyCustomerRow = () => {
    const cache = rowCacheFresh();
    return (cache.every ??= S.enrich(M.buildCustomers(state), state));
  };
  const allCustomerRows = () => {
    const cache = rowCacheFresh();
    return (cache.visible ??= R.scopeOf(state) === "all" ? everyCustomerRow() : everyCustomerRow().filter(customerVisible));
  };
  // 客户存在，但当前账号看不到（不在自己名下）。
  const customerHidden = (name) =>
    R.scopeOf(state) !== "all" && everyCustomerRow().some((c) => c.name === name && !customerVisible(c));
  function rebuildRows() {
    rows = allCustomerRows().filter(
      (c) => L.bucket(state.customers[c.name]) === "active",
    );
  }
  // 当前页面属于哪个左侧菜单：常用模式下只有「常用」高亮（不论当前页面是什么类型）；否则客户页面、邮件、业务页面各自对应所在的菜单。
  function railActive(label, route) {
    if (favoritesMode) return label === "常用";
    if (label === "常用") return false;
    if (activeRoute === "mail") return label === "邮件";
    if (activeRoute === "customers") return route === "customers";
    return RM.sectionFor(activeRoute)?.label === label;
  }
  function appNav() {
    const items = [
      ["heart", "常用", null],
      ["grid", "工作台", "dashboard"],
      ["mail", "邮件", "mail"],
      ["chat", "沟通", null],
      ["lead", "线索", "leads"],
      ["people", "客户", "customers"],
      ["globe", "商机", "opportunities"],
      ["search", "Leads", null],
      ["note", "交易", "order-list"],
      ["chart", "团队数据", "team-goals"],
      ["folder", "协同", "calendar", "calendar"],
      ["settings", "设置", "settings", "sliders"],
      ["building", "企业管理", "roles", "building"],
    ];
    return (
      `<div class="rail-scroll">` +
      items
      .filter(([, label]) => !railHidden(label))
      .map(
        ([i, label, route, duo]) => {
          const target = railRoute(label, route);
          return `<button class="rail-item ${railActive(label, route) ? "active" : ""}" data-rail-menu="${label}" ${target ? 'data-lai-route="' + target + '"' : label === "常用" ? 'data-action="favorite-nav"' : 'data-feature="' + label + '"'}>${menuIcon(i, duo)}<span>${label}</span>${route === "mail" ? mailBadge() : ""}</button>`;
        },
      )
      .join("") +
      `</div><button class="rail-item rail-refresh" data-action="refresh-app" aria-label="刷新来财数据">${icon("refresh")}<span>刷新</span></button>`
    );
  }
  // ---- 角色权限：当前账号打不开的入口不显示（保留入口 feature 不受限制） ----
  const entryAllowed = (row) => row.kind === "feature" || R.canOpen(state, row.kind, row.target);
  const menuRows = (label) => RM.menuFor(label)?.filter(entryAllowed) ?? null;
  const favoriteEntries = () => NF.entries(state.laiSettings).filter(entryAllowed);
  // 整个菜单里的入口都打不开：左侧栏不显示这个菜单。
  const railHidden = (label) => {
    const rows = RM.menuFor(label);
    return !!rows && rows.length > 0 && !rows.some(entryAllowed);
  };
  // 左侧栏图标的跳转目标：默认页面打不开时，换成这个菜单里第一个能打开的页面。
  const railRoute = (label, route) => {
    if (!route || route === "customers" || route === "mail") return route;
    const rows = RM.menuFor(label) || [];
    if (rows.some((row) => row.kind === "route" && row.target === route && entryAllowed(row))) return route;
    return rows.find((row) => row.kind === "route" && entryAllowed(row))?.target || route;
  };
  // 点“客户”时先打开第一个能打开的客户页面。
  const firstCustomerScreen = () => (RM.menuFor("客户") || []).find(entryAllowed)?.target || "active";
  // ---- 常用导航：心形标志 ----
  // 没设为常用的条目平时不显示标志（透明度为 0，位置保留），鼠标移到该行或键盘聚焦时浮现浅色空心心形；设为常用后实心心形一直显示。
  const HEART_PATH = icons.heart;
  const heartSvg = (cls = "nav-heart-icon") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${HEART_PATH}"/></svg>`;
  function favoriteHeartState(id, label) {
    const on = NF.isFavorite(state.laiSettings, id);
    return { on, label: `${on ? "取消常用" : "设为常用"}：${label}` };
  }
  // 条目 id 不在可设为常用的清单里（保留入口、客户详情等）时不生成心形。
  function favoriteHeart(id, label, attrs = "") {
    if (!id || !NF.known(id)) return "";
    const heart = favoriteHeartState(id, label);
    return `<button type="button" class="nav-heart${heart.on ? " is-favorite" : ""}" data-nav-favorite="${E(id)}" data-nav-label="${E(label)}" aria-label="${E(heart.label)}" title="${E(heart.label)}"${attrs}>${heartSvg()}</button>`;
  }
  // 同一个条目可能同时出现在二级导航、悬停浮层等几处：保存成功后把所有心形一起更新。
  function syncFavoriteHearts() {
    document.querySelectorAll("[data-nav-favorite]").forEach((button) => {
      const heart = favoriteHeartState(button.dataset.navFavorite, button.dataset.navLabel);
      button.classList.toggle("is-favorite", heart.on);
      button.setAttribute("aria-label", heart.label);
      button.title = heart.label;
    });
  }
  // 常用列表变了之后，把依赖它的几处界面当场更新：心形、常用模式下的二级导航、「常用」页自身、打开着的「常用」浮层。
  function refreshFavoriteViews() {
    syncFavoriteHearts();
    if (favoritesMode) {
      const aside = document.querySelector("#app-subnav");
      if (aside) aside.innerHTML = subnav();
    }
    if (activeRoute === "favorites") {
      const main = document.querySelector(".main");
      if (main) main.innerHTML = favoritesHomeMarkup();
    }
    const flyout = document.querySelector(".rail-flyout");
    if (flyout?.dataset.menu === "常用") flyout.innerHTML = flyoutPanel("常用");
  }
  // 连续快速点击时按顺序保存，后一次在前一次保存完成后再计算，不会因为「上一项修改正在保存」而丢失。
  let favoriteSaveChain = Promise.resolve();
  function saveFavoriteNav(change) {
    const run = favoriteSaveChain.then(() => writeFavoriteNav(change));
    favoriteSaveChain = run.catch(() => {});
    return run;
  }
  async function writeFavoriteNav(change) {
    if (!(await window.flushPendingSave())) return false;
    try {
      await persist({ ...state, laiSettings: change(state.laiSettings) });
    } catch (error) {
      toast(error.message);
      return false;
    }
    refreshFavoriteViews();
    return true;
  }
  // 点心形：切换常用状态。在「常用」二级导航里点实心心形等于移除，列表重画后把焦点放到原位置附近，不丢失。
  async function toggleFavoriteHeart(button, id) {
    const inList = favoritesMode && !!button.closest?.("#app-subnav");
    const index = inList ? [...document.querySelectorAll("#app-subnav [data-nav-favorite]")].indexOf(button) : -1;
    const saved = await saveFavoriteNav((settings) => NF.toggle(settings, id));
    if (!saved || !inList) return saved;
    const hearts = [...document.querySelectorAll("#app-subnav [data-nav-favorite]")];
    (hearts[Math.min(index, hearts.length - 1)] || document.querySelector('#app-subnav [data-action="favorite-nav-manage"]'))?.focus({ preventScroll: true });
    return saved;
  }
  const FAVORITE_HINT = "把鼠标移到导航条目上，点右侧的心形，就能加到常用。";
  function favoriteNavPanel(pointerActivated = false) {
    const items = favoriteEntries();
    const rows = items
      .map(
        (entry, index) =>
          `<li class="favorite-nav-row"><button type="button" class="favorite-nav-jump" data-favorite-jump="${entry.id}">${E(entry.label)}${entry.menu === entry.label ? "" : `<small>${E(entry.menu)}</small>`}</button><span class="favorite-nav-actions"><button type="button" data-favorite-move="${entry.id}" data-direction="-1" aria-label="上移${E(entry.label)}" title="上移"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-favorite-move="${entry.id}" data-direction="1" aria-label="下移${E(entry.label)}" title="下移"${index === items.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-favorite-remove="${entry.id}" aria-label="从常用移除${E(entry.label)}">移除</button></span></li>`,
      )
      .join("");
    drawer(
      "管理常用",
      `<div class="drawer-body favorite-nav-body">${items.length ? `<ul class="favorite-nav-list">${rows}</ul>` : `<div class="feature-state"><strong>还没有常用导航</strong>${FAVORITE_HINT}</div>`}<p class="module-note">点名称可直接跳转；用 ↑ ↓ 调整顺序。客户、工作台、邮件、交易、团队数据、日历与待办、设置里的页面都可以设为常用。</p></div>`,
      `<button class="primary" data-action="close-modal">关闭</button>`,
      "favorites",
      pointerActivated,
    );
  }
  // ---- 打开导航条目 ----
  // 打开某个客户页面；favorites 为真时保持左侧「常用」高亮与「常用」二级导航。
  async function openCustomerScreen(screen, favorites = false) {
    if (!(await navigateApp("customers", "", true, favorites))) return false;
    if (screen === "customer-settings") customerSettings();
    else if (screen !== "active") showCustomerScreen(screen);
    return true;
  }
  // 条目可以是客户页面、业务页面或邮件文件夹；返回 false 表示被拦住（例如有未保存的编辑），界面保持原样。
  async function openNavEntry(entry, favorites = false) {
    if (entry.kind === "route") return navigateApp(entry.target, "", true, favorites);
    if (entry.kind === "mail") return navigateApp("mail", "", true, favorites, entry.target);
    return openCustomerScreen(entry.target, favorites);
  }
  // 从「常用」列表（二级导航、管理面板、浮层）打开一项：始终进入常用模式。
  async function openFavoriteNav(id) {
    const entry = NF.entry(id);
    return entry ? openNavEntry(entry, true) : false;
  }
  // 点左侧「常用」：打开列表第一项；列表为空时进入「常用」页，明确告诉用户怎么添加。
  function openFavorites() {
    const first = favoriteEntries()[0];
    return first ? openNavEntry(first, true) : navigateApp("favorites", "", true, true);
  }
  // 当前页面对应的导航条目 id，用来在「常用」二级导航里高亮当前所在的一项；不是导航条目的页面返回空串。
  function currentNavId() {
    if (activeRoute === "customers") return "screen:" + customerScreen;
    if (activeRoute === "mail") return mail.view() === "mail" ? "mail:" + mail.folder() : "";
    if (activeRoute === "favorites") return "";
    return "route:" + activeRoute;
  }
  function favoritesHomeMarkup() {
    const has = NF.list(state.laiSettings).length > 0;
    const body = has
      ? `<strong>从左侧选一项常用导航</strong><span>点列表里的任意一项直接打开；用「管理常用」调整顺序或移除。</span>`
      : `<strong>还没有常用导航</strong><span>${FAVORITE_HINT}</span><span>设为常用的条目会一直亮着实心心形，再点一下就取消；它们会按添加的顺序出现在左侧这个列表里。</span>`;
    return `<div class="pagebar"><div class="page-tabs"><h1>常用</h1></div></div><section class="module-page favorites-page"><div class="empty favorites-empty"><div class="favorites-empty-art">${heartSvg("favorites-empty-icon")}</div>${body}</div></section>`;
  }
  function showFavoritesHome() {
    window.LaiActivityCategoryNavigation.mount(null);
    closeDropdowns();
    removePopover();
    $("#app").innerHTML = shell(favoritesHomeMarkup());
  }
  function navRow(entry, active, attrs, content) {
    return `<div class="nav-row"><button type="button" class="nav-entry${active ? " active" : ""}" ${attrs}${active ? ' aria-current="page"' : ""}>${content}</button>${favoriteHeart(entry.id, entry.label)}</div>`;
  }
  function favoritesSubnav() {
    const items = favoriteEntries();
    const current = currentNavId();
    const toggle = activeRoute === "customers" ? customerNavToggle(true) : "";
    // 邮件页的「写信」按钮原本在邮件自己的二级导航里；常用模式下二级导航换成了常用列表，这里补一个，免得进了常用就写不了信。
    const compose = activeRoute === "mail" ? `<button type="button" class="primary mail-compose" data-mail-action="compose">写 信</button>` : "";
    return `<h3>常用${toggle}</h3>${compose}${
      items.length
        ? items
            .map((entry) =>
              navRow(entry, entry.id === current, `data-favorite-open="${entry.id}" title="${E(entry.menu)} · ${E(entry.label)}"`, `<span class="nav-label">${E(entry.label)}</span>`),
            )
            .join("")
        : `<p class="subnav-empty">还没有常用导航。${FAVORITE_HINT}</p>`
    }<div class="nav-row"><button class="nav-entry nav-manage" data-action="favorite-nav-manage">管理常用</button></div>`;
  }
  // ---- 左侧栏悬停浮层：每个菜单显示它包含的入口 ----
  function hideRailFlyout() {
    clearTimeout(hideRailFlyout.timer);
    document.querySelector(".rail-flyout")?.remove();
  }
  // 浮层里的一行：条目名称（点了跳转并关闭浮层）＋右侧心形（只切换常用，不跳转、不关闭）。
  function flyoutRow(row) {
    const item = `<button type="button" role="menuitem" class="rail-flyout-item" data-flyout-kind="${row.kind}" data-flyout-target="${E(row.target)}">${E(row.label)}</button>`;
    return `<div class="rail-flyout-row" role="none">${item}${favoriteHeart(row.id, row.label, ' role="menuitem"')}</div>`;
  }
  function flyoutPanel(label) {
    const rows = label === "常用"
      ? favoriteEntries().map((entry) => ({ label: entry.label, kind: "favorite", target: entry.id, id: entry.id }))
      : menuRows(label);
    const body = rows === null
      ? '<div class="rail-flyout-note">功能入口已保留，深入功能待后续实现。</div>'
      : rows.length
        ? rows.map(flyoutRow).join("")
        : `<div class="rail-flyout-note">还没有常用导航。${FAVORITE_HINT}</div>`;
    return `<div class="rail-flyout-panel" role="menu" aria-label="${E(label)}">${body}</div>`;
  }
  function showRailFlyout(item) {
    const rail = item.closest(".rail");
    if (!rail) return;
    const label = item.dataset.railMenu;
    const existing = document.querySelector(".rail-flyout");
    if (existing?.dataset.menu === label) return;
    existing?.remove();
    const flyout = document.createElement("div");
    flyout.className = "rail-flyout";
    flyout.dataset.menu = label;
    flyout.innerHTML = flyoutPanel(label);
    rail.after(flyout);
    const top = rail.offsetTop + item.offsetTop - (item.closest(".rail-scroll")?.scrollTop || 0);
    const bottomLimit = rail.offsetTop + rail.offsetHeight - 8;
    flyout.style.top = `${Math.max(rail.offsetTop, Math.min(top, bottomLimit - flyout.offsetHeight))}px`;
  }
  function activateRailFlyout(kind, target) {
    hideRailFlyout();
    if (kind === "feature") return featureNotice(target);
    if (kind === "favorite") return openFavoriteNav(target);
    return openNavEntry({ kind, target }, false);
  }
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const item = event.target.closest?.(".rail-item[data-rail-menu]");
    if (item) {
      clearTimeout(hideRailFlyout.timer);
      showRailFlyout(item);
      return;
    }
    if (event.target.closest?.(".rail-flyout")) {
      clearTimeout(hideRailFlyout.timer);
      return;
    }
    if (document.querySelector(".rail-flyout")) {
      clearTimeout(hideRailFlyout.timer);
      hideRailFlyout.timer = setTimeout(hideRailFlyout, 160);
    }
  });
  document.addEventListener("mouseleave", hideRailFlyout);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideRailFlyout();
  });
  // 左侧「邮件」图标上的未读数：邮件模块一有新数字就更新，不用重画整页。
  function mailBadge() {
    const unread = Number(mail?.counts?.()?.unread) || 0;
    return unread ? `<i class="rail-badge" aria-label="${unread} 封未读邮件">${unread > 99 ? "99+" : unread}</i>` : "";
  }
  function updateMailBadge() {
    const item = $('.rail-item[data-lai-route="mail"]');
    if (!item) return;
    item.querySelector(".rail-badge")?.remove();
    item.insertAdjacentHTML("beforeend", mailBadge());
  }
  function subnav() {
    if (favoritesMode) return favoritesSubnav();
    if (activeRoute === "mail") return mail.subnav();
    if (activeRoute === "customers")
      return `<h3>客户${customerNavToggle(true)}</h3>${RM.menuFor("客户")
        .filter(entryAllowed)
        .map((row) => navRow(row, row.target === customerScreen, `data-lai-screen="${row.target}"`, `${menuIcon({ active: "people", pool: "globe", duplicates: "search", "customer-settings": "settings" }[row.target])}<span class="nav-label">${E(row.label)}</span>`))
        .join("")}`;
    const section = RM.sectionFor(activeRoute);
    if (!section) return "";
    section.entries = section.entries.filter(entryAllowed);
    if (!section.entries.length) return "";
    const routeIcons = { roles: "settings", members: "people", dashboard: "grid", "order-list": "box", "order-trash": "folder", products: "box", "doc-templates": "note", analysis: "chart", "team-goals": "check", "team-targets": "settings", "team-wall": "grid", "team-assets": "people", "team-followups": "chat", "team-tasks": "check", "team-orders": "note", leads: "lead", "lead-trash": "folder", opportunities: "globe", "opp-analysis": "chart", "opp-flows": "settings", calendar: "clock", settings: "settings", "settings-hub": "settings" };
    const entryButton = (entry) =>
      entry.kind === "feature"
        ? `<button class="nav-entry" data-feature="${E(entry.target)}">${icon("more")}<span class="nav-label">${E(entry.label)}</span></button>`
        : navRow(entry, entry.target === activeRoute, `data-lai-route="${entry.target}"`, `${menuIcon(routeIcons[entry.target])}<span class="nav-label">${E(entry.label)}</span>`);
    const groups = [...new Set(section.entries.map((entry) => entry.group).filter(Boolean))];
    if (!groups.length) return `<h3>${E(section.label)}</h3>${section.entries.map(entryButton).join("")}`;
    return `<h3>${E(section.label)}</h3>${groups
      .map(
        (group) =>
          `<details class="subnav-group" open><summary>${E(group)}</summary>${section.entries
            .filter((entry) => entry.group === group)
            .map(entryButton)
            .join("")}</details>`,
      )
      .join("")}`;
  }
  // 业务页面的清单取自 rail-menu.js，与「可设为常用」同一份来源。
  const businessRoutes = new Set(RM.favoritable().filter((entry) => entry.kind === "route").map((entry) => entry.target));
  async function navigateApp(route, name, animateDetail = true, favorites = false, folder = "") {
    // 离开邮件页时，正在写的信自动存成草稿；存不下来就留在原地。
    if (activeRoute === "mail" && mail?.composing() && !(await mail.leave())) return false;
    if (!(await window.flushPendingSave())) return false;
    rememberCustomerListViewport();
    closeModal();
    // 「favorites」是列表为空时的「常用」页。
    activeRoute = route === "mail" || route === "favorites" || businessRoutes.has(route) ? route : "customers";
    favoritesMode = favorites || activeRoute === "favorites";
    // 「收起导航」只有客户页有恢复按钮；去别的页面时恢复显示，否则二级导航会藏起来又没处可点。
    if (activeRoute !== "customers") $("#app").classList.remove("nav-collapsed");
    currentName = "";
    history.replaceState(null, "", "#" + activeRoute);
    // 当前账号打不开的页面：显示原因，不显示页面。
    const blockKey = activeRoute === "mail" ? R.pagePerm("mail") : businessRoutes.has(activeRoute) ? R.pagePerm("route", activeRoute) : null;
    if (blockKey && !R.can(state, blockKey)) {
      blockedPage(activeRoute === "mail" ? "邮件" : RM.entryById("route:" + activeRoute)?.label || "页面", R.denied(blockKey));
      return true;
    }
    if (activeRoute === "customers") {
      if (name) detail(name, false, animateDetail ? "detail" : "");
      else showCustomerScreen(firstCustomerScreen());
    } else if (activeRoute === "mail") mail.select(folder);
    else if (activeRoute === "favorites") showFavoritesHome();
    else business.navigate(activeRoute);
    return true;
  }
  function showCustomerScreen(screen) {
    if (screen === "customer-settings") return customerSettings();
    if (screenBlocked(screen)) return;
    window.LaiActivityCategoryNavigation.mount(null);
    rememberCustomerListViewport();
    customerScreen = screen;
    currentName = "";
    selected.clear();
    if (screen === "active") return list();
    const names = {
      pool: "公海客户",
      trash: "客户回收站",
      duplicates: "客户查重",
    };
    let body = "";
    if (screen === "duplicates") {
      // 本人范围的账号只在自己的客户里查重。
      const mine = R.scopeOf(state) === "all" ? null : new Set(allCustomerRows().map((row) => row.name));
      const groups = L.findDuplicates(state, CSM.get(state).dedupe)
        .map((g) => (mine ? { ...g, names: g.names.filter((name) => mine.has(name)) } : g))
        .filter((g) => g.names.length > 1);
      const dupChosen = CSM.get(state).duplicateFields;
      const dupFields = CSM.DUPLICATE_FIELDS.filter(([key]) => dupChosen.includes(key));
      body = `<div class="module-note">按完全相同的邮箱或电话号码查找疑似重复客户。先核对资料，再决定合并或移入回收站；合并只在你确认后才做，订单会一起并到保留的客户名下。</div>${groups.length ? groups.map((g) => `<section class="duplicate-card"><h3>${E(g.type)}相同 <span>${E(g.value)}</span>${showIf("customer.merge", `<button type="button" class="duplicate-merge" data-action="merge-group" data-names="${E(g.names.join("\u0001"))}">合并这组</button>`)}</h3>${g.names.map((name) => `<div><button class="company-link" data-open="${E(name)}">${E(name)}</button>${dupFields.map(([key, label]) => `<span>${E(label)}：${E(CSM.duplicateValue(state, name, key) ? (key === "country" ? C.countryLabel(state.customers[name]?.country) : CSM.duplicateValue(state, name, key)) : "—")}</span>`).join("")}<button data-open="${E(name)}">查看资料</button></div>`).join("")}</section>`).join("") : '<div class="empty">' + icon("check") + "<strong>未发现相同邮箱或电话的客户</strong><span>当前检查 " + (mine ? mine.size : Object.keys(state.customers).length) + " 个客户档案</span></div>"}`;
    } else {
      const data = allCustomerRows().filter(
        (c) => L.bucket(state.customers[c.name]) === screen,
      );
      body = `<div class="module-note">${screen === "pool" ? "移入公海的客户在这里集中管理。领回时选跟进人，默认是原跟进人。" : "回收站保留客户资料与关联订单。恢复后回到原来的客户列表或公海。"}</div><div class="module-table-wrap"><table class="order-table"><thead><tr><th>客户名称</th><th>国家地区</th><th>主要联系人</th><th>订单数</th><th>操作</th></tr></thead><tbody>${data.map((c) => `<tr><td><button class="company-link" data-open="${E(c.name)}">${E(c.name)}</button></td><td>${E(C.countryLabel(c.country))}</td><td>${E(screen === "pool" && !CT.poolContactsVisible(state) ? "已隐藏" : c.contact || "—")}</td><td>${c.orderCount}</td><td>${(screen === "pool" ? can("pool.claim") || can("pool.assign") : can("customer.trash")) ? `<button class="primary" data-customer-transition="${screen === "pool" ? "active" : "restore"}" data-customer-name="${E(c.name)}">${screen === "pool" ? "领回客户" : "恢复客户"}</button>` : ""}<button class="text-button" data-open="${E(c.name)}">查看</button></td></tr>`).join("")}</tbody></table>${data.length ? "" : '<div class="empty">' + icon("folder") + "<strong>" + (screen === "pool" ? "公海中暂无客户" : "回收站为空") + "</strong><span>" + (screen === "pool" ? "客户移入公海后会显示在这里" : "删除的客户会显示在这里") + "</span></div>"}</div>`;
    }
    $("#app").innerHTML = shell(
      `<div class="pagebar"><div class="page-tabs"><h1>${names[screen]}</h1></div><button data-lai-screen="active">返回客户列表</button></div><section class="module-page">${body}</section>`,
    );
    document
      .querySelectorAll("[data-lai-screen]")
      .forEach((el) =>
        el.classList.toggle("active", el.dataset.laiScreen === screen),
      );
  }
  // ---- 头像菜单：当前账号、切换测试账号 ----
  function profileMenuMarkup() {
    const me = R.currentMember(state);
    const roleName = (member) => R.roleOf(state, member)?.name || "";
    const others = R.settings(state).members.filter((member) => member.id !== me.id);
    const switcher = others.length
      ? `<hr><div class="account-label">切换测试账号</div>${others
          .map((member) => `<button type="button" data-lai-switch-member="${E(member.id)}">${E(member.name)} · ${E(roleName(member))}</button>`)
          .join("")}`
      : "";
    return `<div class="account-head"><strong>${E(me.name)}</strong> · ${E(roleName(me))}</div>${switcher}<hr>${
      R.canOpen(state, "route", "settings") ? '<button data-lai-route="settings">来财设置</button>' : ""
    }${showIf("settings.roles", '<button data-lai-route="roles">角色权限</button><button data-lai-route="members">成员管理</button>')}<button data-action="about">关于来财</button>`;
  }
  // 当前页面这个账号能不能打开（换账号后用来决定是留在原页面还是回工作台）。
  function currentPageAllowed() {
    if (activeRoute === "favorites") return true;
    if (activeRoute === "mail") return R.canOpen(state, "mail", "inbox");
    if (activeRoute === "customers") {
      if (currentName) {
        const key = L.bucket(state.customers?.[currentName]) === "pool" ? "pool.view" : "customer.view";
        return can(key) && !customerHidden(currentName);
      }
      return R.canOpen(state, "screen", customerScreen);
    }
    return R.canOpen(state, "route", activeRoute);
  }
  // 换账号或改了角色权限之后，整个界面按当前账号重画；当前页面这个账号打不开时回工作台。
  async function rerenderApp() {
    hideRailFlyout();
    removePopover();
    rebuildRows();
    if (!currentPageAllowed()) {
      favoritesMode = false;
      return navigateApp("dashboard");
    }
    if (activeRoute === "customers") return refresh();
    if (activeRoute === "mail") return navigateApp("mail", "", true, favoritesMode, mail.folder());
    if (activeRoute === "favorites") return showFavoritesHome();
    return business.navigate(activeRoute);
  }
  // 切到另一个测试账号：只是预览不同角色看到什么，不需要密码。
  async function switchAccount(id) {
    removePopover();
    if (id === R.currentMember(state).id) return true;
    if (!(await window.flushPendingSave())) return false;
    try {
      await persist(R.switchTo(state, id));
    } catch (error) {
      toast(error.message);
      return false;
    }
    // 上一个账号的筛选（比如“我的客户”）不带到新账号。
    filters.owner = "";
    team = "team";
    selected.clear();
    page = 1;
    await rerenderApp();
    toast(`已切换到 ${R.meName(state)}（${R.roleOf(state)?.name || ""}）`);
    return true;
  }
  function transitionDialog(names, target, pointerActivated = false) {
    if (target === "pool" ? !allow("customer.toPool") : names.some((n) => L.bucket(state.customers?.[n] || {}) === "pool") ? !allow("pool.delete") : !allow("customer.trash")) return;
    const label = target === "pool" ? "移入公海" : "移入回收站";
    const pool = target === "pool" ? CT.poolRules(state) : null;
    // 公海规则里设了原因（或要求必填）时，移入公海要选原因；没设原因却要求必填时让他自己写。
    const reasonField = !pool || !(pool.reasons.length || pool.requireReason) ? ""
      : pool.reasons.length
        ? `<label class="field" for="transition-reason"><span>原因${pool.requireReason ? "" : "（选填）"}</span><select id="transition-reason" name="reason">${pool.requireReason ? '<option value="">请选择原因</option>' : '<option value="">不填</option>'}${pool.reasons.map((reason) => `<option value="${E(reason)}">${E(reason)}</option>`).join("")}</select></label>`
        : `<label class="field" for="transition-reason"><span>原因</span><input id="transition-reason" name="reason" maxlength="50" autocomplete="off" placeholder="请填写移入公海的原因"></label>`;
    drawer(
      label,
      `<div class="drawer-body"><p>将 ${names.length} 位客户${label}：</p><div class="transition-names">${names.map((n) => `<div>${E(n)}</div>`).join("")}</div>${reasonField}<p class="module-note">${target === "pool" ? "客户将从当前列表移到公海，领回时可选跟进人，默认是原跟进人。" : "客户资料和关联订单都会保留，可从回收站恢复。"}</p><div class="error" id="workspace-error" role="alert"></div></div>`,
      `<button data-action="close-modal">取消</button><button class="primary" id="confirm-transition">确认${label}</button>`,
      "transition",
      pointerActivated,
    );
    $("#confirm-transition").onclick = () =>
      (target === "pool" ? allow("customer.toPool") : allow("customer.trash")) &&
      workspaceSave(
        () => L.moveCustomers(state, names, target, undefined, reasonField ? { reason: $("#transition-reason")?.value || "" } : undefined),
        () => {
          currentName = "";
          selected.clear();
          customerScreen = "active";
        },
      );
  }
  // 领回客户：选谁来跟进（默认原跟进人），公海规则里的领回限制、领取上限、客户上限由 moveCustomers 检查。
  function claimDialog(name, pointerActivated = false) {
    if (!can("pool.claim") && !can("pool.assign")) { allow("pool.claim"); return; }
    const profile = state.customers?.[name] || {};
    const previous = String(profile.laiPreviousOwner || "").trim();
    // 只有“领取”没有“分配”的角色，只能领给自己。
    const owners = can("pool.assign") ? [...new Set([previous, ...ownerChoices()].filter(Boolean))] : [R.meName(state)].filter(Boolean);
    const first = can("pool.assign") ? previous || owners[0] || "" : owners[0] || "";
    drawer(
      "领回客户",
      `<form id="claim-form" class="drawer-body claim-form"><p>领回客户：<strong>${E(name)}</strong></p>${owners.length ? `<label class="field" for="claim-owner"><span>跟进人</span><select id="claim-owner" name="owner">${owners.map((owner) => `<option value="${E(owner)}" ${owner === first ? "selected" : ""}>${E(owner)}${owner === previous ? "（原跟进人）" : ""}</option>`).join("")}</select></label>` : `<label class="field" for="claim-owner"><span>跟进人</span><input id="claim-owner" name="owner" maxlength="120" autocomplete="off" placeholder="填写跟进人"></label>`}<p class="module-note" id="claim-quota"></p><div class="error" id="workspace-error" role="alert"></div></form>`,
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="claim-form" class="primary">确认领回</button>`,
      "actions",
      pointerActivated,
    );
    const form = $("#claim-form");
    const quota = () => {
      const owner = form.elements.owner.value.trim();
      const limit = owner ? CT.claimLimitFor(state, owner) : 0;
      $("#claim-quota").textContent = limit > 0 ? `近 ${CT.poolRules(state).claimLimit.periodDays} 天已领 ${CT.claimCount(state, owner)} / 上限 ${limit}` : "";
      $("#claim-quota").hidden = !(limit > 0);
    };
    form.elements.owner.addEventListener("change", quota);
    form.elements.owner.addEventListener("input", quota);
    quota();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const owner = form.elements.owner.value.trim();
      workspaceSave(
        () => L.moveCustomers(state, [name], "active", undefined, { owner }),
        () => {
          currentName = "";
          selected.clear();
        },
      );
    });
  }
  function customerActions(pointerActivated = false) {
    const c = state.customers[currentName] || {},
      status = L.bucket(c);
    drawer(
      "客户操作",
      `<div class="drawer-body"><h3>${E(currentName)}</h3><div class="customer-action-list">${status === "trash" ? showIf("customer.trash", `<button data-customer-transition="restore" data-customer-name="${E(currentName)}">恢复客户</button>`) : status === "pool" ? (can("pool.claim") || can("pool.assign") ? `<button data-customer-transition="active" data-customer-name="${E(currentName)}">领回客户</button>` : "") : `${showIf("customer.toPool", '<button data-action="move-current-pool">移入公海</button>')}${showIf("customer.trash", '<button data-action="archive-current">移入回收站</button>')}`}<button data-lai-route="order-list">查看订单列表</button></div><div class="error" id="workspace-error" role="alert"></div></div>`,
      `<button data-action="close-modal">关闭</button>`,
      "actions",
      pointerActivated,
    );
  }
  function closeCustomerTagEditor(restoreFocus = false, animate = false) {
    const box = $(".tag-popover");
    if (!box) return;
    const trigger = box._trigger;
    trigger?.setAttribute("aria-expanded", "false");
    if ((restoreFocus || box.contains(document.activeElement)) && trigger?.isConnected) trigger.focus();
    if (!animate) {
      clearTimeout(box._closeTimer);
      box.remove();
      return;
    }
    if (box.classList.contains("tag-popover-closing")) return;
    const style = getComputedStyle(box);
    box.style.setProperty("--tag-exit-transform", style.transform);
    box.style.setProperty("--tag-exit-opacity", style.opacity);
    box.classList.remove("tag-popover-motion");
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.classList.add("tag-popover-closing");
    const finish = () => {
      clearTimeout(box._closeTimer);
      box.remove();
    };
    box.addEventListener("animationend", finish, { once: true });
    box._closeTimer = setTimeout(finish, 240);
  }
  // 改客户标签要有编辑权限（公海客户看公海编辑权限）。
  const tagEditKey = (name) => (L.bucket(state.customers?.[name] || {}) === "pool" ? "pool.edit" : "customer.edit");
  function customerTagEditor(anchor, pointerActivated = false) {
    const name = currentName;
    if (!allow(tagEditKey(name))) return;
    if (L.bucket(state.customers?.[name] || {}) === "trash")
      return toast("请先恢复回收站客户");
    const tags = M.tags(state.customers?.[name]?.tags);
    const box = popover(
      anchor,
      `<form id="customer-tags-form" aria-label="编辑客户标签"><h4>客户标签</h4><label for="customer-tags-input">用逗号分隔多个标签</label><input id="customer-tags-input" name="tags" value="${E(tags.join("，"))}" maxlength="400" autocomplete="off"><div id="workspace-error" class="error" role="alert"></div><div class="tag-editor-actions"><button type="button" data-action="cancel-customer-tags">取消</button><button type="submit" class="primary">保存</button></div></form>`,
      `tag-popover${pointerActivated ? " tag-popover-motion" : ""}`,
    );
    box.id = "customer-tags-menu";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "编辑客户标签");
    anchor.setAttribute("aria-expanded", "true");
    const anchorRect = anchor.getBoundingClientRect();
    box.style.top = Math.max(8, Math.min(anchorRect.bottom, innerHeight - box.offsetHeight - 12)) + "px";
    box.querySelector("#customer-tags-input").focus();
    box.querySelector('[data-action="cancel-customer-tags"]').addEventListener("click", (event) => {
      closeCustomerTagEditor(true, event.detail > 0);
    });
    box.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!allow(tagEditKey(name))) return;
      const value = event.currentTarget.elements.tags.value;
      let saved = false;
      await workspaceSave(() => M.upsertCustomer(state, name, { name, tags: value }), () => {
        saved = true;
        closeCustomerTagEditor();
      });
      if (saved) $("[data-action='customer-tags']")?.focus();
    });
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el || el.disabled) return;
    const d = el.dataset;
    if (d.flyoutKind) return activateRailFlyout(d.flyoutKind, d.flyoutTarget);
    if (el.closest(".rail")) hideRailFlyout();
    if (d.laiSwitchMember) return switchAccount(d.laiSwitchMember);
    if (d.laiRoute) return navigateApp(d.laiRoute);
    if (d.mailFolder) return mail.select(d.mailFolder);
    if (d.mailAction) return mail.action(d.mailAction, e.detail > 0, el);
    if (d.mailView) return mail.showView(d.mailView);
    if (d.navFavorite) return toggleFavoriteHeart(el, d.navFavorite);
    if (d.action === "favorite-nav") return openFavorites();
    if (d.action === "favorite-nav-manage") return favoriteNavPanel(e.detail > 0);
    // 设置中心里的“邮箱设置”：先去邮件页，再打开原来的邮箱设置弹窗。
    if (d.action === "open-mail-settings") return navigateApp("mail").then((ok) => ok !== false && mail.action("account", e.detail > 0));
    if (d.favoriteOpen) return openFavoriteNav(d.favoriteOpen);
    if (d.favoriteJump) return openFavoriteNav(d.favoriteJump);
    if (d.favoriteMove)
      return saveFavoriteNav((settings) => NF.move(settings, d.favoriteMove, Number(d.direction))).then((saved) => {
        if (!saved) return;
        // 保持焦点在刚点的按钮；移到边界后该按钮变为禁用，则回到同一行的名称。
        const same = `[data-favorite-move="${d.favoriteMove}"][data-direction="${d.direction}"]`;
        favoriteNavPanel();
        const target = $(same);
        (target && !target.disabled ? target : $(`[data-favorite-jump="${d.favoriteMove}"]`))?.focus({ preventScroll: true });
      });
    if (d.favoriteRemove)
      return saveFavoriteNav((settings) => NF.remove(settings, d.favoriteRemove)).then((saved) => {
        if (!saved) return;
        favoriteNavPanel();
        ($(".favorite-nav-jump") || $(".drawer-footer .primary"))?.focus({ preventScroll: true });
      });
    // 从别的页面（比如设置中心）进客户页面时要真正换页：网址、左侧高亮才会跟着走。
    if (d.laiScreen && activeRoute !== "customers") return openCustomerScreen(d.laiScreen);
    if (d.laiScreen === "customer-settings") return customerSettings();
    if (d.laiScreen) return showCustomerScreen(d.laiScreen);
    if (d.customerTransition === "active") return claimDialog(d.customerName, e.detail > 0);
    if (d.customerTransition && !allow(d.customerTransition === "restore" ? "customer.trash" : d.customerTransition === "pool" ? "customer.toPool" : "customer.trash")) return;
    if (d.customerTransition)
      return workspaceSave(
        () => L.moveCustomers(state, [d.customerName], d.customerTransition),
        () => {
          currentName = "";
          selected.clear();
        },
      );
    if (d.action === "batch-pool" || d.action === "batch-trash")
      return transitionDialog(
        [...selected],
        d.action === "batch-pool" ? "pool" : "trash",
        e.detail > 0,
      );
    if (d.action === "move-current-pool" || d.action === "archive-current")
      return transitionDialog(
        [currentName],
        d.action === "move-current-pool" ? "pool" : "trash",
        e.detail > 0,
      );
    if (d.action === "customer-actions") return customerActions(e.detail > 0);
    if (d.action === "customer-tags") return customerTagEditor(el, e.detail > 0);
  });

  function featureNotice(name, pointerActivated = false) {
    if (modal) {
      toast(`${name}：功能入口已保留，深入功能待后续实现。`);
      return;
    }
    drawer(
      name,
      `<div class="drawer-body"><div class="feature-state"><strong>${E(name)}</strong>功能入口已保留。深入功能待后续实现，具体范围由你后续决定。</div></div>`,
      `<button class="primary" data-action="close-modal">知道了</button>`,
      "feature",
      pointerActivated,
    );
    $(".drawer").classList.add("feature-dialog");
  }
  function closeActivitySortMenu(restoreFocus = false, animate = false) {
    const box = $(".activity-sort-popover");
    if (!box) return;
    const trigger = box._trigger;
    trigger?.setAttribute("aria-expanded", "false");
    if ((restoreFocus || box.contains(document.activeElement)) && trigger?.isConnected) trigger.focus();
    if (!animate) {
      clearTimeout(box._closeTimer);
      box.remove();
      return;
    }
    if (box.classList.contains("activity-sort-closing")) return;
    const style = getComputedStyle(box);
    box.style.setProperty("--sort-exit-from-transform", style.transform);
    box.style.setProperty("--sort-exit-from-opacity", style.opacity);
    box.classList.remove("activity-sort-popover-motion");
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.classList.add("activity-sort-closing");
    const finish = () => {
      clearTimeout(box._closeTimer);
      box.remove();
    };
    box.addEventListener("animationend", finish, { once: true });
    box._closeTimer = setTimeout(finish, 240);
  }
  function closeActivityAdvancedFilterMenu(restoreFocus = false, animate = false) {
    const box = $(".activity-filter-popover");
    if (!box) return;
    const trigger = box._trigger;
    trigger?.setAttribute("aria-expanded", "false");
    if ((restoreFocus || box.contains(document.activeElement)) && trigger?.isConnected) trigger.focus();
    if (!animate) {
      clearTimeout(box._closeTimer);
      box.remove();
      return;
    }
    if (box.classList.contains("activity-filter-closing")) return;
    const style = getComputedStyle(box);
    box.style.setProperty("--filter-exit-from-transform", style.transform);
    box.style.setProperty("--filter-exit-from-opacity", style.opacity);
    box.classList.remove("activity-filter-popover-motion");
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.classList.add("activity-filter-closing");
    const finish = () => {
      clearTimeout(box._closeTimer);
      box.remove();
    };
    box.addEventListener("animationend", finish, { once: true });
    box._closeTimer = setTimeout(finish, 240);
  }
  function activityAdvancedFilterMenu(anchor, pointerActivated = false) {
    const customer = allCustomerRows().find((row) => row.name === currentName);
    if (!customer) return;
    const storedHistory = state.customers?.[currentName]?.history;
    const history = (Array.isArray(storedHistory) ? storedHistory : []).filter((item) => item.type !== "operation");
    const contacts = [...new Set([
      ...(Array.isArray(customer.contacts) ? customer.contacts : []).map((contact) => typeof contact === "object" ? contact?.contact || contact?.name : contact),
      ...history.map((item) => item.contact || item.contactName || item.contactId),
    ].filter(Boolean).map(String))];
    const owners = [...new Set(history.map((item) => item.owner).filter(Boolean).map(String))];
    const types = [
      ["followup", "跟进记录", [["quick", "快速记录"], ["phone", "电话"], ["meeting", "会面"], ["social", "社交平台"], ["schedule", "日程"]]],
      ["email", "往来邮件", [["received", "收件"], ["sent", "发件"], ["edm", "EDM邮件"], ["aireach", "AiReach 代发"]]],
      ["chat", "聊天记录", [["whatsapp", "WhatsApp"], ["facebook", "Facebook"], ["tm", "TM"], ["whatsappbusiness", "WhatsApp企业版"], ["whatsappgroup", "WhatsApp群聊"], ["aireach", "AiReach 代发"], ["wecom", "企业微信"], ["wecomgroup", "企业微信群组"], ["instagrammessenger", "Instagram Messenger"], ["whatsappoutbound", "WhatsApp代发"]]],
      ["other", "其它", [["opportunity", "商机"], ["quote", "报价单"], ["order", "销售订单"], ["inquiry", "询盘"], ["web", "网站行为"], ["quotetask", "报价任务"], ["businesscard", "OKKI 名片夹"], ["comment", "评论"], ["nocomment", "无评论"], ["hascomment", "有评论"]]],
    ];
    const selected = new Set(activityAdvanced.types || []);
    const check = (key, label, group = false) => `<label class="activity-filter-choice"><input type="checkbox" name="activityType" value="${E(key)}" ${group ? `data-activity-type-group="${E(key)}"` : ""} ${selected.has(key) ? "checked" : ""}><span>${E(label)}</span></label>`;
    const options = (values) => `<option value="">请选择</option>${values.map((value) => opt(value, value, "")).join("")}`;
    const saved = state.laiSettings?.activityTypeDefaults;
    const box = popover(anchor,
      `<form id="activity-advanced-form" aria-label="筛选动态"><div class="activity-filter-scroll"><div class="activity-filter-error" role="alert"></div><label class="activity-filter-field">日期<div class="activity-filter-date"><input type="date" name="startDate" aria-label="开始日期" value="${E(activityAdvanced.startDate || "")}"><span>→</span><input type="date" name="endDate" aria-label="结束日期" value="${E(activityAdvanced.endDate || "")}"></div></label><label class="activity-filter-field">联系人<select name="contact" aria-label="联系人">${options(contacts)}</select></label><label class="activity-filter-field">跟进人<select name="owner" aria-label="跟进人">${options(owners)}</select></label><h4>历史动态</h4>${types.map(([key, label, children]) => `<div class="activity-filter-type-group">${check(key, label, true)}<div class="activity-filter-type-grid">${children.map(([subtype, title]) => check(`${key}:${subtype}`, title)).join("")}</div></div>`).join("")}</div><div class="activity-filter-footer"><label><input type="checkbox" name="rememberTypes" ${saved?.enabled ? "checked" : ""}>以后只显示已选类型</label><button type="button" data-activity-filter-reset>重置</button><button type="submit" class="primary">筛选</button></div></form>`,
      `activity-filter-popover${pointerActivated ? " activity-filter-popover-motion" : ""}`,
    );
    box.id = "activity-advanced-menu";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "筛选动态");
    const anchorRect = anchor.getBoundingClientRect();
    box._anchorBounds = anchorRect;
    const below = anchorRect.bottom + 4;
    box.style.left = Math.max(8, Math.min(anchorRect.right - box.offsetWidth, innerWidth - box.offsetWidth - 16)) + "px";
    box.style.top = (below + box.offsetHeight <= innerHeight - 12
      ? below : Math.max(8, anchorRect.top - box.offsetHeight - 4)) + "px";
    anchor.setAttribute("aria-expanded", "true");
    box.querySelector('[name="contact"]').value = activityAdvanced.contact || "";
    box.querySelector('[name="owner"]').value = activityAdvanced.owner || "";
    if (!pointerActivated) box.querySelector('[name="startDate"]').focus();
    box.addEventListener("change", (event) => {
      const input = event.target.closest('[name="activityType"]');
      if (!input) return;
      if (input.dataset.activityTypeGroup) {
        for (const child of box.querySelectorAll('[name="activityType"]'))
          if (child.value.startsWith(input.value + ":")) child.checked = input.checked;
      } else if (!input.checked) {
        const group = input.value.split(":")[0];
        const parent = box.querySelector(`[data-activity-type-group="${group}"]`);
        if (parent) parent.checked = false;
      }
    });
    box.querySelector("[data-activity-filter-reset]").addEventListener("click", () => {
      const form = box.querySelector("form");
      form.reset();
      for (const input of form.querySelectorAll('input[type="date"], select')) input.value = "";
      for (const input of form.querySelectorAll('input[type="checkbox"]')) input.checked = false;
      form.querySelector(".activity-filter-error").textContent = "";
    });
    const name = currentName;
    const isCurrentMenu = () => box.isConnected && !box.inert &&
      currentName === name && tab === "activity" && anchor.isConnected &&
      $(".activity-filter-popover") === box;
    let submitting = false;
    box.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting || !isCurrentMenu()) return;
      const form = event.currentTarget;
      const fields = new FormData(form);
      const next = {
        startDate: String(fields.get("startDate") || ""),
        endDate: String(fields.get("endDate") || ""),
        contact: String(fields.get("contact") || ""),
        owner: String(fields.get("owner") || ""),
        types: [...new Set(fields.getAll("activityType").map(String))],
      };
      const error = form.querySelector(".activity-filter-error");
      error.textContent = "";
      if (next.startDate && next.endDate && next.startDate > next.endDate) {
        error.textContent = "开始日期不能晚于结束日期";
        box.querySelector(".activity-filter-scroll").scrollTop = 0;
        return;
      }
      const defaults = { enabled: fields.has("rememberTypes"), types: fields.has("rememberTypes") ? next.types : [] };
      const previous = state.laiSettings?.activityTypeDefaults || { enabled: false, types: [] };
      if (JSON.stringify(defaults) !== JSON.stringify(previous)) {
        const submit = form.querySelector('[type="submit"]');
        submitting = true;
        submit.disabled = true;
        form.setAttribute("aria-busy", "true");
        try {
          await persist({ ...state, laiSettings: { ...state.laiSettings, activityTypeDefaults: defaults } });
        } catch (failure) {
          if (isCurrentMenu()) {
            error.textContent = failure.message;
            box.querySelector(".activity-filter-scroll").scrollTop = 0;
          }
          return;
        } finally {
          submitting = false;
          submit.disabled = false;
          form.removeAttribute("aria-busy");
        }
      }
      if (!isCurrentMenu()) return;
      activityAdvanced = next;
      closeActivityAdvancedFilterMenu(true, pointerActivated);
      anchor.classList.toggle("lcd-filter-active", Boolean(next.startDate || next.endDate || next.contact || next.owner || next.types.length));
      replaceActivityResults();
      if (pointerActivated) {
        const results = $("#activity-results");
        results.classList.add("lcd-filter-enter");
        const clear = () => results.classList.remove("lcd-filter-enter");
        results.addEventListener("animationend", clear, { once: true });
        setTimeout(clear, 180);
      }
    });
  }
  function popover(anchor, html, className = "") {
    closeDropdowns();
    closeActivitySortMenu();
    closeActivityAdvancedFilterMenu();
    removePopover();
    const box = document.createElement("div");
    box.className = "popover " + className;
    box._trigger = anchor;
    box.innerHTML = html;
    document.body.append(box);
    positionPopover(box, anchor);
    box._anchorBounds = anchor.getBoundingClientRect();
    return box;
  }
  function positionPopover(box, anchor) {
    const r = anchor.getBoundingClientRect();
    box.style.left =
      Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 16)) + "px";
    if (box.classList.contains("contact-menu")) {
      const opensAbove = r.bottom + 4 + box.offsetHeight > innerHeight - 12;
      const top = opensAbove ? r.top - box.offsetHeight - 4 : r.bottom + 4;
      box.style.top = Math.max(8, Math.min(top, innerHeight - box.offsetHeight - 12)) + "px";
      box.style.transformOrigin = opensAbove ? "right bottom" : "left top";
      anchor.setAttribute("aria-haspopup", "true");
      anchor.setAttribute("aria-expanded", "true");
    } else {
      box.style.top = Math.min(r.bottom + 5, innerHeight - box.offsetHeight - 12) + "px";
    }
  }
  function closeContactMenu(restoreFocus = false, animate = false) {
    for (const box of document.querySelectorAll(".contact-menu")) {
      const trigger = box._trigger;
      trigger?.setAttribute("aria-expanded", "false");
      if ((restoreFocus || box.contains(document.activeElement)) && trigger?.isConnected) trigger.focus();
      if (!animate) {
        clearTimeout(box._closeTimer);
        box.remove();
        continue;
      }
      if (box.classList.contains("contact-menu-closing")) continue;
      const style = getComputedStyle(box);
      box.style.setProperty("--contact-exit-transform", style.transform);
      box.style.setProperty("--contact-exit-opacity", style.opacity);
      box.classList.remove("contact-menu-motion");
      box.inert = true;
      box.setAttribute("aria-hidden", "true");
      box.classList.add("contact-menu-closing");
      const finish = () => {
        clearTimeout(box._closeTimer);
        box.remove();
      };
      box.addEventListener("animationend", finish, { once: true });
      box._closeTimer = setTimeout(finish, 240);
    }
  }
  function closeDocumentSizeMenu(restoreFocus = false, animate = false) {
    const box = $(".document-size-menu");
    if (!box) return;
    const trigger = box._trigger;
    trigger?.setAttribute("aria-expanded", "false");
    if ((restoreFocus || box.contains(document.activeElement)) && trigger?.isConnected) trigger.focus();
    if (!animate) {
      clearTimeout(box._closeTimer);
      box.remove();
      return;
    }
    if (box.classList.contains("document-size-closing")) return;
    const style = getComputedStyle(box);
    box.style.setProperty("--document-size-exit-transform", style.transform);
    box.style.setProperty("--document-size-exit-opacity", style.opacity);
    box.classList.remove("document-size-motion");
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.classList.add("document-size-closing");
    const finish = () => {
      clearTimeout(box._closeTimer);
      box.remove();
    };
    box.addEventListener("animationend", finish, { once: true });
    box._closeTimer = setTimeout(finish, 240);
  }
  function removePopover() {
    const box = $(".popover");
    if (box?.classList.contains("document-size-menu")) closeDocumentSizeMenu();
    else if (box?.classList.contains("global-search-scope-menu")) closeGlobalSearchScope();
    else if (box?.classList.contains("activity-sort-popover")) closeActivitySortMenu();
    else if (box?.classList.contains("activity-filter-popover")) closeActivityAdvancedFilterMenu();
    else if (box?.classList.contains("tag-popover")) closeCustomerTagEditor();
    else if (box?.classList.contains("contact-menu")) closeContactMenu();
    else {
      box?._trigger?.setAttribute("aria-expanded", "false");
      box?.remove();
    }
  }
  function closeGlobalSearchScope(animate = false, restoreFocus = false) {
    const box = $(".global-search-scope-menu");
    if (!box) return;
    clearTimeout(box._closeTimer);
    const trigger = box._trigger;
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus || box.contains(document.activeElement)) trigger?.focus();
    if (!animate) {
      box.remove();
      return;
    }
    box.classList.add("global-search-scope-motion");
    void box.offsetHeight;
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.classList.add("global-search-scope-closing");
    box._closeTimer = setTimeout(() => box.remove(), 300);
  }
  function globalSearchScopeMenu(anchor, pointerActivated = false) {
    // 现在只有客户能搜，别的类别先不显示。
    const categories = ["客户"];
    const box = popover(anchor,
      `<div class="global-search-categories">${categories.map((label, index) => `<button type="button" data-global-category="${E(label)}" class="${label === "客户" ? "active" : ""}">${E(label)}${index < 4 ? icon("next") : ""}</button>`).join("")}</div><div class="global-search-fields">${C.globalSearchFields.map(({ id, label }) => `<button type="button" data-global-field="${E(id)}">${E(label)}</button>`).join("")}</div>`,
      `global-search-scope-menu${pointerActivated ? " global-search-scope-motion" : ""}`);
    anchor.setAttribute("aria-expanded", "true");
    if (!pointerActivated) box.querySelector('[data-global-category="客户"]')?.focus();
    return box;
  }
  function tableOptions(anchor) {
    const d = tablePrefs();
    popover(
      anchor,
      `${[
        ["列表字段", "settings"],
        ["标签管理", "tag-manager"],
        ["客户设置", "customer-settings"],
      ]
        .filter(([, action]) => action !== "customer-settings" || can("settings.customer"))
        .filter(([, action]) => action !== "tag-manager" || can("customer.edit"))
        .map(
          ([label, action]) =>
            `<div><span>${label}</span><button data-action="${action}">设置</button></div>`,
        )
        .join("")}<hr>${[
        ["compact", "表格行高"],
        ["compactWidth", "表格列宽"],
      ]
        .map(
          ([key, label]) =>
            `<div><span>${label}</span><span class="option-pair"><button class="${d[key] !== false ? "active" : ""}" data-table-pref="${key}" data-value="true">紧凑</button><button class="${d[key] === false ? "active" : ""}" data-table-pref="${key}" data-value="false">宽松</button></span></div>`,
        )
        .join(
          "",
        )}<div><span>显示斑马纹</span><input type="checkbox" data-live-pref="striped" ${d.striped ? "checked" : ""} aria-label="显示斑马纹"></div><div><span>显示竖向分割线</span><input type="checkbox" data-live-pref="verticalLines" ${d.verticalLines ? "checked" : ""} aria-label="显示竖向分割线"></div>`,
      "table-popover",
    );
  }
  // 客户设置里的页签：没有对应权限的页签不显示。
  const csHiddenTabs = () => [
    ...(can("settings.dedupe") ? [] : ["dedupe"]),
    ...(can("settings.source") ? [] : ["sources"]),
  ];
  function customerSettings(keepModal = false) {
    window.LaiActivityCategoryNavigation.mount(null);
    rememberCustomerListViewport();
    // 标签管理窗口开着时页面在后面刷新，窗口要留着让人继续改。
    if (!keepModal) closeModal();
    if (screenBlocked("customer-settings")) return;
    customerScreen = "customer-settings";
    currentName = "";
    selected.clear();
    if (csHiddenTabs().includes(csTab)) csTab = "groups";
    // 同一个页签里保存后重新画页面，保持原来的滚动位置（公海管理很长）。
    const sameTab = document.querySelector(`.cs-panel[data-cs-panel="${csTab}"]`);
    const scrolled = sameTab ? sameTab.closest("main")?.scrollTop || 0 : 0;
    $("#app").innerHTML = shell(
      window.LaiCustomerSettingsUI.markup(state, { tab: csTab, editing: csEditing, dedupeSub: csDedupeSub, hiddenTabs: csHiddenTabs(), canOpenSettings: R.canOpen(state, "route", "settings") }, E, ownerChoices()),
    );
    if (scrolled) {
      const main = document.querySelector(".cs-panel")?.closest("main");
      if (main) main.scrollTop = scrolled;
    }
  }
  // ---- 客户设置页：页签、改名、删除、排序、分组抽屉 ----
  const CSM = window.LaiCustomerSettings;
  // 保存设置：成功后刷新页面；出错时把原因显示在页面（或抽屉）里，不关窗口。
  async function csSave(makeNext, errorSelector, closeDrawer, doneMessage) {
    if (pending) return toast("上一项修改正在保存，请稍候"), false;
    const box = $(errorSelector || "#cs-error");
    box?.classList.remove("visible");
    try {
      await persist(makeNext());
      if (closeDrawer) closeModal();
      csEditing = null;
      refresh();
      toast(doneMessage || "已保存到来财");
      return true;
    } catch (error) {
      if (box) {
        box.textContent = error.message;
        box.classList.add("visible");
      } else toast(error.message);
      return false;
    }
  }
  function csGroupDrawer(spec, pointerActivated) {
    const isChild = !!spec.id && !CSM.get(state).groups.some((g) => g.id === spec.id);
    const title = spec.id ? (isChild ? "改子分组名称" : "编辑分组") : spec.parentId ? "新建子分组" : "新建分组";
    drawer(
      title,
      window.LaiCustomerSettingsUI.groupForm(state, spec, ownerChoices(), E),
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="cs-group-form" class="primary">保存</button>`,
      "actions",
      pointerActivated,
    );
  }
  // 公海管理里每一小节单独保存：在现有设置上改几项，整份交给 CT.setPoolRules 检查。
  const csPoolSave = (patch, ...rest) => csSave(() => CT.setPoolRules(state, { ...CT.poolRules(state), ...patch(CT.poolRules(state)) }), ...rest);
  // 点选框保存失败时，把它恢复成原样。
  const csToggle = (el, makeNext) => csSave(makeNext).then((ok) => { if (!ok && el.isConnected) el.checked = !el.checked; });
  function csRuleDrawer(id, pointerActivated) {
    drawer(
      id ? "编辑规则" : "新建规则",
      window.LaiCustomerSettingsUI.ruleForm(state, id, E),
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="cs-rule-form" class="primary">保存</button>`,
      "actions",
      pointerActivated,
    );
  }
  function csTplDrawer(spec, pointerActivated) {
    drawer(
      spec.itemId ? "编辑常用语" : "添加常用语",
      window.LaiCustomerSettingsUI.tplForm(state, spec, E),
      `<button type="button" data-action="close-modal">取消</button><button type="submit" form="cs-tpl-form" class="primary">保存</button>`,
      "actions",
      pointerActivated,
    );
  }
  function csClick(el, e) {
    const d = el.dataset;
    // 客户设置页上的按钮：没有权限就不动（页面本身没权限时根本打不开，这里防的是过期的页面或键盘操作）。
    if (el.closest(".cs-page") && !allow("settings.customer")) return true;
    if ((d.csSourceMove || d.csSourceHide || d.csSourceSub || d.csDelete === "source") && !allow("settings.source")) return true;
    if ((d.csDedupeSub || d.csTab === "dedupe") && !allow("settings.dedupe")) return true;
    if (d.csTab === "sources" && !allow("settings.source")) return true;
    if (d.csRuleToggle) {
      const id = d.csRuleToggle, enabled = el.checked;
      const rule = CT.poolRules(state).rules.find((r) => r.id === id);
      if (rule) csToggle(el, () => CT.savePoolRule(state, { ...rule, enabled }));
      return true;
    }
    if (d.csRuleEdit !== undefined) {
      csRuleDrawer(d.csRuleEdit, e.detail > 0);
      return true;
    }
    if (d.csRuleDelete) {
      csSave(() => CT.deletePoolRule(state, d.csRuleDelete));
      return true;
    }
    if (d.csPoolRun !== undefined) {
      if (!CT.poolCandidates(state).length) toast("现在没有符合规则的客户");
      else {
        csEditing = { kind: "poolrun" };
        customerSettings();
      }
      return true;
    }
    if (d.csPoolRunOk !== undefined) {
      const result = CT.applyPoolRules(state);
      if (!result.moved.length) {
        csEditing = null;
        customerSettings();
        toast("现在没有符合规则的客户");
      } else csSave(() => result.state, null, false, `已移入公海 ${result.moved.length} 位客户`);
      return true;
    }
    if (d.csPoolWhiteRemove) {
      csPoolSave((r) => ({ whitelist: r.whitelist.filter((o) => o !== d.csPoolWhiteRemove) }));
      return true;
    }
    if (d.csPoolReasonRemove) {
      csPoolSave((r) => ({ reasons: r.reasons.filter((x) => x !== d.csPoolReasonRemove) }));
      return true;
    }
    if (d.csPoolRequire !== undefined) {
      const requireReason = el.checked;
      csToggle(el, () => CT.setPoolRules(state, { ...CT.poolRules(state), requireReason }));
      return true;
    }
    if (d.csDeal) {
      csSave(() => CSM.setDealRule(state, d.csDeal));
      return true;
    }
    if (d.csActivity !== undefined) {
      const autoMail = el.checked;
      csToggle(el, () => CSM.setActivity(state, { autoMail }));
      return true;
    }
    if (d.csAllowPast !== undefined) {
      const allowPastTime = el.checked;
      csToggle(el, () => CSM.setFollowupOptions(state, { allowPastTime }));
      return true;
    }
    if (d.csTplMove) {
      csSave(() => CSM.moveTemplateGroup(state, d.csTplMove, Number(d.delta)));
      return true;
    }
    if (d.csTplAdd) {
      csTplDrawer({ groupId: d.csTplAdd }, e.detail > 0);
      return true;
    }
    if (d.csTplEdit) {
      csTplDrawer({ groupId: d.tplGroup, itemId: d.csTplEdit }, e.detail > 0);
      return true;
    }
    if (d.csTplDelete) {
      csSave(() => CSM.deleteTemplate(state, d.tplGroup, d.csTplDelete));
      return true;
    }
    if (d.csDedupeSub) {
      csDedupeSub = d.csDedupeSub === "lead" ? "lead" : "customer";
      customerSettings();
      return true;
    }
    if (d.csTab) {
      csTab = d.csTab;
      csEditing = null;
      customerSettings();
      return true;
    }
    if (d.csCancel !== undefined) {
      csEditing = null;
      customerSettings();
      return true;
    }
    if (d.csEdit) {
      csEditing = { kind: d.csEdit, key: d.key };
      customerSettings();
      $(".cs-inline input")?.focus();
      return true;
    }
    if (d.csSourceMove) {
      csSave(() => CSM.moveSource(state, d.csSourceMove, Number(d.delta)));
      return true;
    }
    if (d.csSourceHide) {
      csSave(() => CSM.setSourceHidden(state, d.csSourceHide, d.hidden === "1"));
      return true;
    }
    if (d.csSourceSub) {
      csEditing = { kind: "sourcesub", key: d.csSourceSub };
      customerSettings();
      $(".cs-add input")?.focus();
      return true;
    }
    if (d.csMove) {
      csSave(() => CSM.moveItem(state, d.csMove, d.name, Number(d.delta)));
      return true;
    }
    if (d.csLayout) {
      csSave(() => CSM.setLayout(state, d.csLayout));
      return true;
    }
    if (d.csDelete) {
      const kind = d.csDelete, key = d.key;
      csSave(() => {
        if (kind === "stages") return CSM.deleteStage(state, key);
        if (kind === "types") return CSM.deleteType(state, key);
        if (kind === "blacklist") return CSM.removeBlacklist(state, key);
        if (kind === "tplgroup") return CSM.deleteTemplateGroup(state, key);
        if (kind === "source") return CSM.deleteSource(state, key);
        return CSM.deleteGroup(state, key);
      });
      return true;
    }
    if (d.csGroupAdd !== undefined) {
      csGroupDrawer({ parentId: d.csGroupAdd }, e.detail > 0);
      return true;
    }
    if (d.csGroupEdit) {
      csGroupDrawer({ id: d.csGroupEdit }, e.detail > 0);
      return true;
    }
    return false;
  }
  // 公海管理里各小节的表单：在现有设置上改这一节的几项。
  function csPoolForm(kind, data, text) {
    const cur = CT.poolRules(state);
    const next = (patch) => CT.setPoolRules(state, { ...cur, ...patch });
    if (kind === "pool-remind") return next({ remindDays: text("remindDays") });
    if (kind === "pool-white-add") {
      if (!text("owner")) throw new Error("请先选择跟进人");
      return next({ whitelist: [...cur.whitelist, text("owner")] });
    }
    if (kind === "pool-skip") return next({ skipOpenOrders: data.has("skipOpenOrders"), skipFollowed: data.has("skipFollowed"), skipTags: text("skipTags") });
    if (kind === "pool-reclaim") return next({ reclaimBlockDays: text("reclaimBlockDays") });
    if (kind === "pool-claim") {
      const perOwner = {};
      for (const [key, value] of data.entries()) if (key.startsWith("claim:") && String(value).trim() !== "") perOwner[key.slice(6)] = value;
      return next({ claimLimit: { periodDays: text("periodDays"), defaultLimit: text("defaultLimit"), perOwner } });
    }
    if (kind === "pool-contacts") return next({ showPoolContacts: text("showPoolContacts") !== "hide" });
    if (kind === "pool-reason-add") {
      if (!text("reason").trim()) throw new Error("请填写原因");
      return next({ reasons: [...cur.reasons, text("reason")] });
    }
    throw new Error("无法保存");
  }
  document.addEventListener("submit", (e) => {
    const form = e.target;
    const kind = form.dataset?.csForm;
    if (!kind && !["cs-group-form", "cs-rule-form", "cs-tpl-form"].includes(form.id)) return;
    e.preventDefault();
    if (!allow("settings.customer")) return;
    if (["dedupe", "lead-dedupe"].includes(kind) && !allow("settings.dedupe")) return;
    if (["add-source", "rename-source"].includes(kind) && !allow("settings.source")) return;
    const data = new FormData(form);
    if (form.id === "cs-rule-form") {
      const rule = {
        id: form.dataset.id, name: String(data.get("name") || ""), kind: String(data.get("kind") || ""), days: String(data.get("days") || ""),
        groups: data.getAll("group").map(String), startDate: String(data.get("startDate") || ""), enabled: data.has("enabled"),
      };
      csSave(() => CT.savePoolRule(state, rule), "#workspace-error", true);
      return;
    }
    if (form.id === "cs-tpl-form") {
      const { tplGroup: group, item } = form.dataset, value = String(data.get("text") || "");
      csSave(() => (item ? CSM.editTemplate(state, group, item, value) : CSM.addTemplate(state, group, value)), "#workspace-error", true);
      return;
    }
    if (form.id === "cs-group-form") {
      const id = form.dataset.id, parentId = form.dataset.parent;
      const members = data.get("membersMode") === "some" ? data.getAll("member").map(String) : "all";
      csSave(
        () => {
          const name = String(data.get("name") || "");
          if (!id) return CSM.addGroup(state, { name, parentId, members });
          const patch = { name };
          if (form.querySelector('[name="membersMode"]')) patch.members = members;
          if (form.querySelector('[name="childRequired"]')) patch.childRequired = data.has("childRequired");
          return CSM.editGroup(state, id, patch);
        },
        "#workspace-error",
        true,
      );
      return;
    }
    const text = (key) => String(data.get(key) || "");
    csSave(() => {
      if (kind === "add-stages") return CSM.addStage(state, text("name"));
      if (kind === "add-types") return CSM.addType(state, text("name"));
      if (kind === "rename-stages") return CSM.renameStage(state, form.dataset.old, text("name"));
      if (kind === "rename-types") return CSM.renameType(state, form.dataset.old, text("name"));
      if (kind === "add-blacklist") return CSM.addBlacklist(state, text("email"));
      if (kind === "add-source") return CSM.addSource(state, { name: text("name"), parentId: form.dataset.parent || "" });
      if (kind === "rename-source") return CSM.renameSource(state, form.dataset.id, text("name"));
      if (kind === "dedupe") return CSM.setDedupe(state, Object.fromEntries(CSM.DEDUPE_FIELDS.map(([key]) => [key, text(`dedupe:${key}`)])));
      if (kind === "lead-dedupe") return CSM.setLeadDedupe(state, Object.fromEntries(CSM.LEAD_DEDUPE_FIELDS.map(([key]) => [key, text(`dedupe:${key}`)])));
      if (kind === "duplicates") return CSM.setDuplicateFields(state, data.getAll("field").map(String));
      if (kind === "caps") {
        const perOwner = {};
        for (const [key, value] of data.entries()) if (key.startsWith("cap:")) perOwner[key.slice(4)] = String(value).trim() === "" ? null : value;
        return CSM.setCaps(state, { defaultLimit: text("defaultLimit"), perOwner });
      }
      if (kind === "follow") return CSM.setFollowRules(state, { contact: data.getAll("contact").map(String), followup: data.getAll("followup").map(String) });
      if (kind === "tpl-group-add") return CSM.addTemplateGroup(state, text("name"));
      if (kind === "tpl-group-rename") return CSM.renameTemplateGroup(state, form.dataset.id, text("name"));
      if (kind.startsWith("pool-")) return csPoolForm(kind, data, text);
      throw new Error("无法保存");
    });
  });
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button,input");
    if (!el || el.disabled) return;
    const d = el.dataset,
      a = d.action;
    if (a === "refresh-app") return refreshApplication();
    if (csClick(el, e)) return;
    if (a === "global-search-scope") {
      const box = $(".global-search-scope-menu");
      if (box) {
        if (box.classList.contains("global-search-scope-closing")) {
          clearTimeout(box._closeTimer);
          if (e.detail === 0) box.classList.remove("global-search-scope-motion");
          box.classList.remove("global-search-scope-closing");
          box.inert = false;
          box.removeAttribute("aria-hidden");
          el.setAttribute("aria-expanded", "true");
          if (e.detail === 0) box.querySelector('[data-global-category="客户"]')?.focus();
        } else closeGlobalSearchScope(e.detail > 0, true);
        return;
      }
      return globalSearchScopeMenu(el, e.detail > 0);
    }
    if (d.globalCategory) return;
    if (d.globalField) {
      if (!C.globalSearchFields.some((field) => field.id === d.globalField)) return;
      globalSearch.field = d.globalField;
      const trigger = $("[data-action='global-search-scope']");
      if (trigger) {
        const label = d.globalField === "all" ? "客户" : C.globalSearchFields.find((field) => field.id === d.globalField).label;
        trigger.innerHTML = `<span class="global-search-label" title="${E(label)}">${E(label)}</span><span class="dd-caret" aria-hidden="true"></span>`;
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      }
      removePopover();
      return;
    }
    // 客户列表批量栏与客户详情里的「写邮件」：一位客户直接写信，多位走群发。
    if (d.feature === "写邮件") {
      const fromList = !!el.closest(".replica-batch"), name = currentName;
      return mail.composeFor(fromList ? [...selected] : name ? [name] : [], e.detail > 0, () => navigateApp("customers", fromList ? "" : name, false));
    }
    if ((d.feature === "添加商机" || d.feature === "新建商机") && !allow("opp.create")) return;
    if (d.feature && customerOpportunityFeature(d.feature)) return;
    if (d.feature) return featureNotice(d.feature, e.detail > 0);
    if (d.groupTab) {
      groupTab = d.groupTab;
      list();
      [...document.querySelectorAll("#app .group-tabs button[data-group-tab]")]
        .find((button) => button.dataset.groupTab === groupTab)
        ?.focus({ preventScroll: true });
      return;
    }
    if (d.team) {
      team = d.team;
      if (team === "mine") {
        const owner =
          state.laiSettings?.defaultOwner || state.orderSettings?.defaultOwner;
        if (!owner) {
          team = "team";
          return toast("请先在来财设置中设置默认跟进人，或选择业务员筛选");
        }
        filters.owner = owner;
      } else filters.owner = "";
      selected.clear();
      page = 1;
      return list();
    }
    if (d.page) {
      page = Number(d.page);
      return list();
    }
    if (d.sortField) {
      if (!fieldById.has(d.sortField)) return;
      const current = filters.sortField === d.sortField ? filters.sortDirection : "";
      const arrow = e.target.closest(".sort-up") ? "asc" : e.target.closest(".sort-down") ? "desc" : "";
      const next = arrow ? (current === arrow ? "" : arrow) : current === "asc" ? "desc" : current === "desc" ? "" : "asc";
      filters.sortDirection = next;
      filters.sortField = next ? d.sortField : "";
      page = 1;
      return list();
    }
    if (d.rowMore) {
      popover(
        el,
        (() => {
          const followed = allCustomerRows().find((c) => c.name === d.rowMore)?.followed;
          return `<button data-open="${E(d.rowMore)}">查看客户</button>${followed && !can("customer.unfollow") ? "" : `<button data-follow="${E(d.rowMore)}">${followed ? "取消关注" : "关注"}</button>`}${showIf("customer.edit", `<button data-edit-customer="${E(d.rowMore)}">编辑客户</button>`)}`;
        })(),
      );
      return;
    }
    if (d.contactMore !== undefined) {
      const contact = el.closest(".lcd-contact")?.querySelector(".lcd-contact-title strong")?.textContent || "联系人";
      return popover(el, `<button type="button" data-edit-contact="${Number(d.contactMore)}" aria-label="编辑${E(contact)}">编辑联系人</button>`, `contact-menu${e.detail > 0 ? " contact-menu-motion" : ""}`);
    }
    if (d.editContact !== undefined) return editContact(Number(d.editContact), e.detail > 0);
    if (a === "contacts-actions")
      return popover(el, `<button type="button" data-action="add-contact">添加联系人</button><button type="button" data-edit-contact="0">编辑主联系人</button>`, `contact-menu${e.detail > 0 ? " contact-menu-motion" : ""}`);
    if (d.editCustomer) {
      removePopover();
      return editForm(false, e.detail > 0, d.editCustomer);
    }
    if (d.newCustomerOrder) {
      if (!allow("order.create")) return;
      if (d.newCustomerOrder !== currentName || !(await window.flushPendingSave())) return;
      return business.createOrderForCustomer(currentName);
    }
    if (d.laiOrder) {
      // 从客户详情打开订单：记下是哪位客户，保存或取消后回到这位客户。
      const back = currentName;
      if (await navigateApp("order-list"))
        return business.openOrder(d.laiOrder, undefined, back);
      return;
    }
    if (d.filterMode) {
      if (filterMode === "advanced") filterDraft.advanced = readAdvanced();
      else
        Object.assign(
          filterDraft.normal,
          Object.fromEntries(new FormData($("#filter-form"))),
        );
      filterMode = d.filterMode;
      return filterForm();
    }
    if (d.removeAdvanced !== undefined) {
      filterDraft.advanced = readAdvanced();
      filterDraft.advanced.rules.splice(Number(d.removeAdvanced), 1);
      return filterForm();
    }
    if (d.tablePref) {
      await workspaceSave(() => ({
        ...state,
        previewTable: { ...tablePrefs(), [d.tablePref]: d.value === "true" },
      }));
      removePopover();
      return;
    }
    if (a === "table-options") return tableOptions(el);
    if (a === "customer-settings") return allow("settings.customer") && customerSettings();
    if (a === "collapse-groups") {
      if (groupPointerPress === el) { groupPointerPress = null; return; }
      return toggleGroupPanel(el, e.detail > 0);
    }
    if (a === "collapse-subnav" || a === "expand-subnav") {
      closeDropdowns();
      const collapsed = a === "collapse-subnav";
      $("#app").classList.toggle("nav-collapsed", collapsed);
      document.querySelectorAll(".subnav-toggle").forEach((button) => {
        button.setAttribute("aria-expanded", String(!collapsed));
      });
      const nextAction = collapsed ? "expand-subnav" : "collapse-subnav";
      $(`[data-action="${nextAction}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (a === "select-all-filtered") {
      selected = new Set(filteredRows().map((c) => c.name));
      return list();
    }
    if (a === "batch-followup") return batchFollowupDialog(e.detail > 0);
    if (a === "batch-schedule") return batchScheduleDialog(e.detail > 0);
    if (a === "batch-tags") return batchTagsDialog(e.detail > 0);
    if (a === "batch-merge") return mergeDialog([...selected], e.detail > 0);
    if (a === "merge-customer") return mergePickerDialog(currentName, e.detail > 0);
    if (a === "document-all") {
      documentQuery = "";
      documentPage = 1;
      documentSelected.clear();
      return detail(currentName, true, "");
    }
    if (a === "batch-create") return batchCreateDialog(e.detail > 0);
    if (a === "tag-manager") return tagManagerDialog(e.detail > 0);
    if (a === "merge-group") return mergeDialog(el.dataset.names.split("\u0001"), e.detail > 0);
    if (a === "batch-edit-field") return batchFieldDialog(e.detail > 0);
    if (a === "batch-more")
      return popover(
        el,
        `${showIf("customer.merge", '<button data-action="batch-merge">合并客户</button><hr>')}${showIf("customer.toPool", '<button data-action="batch-pool">移入公海</button>')}<button data-action="batch-follow">关注</button>${showIf("customer.unfollow", '<button data-action="batch-unfollow">取消关注</button>')}<hr>${showIf("customer.reassign", '<button data-action="batch-assign-owner">重新分配</button>')}${showIf("customer.removeOwner", '<button data-action="batch-clear-owner">移除跟进人</button>')}<hr><button data-action="remove-members">移出客群</button>${showIf("customer.trash", '<button data-action="batch-trash">移入回收站</button>')}`,
      );
    if (a === "batch-assign-owner" || a === "batch-clear-owner")
      return batchOwnerDialog(a === "batch-clear-owner", e.detail > 0);
    if (a === "create-menu")
      return popover(
        el,
        `${showIf("customer.create", '<button data-action="new">新建客户</button>')}${importPreviewEnabled && can("customer.import") ? '<button data-action="import-customers">导入客户</button>' : ''}${showIf("customer.create", '<button data-action="batch-create">批量建档</button>')}`,
      );
    if (a === "profile-menu")
      return popover(el, profileMenuMarkup(), "account-menu");
    if (a === "restore-table-defaults") {
      columnDraft = { ...tablePrefs(), ...C.normalizeColumns() };
      return renderColumns();
    }
    if (a === "add-advanced") {
      filterDraft.advanced = readAdvanced();
      filterDraft.advanced.rules.push({
        field: "name",
        op: "contains",
        value: "",
      });
      return filterForm();
    }
    if (a === "save-columns-all")
      return workspaceSave(
        () => ({
          ...state,
          previewTable: { ...columnDraft, ...C.normalizeColumns(columnDraft) },
        }),
        () => toast("字段设置已应用到所有客群"),
      );
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (modal === 'import' && importDraft) {
      if (el.id === 'customer-import-file') { void readImportFile(el.files?.[0]); return; }
      if (el.name === 'importDestination') { importDraft.destination = el.value; return; }
      if (el.name === 'importDuplicate') { importDraft.duplicate = el.value; return; }
      if (el.dataset.importColumn !== undefined) {
        const column = Number(el.dataset.importColumn);
        for (const [field, index] of Object.entries(importDraft.mapping))
          if (index === column || field === el.value) delete importDraft.mapping[field];
        if (el.value) importDraft.mapping[el.value] = column;
        importDraft.error = '';
        renderImportDrawer();
        $(`.customer-import [data-import-column="${column}"]`)?.focus();
        return;
      }
    }
    if (el.id === "customer-owner") {
      filters.owner = el.value;
      team = "team";
      selected.clear();
      page = 1;
      list();
    }
    if (el.id === "page-jump") {
      page = Number(el.value);
      list();
    }
    if (el.dataset.advancedProp === "op") {
      const row = el.closest("[data-advanced-rule]");
      const field = fieldById.get(row.querySelector('[data-advanced-prop="field"]').value);
      const input = row.querySelector('[data-advanced-prop="value"]');
      const numeric = el.value === "olderDays" || field.type === "number";
      if (input.tagName !== "SELECT") {
        input.type = numeric ? "number" : field.type === "date" ? "date" : "text";
        if (numeric) input.setAttribute("step", "any");
        else input.removeAttribute("step");
      }
      input.disabled = ["empty", "notEmpty"].includes(el.value);
    }
    if (el.dataset.advancedProp === "field") {
      filterDraft.advanced = readAdvanced();
      const r =
        filterDraft.advanced.rules[
          Number(el.closest("[data-advanced-rule]").dataset.advancedRule)
        ];
      r.op = ops(r.field)[0];
      r.value = fieldById.get(r.field)?.type === "boolean" ? "true" : "";
      filterForm();
    }
    if (el.dataset.livePref) {
      workspaceSave(() => ({
        ...state,
        previewTable: { ...tablePrefs(), [el.dataset.livePref]: el.checked },
      }));
      removePopover();
    }
  });
  document.addEventListener('dragover', (e) => {
    if (modal === 'import' && e.target.closest?.('.import-dropzone')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (modal !== 'import' || !e.target.closest?.('.import-dropzone')) return;
    e.preventDefault();
    void readImportFile(e.dataTransfer?.files?.[0]);
  });
  document.addEventListener('paste', (e) => {
    if (modal !== 'import' || !e.target.closest?.('.import-dropzone')
      && !document.querySelector('.customer-import .import-dropzone:hover')) return;
    const file = e.clipboardData?.files?.[0]
      || [...(e.clipboardData?.items || [])].find(item => item.kind === 'file')?.getAsFile();
    if (!file) return;
    e.preventDefault();
    void readImportFile(file);
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "global-search-form") return;
    e.preventDefault();
    const query = e.target.elements.query.value.trim();
    if (!(await window.flushPendingSave())) return;
    globalSearch.query = query;
    filters = {
      query: "",
      field: "name",
      country: "",
      owner: "",
      stage: "",
      tag: "",
      group: "all",
      sort: "recent",
      sortField: "",
      sortDirection: "",
      quickCountries: [],
    };
    advancedSpec = null;
    filterDraft = null;
    team = "team";
    page = 1;
    await navigateApp("customers", "", true, favoritesMode && NF.isFavorite(state.laiSettings, "screen:active"));
  });
  document.addEventListener("pointerdown", (e) => {
    if (
      $(".popover") &&
      !e.target.closest(".popover") &&
      !e.target.closest('[data-action="table-options"]') &&
      !e.target.closest('[data-action="followup-templates"]') &&
      !e.target.closest('[data-action="activity-sort"]') &&
      !e.target.closest('[data-action="activity-advanced-filter"]') &&
      !e.target.closest('[data-action="document-page-size"]') &&
      !e.target.closest('[data-contact-more]') &&
      !e.target.closest('[data-action="contacts-actions"]') &&
      !e.target.closest('[data-action="global-search-scope"]')
    ) {
      if ($(".activity-sort-popover")) {
        closeActivitySortMenu(false, true);
        return;
      }
      if ($(".activity-filter-popover")) {
        closeActivityAdvancedFilterMenu(false, true);
        return;
      }
      if ($(".document-size-menu")) {
        closeDocumentSizeMenu(false, true);
        return;
      }
      if ($(".tag-popover")) {
        closeCustomerTagEditor(false, true);
        return;
      }
      if ($(".contact-menu")) {
        closeContactMenu(false, true);
        return;
      }
      if ($(".global-search-scope-menu")) closeGlobalSearchScope(true);
      else removePopover();
    }
  });

  const countryExpanded = new Set(["recent"]);
  let recentCountries = [];
  function countryPicker(input) {
    if (filters.field !== "country") return;
    const values = [...new Set(rows.map((c) => c.country).filter(Boolean))];
    const selectedCountries = filters.quickCountries || [];
    const groups = [
      { label: "最近使用", key: "recent", values: recentCountries },
      ...window.LaiCustomerCountry.group(values).map((g, i) => ({
        ...g,
        key: String(i),
      })),
    ];
    const matching = selectedCountries.length
      ? ""
      : input.value.trim().toLowerCase();
    const visible = groups.map((g) => ({
      ...g,
      values: g.values.filter(
        (v) => !matching || v.toLowerCase().includes(matching),
      ),
    }));
    const items = (g) =>
      g.values
        .map(
          (v) =>
            `<label class="country-option"><input type="checkbox" data-quick-country="${E(v)}" ${selectedCountries.includes(v) ? "checked" : ""}><span>${E(v)}</span></label>`,
        )
        .join("") || '<div class="country-none">暂无记录</div>';
    const box = popover(
      input,
      visible
        .map(
          (g) =>
            `<details data-country-region="${g.key}" ${countryExpanded.has(g.key) || matching ? "open" : ""}><summary>${g.key === "recent" ? "" : '<input type="checkbox" data-country-region-check="' + g.key + '" aria-label="选择' + E(g.label) + '" ' + (g.values.length && g.values.every((v) => selectedCountries.includes(v)) ? "checked" : "") + ">"}<span>${E(g.label)}</span></summary>${items(g)}</details>`,
        )
        .join(""),
      "country-tree",
    );
    box.addEventListener(
      "toggle",
      (e) => {
        const key = e.target.dataset.countryRegion;
        if (key !== undefined) {
          e.target.open
            ? countryExpanded.add(key)
            : countryExpanded.delete(key);
        }
      },
      true,
    );
    box.addEventListener("change", (e) => {
      const el = e.target;
      let changed = [];
      if (el.dataset.quickCountry !== undefined)
        changed = [el.dataset.quickCountry];
      if (el.dataset.countryRegionCheck !== undefined)
        changed =
          visible.find((g) => g.key === el.dataset.countryRegionCheck)
            ?.values || [];
      if (!changed.length) return;
      const next = new Set(filters.quickCountries || []);
      changed.forEach((v) => (el.checked ? next.add(v) : next.delete(v)));
      filters.quickCountries = [...next];
      filters.query = [...next].map(C.countryLabel).join("、");
      if (el.checked)
        recentCountries = [...new Set([...changed, ...recentCountries])].slice(
          0,
          5,
        );
      page = 1;
      box.remove();
      list();
      countryPicker($("#search"));
    });
    box
      .querySelectorAll("summary input")
      .forEach((el) =>
        el.addEventListener("click", (e) => e.stopPropagation()),
      );
    input.setAttribute("aria-expanded", "true");
  }
  document.addEventListener("click", (e) => {
    if (e.target.id === "search" && filters.field === "country")
      countryPicker(e.target);
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "search" && filters.field === "country") {
      filters.quickCountries = [];
      countryPicker(e.target);
    }
  });
  document.addEventListener(
    "scroll",
    (e) => {
      if (!e.target.closest?.(".lai-select-menu,.lai-suggestions,.popover")) {
        // A scroll can arrive just after a popup opens (layout settling, scroll into view): close it only when
        // its anchor really moved.
        const filter = $(".activity-filter-popover") || $(".popover");
        const origin = filter?._anchorBounds;
        if (origin && !filter.inert && filter._trigger?.isConnected) {
          const current = filter._trigger.getBoundingClientRect();
          // Scroll can arrive after opening; dismiss only when its anchor moved.
          if (current.left === origin.left && current.top === origin.top &&
              current.width === origin.width && current.height === origin.height) return;
        }
        window.LaiCustomerSelect?.close();
        removePopover();
      }
    },
    true,
  );
  let detailTabResizeFrame = 0;
  window.addEventListener("resize", () => {
    window.LaiCustomerSelect?.close();
    const customerWarning = $(".customer-editor-unsaved");
    if (customerWarning) positionCustomerUnsavedWarning(customerWarning);
    const segmentWarning = $(".segment-editor-unsaved");
    if (segmentWarning) positionCustomerUnsavedWarning(segmentWarning, $(".drawer.segment"), 18);
    const searchScopeMenu = $(".global-search-scope-menu");
    if (searchScopeMenu && !searchScopeMenu.inert && searchScopeMenu._trigger?.isConnected) {
      positionPopover(searchScopeMenu, searchScopeMenu._trigger);
    } else removePopover();
    if (detailTabResizeFrame) cancelAnimationFrame(detailTabResizeFrame);
    detailTabResizeFrame = requestAnimationFrame(() => {
      detailTabResizeFrame = 0;
      syncDetailTabOverflow();
      V?.placeTabIndicator($(".lcd-root"));
    });
  });
  let focusRefreshInProgress = false;
  window.addEventListener("focus", async () => {
    if (!nativeWindowBridge() || focusRefreshInProgress || pending || modal ||
        !state?.customers || business?.hasDraft() ||
        openFollowupDraft()) return;
    focusRefreshInProgress = true;
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = await response.json();
      if (pending || modal || business?.hasDraft() ||
          openFollowupDraft() ||
          !Number.isInteger(snapshot?.revision) || snapshot.revision <= revision ||
          !Array.isArray(snapshot.data?.orders) || !snapshot.data?.customers ||
          typeof snapshot.data.customers !== "object" ||
          Array.isArray(snapshot.data.customers)) return;
      adoptServerState(snapshot.data, snapshot.revision);
      rebuildRows();
      refresh();
    } catch {
      // Keep the visible state when the local service is briefly unavailable.
    } finally {
      focusRefreshInProgress = false;
    }
  });

  business = window.LaiBusinessUI.create({
    getState: () => state,
    escape: E,
    mount: (html) => {
      window.LaiActivityCategoryNavigation.mount(null);
      closeDropdowns();
      removePopover();
      $("#app").innerHTML = shell(html);
    },
    save: persist,
    // 商机附件：读取文件、JSON 请求、上传文件（请求体就是文件内容）。
    request: (path, payload) =>
      fetch(path, payload === undefined
        ? { cache: "no-store" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    upload: (path, file) =>
      fetch(path, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }),
    openCustomer: (name) => navigateApp("customers", name),
    refreshCustomer: (name) => detail(name, true, ""),
    navigate: navigateApp,
    // 成员管理页换了账号或角色后，请整个界面按当前账号重画（左侧栏、二级导航、当前页面）。
    rerenderApp,
    // 成员管理页的“切换到此账号”：和头像菜单一样，清掉上个账号的筛选再重画。
    switchAccount,
    // 工作台的未读邮件卡片：邮件页打开过就用它已有的数字，邮件列表向本机邮件服务要。
    mailCounts: () => mail?.counts?.() || null,
    mailSummary: async () => {
      const response = await fetch("/api/mail/messages?folder=unread&page=1", { cache: "no-store" });
      const data = await response.json();
      if (!data?.ok) return null;
      const counts = data.counts || { unread: data.total || 0, pending: 0 };
      return { items: data.items || [], unread: counts.unread, pending: counts.pending };
    },
    toast,
    dialog: drawer,
    closeDialog: closeModal,
  });
  mail = window.LaiMailUI.create({
    escape: E,
    icon,
    favoriteHeart,
    // 写信、回复、转发要有“邮件·写信和回复”权限。
    can: (key) => R.can(state, key),
    // 邮箱绑定只和本机服务通信；密码不进入业务数据快照。
    createEditor: (node, bar, html) => window.LaiMailEditor.create(node, bar, html),
    editorToolbar: () => window.LaiMailEditor.toolbar(),
    request: (path, payload) =>
      fetch(path, payload === undefined
        ? { cache: "no-store" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    isActive: () => activeRoute === "mail",
    hasDialog: () => !!modal,
    customerRows: () => allCustomerRows(),
    onCounts: () => updateMailBadge(),
    // 把邮件记到客户动态：和别的客户资料改动一样保存到来财。
    recordMail: async (name, item) => {
      try {
        await persist(M.addMailActivity(state, name, item));
        toast("已记到客户动态");
        return true;
      } catch (error) {
        toast(error.message);
        return false;
      }
    },
    isMailRecorded: (name, item) => M.mailRecorded(state, name, item),
    autoRecordMails,
    refreshCustomerPanel: (name) => {
      if (activeRoute === "customers" && currentName === name && tab === "activity" && activityFilter === "email" && $("#activity-results")) replaceActivityResults(true);
    },
    dialog: drawer,
    closeDialog: () => {
      if (String(modal || "").startsWith("mail-")) closeModal(false, true);
    },
    openMail: (folder) => navigateApp("mail", "", true, false, folder),
    getCustomers: () => state.customers || {},
    isArchived: (profile) => L.bucket(profile) === "trash",
    // 只看本人客户的账号：群发、收件人、客户匹配里也不出现别人的客户。
    canSeeCustomer: (name, profile) => R.scopeOf(state) === "all" || customerVisible({ name, owner: profile?.owner }),
    openCustomer: (name) => navigateApp("customers", name),
    toast,
    mount: (html) => {
      window.LaiActivityCategoryNavigation.mount(null);
      closeDropdowns();
      removePopover();
      $("#app").innerHTML = shell(html);
    },
  });
  boot();
})();
