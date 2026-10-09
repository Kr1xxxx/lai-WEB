(function (root) {
  "use strict";
  const summaryFieldOptions = [
    { id: "stage", label: "客户阶段" },
    { id: "group", label: "客户分组" },
    { id: "customerStars", label: "客户星级" },
    { id: "score", label: "评分" },
    { id: "source", label: "客户来源" },
    { id: "website", label: "公司网址" },
    { id: "productType", label: "主营产品." },
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
    const mini = (label, glyph) => feature(label, icon(glyph), "lcd-icon");
    const miniAction = (label, glyph, action, cls = "lcd-icon") =>
      `<button type="button" class="lcd-feature ${cls}" data-action="${action}" aria-label="${E(label)}">${icon(glyph)}</button>`;
    const label = (name, content, raw = false, summaryId = "") =>
      `<div class="lcd-field"${summaryId ? ` data-summary-field="${E(summaryId)}"` : ""}><dt>${E(name)}</dt><dd>${raw ? content : value(content)}</dd></div>`;
    const heading = (name, actions = "") =>
      `<div class="lcd-section-head"><h3><span class="lcd-caret">⌄</span>${E(name)}</h3>${actions}</div>`;
    const empty = (message = "暂无数据") =>
      `<div class="lcd-empty"><svg viewBox="0 0 88 76" aria-hidden="true"><path d="M21 7h43v47H21z" fill="#fff" stroke="var(--ink-400)"/><path d="M12 20h25l7 7h30l-7 36H18z" fill="var(--ink-200)"/><path d="M18 34h20l2 7H19z" fill="var(--brand-500)"/><path d="M53 15h5" stroke="var(--ink-400)"/></svg><span>${E(message)}</span></div>`;
    const history = list(c.history)
      .slice()
      .sort(
        (a, b) =>
          Date.parse(b.time || b.date || 0) - Date.parse(a.time || a.date || 0),
      );
    const legacyOperation = /^(?:新建客户档案|更新客户资料|更新：|合并客户档案：|批量(?:添加|移除)客户标签：)/;
    const isOperation = (item) => item.type === "operation" || (!item.type && legacyOperation.test(String(item.text || item.content || item.note || "").trim()));
    const activityHistory = history.filter((item) => !isOperation(item));
    const operationHistory = history.filter((item) => isOperation(item) || !item.type);
    const profile = state.customers?.[c.name] || {};
    const savedContacts = Array.isArray(c.contacts) ? c.contacts : [];
    const contacts = Array.from(
      { length: c.contactCount || 0 },
      (_, i) => savedContacts[i] ?? (i === 0 ? c.contact : profile.extraContacts?.[i - 1]?.contact || c.extraContacts?.[i - 1]?.contact) ?? "",
    );
    const group = list(c.group).join("、") || "未分组";
    const starValue = Number(c.customerStars),
      starIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 17.886 17.478 4 19.49l10.059 9.834L11.654 43 24 36.42 36.345 43 33.96 29.325 44 19.491 30.191 17.478Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>',
      stars = `<span class="lcd-stars" aria-label="客户星级 ${E(c.customerStars || "未填写")}">${[1, 2, 3, 4, 5].map((n) => `<span class="lcd-star ${Number.isFinite(starValue) && starValue >= n ? "filled" : ""}">${starIcon}</span>`).join("")}</span>`;
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
            const searchText = [contactName, c.emails?.[i] ?? record.email,
              record.alternateEmail ?? record.alternativeEmail ?? record.backupEmail, social, phones]
              .filter(Boolean).join("\n");
            return `<article class="lcd-contact" data-contact-index="${i}" data-contact-id="${E(i === 0 ? contactId : contactId ? "extra:" + contactId : "")}" data-contact-search="${E(searchText)}"><div class="lcd-contact-title"><strong>${E(displayName)}</strong>${i === 0 ? '<span class="lcd-main-contact">主</span>' : ""}<span class="lcd-contact-actions">${mini("写邮件给联系人", "mail")}<button type="button" class="lcd-feature lcd-icon" data-contact-more="${i}" aria-label="${E(actionName)}的更多操作">${icon("more")}</button></span></div><dl>${label("邮箱", c.emails?.[i] ?? record.email)}${label("社交平台", social)}${label("联系电话", phones)}${label("Alibaba会员 ID", record.alibabaId)}${label("地址", c.addresses?.[i] ?? record.address)}${label("备用邮箱", record.alternateEmail ?? record.alternativeEmail ?? record.backupEmail)}${label("生日", record.birthday)}${label("付款方式", record.contactPaymentMethod || (i > 0 ? record.paymentMethod : ""))}${record.contactTitle ? label("职位", record.contactTitle) : ""}${record.contactGender ? label("性别", record.contactGender) : ""}${label("联系人备注", record.contactNote)}</dl></article>`;
          }).join("")
        : empty("暂无联系人");
    const summaryValues = {
      stage: c.stage, group, customerStars: stars, score: profile.score,
      source: c.source, website: c.website, productType: c.productType,
      level: c.displayLevel ?? c.level, country, companyProducts: profile.companyProducts ?? c.companyProducts,
      lastContact: localDateTime(c.lastContact), nextFollow: date(c.nextFollow),
    };
    const summaryLabels = new Map(summaryFieldOptions.map((field) => [field.id, field.label]));
    const summary = normalizeSummaryFields(state.previewDetailSummaryFields)
      .map((id) => label(`${summaryLabels.get(id)}:`, summaryValues[id], id === "customerStars", id))
      .join("");
    const collapsedCards = new Set(Array.isArray(collapsedDetailCards) ? collapsedDetailCards : []);
    const cardHeading = (id, title, actions = "") => {
      const closed = collapsedCards.has(id);
      const titleMarkup = id === "contacts" ? `<span id="contact-count-label">${E(title)}</span>` : E(title);
      return `<div class="lcd-section-head"><h3><button type="button" class="lcd-card-toggle" data-action="toggle-detail-card" data-card-id="${id}" aria-controls="lcd-card-panel-${id}" aria-expanded="${!closed}"><span class="lcd-caret" aria-hidden="true">${closed ? "›" : "⌄"}</span>${titleMarkup}</button></h3>${actions}</div>`;
    };
    const cardPanel = (id, content) => `<div class="lcd-card-panel" id="lcd-card-panel-${id}" aria-hidden="${collapsedCards.has(id)}"${collapsedCards.has(id) ? " inert" : ""}><div class="lcd-card-panel-inner">${content}</div></div>`;
    const analysis = `<div class="lcd-analysis" data-detail-card="analysis" data-collapsed="${collapsedCards.has("analysis")}">${cardHeading("analysis", "AI 客户分析", feature("查看完整分析", "查看完整分析", "lcd-blue"))}${cardPanel("analysis", `<p class="lcd-analysis-caption">基于沟通情况、跟进动态、国际站行为数据进行分析</p><div class="lcd-ai-report"><div class="lcd-ai-empty"><span class="lcd-ai-spark">✦</span><p>暂无客户分析报告</p>${feature("AI客户分析", "生成客户分析", "lcd-outline-blue")}</div></div>`)}</div>`;
    const contactActions = `<div class="lcd-contact-header-actions"><div class="lcd-contact-search-controls">${miniAction("搜索联系人", "search", "contact-search")}${miniAction("添加联系人", "plus", "add-contact")}${miniAction("联系人更多操作", "more", "contacts-actions")}</div><div class="lcd-contact-search-row" hidden><div class="lcd-contact-search-input"><input id="contact-search-input" type="search" maxlength="200" aria-label="搜索联系人" aria-describedby="contact-search-status" placeholder="搜索昵称/邮箱/电话/社交平台" autocomplete="off"><button type="button" data-action="clear-contact-search" aria-label="清空联系人搜索" hidden><svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="7" fill="currentColor"/><path d="m5 5 4 4m0-4-4 4" stroke="#fff" stroke-width="1.2"/></svg></button></div><button type="button" data-action="apply-contact-search" aria-label="搜索联系人结果">${icon("search")}</button></div></div>`;
    const contactsCard = `<section class="lcd-card lcd-contacts" data-detail-card="contacts" data-collapsed="${collapsedCards.has("contacts")}">${cardHeading("contacts", `联系人(${contacts.length})`, contactActions)}${cardPanel("contacts", `${contactCards()}<span id="contact-search-status" class="lcd-contact-search-feedback" role="status"></span><div id="contact-search-empty" class="lcd-contact-search-empty lcd-contact-search-feedback" hidden>未找到联系人</div>`)}</section>`;
    const identity = profile.laiBucket === "trash" ? "回收站" : profile.laiBucket === "pool" ? "公海客户" : "私海客户";
    const scheduleCard = `<section class="lcd-card lcd-schedule">${heading(`计划日程 （${c.nextFollow ? 1 : 0}）`, '<button type="button" class="lcd-feature" data-action="schedule-edit" aria-label="安排客户跟进日程">添加</button>')}${c.nextFollow ? `<div class="lcd-schedule-entry">${icon("clock")} ${E(date(c.nextFollow))} <span>客户跟进</span><button type="button" class="lcd-feature" data-action="schedule-view" aria-label="在日历查看客户跟进日程">查看</button></div>` : ""}</section>`;
    const left = `<aside class="lcd-left"><section class="lcd-card lcd-summary"><div class="lcd-identity"><div class="lcd-person"><svg viewBox="0 0 40 35" aria-hidden="true"><circle cx="20" cy="11" r="8" fill="var(--brand-500)"/><path d="M6 33c0-16 28-16 28 0" fill="var(--brand-500)"/></svg><span>${identity}</span></div><div class="lcd-identity-text"><h2>${E(c.name)} ${mini("客户身份", "help")}</h2><div>编号：${E(c.customerCode || "—")} <span>${E(country || "—")}</span> <span>${E(profile.timezone || "")}</span></div></div><button class="lcd-follow ${c.followed ? "on" : ""}" data-follow="${E(c.name)}" aria-label="${c.followed ? "取消关注" : "关注"}客户">♡</button></div><div class="lcd-tags">标签：${list(
      c.tags,
    )
      .map((tag, i) => `<span class="lcd-tag tag-${i % 3}">${E(tag)}</span>`)
      .join(
        "",
      )}${miniAction("设置客户标签", "plus", "customer-tags", "lcd-add-tag")}</div><div class="lcd-owner">跟进人：<span>${E(c.owner || "—")}</span></div><div class="lcd-summary-fields"><dl>${summary}</dl>${miniAction("客户摘要字段设置", "settings", "summary-fields")}</div>${analysis}</section>${scheduleCard}${contactsCard}</aside>`;
    const phases = ["未成单", "付款未到账", "待付尾款.", "已完成", "输单"];
    const phaseIds = ["open", "unpaid", "balance", "done", "lost"];
    const hasActiveOpportunity = Number.isFinite(Number(c.activeOpportunityCount)) && Number(c.activeOpportunityCount) > 0;
    // 当前显示的那一个进行中商机（由页面决定是第几个）；没有传入时保持原来的占位显示。
    const activeOpportunity = hasActiveOpportunity && Array.isArray(c.activeOpportunities) ? c.activeOpportunities[Math.min(Math.max(0, Number(c.activeOpportunityIndex) || 0), c.activeOpportunities.length - 1)] : null;
    const opportunityDetails = hasActiveOpportunity
      ? `<div class="lcd-opportunity-row"><div>${mini("上一个商机", "back")}<span>${activeOpportunity ? E(activeOpportunity.name) : "—"}</span>${mini("下一个商机", "next")}</div><div>销售金额 <b>${activeOpportunity ? `${E(activeOpportunity.currency)} ${numeric(activeOpportunity.amount, true)}` : "—"}</b></div><div>结束日期 <b>${activeOpportunity ? E(activeOpportunity.endDate || "—") : "—"}</b></div><div>备注 <b>${activeOpportunity?.note ? E(activeOpportunity.note) : "—"}</b></div>${mini("商机更多操作", "more")}</div><div class="lcd-phases">${(Array.isArray(activeOpportunity?.stages) ? activeOpportunity.stages : phases.map((phase, i) => ({ id: phaseIds[i], label: phase }))).map((phase, i) => feature(`商机阶段：${phase.label}`, E(phase.label), `lcd-phase phase-${i}${activeOpportunity && phase.id === activeOpportunity.stage ? " is-current" : ""}`)).join("")}</div>`
      : "";
    const opportunity = `<section class="lcd-card lcd-opportunity${hasActiveOpportunity ? "" : " is-empty"}">${heading(`进行中的商机 （${numeric(c.activeOpportunityCount)}）`, feature("添加商机", "添加"))}${opportunityDetails}</section>`;
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
        timeField("最近成交日期", profile.lastDealDate),
        timeField("最近发件时间", profile.lastEmailSent),
        timeField("最近收件时间", profile.lastEmailReceived),
        timeField("最近发EDM时间", profile.lastEdmSent),
        timeField("最近收到阿里TM消息时间", profile.lastAlibabaMessageReceived),
        timeField("最近发送阿里TM消息时间", profile.lastAlibabaMessageSent),
        timeField("最近收到阿里TM询盘时间", profile.lastAlibabaInquiryReceived),
        timeField("最近WhatsApp沟通时间", profile.lastWhatsAppContact),
        timeField("最近企业微信沟通时间", profile.lastWeComContact),
        timeField("最近Instagram Messenger沟通时间", profile.lastInstagramContact),
        timeField("Tips最近更新时间", profile.tipsUpdatedAt),
        timeField("最近「写跟进」时间", profile.lastWrittenFollowup),
        timeField("下次跟进时间", c.nextFollow), ["跟进人", c.owner],
      ];
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
      ];
      const hasTradePreferences = Boolean(profile.paymentMethod || profile.paymentEmail || profile.repurchaseCycle || profile.currency && profile.currency !== "USD");
      // The captured detail view has a fixed 9+4 layout. The display drawer
      // configures the editor; tags already live in the identity card above.
      const companyCommon = `${label("公司网址", c.website)}${label("公司名称", c.name)}${label("国家地区", country)}${label("客户来源", c.source)}${label("主营产品.", c.productType)}${label("客户分组", group)}${label("客户阶段", c.stage)}${c.customerType ? label("客户类型", c.customerType) : ""}${label("客户星级", stars, true)}${label("客户编号", c.customerCode)}`;
      const companyOther = `${label("时区", profile.timezone)}${label("主营产品", profile.companyProducts ?? profile.mainProducts ?? profile["主营产品"])}${label("卡纸", profile.cardStock ?? profile.cardPaper ?? profile["卡纸"])}${label("定制盒", profile.customBox ?? profile["定制盒"])}${[["公司简称",profile.shortName],["座机",profile.landline],["详细地址",profile.companyAddress],["公司备注",profile.companyRemark],["公海分组",profile.poolGroup]].filter(([,value]) => value).map(([name,value]) => label(name,value)).join("")}`;
      return `${section("company-common", "公司常用信息", companyCommon, miniAction("公司常用信息设置", "settings", "company-display-settings"))}<div class="lcd-rule"></div>${section("company-other", "公司其他信息", companyOther)}<div class="lcd-rule"></div>${section("followup", "跟进信息", fields(followupFields))}<div class="lcd-rule"></div>${section("system", "系统信息", fields(systemFields))}${profile.note || profile.permanentNote ? `<div class="lcd-rule"></div>${section("notes", "客户备注", `${label("客户备注", profile.note)}${label("客户永久备注", profile.permanentNote)}`)}` : ""}${hasTradePreferences ? `<div class="lcd-rule"></div>${section("trade-preferences", "交易偏好", `${label("默认币种", profile.currency || "USD")}${label("客户付款方式", profile.paymentMethod)}${label("付款邮箱", profile.paymentEmail)}${label("复购周期", profile.repurchaseCycle ? `${profile.repurchaseCycle} 天` : "")}`)}` : ""}`;
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
      const searchButton = `<button type="button" class="lcd-feature lcd-icon" data-action="activity-search" aria-label="搜索动态" aria-controls="activity-search-row" aria-expanded="${activitySearchOpen}">${icon("search")}</button>`;
      const searchRow = `<div id="activity-search-row" class="lcd-activity-search-row" role="search" ${activitySearchOpen ? "" : "hidden"}><div class="lcd-activity-search-field"><input id="activity-search-input" type="text" maxlength="200" aria-label="搜索当前客户动态" aria-describedby="activity-search-status" placeholder="搜索跟进记录/往来邮件/动态评论" value="${E(activitySearchDraft)}" autocomplete="off"><button type="button" data-action="clear-activity-search" aria-label="清空动态搜索" ${activitySearchDraft ? "" : "hidden"}><svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="7" fill="currentColor"/><path d="m5 5 4 4m0-4-4 4" stroke="#fff" stroke-width="1.2"/></svg></button></div><button type="button" data-action="apply-activity-search" aria-label="提交动态搜索">${icon("search")}</button><span id="activity-search-status" role="status">${query ? `找到 ${shown.length} 条动态` : ""}</span></div>`;
      const refreshButton = `<button type="button" class="lcd-feature lcd-icon lcd-activity-refresh" data-action="refresh-activity" aria-label="刷新动态" aria-controls="activity-results">${icon("clock")}</button>`;
      const sortButton = `<button type="button" class="lcd-feature lcd-icon" data-action="activity-sort" aria-label="动态排序" aria-haspopup="true" aria-expanded="false" aria-controls="activity-sort-menu">${icon("sort")}</button>`;
      const queryHint = query ? `<p class="lcd-activity-query-hint">如没有符合条件的搜索结果，可尝试输入更完整的关键字</p>` : "";
      const hasAdvanced = Boolean(activityAdvanced.startDate || activityAdvanced.endDate || activityAdvanced.contact || activityAdvanced.owner || selectedTypes.size);
      const advancedButton = `<button type="button" class="lcd-feature lcd-icon ${hasAdvanced ? "lcd-filter-active" : ""}" data-action="activity-advanced-filter" aria-label="筛选动态" aria-haspopup="true" aria-expanded="false" aria-controls="activity-advanced-menu">${icon("filter")}</button>`;
      const activityTools = `<div class="lcd-activity-tools"><div class="lcd-activity-tools-buttons" ${activitySearchOpen ? "hidden" : ""}><span id="activity-refresh-status" class="lcd-activity-refresh-status" role="status" aria-live="polite"></span>${refreshButton}${searchButton}${advancedButton}${sortButton}</div>${searchRow}</div>`;
      return `<div class="lcd-followup-label"><button type="button" data-action="write-followup"><strong>写跟进</strong></button><div>${feature("AI写跟进", "AI写跟进", "lcd-ai-text")}${feature("选择跟进模板", `${icon("note")} 选择模板`)}</div></div><form id="followup-form" class="lcd-followup-form ${followupDraft?.text ? "has-draft" : ""}"><textarea id="followup-text" name="text" required aria-label="跟进内容" placeholder="点击这里记录跟进细节，同步最新进展。">${E(followupDraft?.text || "")}</textarea><div class="error" id="followup-error" role="alert"></div><div class="lcd-followup-footer"><label>下次跟进 <input type="date" name="nextFollow" value="${E(String(followupDraft?.nextFollow ?? c.nextFollow ?? "").slice(0, 10))}"></label><div><button type="button" data-action="cancel-followup">取消草稿</button><button type="submit" class="lcd-primary">保存跟进</button></div></div></form><div class="lcd-journey"><div class="lcd-button-group"><button class="selected" data-tab="activity">历史动态</button>${feature("AI聊天旅程")}${feature("AI谈单卡点", "AI 谈单卡点 (—)")}</div>${activityTools}</div><div class="lcd-activity-filters" aria-label="动态类别"><button type="button" class="lcd-activity-arrow" data-activity-scroll="left" aria-label="向左查看动态类别" hidden><svg class="lcd-activity-arrow-glyph" viewBox="64 64 896 896" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M724 218.3V141c0-6.7-7.7-10.4-12.9-6.3L260.3 486.8a31.86 31.86 0 000 50.3l450.8 352.1c5.3 4.1 12.9.4 12.9-6.3v-77.3c0-4.9-2.3-9.6-6.1-12.6l-360-281 360-281.1c3.8-3 6.1-7.7 6.1-12.6z"/></svg></button><div class="lcd-activity-clip"><div class="lcd-activity-list">${filterButton("all", "全部")}${filterButton("followup", "跟进记录")}${filterButton("email", "往来邮件")}${filterButton("chat", "聊天记录")}${filterButton("other", "其它")}</div></div><button type="button" class="lcd-activity-arrow" data-activity-scroll="right" aria-label="向右查看动态类别" hidden><svg class="lcd-activity-arrow-glyph" viewBox="64 64 896 896" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M765.7 486.8L314.9 134.7A7.97 7.97 0 00302 141v77.3c0 4.9 2.3 9.6 6.1 12.6l360 281.1-360 281.1c-3.9 3-6.1 7.7-6.1 12.6V883c0 6.7 7.7 10.4 12.9 6.3l450.8-352.1a31.96 31.96 0 000-50.4z"/></svg></button></div><div id="activity-results">${mailPanel}${queryHint}${shown.length ? (activityFilter === "followup" || query ? timeline(ordered, true) : groupMarkup) : query ? empty("暂无数据") : `${heading("最近 (0)")}${empty(hasAdvanced ? "未找到动态" : "暂无动态记录")}`}</div>`;
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
        ["已生效回款单数", "—"],
        ["已生效回款金额", "—"],
      ];
      return `${heading("商机", `<div class="lcd-heading-inline">${feature("全部商机", `全部 (${Number.isFinite(c.opportunityAllCount) ? c.opportunityAllCount : "—"}) ›`)}${mini("新建商机", "plus")}</div>`)}<div class="lcd-metrics">${metrics.map(([name, content]) => `<div><span>${E(name)}</span><strong>${content}</strong></div>`).join("")}</div><div class="lcd-table-scroll"><table class="lcd-table"><thead><tr>${["商机编号", "商机名称", "当前阶段", "销售金额", "结束日期", "已生效回款金额", "未回款金额", "操作"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody><tr><td colspan="8" class="lcd-no-data">暂无商机数据</td></tr></tbody></table></div><div class="lcd-pagination">共 0 条　 ‹　 1　 ›</div>${heading("产品", feature("产品筛选", "成交的产品　⌄"))}<table class="lcd-table"><thead><tr>${["产品", "销售订单", "报价单", "商机", "操作"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody><tr><td colspan="5" class="lcd-no-data">暂无关联产品数据</td></tr></tbody></table><div class="lcd-rule"></div>${heading(`销售订单 (${list(c.orders).length})`, `<button type="button" class="lcd-feature" data-new-customer-order="${E(c.name)}" aria-label="新建销售订单">＋ 新建</button>`)}<div class="lcd-table-scroll"><table class="lcd-table"><thead><tr><th>订单编号</th><th>订单日期</th><th>订单金额</th><th>当前阶段</th><th>产品类型</th></tr></thead><tbody>${
        list(c.orders)
          .map(
            (order) =>
              `<tr><td><button class="lcd-blue" data-lai-order="${E(order.id)}">${E(order.num || order.id)}</button></td><td>${E(date(order.createdAt))}</td><td>${E(order.currency || "USD")} ${E(money(Number(order.amount)))}</td><td>${E({ quote: "报价", deposit: "定金", production: "生产中", balance: "尾款", shipment: "已发货", done: "已完成" }[order.stage] || order.stage || "—")}</td><td>${value(order.productType)}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="5" class="lcd-no-data">暂无销售订单</td></tr>'
      }</tbody></table></div>`;
    }
    function documents() {
      const normalizeName = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
      const attachmentName = (file) => file.name || file.fileName || file.type || "未命名";
      const query = normalizeName(documentQuery.trim());
      const attachments = list(state.orders)
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
        return `<tr data-document-row="${E(key)}"><td><input type="checkbox" data-document-select="${E(key)}" aria-label="选择文档 ${E(name)}" ${selected.has(key) ? "checked" : ""}></td><td>${feature("预览文档", E(name), "lcd-blue")}</td><td>—</td><td>销售订单 ${E(order.num || "")}</td><td>—</td><td>${mini("文档操作", "more")}</td></tr>`;
      }).join("");
      return `<div class="lcd-doc-toolbar"><div class="lcd-doc-search" role="search"><input id="document-search-input" type="search" aria-label="搜索文件名称" placeholder="搜索文件名称" value="${E(documentQuery)}" autocomplete="off"><button type="button" class="lcd-feature lcd-icon" data-action="document-search" aria-label="搜索客户文档">${icon("search")}</button></div><div>${mini("筛选文档", "filter")}${mini("添加文档", "plus")}${mini("文档更多操作", "more")}</div></div><div class="lcd-doc-layout"><aside>${feature("全部文档", "全部文档", "selected")}</aside><section><div id="document-results" role="status" aria-live="polite"><div class="lcd-doc-grid"><table class="lcd-table"><thead><tr><th><input type="checkbox" data-document-select-all aria-label="选择当前页全部文档" ${allVisibleSelected ? "checked" : ""} ${visible.length ? "" : "disabled"}></th><th>文件名称</th><th>父级文件夹</th><th>关联类型</th><th>上传方式</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>${attachments.length ? "" : empty(query ? "未找到文档" : "暂无数据")}</div><div class="lcd-pagination">${selectedCount ? `<span class="lcd-doc-selected">已选 ${selectedCount} 条 <button type="button" data-action="document-clear-selection">取消选择</button></span>` : ""}<span>共 ${attachments.length} 条</span><button type="button" data-action="document-prev" aria-label="上一页" ${page === 1 ? "disabled" : ""}>‹</button><span aria-label="第 ${page} 页，共 ${pages} 页">${page}</span><button type="button" data-action="document-next" aria-label="下一页" ${page === pages ? "disabled" : ""}>›</button><button type="button" data-action="document-page-size" aria-label="文档每页条数" aria-haspopup="menu" aria-expanded="false">${size} 条/页 ⌄</button></div></div></section></div>`;
    }
    // 右侧摘要栏（新界面的三栏版式，设计稿 CustomerDetail）：资料、销售订单、文档、操作历史各一张小卡；
    // 小满主题下 CSS 隐藏它，页面还是原来的两栏。里面的按钮沿用已有的 data-tab / data-new-customer-order / data-lai-order 处理。
    const sideCard = (title, actions, inner, extra = "") =>
      `<section class="lcd-card lcd-side-card${extra}"><div class="lcd-side-head"><h3>${E(title)}</h3>${actions}</div>${inner}</section>`;
    const sideLink = (tabId, text = "查看全部") => `<button type="button" class="lcd-side-link" data-tab="${tabId}">${text} ›</button>`;
    const stageNames = { quote: "报价", deposit: "定金", production: "生产中", balance: "尾款", shipment: "已发货", done: "已完成" };
    const sideInfo = [["客户阶段", summaryValues.stage], ["客户分组", summaryValues.group], ["客户来源", summaryValues.source], ["公司网址", summaryValues.website], ["主营产品", summaryValues.companyProducts]]
      .map(([name, content]) => `<div class="lcd-side-row"><span>${E(name)}</span><b>${value(content)}</b></div>`).join("");
    const sideOrders = list(c.orders).slice(0, 4).map((order) =>
      `<div class="lcd-side-order"><div><button type="button" class="lcd-blue" data-lai-order="${E(order.id)}">${E(order.num || order.id)}</button><b>${E(order.currency || "USD")} ${E(money(Number(order.amount)))}</b></div><span>${E(date(order.createdAt))} · ${E(stageNames[order.stage] || order.stage || "—")} · ${E(order.productType || "—")}</span></div>`).join("")
      || '<p class="lcd-side-empty">暂无销售订单</p>';
    const sideDocs = list(state.orders).flatMap((order) => order.client === c.name ? list(order.attachments).map((file) => ({ file, order })) : []).slice(0, 4)
      .map(({ file, order }) => `<div class="lcd-side-doc"><span>${E(file.name || file.fileName || file.type || "未命名")}</span><small>销售订单 ${E(order.num || "")}</small></div>`).join("")
      || '<p class="lcd-side-empty">暂无文档</p>';
    const sideHistory = operationHistory.slice(0, 3)
      .map((item) => `<div class="lcd-side-hist"><span>${E(item.text || item.content || item.note || "—")}</span><small>${E(localDateTime(item.time || item.date) || "—")}</small></div>`).join("")
      || '<p class="lcd-side-empty">暂无操作记录</p>';
    const sideColumn = !withSideColumn ? "" : `<aside class="lcd-side" aria-label="客户摘要">`
      + sideCard("资料", '<button type="button" class="lcd-side-link" data-action="edit">编辑</button>', `<div class="lcd-side-rows">${sideInfo}</div>${sideLink("info", "查看全部资料")}`)
      + sideCard(`销售订单 （${list(c.orders).length}）`, `<button type="button" class="lcd-side-link" data-new-customer-order="${E(c.name)}" aria-label="新建销售订单">＋ 新建</button>`, sideOrders + (list(c.orders).length > 4 ? sideLink("trade") : ""))
      + sideCard("文档", "", sideDocs + sideLink("documents"))
      + sideCard("操作历史", "", sideHistory + sideLink("history"))
      + `</aside>`;
    const tabs = [
      ["activity", "动态"],
      ["info", "资料"],
      ["trade", "商机&交易"],
      ["tips", "Tips"],
      ["ai", "AI 背调"],
      ["analytics", "数据分析"],
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
                : `<div class="lcd-feature-view">${heading(tabs.find((item) => item[0] === tab)?.[1] || "详情")}${empty("暂无数据")}${feature(tabs.find((item) => item[0] === tab)?.[1] || "详情", "查看功能", "lcd-outline-blue")}</div>`;
    return `<div class="lcd-root"><header class="lcd-pagebar"><h1>客户详情</h1><div>${feature("合并客户", "合并客户", "lcd-pill")}<button class="lcd-pill" data-action="edit">编辑</button>${feature("写邮件", "写邮件", "lcd-pill lcd-primary")}${miniAction("客户更多操作", "more", "customer-actions")}<button class="lcd-icon lcd-return" data-action="list" aria-label="返回客户列表" title="返回客户列表">${icon("back")}</button></div></header><div class="lcd-columns"${state.laiSettings?.customerSettings?.layout === "left-large" ? ' data-layout="left-large"' : ""}>${left}<div class="lcd-right">${opportunity}<section class="lcd-card lcd-tabs-card"><nav class="lcd-tabs" aria-label="客户详情页签">${tabs.map(([id, title]) => `<button type="button" data-tab="${id}" class="${id === tab ? "active" : ""}" aria-selected="${id === tab}">${E(title)}</button>`).join("")}<span class="lcd-active-indicator" aria-hidden="true"></span></nav><button type="button" class="lcd-tabs-more" data-action="detail-tabs-more" aria-label="更多详情页签" aria-haspopup="menu" aria-expanded="false" aria-controls="lcd-tabs-overflow-menu" hidden><svg viewBox="64 64 896 896" width="14" height="14" fill="currentColor" aria-hidden="true" focusable="false"><path d="M176 511a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0z"/></svg></button><div id="lcd-tabs-overflow-menu" class="lcd-tabs-overflow-menu" role="menu" aria-label="更多详情页签" hidden>${tabs.map(([id, title]) => `<button type="button" role="menuitem" data-overflow-tab="${id}" hidden>${E(title)}</button>`).join("")}</div><div class="lcd-body lcd-body-${E(tab)}">${body}</div></section><p class="lcd-ai-disclosure">AI 相关内容入口已保留，分析结果以实际生成内容为准</p></div>${sideColumn}</div></div>`;
  }
  const api = { render, summaryFieldOptions, defaultSummaryFields, normalizeSummaryFields };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerDetail = api;
})(typeof window !== "undefined" ? window : globalThis);
