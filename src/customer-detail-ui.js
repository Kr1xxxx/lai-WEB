(function (root) {
  "use strict";
  const summaryFieldOptions = [
    { id: "stage", label: "客户阶段" },
    { id: "group", label: "客户分组" },
    { id: "customerStars", label: "客户星级" },
    { id: "score", label: "评分" },
    { id: "source", label: "客户来源" },
    { id: "website", label: "公司网址" },
    { id: "productType", label: "主营产品类型" },
    { id: "level", label: "客户等级" },
    { id: "country", label: "国家地区" },
    { id: "companyProducts", label: "主营产品" },
    { id: "lastContact", label: "最近联系时间" },
    { id: "nextFollow", label: "下次跟进" },
  ];
  const defaultSummaryFields = summaryFieldOptions.slice(0, 7).map((field) => field.id);
  function normalizeSummaryFields(fields) {
    if (!Array.isArray(fields)) return [...defaultSummaryFields];
    const allowed = new Set(summaryFieldOptions.map((field) => field.id));
    const valid = [...new Set(fields.filter((id) => typeof id === "string" && allowed.has(id)))];
    return valid.length ? valid : [...defaultSummaryFields];
  }
  const pad2 = (n) => String(n).padStart(2, "0");
  // datetime-local 需要的本地时间格式：2026-10-09T10:30
  function localInputTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  // 「写跟进」的跟进时间：客户设置里允许填历史时间才出现；不允许时返回空，页面和原来一样。
  function followupTimeInput(state, { now = new Date(), value = "", id = "", cls = "", escape: esc = String } = {}) {
    let allowed = false;
    try { allowed = root.LaiCustomerSettings?.get(state)?.followup?.allowPastTime === true; } catch (_) { allowed = false; }
    if (!allowed) return "";
    return `<input${id ? ` id="${esc(id)}"` : ""} type="datetime-local" name="followupTime" max="${esc(localInputTime(now))}" value="${esc(value)}" aria-label="跟进时间（选填，留空为现在）"${cls ? ` class="${esc(cls)}"` : ""}>`;
  }
  // 选择跟进模板的列表：按分组列出常用语，点一条把它放进跟进内容。
  function followupTemplateList(state, esc = String) {
    let groups = [];
    try { groups = root.LaiCustomerSettings?.get(state)?.followup?.templates || []; } catch (_) { groups = []; }
    groups = groups.filter((group) => Array.isArray(group.items) && group.items.length);
    if (!groups.length)
      return `<div class="k-empty followup-template-none"><span>还没有跟进模板</span><button type="button" class="k-btn k-btn--sm followup-template-settings" data-action="followup-templates-settings">去设置</button></div>`;
    return groups.map((group) => `<section class="followup-template-group"><h5>${esc(group.name)}</h5>${group.items.map((item) => `<button type="button" class="followup-template-item" data-template-item="${esc(item.id)}">${esc(item.text)}</button>`).join("")}</section>`).join("");
  }
  function render(c, options = {}) {
    const {
      tab = "info",
      icon = () => "",
      escape: StringEscape = String,
      money = (v) => String(v ?? "—"),
      date = (v) => String(v || "—").slice(0, 10),
      state = {},
      followupDraft = {},
      activityFilter = "all",
      mailPanel = "",
      activityQuery = "",
      activitySearchDraft = activityQuery,
      documentQuery = "",
      documentPage = 1,
      documentPageSize = 20,
      documentSelected = [],
      collapsedInfoSections = [],
      collapsedDetailCards = [],
      activitySearchOpen = false,
      activityGroupState = {},
      activitySort = "newest",
      activityAdvanced = {},
      now = new Date(),
      sideColumn: withSideColumn = false,
    } = options;
    const country =
      root.LaiCustomerFields?.countryLabel(c.country) || c.country;
    const E = (v) => StringEscape(String(v ?? "")),
      list = (v) => (Array.isArray(v) ? v.filter(Boolean) : v === 0 ? [0] : v ? [v] : []),
      value = (v) => E(list(v).join("、") || "—");
    const numeric = (raw, amount = false) =>
      raw !== undefined && raw !== null && String(raw).trim() !== "" && Number.isFinite(Number(raw))
        ? E(amount ? money(Number(raw)) : Number(raw))
        : "—";
    const localDateTime = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const parsed = new Date(raw.replace(" ", "T"));
      if (!Number.isFinite(parsed.getTime())) return raw;
      const pad = (part) => String(part).padStart(2, "0");
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
    };
    const feature = (label, inner = label, cls = "") =>
      `<button type="button" class="lcd-feature ${cls}" data-feature="${E(label)}" aria-label="${E(label)}">${inner}</button>`;
    // 图标按钮：组件套件的幽灵按钮（src/ui-kit.css，D-028），lcd-icon 只管 28×28 的方形尺寸。
    const ICON = "lcd-icon k-btn k-btn--ghost";
    const mini = (label, glyph) => feature(label, icon(glyph), ICON);
    const miniAction = (label, glyph, action, cls = ICON) =>
      `<button type="button" class="lcd-feature ${cls}" data-action="${action}" aria-label="${E(label)}">${icon(glyph)}</button>`;
    const label = (name, content, raw = false, summaryId = "") =>
      `<div class="lcd-field"${summaryId ? ` data-summary-field="${E(summaryId)}"` : ""}><dt>${E(name)}</dt><dd>${raw ? content : value(content)}</dd></div>`;
    const heading = (name, actions = "") =>
      `<div class="lcd-section-head"><h3><span class="lcd-caret">⌄</span>${E(name)}</h3>${actions}</div>`;
    const empty = (message = "暂无数据") => `<div class="k-empty"><span>${E(message)}</span></div>`;
    const history = list(c.history)
      .slice()
      .sort(
        (a, b) =>
          Date.parse(b.time || b.date || 0) - Date.parse(a.time || a.date || 0),
      );
    const legacyOperation = /^(?:新建客户档案|更新客户资料|更新：|合并客户档案：|批量(?:添加|移除)客户标签：)/;
    const isOperation = (item) => item.type === "operation" || (!item.type && legacyOperation.test(String(item.text || item.content || item.note || "").trim()));
    // 功能开关：关着的模块（线索、邮件、沟通）在这页上的入口和字段不显示（数据还在）。
    let switchTools = root.LaiFeatureSwitch;
    if (!switchTools && typeof require === "function") { try { switchTools = require("./feature-switch-model.js"); } catch (_) { switchTools = null; } }
    const modOn = (module) => !switchTools || switchTools.enabled(state, module);
    const offFields = new Set([
      ...(modOn("mail") ? [] : ["最近发件时间", "最近收件时间"]),
      ...(modOn("chat") ? [] : ["最近WhatsApp沟通时间"]),
      ...(modOn("lead") ? [] : ["关联线索", "最近转化线索创建时间", "来源线索"]),
    ]);
    if (!modOn("mail") && activityFilter === "email") { activityFilter = "all"; mailPanel = ""; }
    // 聊天记录：没有“查看聊天记录”权限的角色，动态里看不到聊天条目。
    const roleTools = root.LaiRoleModel;
    const allowChat = (key) => !roleTools || roleTools.can(state, key);
    const chatView = allowChat("chat.view"), chatSend = allowChat("chat.send"), chatImport = allowChat("chat.import");
    const activityHistory = history.filter((item) => !isOperation(item) && (chatView || item.type !== "chat"));
    const operationHistory = history.filter((item) => isOperation(item) || !item.type);
    const profile = state.customers?.[c.name] || {};
    const poolTools = root.LaiCustomerTools;
    let hideContacts = false;
    try { hideContacts = profile.laiBucket === "pool" && !!poolTools && !poolTools.poolContactsVisible(state); } catch (_) { hideContacts = false; }
    // 角色权限：没有编辑权限就不画编辑入口。
    const roles = root.LaiRoleModel;
    const can = (key) => !roles || roles.can(state, key);
    const showOpp = can("opp.view"), showOrder = can("order.view");
    const canEdit = can(profile.laiBucket === "pool" ? "pool.edit" : "customer.edit");
    // 商机字段权限：结束日期、备注被设成看不到的角色，进行中的商机这一行不显示它们。
    const oppShown = (key) => !roles || !roles.fieldVisible || roles.fieldVisible(state, "opp", key);
    // 字段权限：看不到的字段不显示，也不能拿它搜；只能看的字段没有编辑入口。
    let fieldTools = root.LaiCustomerFields;
    if (!fieldTools && typeof require === "function") { try { fieldTools = require("./customer-fields.js"); } catch (_) { fieldTools = null; } }
    const gate = fieldTools?.gate ? fieldTools.gate(state, profile) : null;
    const show = (key) => !gate || gate.visible(key);
    const showContact = (key) => show("contact." + key);
    const canActivity = !gate || gate.canActivity;
    const editLock = hideContacts ? ' disabled title="公海客户不能编辑（客户设置 → 公海管理）"' : "";
    let forecast = null;
    try { forecast = poolTools && (profile.laiBucket || "active") === "active" ? poolTools.poolForecast(state, c.name, now) : null; } catch (_) { forecast = null; }
    const forecastNotice = forecast
      ? `<p class="lcd-pool-notice${forecast.dueInDays <= 0 ? " is-due" : ""}" role="status" data-pool-forecast>${forecast.dueInDays <= 0 ? `已符合公海规则「${E(forecast.ruleName)}」，下次执行时会移入公海` : `还有 ${Math.ceil(forecast.dueInDays)} 天移入公海（规则：${E(forecast.ruleName)}）`}</p>`
      : "";
    const savedContacts = Array.isArray(c.contacts) ? c.contacts : [];
    const contacts = Array.from(
      { length: c.contactCount || 0 },
      (_, i) => savedContacts[i] ?? (i === 0 ? c.contact : profile.extraContacts?.[i - 1]?.contact || c.extraContacts?.[i - 1]?.contact) ?? "",
    );
    const group = list(c.group).join("、") || "未分组";
    const starValue = Number(c.customerStars),
      starIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 17.886 17.478 4 19.49l10.059 9.834L11.654 43 24 36.42 36.345 43 33.96 29.325 44 19.491 30.191 17.478Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>',
      stars = `<span class="lcd-stars" aria-label="客户星级 ${E(c.customerStars || "未填写")}">${[1, 2, 3, 4, 5].map((n) => `<span class="lcd-star ${Number.isFinite(starValue) && starValue >= n ? "filled" : ""}">${starIcon}</span>`).join("")}</span>`;
    // 页头的 WhatsApp 按钮：用第一个有号码的联系人；客户没有电话，或没有“打开 WhatsApp 聊天”权限，就不出现。
    const waTarget = (() => {
      if (!chatSend || !show("contact.phone")) return null;
      const found = (phone, code, name) => (String(phone ?? "").trim() ? { phone: String(phone).trim(), code: String(code ?? "").trim(), contact: String(name ?? "").trim() } : null);
      for (let i = 0; i < contacts.length; i++) {
        const legacy = typeof contacts[i] === "object" ? contacts[i] : {};
        const record = i === 0 ? { ...c, ...profile, ...legacy } : { ...legacy, ...(profile.extraContacts?.[i - 1] || c.extraContacts?.[i - 1] || {}) };
        const name = typeof contacts[i] === "object" ? contacts[i].contact || contacts[i].name : contacts[i];
        const hit = found(c.phones?.[i] ?? record.phone, record.phoneCountryCode, name)
          || (Array.isArray(record.additionalPhones) ? record.additionalPhones : []).map((entry) => found(entry?.phone, entry?.phoneCountryCode, name)).find(Boolean);
        if (hit) return hit;
      }
      return found(c.phones?.[0] ?? profile.phone, profile.phoneCountryCode, c.contact);
    })();
    const waPill = waTarget
      ? `<button type="button" class="lcd-feature k-btn lcd-wa-pill" data-chat-action="open-wa" data-wa-phone="${E(waTarget.phone)}" data-wa-code="${E(waTarget.code)}" data-wa-contact="${E(waTarget.contact)}" aria-label="用 WhatsApp 联系客户">WhatsApp</button>`
      : "";
    const contactCards = () =>
      contacts.length
        ? contacts.map((contact, i) => {
            const legacy = typeof contact === "object" ? contact : {};
            const record = i === 0
              ? { ...c, ...profile, ...legacy }
              : { ...legacy, ...(profile.extraContacts?.[i - 1] || c.extraContacts?.[i - 1] || {}) };
            const contactName = typeof contact === "object"
              ? contact.contact || contact.name || contact.nickname || "—"
              : contact;
            const displayName = String(contactName || "").trim() || "—";
            const actionName = displayName === "—" ? "未命名联系人" : displayName;
            const contactId = i === 0 ? "primary" : String(record.id || "").trim();
            const social = [
              [record.socialPlatform || record.social, record.socialAccount].filter(Boolean).join(" "),
              ...(Array.isArray(record.additionalSocialAccounts) ? record.additionalSocialAccounts : [])
                .map((entry) => [entry?.socialPlatform, entry?.socialAccount].filter(Boolean).join(" ")),
            ].filter(Boolean).join("、");
            const phoneDisplay = (phone, code) => {
              const number = String(phone ?? "").trim();
              if (!number || /^(?:\+|00)/.test(number)) return number;
              return [String(code ?? "").trim(), number].filter(Boolean).join(" ");
            };
            const phones = [
              phoneDisplay(c.phones?.[i] ?? record.phone, record.phoneCountryCode),
              ...(Array.isArray(record.additionalPhones) ? record.additionalPhones : [])
                .map((entry) => phoneDisplay(entry?.phone, entry?.phoneCountryCode)),
            ].filter(Boolean).join("、");
            // 每个号码一个 WhatsApp 入口：有“打开 WhatsApp 聊天”权限、能看到电话字段时才有。
            const waPhones = chatSend && showContact("phone")
              ? [{ phone: c.phones?.[i] ?? record.phone, code: record.phoneCountryCode },
                  ...(Array.isArray(record.additionalPhones) ? record.additionalPhones : []).map((entry) => ({ phone: entry?.phone, code: entry?.phoneCountryCode }))]
                  .filter((entry) => String(entry.phone ?? "").trim())
              : [];
            const waButtons = waPhones.map((entry) => `<button type="button" class="lcd-feature ${ICON} lcd-wa-phone" data-chat-action="open-wa" data-wa-phone="${E(String(entry.phone).trim())}" data-wa-code="${E(String(entry.code ?? "").trim())}" data-wa-contact="${E(String(contactName || "").trim() === "—" ? "" : contactName)}" aria-label="用 WhatsApp 联系${E(actionName)}（${E(String(entry.phone).trim())}）" title="WhatsApp ${E(String(entry.phone).trim())}">${icon("chat")}</button>`).join("");
            const searchText = [contactName, showContact("email") ? c.emails?.[i] ?? record.email : "",
              showContact("alternateEmail") ? record.alternateEmail ?? record.alternativeEmail ?? record.backupEmail : "",
              showContact("socialAccount") ? social : "", showContact("phone") ? phones : ""]
              .filter(Boolean).join("\n");
            const cf = (key, name, content, raw) => (showContact(key) ? label(name, content, raw) : "");
            return `<article class="lcd-contact" data-contact-index="${i}" data-contact-id="${E(i === 0 ? contactId : contactId ? "extra:" + contactId : "")}" data-contact-search="${E(searchText)}"><div class="lcd-contact-title"><strong>${E(displayName)}</strong>${i === 0 ? '<span class="lcd-main-contact k-badge k-badge--primary">主</span>' : ""}<span class="lcd-contact-actions">${waButtons}${modOn("mail") && i === 0 && String(c.emails?.[0] ?? record.email ?? "").trim() ? `<button type="button" class="lcd-feature ${ICON}" data-feature="写邮件" aria-label="写邮件给联系人">${icon("mail")}</button>` : ""}${canEdit ? `<button type="button" class="lcd-feature ${ICON}" data-contact-more="${i}" aria-label="${E(actionName)}的更多操作">${icon("more")}</button>` : ""}</span></div><dl>${cf("email", "邮箱", c.emails?.[i] ?? record.email)}${cf("socialAccount", "社交平台", social)}${cf("phone", "联系电话", phones)}${cf("alibabaId", "Alibaba会员 ID", record.alibabaId)}${cf("address", "地址", c.addresses?.[i] ?? record.address)}${cf("alternateEmail", "备用邮箱", record.alternateEmail ?? record.alternativeEmail ?? record.backupEmail)}${cf("birthday", "生日", record.birthday)}${cf("contactPaymentMethod", "付款方式", record.contactPaymentMethod || (i > 0 ? record.paymentMethod : ""))}${record.contactTitle ? label("职位", record.contactTitle) : ""}${record.contactGender ? label("性别", record.contactGender) : ""}${cf("contactNote", "联系人备注", record.contactNote)}</dl></article>`;
          }).join("")
        : empty("暂无联系人");
    const summaryValues = {
      stage: c.stage, group, customerStars: stars, score: profile.score,
      source: c.source, website: c.website, productType: c.productType,
      level: c.displayLevel ?? c.level, country, companyProducts: profile.companyProducts ?? c.companyProducts,
      lastContact: localDateTime(c.lastContact), nextFollow: date(c.nextFollow),
    };
    const summaryLabels = new Map(summaryFieldOptions.map((field) => [field.id, field.label]));
    const summaryShown = (id) => !gate || gate.summaryVisible(id);
    const summary = normalizeSummaryFields(state.previewDetailSummaryFields)
      .filter(summaryShown)
      .map((id) => label(`${summaryLabels.get(id)}:`, summaryValues[id], id === "customerStars", id))
      .join("");
    const collapsedCards = new Set(Array.isArray(collapsedDetailCards) ? collapsedDetailCards : []);
    const cardHeading = (id, title, actions = "") => {
      const closed = collapsedCards.has(id);
      const titleMarkup = id === "contacts" ? `<span id="contact-count-label">${E(title)}</span>` : E(title);
      return `<div class="lcd-section-head"><h3><button type="button" class="lcd-card-toggle" data-action="toggle-detail-card" data-card-id="${id}" aria-controls="lcd-card-panel-${id}" aria-expanded="${!closed}"><span class="lcd-caret" aria-hidden="true">${closed ? "›" : "⌄"}</span>${titleMarkup}</button></h3>${actions}</div>`;
    };
    const cardPanel = (id, content) => `<div class="lcd-card-panel" id="lcd-card-panel-${id}" aria-hidden="${collapsedCards.has(id)}"${collapsedCards.has(id) ? " inert" : ""}><div class="lcd-card-panel-inner">${content}</div></div>`;
    const contactActions = `<div class="lcd-contact-header-actions"><div class="lcd-contact-search-controls">${miniAction("搜索联系人", "search", "contact-search")}${canEdit ? miniAction("添加联系人", "plus", "add-contact") + miniAction("联系人更多操作", "more", "contacts-actions") : ""}</div><div class="lcd-contact-search-row" hidden><div class="lcd-contact-search-input"><input id="contact-search-input" type="search" maxlength="200" aria-label="搜索联系人" aria-describedby="contact-search-status" placeholder="搜索昵称/邮箱/电话/社交平台" autocomplete="off"><button type="button" data-action="clear-contact-search" aria-label="清空联系人搜索" hidden><svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="7" fill="currentColor"/><path d="m5 5 4 4m0-4-4 4" stroke="#fff" stroke-width="1.2"/></svg></button></div><button type="button" data-action="apply-contact-search" aria-label="搜索联系人结果">${icon("search")}</button></div></div>`;
    const contactsCard = `<section class="lcd-card lcd-contacts k-card" data-detail-card="contacts" data-collapsed="${collapsedCards.has("contacts")}">${cardHeading("contacts", `联系人(${contacts.length})`, hideContacts ? "" : contactActions)}${cardPanel("contacts", `${hideContacts ? empty("公海联系人已隐藏") : contactCards()}<span id="contact-search-status" class="lcd-contact-search-feedback" role="status"></span><div id="contact-search-empty" class="lcd-contact-search-feedback" hidden>未找到联系人</div>`)}</section>`;
    const timeInput = followupTimeInput(state, { now, value: followupDraft?.time || "", cls: "k-input", escape: E });
    const identity = profile.laiBucket === "trash" ? "回收站" : profile.laiBucket === "pool" ? "公海客户" : "私海客户";
    const scheduleCard = `<section class="lcd-card lcd-schedule k-card">${heading(`计划日程 （${c.nextFollow ? 1 : 0}）`, canEdit ? '<button type="button" class="lcd-feature k-btn k-btn--ghost k-btn--sm" data-action="schedule-edit" aria-label="安排客户跟进日程">添加</button>' : "")}${c.nextFollow ? `<div class="lcd-schedule-entry">${icon("clock")} ${E(date(c.nextFollow))} <span>客户跟进</span><button type="button" class="lcd-feature k-btn k-btn--ghost k-btn--sm" data-action="schedule-view" aria-label="在日历查看客户跟进日程">查看</button></div>` : ""}</section>`;
    const left = `<aside class="lcd-left"><section class="lcd-card lcd-summary k-card"><div class="lcd-identity"><div class="lcd-person"><svg viewBox="0 0 40 35" aria-hidden="true"><circle cx="20" cy="11" r="8" fill="var(--brand-500)"/><path d="M6 33c0-16 28-16 28 0" fill="var(--brand-500)"/></svg><span>${identity}</span></div><div class="lcd-identity-text"><h2>${E(c.name)}</h2><div>${show("customerCode") ? `编号：${E(c.customerCode || "—")} ` : ""}<span>${E(country || "—")}</span>${show("timezone") ? ` <span>${E(profile.timezone || "")}</span>` : ""}</div></div><button type="button" class="lcd-follow k-btn k-btn--ghost${c.followed ? " on" : ""}" data-follow="${E(c.name)}" aria-label="${c.followed ? "取消关注" : "关注"}客户">♡</button></div>${show("tags") ? `<div class="lcd-tags">标签：${list(
      c.tags,
    )
      .map((tag) => `<span class="lcd-tag k-badge">${E(tag)}</span>`)
      .join(
        "",
      )}${canEdit && !hideContacts && (!gate || gate.editable("tags")) ? miniAction("设置客户标签", "plus", "customer-tags", "lcd-add-tag " + ICON) : ""}</div>` : ""}<div class="lcd-owner">跟进人：<span>${E(c.owner || "—")}</span></div><div class="lcd-summary-fields"><dl>${summary}</dl>${miniAction("客户摘要字段设置", "settings", "summary-fields")}</div></section>${scheduleCard}${contactsCard}</aside>`;
    const phases = ["未成单", "付款未到账", "待付尾款.", "已完成", "输单"];
    const phaseIds = ["open", "unpaid", "balance", "done", "lost"];
    const hasActiveOpportunity = Number.isFinite(Number(c.activeOpportunityCount)) && Number(c.activeOpportunityCount) > 0;
    // 当前显示的那一个进行中商机（由页面决定是第几个）；没有传入时保持原来的占位显示。
    const activeOpportunity = hasActiveOpportunity && Array.isArray(c.activeOpportunities) ? c.activeOpportunities[Math.min(Math.max(0, Number(c.activeOpportunityIndex) || 0), c.activeOpportunities.length - 1)] : null;
    const opportunityDetails = hasActiveOpportunity
      ? `<div class="lcd-opportunity-row"><div>${mini("上一个商机", "back")}<span>${activeOpportunity ? E(activeOpportunity.name) : "—"}</span>${mini("下一个商机", "next")}</div><div>销售金额 <b>${activeOpportunity ? `${E(activeOpportunity.currency)} ${numeric(activeOpportunity.amount, true)}` : "—"}</b></div>${oppShown("endDate") ? `<div>结束日期 <b>${activeOpportunity ? E(activeOpportunity.endDate || "—") : "—"}</b></div>` : ""}${oppShown("note") ? `<div>备注 <b>${activeOpportunity?.note ? E(activeOpportunity.note) : "—"}</b></div>` : ""}${mini("商机更多操作", "more")}</div><div class="lcd-phases">${(Array.isArray(activeOpportunity?.stages) ? activeOpportunity.stages : phases.map((phase, i) => ({ id: phaseIds[i], label: phase }))).map((phase, i) => feature(`商机阶段：${phase.label}`, E(phase.label), `lcd-phase phase-${i}${activeOpportunity && phase.id === activeOpportunity.stage ? " is-current" : ""}`)).join("")}</div>`
      : "";
    const opportunity = `<section class="lcd-card lcd-opportunity${hasActiveOpportunity ? "" : " is-empty"} k-card">${heading(`进行中的商机 （${numeric(c.activeOpportunityCount)}）`, feature("添加商机", "添加", "k-btn k-btn--ghost k-btn--sm"))}${opportunityDetails}</section>`;
    function info() {
      const fields = (items) => items.map(([name, content]) => label(name, content)).join("");
      const collapsed = new Set(Array.isArray(collapsedInfoSections) ? collapsedInfoSections : []);
      const section = (id, title, content, actions = "") => {
        const closed = collapsed.has(id);
        return `<section class="lcd-info-section" data-info-section="${id}" data-collapsed="${closed}"><div class="lcd-section-head"><h3><button type="button" class="lcd-info-toggle" id="lcd-info-toggle-${id}" data-action="toggle-info-section" data-info-id="${id}" aria-controls="lcd-info-${id}" aria-expanded="${!closed}"><span class="lcd-caret" aria-hidden="true">${closed ? "›" : "⌄"}</span>${E(title)}</button></h3>${actions}</div><div class="lcd-info-panel" id="lcd-info-${id}" aria-hidden="${closed}"${closed ? " inert" : ""}><div class="lcd-info-panel-inner"><dl class="lcd-info-fields">${content}</dl></div></div></section>`;
      };
      const timeField = (name, content) => [name, localDateTime(content)];
      const followupFields = [
        timeField("最近联系时间", c.lastContact), timeField("最近跟进时间", c.lastFollowup),
        timeField("下次移入公海日期", profile.nextPoolEntry),
        timeField("最近进入私海时间", profile.lastPrivatePoolEntry),
        timeField("最近进入公海时间", profile.lastPoolEntry),
        ["进入公海次数", profile.poolEntryCount],
        timeField("最近成交时间", c.lastDealDate ?? profile.lastDealDate),
        timeField("最近发件时间", profile.lastEmailSent),
        timeField("最近收件时间", profile.lastEmailReceived),
        timeField("最近发EDM时间", profile.lastEdmSent),
        timeField("最近收到阿里TM消息时间", profile.lastAlibabaMessageReceived),
        timeField("最近发送阿里TM消息时间", profile.lastAlibabaMessageSent),
        timeField("最近收到阿里TM询盘时间", profile.lastAlibabaInquiryReceived),
        timeField("最近WhatsApp沟通时间", c.lastWhatsAppContact ?? profile.lastWhatsAppContact),
        timeField("最近企业微信沟通时间", profile.lastWeComContact),
        timeField("最近Instagram Messenger沟通时间", profile.lastInstagramContact),
        timeField("Tips最近更新时间", profile.tipsUpdatedAt),
        timeField("最近「写跟进」时间", profile.lastWrittenFollowup),
        timeField("下次跟进时间", c.nextFollow), ["跟进人", c.owner],
      ].filter(([name]) => !offFields.has(name));
      const systemFields = [
        ["创建人", profile.createdBy], timeField("创建时间", c.createdAt),
        ["最近修改人", profile.updatedBy], timeField("资料更新时间", profile.updated),
        ["原跟进人", profile.previousOwner || (profile.laiBucket === "pool" ? profile.laiPreviousOwner : "")],
        ["客户通跟进人", profile.customerConnectOwner],
        ["客户通原跟进人", profile.customerConnectPreviousOwner],
        ["创建方式", profile.creationMethod], ["关联线索", profile.linkedLead],
        timeField("最近转化线索创建时间", profile.lastConvertedLeadCreated),
        ["来源线索", profile.sourceLead], ["来源详情", profile.sourceDetail],
        ["客群", c.segments ?? profile.segments],
        timeField("关联客户通客户首次同步时间", profile.customerConnectFirstSync),
        timeField("关联客户通客户最近同步时间", profile.customerConnectLastSync),
        timeField("跟进人更新时间", profile.ownerUpdatedAt),
      ].filter(([name]) => !offFields.has(name));
      const hasTradePreferences = Boolean(profile.paymentMethod || profile.paymentEmail || profile.repurchaseCycle || profile.currency && profile.currency !== "USD");
      // The captured detail view has a fixed 9+4 layout. The display drawer
      // configures the editor; tags already live in the identity card above.
      const sf = (key, name, content, raw) => (show(key) ? label(name, content, raw) : "");
      const companyCommon = `${sf("website", "公司网址", c.website)}${label("公司名称", c.name)}${label("国家地区", country)}${label("客户来源", c.source)}${sf("productType", "主营产品类型", c.productType)}${sf("previewGroup", "客户分组", group)}${sf("customerStage", "客户阶段", c.stage)}${c.customerType ? sf("customerType", "客户类型", c.customerType) : ""}${sf("customerStars", "客户星级", stars, true)}${sf("customerCode", "客户编号", c.customerCode)}`;
      const companyOther = `${sf("timezone", "时区", profile.timezone)}${sf("companyProducts", "主营产品", profile.companyProducts ?? profile.mainProducts ?? profile["主营产品"])}${sf("cardStock", "卡纸", profile.cardStock ?? profile.cardPaper ?? profile["卡纸"])}${sf("customBox", "定制盒", profile.customBox ?? profile["定制盒"])}${[["shortName","公司简称",profile.shortName],["landline","座机",profile.landline],["companyAddress","详细地址",profile.companyAddress],["companyRemark","公司备注",profile.companyRemark],["poolGroup","公海分组",profile.poolGroup]].filter(([,,value]) => value).map(([key,name,value]) => sf(key,name,value)).join("")}`;
      // 自定义字段（客户设置 → 字段设置）：按设置里的顺序；角色看不到的字段不显示。设置里删掉的字段不显示（值仍在档案里）。
      let fieldModel = root.LaiFieldModel;
      if (!fieldModel && typeof require === "function") { try { fieldModel = require("./field-model.js"); } catch (_) { fieldModel = null; } }
      const customValues = profile.custom && typeof profile.custom === "object" && !Array.isArray(profile.custom) ? profile.custom : {};
      const customDefs = fieldModel ? fieldModel.get(state, "customer").customFields.filter((def) => show("custom." + def.id)) : [];
      const customSection = customDefs.length
        ? `<div class="lcd-rule"></div>${section("custom-fields", "自定义字段", customDefs.map((def) => label(def.name, fieldModel.formatValue(def, customValues[def.id]))).join(""))}`
        : "";
      return `${section("company-common", "公司常用信息", companyCommon, miniAction("公司常用信息设置", "settings", "company-display-settings"))}<div class="lcd-rule"></div>${section("company-other", "公司其他信息", companyOther)}${customSection}<div class="lcd-rule"></div>${section("followup", "跟进信息", fields(followupFields))}<div class="lcd-rule"></div>${section("system", "系统信息", fields(systemFields))}${(profile.note && show("note")) || (profile.permanentNote && show("permanentNote")) ? `<div class="lcd-rule"></div>${section("notes", "客户备注", `${sf("note", "客户备注", profile.note)}${sf("permanentNote", "客户永久备注", profile.permanentNote)}`)}` : ""}${hasTradePreferences && ["currency", "paymentMethod", "paymentEmail", "repurchaseCycle"].some(show) ? `<div class="lcd-rule"></div>${section("trade-preferences", "交易偏好", `${sf("currency", "默认币种", profile.currency || "USD")}${sf("paymentMethod", "客户付款方式", profile.paymentMethod)}${sf("paymentEmail", "付款邮箱", profile.paymentEmail)}${sf("repurchaseCycle", "复购周期", profile.repurchaseCycle ? `${profile.repurchaseCycle} 天` : "")}`)}` : ""}`;
    }
    function timeline(items, activity) {
      return items.length
        ? `<div class="lcd-timeline ${activity ? "is-activity" : ""}">${items
            .map(
              (item, index) => {
                const time = localDateTime(item.time || item.date) || "—";
                const content = item.text || item.content || item.note || "—";
                if (activity) {
                  const panelId = `activity-detail-${history.indexOf(item)}`;
                  const kind = { followup: "跟进记录", email: "往来邮件", chat: "聊天记录" }[item.type] || item.type || "客户动态";
                  const actor = item.owner || item.actor || item.operator;
                  const contact = item.contact || item.contactName;
                  const channel = item.channel;
                  const quick = item.type === "followup" && item.subtype === "quick";
                  const displayTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)
                    ? time.slice(time.slice(0, 4) === String(new Date(now).getFullYear()) ? 5 : 0, 16)
                    : time;
                  if (item.type === "chat" && typeof root.LaiWhatsAppUI?.renderChatEntry === "function") {
                    return `<article class="lcd-activity-record lcd-chat-record"><time title="${E(time)}">${E(displayTime)}</time><div class="lcd-timeline-owner">聊天记录 <span>｜ 操作人：${E(actor || "—")}</span></div><div class="lcd-event-body">${root.LaiWhatsAppUI.renderChatEntry(item, E)}</div></article>`;
                  }
                  const expand = `<button type="button" class="lcd-event-expand" data-action="toggle-activity-detail" aria-label="查看动态详情" aria-controls="${panelId}" aria-expanded="false">查看详情</button>`;
                  const quickIcon = quick ? `<svg class="lcd-activity-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><circle cx="14" cy="14" r="14" fill="#04C373" fill-opacity=".2"/><path fill="#04C373" fill-rule="evenodd" d="M16.456 12.66a1.1 1.1 0 0 0 .782-.322l3.254-3.249v11.193c0 .646-.525 1.168-1.168 1.168H7.877a1.169 1.169 0 0 1-1.169-1.168V7.148c0-.647.522-1.169 1.169-1.169h11.422a1.187 1.187 0 0 1 .848.357 1.068 1.068 0 0 0-.163.132l-4.31 4.306a1.107 1.107 0 0 0 .782 1.887Zm-3.425-1.654H8.752a.554.554 0 0 0-.552.553c0 .304.248.552.552.552h4.28a.554.554 0 0 0 .552-.552.554.554 0 0 0-.553-.553Zm-4.279 4.696h5.716a.552.552 0 0 0 0-1.105H8.752a.554.554 0 0 0-.552.553c0 .303.248.552.552.552Zm7.376-3.688a.554.554 0 0 0 .696-.066l4.306-4.306a.554.554 0 0 0-.782-.782l-4.303 4.304a.554.554 0 0 0 .083.85Z"/></svg>` : "";
                  const heading = quick
                    ? `快速记录<span class="lcd-activity-separator" aria-hidden="true"></span><span class="lcd-activity-actor">操作人：${E(actor || "—")}</span>${expand}`
                    : `${E(item.type === "followup" ? "跟进记录" : "客户动态")} <span>｜ 操作人：${E(actor || "—")}</span>`;
                  const body = quick
                    ? `<span class="lcd-activity-content">${E(content)}</span>${contact ? `<div class="lcd-activity-contact"><span>关联联系人：</span>${E(contact)}</div>` : ""}`
                    : `${E(content)}${expand}`;
                  return `<article class="lcd-activity-record${quick ? " lcd-quick-record" : ""}">${quickIcon}<time title="${E(time)}">${E(displayTime)}</time><div class="lcd-timeline-owner">${heading}</div><div class="lcd-event-body">${body}</div><div id="${panelId}" class="lcd-activity-detail" aria-hidden="true"><div class="lcd-activity-detail-inner"><dl><div><dt>时间</dt><dd>${E(time)}</dd></div><div><dt>类型</dt><dd>${E(kind)}</dd></div>${actor ? `<div><dt>操作人</dt><dd>${E(actor)}</dd></div>` : ""}${contact ? `<div><dt>联系人</dt><dd>${E(contact)}</dd></div>` : ""}${channel ? `<div><dt>渠道</dt><dd>${E(channel)}</dd></div>` : ""}<div><dt>记录内容</dt><dd>${E(content)}</dd></div></dl></div></div></article>`;
                }
                const actor = item.owner || item.actor || item.operator;
                const panelId = `operation-detail-${index}`;
                return `<article class="lcd-operation-record"><button type="button" class="lcd-operation-head" data-action="toggle-operation" aria-controls="${panelId}" aria-expanded="false"><span class="lcd-operation-head-main"><time>${E(time)}</time><span class="lcd-operation-description">${E(content)}</span></span><span class="lcd-operation-chevron" aria-hidden="true">⌄</span></button><div id="${panelId}" class="lcd-operation-detail" aria-hidden="true"><div class="lcd-operation-detail-inner"><dl><div><dt>操作时间</dt><dd>${E(time)}</dd></div>${actor ? `<div><dt>操作人</dt><dd>${E(actor)}</dd></div>` : ""}<div><dt>记录内容</dt><dd>${E(content)}</dd></div></dl></div></div></article>`;
              },
            )
            .join("")}</div>`
        : empty(activity ? "暂无动态记录" : "暂无操作记录");
    }
    function activity() {
      const category = (item) =>
        item.type === "followup" ? "followup" :
        item.type === "email" ? "email" :
        item.type === "chat" ? "chat" : "other";
      const normalize = (value) => String(value ?? "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
      const query = normalize(activityQuery);
      const queriedRows = query
        ? activityHistory.filter((item) => normalize([
            item.text || item.content || item.note, item.owner, item.time || item.date,
          ].join(" ")).includes(query))
        : activityHistory;
      const categoryRows = activityFilter === "all"
        ? queriedRows
        : queriedRows.filter((item) => category(item) === activityFilter);
      const selectedTypes = new Set(Array.isArray(activityAdvanced.types) ? activityAdvanced.types : []);
      const matchesAdvanced = (item) => {
        const rawDate = String(item.time || item.date || "").replace(" ", "T");
        const parsedDate = new Date(rawDate);
        const day = Number.isFinite(parsedDate.getTime()) ? localDateTime(rawDate).slice(0, 10) : "";
        if (activityAdvanced.startDate && (!day || day < activityAdvanced.startDate)) return false;
        if (activityAdvanced.endDate && (!day || day > activityAdvanced.endDate)) return false;
        if (activityAdvanced.contact && normalize(item.contact || item.contactName || item.contactId) !== normalize(activityAdvanced.contact)) return false;
        if (activityAdvanced.owner && normalize(item.owner) !== normalize(activityAdvanced.owner)) return false;
        if (!selectedTypes.size) return true;
        const group = category(item);
        if (selectedTypes.has(group)) return true;
        const rawSubtype = normalize(item.subtype || item.channel || item.sourceType || item.type);
        const subtype = rawSubtype.replace(/[\s_-]+/g, "");
        return [...selectedTypes].some((type) => {
          const [selectedGroup, selectedSubtype] = type.split(":");
          return selectedGroup === group && selectedSubtype && normalize(selectedSubtype).replace(/[\s_-]+/g, "") === subtype;
        });
      };
      const shown = categoryRows.filter(matchesAdvanced);
      const sortTime = (item) => Date.parse(String(item.time || item.date || "").replace(" ", "T")) || 0;
      const ordered = activitySort === "oldest"
        ? shown.slice().sort((a, b) => sortTime(a) - sortTime(b))
        : shown;
      const current = new Date(now);
      const thisYear = current.getFullYear(), thisMonth = current.getMonth();
      const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
      const groupFor = (item) => {
        const raw = String(item.time || item.date || "").replace(" ", "T");
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) return { id: "undated", label: "未注明时间" };
        const year = date.getFullYear(), month = date.getMonth();
        if (year === thisYear && month === thisMonth) return { id: "recent", label: "最近" };
        if (year === thisYear) return { id: `month:${year}-${String(month + 1).padStart(2, "0")}`, label: monthNames[month] };
        return { id: `year:${year}`, label: `${year}年` };
      };
      const groups = [];
      for (const item of ordered) {
        const group = groupFor(item);
        let target = groups.find((entry) => entry.id === group.id);
        if (!target) {
          target = { ...group, items: [] };
          groups.push(target);
        }
        target.items.push(item);
      }
      const groupMarkup = groups.map((group) => {
        const expanded = Boolean(query) || (Object.prototype.hasOwnProperty.call(activityGroupState, group.id)
          ? Boolean(activityGroupState[group.id]) : group.id === "recent");
        const panelId = `activity-group-${group.id}`;
        return `<section class="lcd-timeline-group" data-timeline-group="${E(group.id)}"><button type="button" class="lcd-time-group-head" data-action="toggle-activity-group" data-group-id="${E(group.id)}" aria-controls="${E(panelId)}" aria-expanded="${expanded}"><span class="lcd-caret">${expanded ? "⌄" : "›"}</span>${E(group.label)}(${group.items.length})</button><div id="${E(panelId)}" class="lcd-time-group-body" ${expanded ? "" : "hidden"}>${timeline(group.items, true)}</div></section>`;
      }).join("");
      const filterButton = (id, title) =>
        `<button type="button" data-activity-filter="${id}" aria-pressed="${id === activityFilter}" class="${id === activityFilter ? "selected" : ""}"><span class="lcd-activity-label">${E(title)}(${id === "all" ? queriedRows.length : queriedRows.filter((item) => category(item) === id).length})</span></button>`;
      const searchButton = `<button type="button" class="lcd-feature ${ICON}" data-action="activity-search" aria-label="搜索动态" aria-controls="activity-search-row" aria-expanded="${activitySearchOpen}">${icon("search")}</button>`;
      const searchRow = `<div id="activity-search-row" class="lcd-activity-search-row" role="search" ${activitySearchOpen ? "" : "hidden"}><div class="lcd-activity-search-field"><input id="activity-search-input" type="text" maxlength="200" aria-label="搜索当前客户动态" aria-describedby="activity-search-status" placeholder="搜索跟进记录/往来邮件/动态评论" value="${E(activitySearchDraft)}" autocomplete="off"><button type="button" data-action="clear-activity-search" aria-label="清空动态搜索" ${activitySearchDraft ? "" : "hidden"}><svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="7" fill="currentColor"/><path d="m5 5 4 4m0-4-4 4" stroke="#fff" stroke-width="1.2"/></svg></button></div><button type="button" data-action="apply-activity-search" aria-label="提交动态搜索">${icon("search")}</button><span id="activity-search-status" role="status">${query ? `找到 ${shown.length} 条动态` : ""}</span></div>`;
      const refreshButton = `<button type="button" class="lcd-feature ${ICON} lcd-activity-refresh" data-action="refresh-activity" aria-label="刷新动态" aria-controls="activity-results">${icon("clock")}</button>`;
      const sortButton = `<button type="button" class="lcd-feature ${ICON}" data-action="activity-sort" aria-label="动态排序" aria-haspopup="true" aria-expanded="false" aria-controls="activity-sort-menu">${icon("sort")}</button>`;
      const queryHint = query ? `<p class="lcd-activity-query-hint">如没有符合条件的搜索结果，可尝试输入更完整的关键字</p>` : "";
      const hasAdvanced = Boolean(activityAdvanced.startDate || activityAdvanced.endDate || activityAdvanced.contact || activityAdvanced.owner || selectedTypes.size);
      const advancedButton = `<button type="button" class="lcd-feature ${ICON}${hasAdvanced ? " lcd-filter-active" : ""}" data-action="activity-advanced-filter" aria-label="筛选动态" aria-haspopup="true" aria-expanded="false" aria-controls="activity-advanced-menu">${icon("filter")}</button>`;
      const activityTools = `<div class="lcd-activity-tools"><div class="lcd-activity-tools-buttons" ${activitySearchOpen ? "hidden" : ""}><span id="activity-refresh-status" class="lcd-activity-refresh-status" role="status" aria-live="polite"></span>${refreshButton}${searchButton}${advancedButton}${sortButton}</div>${searchRow}</div>`;
      const chatTools = chatSend || chatImport
        ? `<div class="lcd-chat-tools">${chatSend ? '<button type="button" class="lcd-feature k-btn k-btn--sm" data-chat-action="log-chat">记一笔聊天</button>' : ""}${chatImport ? '<button type="button" class="lcd-feature k-btn k-btn--sm" data-chat-action="import-chat">导入聊天记录</button>' : ""}</div>`
        : "";
      const full = `<div class="lcd-followup-label"><button type="button" data-action="write-followup"><strong>写跟进</strong></button><div><button type="button" class="lcd-feature k-btn k-btn--ghost k-btn--sm" data-action="followup-templates" aria-haspopup="true" aria-expanded="false">${icon("note")} 选择模板</button></div></div><form id="followup-form" class="lcd-followup-form ${followupDraft?.text ? "has-draft" : ""}"><textarea id="followup-text" class="k-textarea" name="text" required aria-label="跟进内容" placeholder="点击这里记录跟进细节，同步最新进展。">${E(followupDraft?.text || "")}</textarea><div class="error" id="followup-error" role="alert"></div><div class="lcd-followup-footer"><label>下次跟进 <input type="date" class="k-input" name="nextFollow" value="${E(String(followupDraft?.nextFollow ?? c.nextFollow ?? "").slice(0, 10))}"></label>${timeInput ? `<label class="lcd-followup-time">跟进时间（选填，留空为现在） ${timeInput}</label>` : ""}<div><button type="button" class="k-btn" data-action="cancel-followup">取消草稿</button><button type="submit" class="k-btn k-btn--primary">保存跟进</button></div></div></form><div class="lcd-journey"><div class="lcd-button-group k-tabs"><button class="selected k-tab is-active" data-tab="activity">历史动态</button></div>${activityTools}</div><div class="lcd-activity-filters" aria-label="动态类别"><button type="button" class="lcd-activity-arrow" data-activity-scroll="left" aria-label="向左查看动态类别" hidden><svg class="lcd-activity-arrow-glyph" viewBox="64 64 896 896" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M724 218.3V141c0-6.7-7.7-10.4-12.9-6.3L260.3 486.8a31.86 31.86 0 000 50.3l450.8 352.1c5.3 4.1 12.9.4 12.9-6.3v-77.3c0-4.9-2.3-9.6-6.1-12.6l-360-281 360-281.1c3.8-3 6.1-7.7 6.1-12.6z"/></svg></button><div class="lcd-activity-clip"><div class="lcd-activity-list">${filterButton("all", "全部")}${filterButton("followup", "跟进记录")}${modOn("mail") ? filterButton("email", "往来邮件") : ""}${chatView ? filterButton("chat", "聊天记录") : ""}${filterButton("other", "其它")}</div></div><button type="button" class="lcd-activity-arrow" data-activity-scroll="right" aria-label="向右查看动态类别" hidden><svg class="lcd-activity-arrow-glyph" viewBox="64 64 896 896" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M765.7 486.8L314.9 134.7A7.97 7.97 0 00302 141v77.3c0 4.9 2.3 9.6 6.1 12.6l360 281.1-360 281.1c-3.9 3-6.1 7.7-6.1 12.6V883c0 6.7 7.7 10.4 12.9 6.3l450.8-352.1a31.96 31.96 0 000-50.4z"/></svg></button></div><div id="activity-results">${activityFilter === "chat" && chatView ? chatTools : ""}${mailPanel}${queryHint}${shown.length ? (activityFilter === "followup" || query ? timeline(ordered, true) : groupMarkup) : query ? empty("暂无数据") : `${heading("最近 (0)")}${empty(hasAdvanced ? "未找到动态" : "暂无动态记录")}`}</div>`;
      // 没有“跟进动态·查看”权限：看不到动态内容，只留下写跟进（写跟进由编辑权限管）。
      if (canActivity) return full;
      return full.slice(0, full.indexOf('<div class="lcd-journey">')) + `<p class="lcd-activity-denied" role="status" data-activity-denied>你的角色没有“跟进动态·查看”权限</p>`;
    }
    function trade() {
      const metrics = [
        ["赢单商机金额(USD)", numeric(c.opportunityTotal, true)],
        ["赢单商机均价(USD)", numeric(c.opportunityAverage, true)],
        ["首次赢单日期 ⓘ", E(date(c.firstWonDate))],
        ["最近赢单日期 ⓘ", E(date(c.lastWonDate))],
        ["进行中的商机数 ⓘ", numeric(c.activeOpportunityCount)],
        ["赢单商机数", numeric(c.opportunityCount)],
        ["赢单率", Number.isFinite(c.opportunityWinRate) ? `${c.opportunityWinRate}%` : "—"],
        ["平均销售周期", Number.isFinite(c.opportunityCycle) ? `${c.opportunityCycle} 天` : "—"],
      ];
      const allOpportunities = list(c.opportunities), shownOpportunities = allOpportunities.slice(0, 10);
      const oppPart = `${heading("商机", `<div class="lcd-heading-inline">${feature("全部商机", `全部 (${Number.isFinite(c.opportunityAllCount) ? c.opportunityAllCount : "—"}) ›`, "k-btn k-btn--ghost k-btn--sm")}${mini("新建商机", "plus")}</div>`)}<div class="lcd-metrics">${metrics.map(([name, content]) => `<div><span>${E(name)}</span><strong>${content}</strong></div>`).join("")}</div><div class="lcd-table-scroll"><table class="k-table lcd-opportunity-table"><thead><tr>${["商机编号", "商机名称", "当前阶段", "销售金额", ...(oppShown("endDate") ? ["结束日期"] : []), "负责人"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${shownOpportunities.map((item) => `<tr data-opportunity-row="${E(item.id)}"><td>${value(item.number)}</td><td>${E(item.name)}</td><td>${value(item.stageLabel)}</td><td>${E(item.currency)} ${numeric(item.amount, true)}</td>${oppShown("endDate") ? `<td>${E(date(item.endDate))}</td>` : ""}<td>${value(item.owner)}</td></tr>`).join("") || `<tr><td colspan="${oppShown("endDate") ? 6 : 5}" class="lcd-no-data">暂无商机数据</td></tr>`}</tbody></table></div><div class="lcd-pagination">共 ${allOpportunities.length} 条${allOpportunities.length > shownOpportunities.length ? `，这里只列出最近 ${shownOpportunities.length} 条，点上方「全部」查看全部` : ""}</div>`;
      const orderPart = `${heading(`销售订单 (${list(c.orders).length})`, `<button type="button" class="lcd-feature k-btn k-btn--ghost k-btn--sm" data-new-customer-order="${E(c.name)}" aria-label="新建销售订单">＋ 新建</button>`)}<div class="lcd-table-scroll"><table class="k-table"><thead><tr><th>订单编号</th><th>订单日期</th><th>订单金额</th><th>当前阶段</th><th>产品类型</th></tr></thead><tbody>${
        list(c.orders)
          .map(
            (order) =>
              `<tr><td><button class="lcd-blue" data-lai-order="${E(order.id)}">${E(order.num || order.id)}</button></td><td>${E(date(order.createdAt))}</td><td>${E(order.currency || "USD")} ${E(money(Number(order.amount)))}</td><td>${E({ quote: "报价", deposit: "定金", production: "生产中", balance: "尾款", shipment: "已发货", done: "已完成" }[order.stage] || order.stage || "—")}</td><td>${value(order.productType)}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="5" class="lcd-no-data">暂无销售订单</td></tr>'
      }</tbody></table></div>`;
      // 没有商机查看／订单查看权限的角色，对应那一块不显示。
      return [showOpp ? oppPart : "", showOrder ? orderPart : ""].filter(Boolean).join('<div class="lcd-rule"></div>') || empty("你的角色不能查看商机和订单");
    }
    function documents() {
      const normalizeName = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
      const attachmentName = (file) => file.name || file.fileName || file.type || "未命名";
      const query = normalizeName(documentQuery.trim());
      const attachments = (showOrder ? list(state.orders) : [])
        .flatMap((order, orderIndex) => order.client === c.name
          ? list(order.attachments).map((file, fileIndex) => ({ file, order, key: `${order.id || order.num || orderIndex}:${fileIndex}` }))
          : [])
        .filter(({ file }) => !query || normalizeName(attachmentName(file)).includes(query));
      const size = [10, 20, 50, 100].includes(Number(documentPageSize)) ? Number(documentPageSize) : 20;
      const pages = Math.max(1, Math.ceil(attachments.length / size));
      const page = Math.min(pages, Math.max(1, Math.floor(Number(documentPage) || 1)));
      const visible = attachments.slice((page - 1) * size, page * size);
      const selected = new Set(list(documentSelected).map(String));
      const matchingKeys = new Set(attachments.map(({ key }) => key));
      const selectedCount = [...selected].filter((key) => matchingKeys.has(key)).length;
      const allVisibleSelected = visible.length > 0 && visible.every(({ key }) => selected.has(key));
      const rows = visible.map(({ file, order, key }) => {
        const name = attachmentName(file);
        return `<tr data-document-row="${E(key)}"><td><input type="checkbox" data-document-select="${E(key)}" aria-label="选择文档 ${E(name)}" ${selected.has(key) ? "checked" : ""}></td><td>${E(name)}</td><td>—</td><td>销售订单 ${E(order.num || "")}</td><td>—</td></tr>`;
      }).join("");
      return `<div class="lcd-doc-toolbar"><div class="lcd-doc-search" role="search"><input id="document-search-input" class="k-input" type="search" aria-label="搜索文件名称" placeholder="搜索文件名称" value="${E(documentQuery)}" autocomplete="off"><button type="button" class="lcd-feature ${ICON}" data-action="document-search" aria-label="搜索客户文档">${icon("search")}</button></div></div><div class="lcd-doc-layout"><aside><button type="button" class="selected" data-action="document-all" aria-pressed="true">全部文档</button></aside><section><div id="document-results" role="status" aria-live="polite"><div class="lcd-doc-grid"><table class="k-table"><thead><tr><th><input type="checkbox" data-document-select-all aria-label="选择当前页全部文档" ${allVisibleSelected ? "checked" : ""} ${visible.length ? "" : "disabled"}></th><th>文件名称</th><th>父级文件夹</th><th>关联类型</th><th>上传方式</th></tr></thead><tbody>${rows}</tbody></table>${attachments.length ? "" : empty(query ? "未找到文档" : "暂无数据")}</div><div class="lcd-pagination k-pager">${selectedCount ? `<span class="lcd-doc-selected">已选 ${selectedCount} 条 <button type="button" data-action="document-clear-selection">取消选择</button></span>` : ""}<span>共 ${attachments.length} 条</span><button type="button" data-action="document-prev" aria-label="上一页" ${page === 1 ? "disabled" : ""}>‹</button><span aria-label="第 ${page} 页，共 ${pages} 页">${page}</span><button type="button" data-action="document-next" aria-label="下一页" ${page === pages ? "disabled" : ""}>›</button><button type="button" data-action="document-page-size" aria-label="文档每页条数" aria-haspopup="menu" aria-expanded="false">${size} 条/页 ⌄</button></div></div></section></div>`;
    }
    // 右侧摘要栏（新界面的三栏版式，设计稿 CustomerDetail）：资料、销售订单、文档、操作历史各一张小卡；
    // 里面的按钮沿用已有的 data-tab / data-new-customer-order / data-lai-order 处理。
    const sideCard = (title, actions, inner, extra = "") =>
      `<section class="lcd-card lcd-side-card${extra} k-card"><div class="lcd-side-head"><h3>${E(title)}</h3>${actions}</div>${inner}</section>`;
    const sideLink = (tabId, text = "查看全部") => `<button type="button" class="lcd-side-link" data-tab="${tabId}">${text} ›</button>`;
    const stageNames = { quote: "报价", deposit: "定金", production: "生产中", balance: "尾款", shipment: "已发货", done: "已完成" };
    const sideInfo = [["客户阶段", summaryValues.stage, "customerStage"], ["客户分组", summaryValues.group, "previewGroup"], ["客户来源", summaryValues.source, ""], ["公司网址", summaryValues.website, "website"], ["主营产品", summaryValues.companyProducts, "companyProducts"]]
      .filter(([, , key]) => !key || show(key))
      .map(([name, content]) => `<div class="lcd-side-row"><span>${E(name)}</span><b>${value(content)}</b></div>`).join("");
    const sideOrders = list(c.orders).slice(0, 4).map((order) =>
      `<div class="lcd-side-order"><div><button type="button" class="lcd-blue" data-lai-order="${E(order.id)}">${E(order.num || order.id)}</button><b>${E(order.currency || "USD")} ${E(money(Number(order.amount)))}</b></div><span>${E(date(order.createdAt))} · ${E(stageNames[order.stage] || order.stage || "—")} · ${E(order.productType || "—")}</span></div>`).join("")
      || '<p class="k-empty lcd-side-none">暂无销售订单</p>';
    const sideDocs = (showOrder ? list(state.orders) : []).flatMap((order) => order.client === c.name ? list(order.attachments).map((file) => ({ file, order })) : []).slice(0, 4)
      .map(({ file, order }) => `<div class="lcd-side-doc"><span>${E(file.name || file.fileName || file.type || "未命名")}</span><small>销售订单 ${E(order.num || "")}</small></div>`).join("")
      || '<p class="k-empty lcd-side-none">暂无文档</p>';
    const sideHistory = operationHistory.slice(0, 3)
      .map((item) => `<div class="lcd-side-hist"><span>${E(item.text || item.content || item.note || "—")}</span><small>${E(localDateTime(item.time || item.date) || "—")}</small></div>`).join("")
      || '<p class="k-empty lcd-side-none">暂无操作记录</p>';
    const sideColumn = !withSideColumn ? "" : `<aside class="lcd-side" aria-label="客户摘要">`
      + sideCard("资料", canEdit ? `<button type="button" class="lcd-side-link k-btn k-btn--sm" data-action="edit"${editLock}>编辑</button>` : "", `<div class="lcd-side-rows">${sideInfo}</div>${sideLink("info", "查看全部资料")}`)
      + (!showOrder ? "" : sideCard(`销售订单 （${list(c.orders).length}）`, `<button type="button" class="lcd-side-link k-btn k-btn--sm" data-new-customer-order="${E(c.name)}" aria-label="新建销售订单">＋ 新建</button>`, sideOrders + (list(c.orders).length > 4 ? sideLink("trade") : "")))
      + sideCard("文档", "", sideDocs + sideLink("documents"))
      + sideCard("操作历史", "", sideHistory + sideLink("history"))
      + `</aside>`;
    const tabs = [
      ["activity", "动态"],
      ["info", "资料"],
      ...(showOpp || showOrder ? [["trade", "商机和订单"]] : []),
      ["documents", "文档"],
      ["history", "操作历史"],
    ];
    const body =
      tab === "info"
        ? info()
        : tab === "activity"
          ? activity()
          : tab === "trade"
            ? trade()
            : tab === "documents"
              ? documents()
              : tab === "history"
                ? timeline(operationHistory, false)
                : empty("暂无数据");
    return `<div class="lcd-root"><header class="lcd-pagebar k-pageheader"><div class="k-pageheader-text"><button type="button" class="k-btn k-btn--sm lcd-return" data-action="list" aria-label="返回客户列表" title="返回客户列表">${icon("back")}<span aria-hidden="true">返回客户列表</span></button><h1 class="k-pageheader-title">客户详情</h1></div><div class="k-pageheader-actions">${can("customer.merge") ? '<button type="button" class="lcd-feature k-btn" data-action="merge-customer" aria-label="合并客户">合并客户</button>' : ""}${canEdit ? `<button type="button" class="k-btn" data-action="edit"${editLock}>编辑</button>` : ""}${waPill}${modOn("mail") ? feature("写邮件", "写邮件", "k-btn k-btn--primary") : ""}${miniAction("客户更多操作", "more", "customer-actions")}</div></header>${forecastNotice}<div class="lcd-columns"${state.laiSettings?.customerSettings?.layout === "left-large" ? ' data-layout="left-large"' : ""}>${left}<div class="lcd-right">${showOpp ? opportunity : ""}<section class="lcd-card lcd-tabs-card k-card"><nav class="lcd-tabs k-tabs" aria-label="客户详情页签">${tabs.map(([id, title]) => `<button type="button" data-tab="${id}" class="k-tab${id === tab ? " active" : ""}" aria-selected="${id === tab}">${E(title)}</button>`).join("")}<span class="lcd-active-indicator" aria-hidden="true"></span></nav><button type="button" class="lcd-tabs-more k-btn k-btn--ghost" data-action="detail-tabs-more" aria-label="更多详情页签" aria-haspopup="menu" aria-expanded="false" aria-controls="lcd-tabs-overflow-menu" hidden><svg viewBox="64 64 896 896" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M176 511a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0z"/></svg></button><div id="lcd-tabs-overflow-menu" class="lcd-tabs-overflow-menu" role="menu" aria-label="更多详情页签" hidden>${tabs.map(([id, title]) => `<button type="button" role="menuitem" data-overflow-tab="${id}" hidden>${E(title)}</button>`).join("")}</div><div class="lcd-body lcd-body-${E(tab)}">${body}</div></section></div>${sideColumn}</div></div>`;
  }
  const api = { render, summaryFieldOptions, defaultSummaryFields, normalizeSummaryFields, followupTimeInput, followupTemplateList, localInputTime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerDetail = api;
})(typeof window !== "undefined" ? window : globalThis);
