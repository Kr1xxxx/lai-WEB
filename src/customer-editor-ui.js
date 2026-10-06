(function (root) {
  "use strict";
  const M = root.PreviewModel || (typeof require === "function" ? require("./model.js") : null);
  const F = root.LaiCustomerFields || (typeof require === "function" ? require("./customer-fields.js") : null);
  const initialDateValues = new WeakMap();
  function dateInputType(value) {
    const text = String(value ?? "");
    if (!text) return "date";
    const parsed = new Date(text + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number(text.slice(0, 4)) > 0 &&
      Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
      ? "date" : "text";
  }
  function isUnchangedDate(control) {
    return initialDateValues.has(control) && initialDateValues.get(control) === control.value;
  }
  const defaultEscape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const glyph = (name, extra = "") => {
    const paths = {
      down: '<path d="m4 6 4 4 4-4"/>',
      up: '<path d="m4 10 4-4 4 4"/>',
      plus: '<circle cx="8" cy="8" r="6.7"/><path d="M8 5.3v5.4M5.3 8h5.4"/>',
      minus: '<circle cx="8" cy="8" r="6.7"/><path d="M5.3 8h5.4"/>',
      edit: '<path d="m3 10 7-7 3 3-7 7-4 1zM9 4l3 3M2 15h12"/>',
      settings:
        '<path d="m6 2 .5-1h3L10 2l1.5.8 1.1-.1 1.5 2.6-.6.9V8l.6.9-1.5 2.6-1.1-.1-1.5.8-.5 1h-3L6 12.2l-1.5-.8-1.1.1-1.5-2.6.6-.9V6.2l-.6-.9 1.5-2.6 1.1.1z"/><circle cx="8" cy="7" r="2.3"/>',
      star: '<path d="m8 1.2 2.1 4.3 4.8.7-3.5 3.4.8 4.8L8 12.1l-4.2 2.3.8-4.8L1.1 6.2l4.8-.7z"/>',
    };
    return `<svg class="ce-icon ${extra}" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.down}</svg>`;
  };
  const values = (list, current) => [
    ...new Set(
      [...(Array.isArray(list) ? list : []), current].filter(
        (value) => typeof value === "string" && value.trim(),
      ),
    ),
  ];

  function render(
    c = {},
    { isNew = false, escape: E = defaultEscape, opt, state = {} } = {},
  ) {
    const option =
      opt ||
      ((value, label, selected) =>
        `<option value="${E(value)}"${String(value) === String(selected) ? " selected" : ""}>${E(label)}</option>`);
    const profiles = Object.values(state.customers || {});
    const list = (key) =>
      profiles
        .map((profile) => profile?.[key])
        .filter((value) => typeof value === "string");
    const input = (
      name,
      value = "",
      placeholder = "请输入",
      { required = false, type = "text", attrs = "" } = {},
    ) =>
      `<input id="ce-${name}" name="${name}" type="${type === "date" ? dateInputType(value) : type}" value="${E(value)}" placeholder="${E(placeholder)}"${required ? " required" : ""}${type === "date" ? " data-editor-date" : ""}${attrs ? " " + attrs : ""}>`;
    const field = (name, label, content, { star = false, extra = "" } = {}) =>
      `<div class="ce-field ${extra}"><label for="ce-${name}">${star ? '<span class="ce-required" aria-hidden="true">*</span>' : ""}${label}</label>${content}</div>`;
    const select = (name, value, placeholder, options = []) =>
      `<div class="ce-select"><select id="ce-${name}" name="${name}"${name === "productType" ? ' data-searchable="anchor"' : ""}>${option("", placeholder, value)}${values(
        options,
        value,
      )
        .map((valueOption) => option(valueOption, valueOption, value))
        .join("")}</select>${glyph("down")}</div>`;
    const combo = (name, value, placeholder, options = [], required = false) =>
      `<div class="ce-select ce-combo">${input(name, value, placeholder, { required, attrs: `list="ce-options-${name}" autocomplete="off"` })}${glyph("down")}<datalist id="ce-options-${name}">${values(
        options,
        value,
      )
        .map((valueOption) => `<option value="${E(valueOption)}"></option>`)
        .join("")}</datalist></div>`;
    const textarea = (name, value, placeholder = "请输入") =>
      `<textarea id="ce-${name}" name="${name}" rows="3" placeholder="${E(placeholder)}">${E(value || "")}</textarea>`;
    const countryOptions = values(list("country"), c.country);
    const ownerOptions = values(
      [
        ...(Array.isArray(state.owners) ? state.owners : []),
        ...list("owner"),
      ].filter((value) => typeof value === "string"),
      c.owner,
    );
    const originalStage = c.customerStage || (!isNew ? c.stage : "") || "";
    const stageOptions = values(
      [
        ...list("customerStage"),
        "未成单",
        "付款未到账",
        "待付尾款.",
        "已完成",
        "输单",
      ],
      originalStage,
    );
    const manualGroups = (
      Array.isArray(state.previewSegments) ? state.previewSegments : []
    )
      .filter((group) => !group.archived && group.kind === "manual");
    const groupName = (typeof c.previewGroup === "string" && c.previewGroup.trim() ? c.previewGroup : "") ||
      manualGroups.find((group) => (group.members || []).includes(c.name))?.name ||
      (typeof c.group === "string" ? c.group : "");
    const groups = manualGroups.map((group) => group.name);
    const rating = Math.min(5, Math.max(0, Number(c.customerStars) || 0));
    const extrasCount = Math.max(
      (Array.isArray(c.extraContacts) ? c.extraContacts.length : 0),
      (c.contacts || []).length - 1,
      (c.emails || []).length - 1,
      (c.phones || []).length - 1,
      (c.addresses || []).length - 1,
    );
    // Array-only legacy cards share the same identity allocation as structured contacts.
    const extraContacts = M.contactRecordsWithIds(
      Array.from({ length: extrasCount }, (_, index) => c.extraContacts?.[index] || {}),
      "legacy-", 1,
    );
    const primary = {
      ...c,
      contact: c.contact || c.contacts?.[0] || "",
      email: c.email || c.emails?.[0] || "",
      phone: c.phone || c.phones?.[0] || "",
    };
    const methodRow = (kind, record = {}, index = 0) => {
      const social = kind === "social";
      const key = social ? "socialPlatform" : "phoneCountryCode";
      const valueKey = social ? "socialAccount" : "phone";
      const choices = social
        ? ["Instagram", "Facebook", "Twitter", "LinkedIn", "TikTok", "其他"]
        : ["+1", "+44", "+33", "+49", "+61", "+86"];
      const label = social ? "社交平台" : "联系电话";
      return `<div class="ce-paired ce-method-row" data-method-row="${kind}" data-method-id="${E(record.id || "")}"><div class="ce-select"><select data-method-select aria-label="附加${social ? "社交平台" : "电话区号"} ${index + 2}">${option("", social ? "社交平台" : "电话区号", record[key])}${values(choices, record[key]).map((choice) => option(choice, choice, record[key])).join("")}</select>${glyph("down")}</div><input data-method-value type="${social ? "text" : "tel"}" value="${E(record[valueKey] || "")}" placeholder="${social ? "请输入账号" : "请输入电话"}" aria-label="附加${label} ${index + 2}"><button class="ce-method-remove" type="button" data-editor-action="remove-method" aria-label="移除附加${label} ${index + 2}">${glyph("minus")}</button></div>`;
    };
    const methodList = (kind, records) =>
      `<div class="ce-method-list" data-method-list="${kind}">${M.contactRecordsWithIds(records, "method-").map((record, index) => methodRow(kind, record, index)).join("")}</div>`;

    function contactCard(index, record, newContact = false) {
      record = { ...record, alternateEmail: record.alternateEmail ?? record.alternativeEmail ?? record.backupEmail ?? "" };
      const extra = index > 0;
      const name = (key) => (extra ? `${key}Extra` : key);
      const id = (key) => `${name(key)}-${index}`;
      const contactInput = (key, placeholder = "请输入", type = "text") =>
        `<input id="ce-${id(key)}" name="${name(key)}" type="${type === "date" ? dateInputType(record[key]) : type}" value="${E(type === "date" ? record[key] ?? "" : record[key] || "")}" placeholder="${E(placeholder)}"${type === "date" ? " data-editor-date" : ""}${(isNew || newContact) && ["contact", "email", "phone"].includes(key) ? " required" : ""}>`;
      const contactField = (key, label, body, star = false) =>
        `<div class="ce-field"><label for="ce-${id(key)}">${star ? '<span class="ce-required" aria-hidden="true">*</span>' : ""}${label}</label>${body}</div>`;
      const contactSelect = (key, placeholder, options) =>
        `<div class="ce-select"><select id="ce-${id(key)}" name="${name(key)}">${option("", placeholder, record[key])}${values(
          options,
          record[key],
        )
          .map((value) => option(value, value, record[key]))
          .join("")}</select>${glyph("down")}</div>`;
      return `<section class="ce-contact-card" data-contact-card="${index}">${extra ? `<input type="hidden" name="contactIdExtra" value="${E(record.id || "legacy-" + index)}">` : ""}<div class="ce-contact-heading"><strong>联系人<span data-contact-number>${index + 1}</span></strong>${extra ? `<button type="button" class="ce-contact-remove" data-editor-action="remove-contact" aria-label="移除联系人${index + 1}">移除</button>` : '<span class="ce-main-tag">主</span><span class="ce-main-hint">主联系人默认置顶</span>'}</div>
        ${contactField("contact", "昵称", contactInput("contact", "客户姓名"), true)}
        ${contactField("email", "邮箱", contactInput("email", "必填"), true)}
        ${contactField("socialAccount", "社交平台", `<div class="ce-paired">${contactSelect("socialPlatform", "社交平台", ["Instagram", "Facebook", "Twitter", "LinkedIn", "TikTok", "其他"])}${contactInput("socialAccount", "默认Instagram，没有…")}<button class="ce-plus" type="button" data-editor-action="add-method" data-method-type="social" aria-label="添加社交平台">${glyph("plus")}</button></div>${methodList("social", record.additionalSocialAccounts)}`)}
        ${contactField("primaryContactMethod", "主要联系方式", contactSelect("primaryContactMethod", "请选择", ["WhatsApp", "邮件", "阿里巴巴", "iMessage"]))}
        ${contactField("phone", "联系电话", `<div class="ce-paired">${contactSelect("phoneCountryCode", "电话区号", ["+1", "+44", "+33", "+49", "+61", "+86"])}${contactInput("phone", "WhatsApp")}<button class="ce-plus" type="button" data-editor-action="add-method" data-method-type="phone" aria-label="添加联系电话">${glyph("plus")}</button></div>${methodList("phone", record.additionalPhones)}`, true)}
        <details class="ce-extra ce-contact-extra"><summary><span>展开全部 (选填)</span>${glyph("down")}</summary><div class="ce-extra-content">
          ${contactField("alibabaId", "Alibaba会员ID", contactInput("alibabaId", "阿里客户从线索中创建"))}
          ${contactField("address", "地址", `<textarea id="ce-${id("address")}" name="${name("address")}" rows="3" placeholder="请输入">${E(record.address || "")}</textarea>`)}
          ${contactField("alternateEmail", "备用邮箱", contactInput("alternateEmail"))}
          ${contactField("birthday", "生日", contactInput("birthday", "请选择", "date"))}
          ${contactField("contactPaymentMethod", "付款方式", contactSelect("contactPaymentMethod", "请选择", [...(Array.isArray(state.paymentMethods) ? state.paymentMethods : []).filter((value) => typeof value === "string"), "PayPal", "银行转账"]))}
          ${contactField("contactNote", "联系人备注", `<textarea id="ce-${id("contactNote")}" name="${name("contactNote")}" rows="3" placeholder="请输入">${E(record.contactNote || "")}</textarea>`)}
          ${record.contactTitle ? contactField("contactTitle", "职位", contactInput("contactTitle")) : ""}
          ${record.contactGender ? contactField("contactGender", "性别", contactInput("contactGender")) : ""}
          <button class="ce-collapse" type="button" data-editor-action="collapse">收起 ${glyph("up")}</button>
        </div></details></section>`;
    }

    const contacts = [contactCard(0, primary)];
    for (let index = 1; index <= extrasCount; index++)
      contacts.push(
        contactCard(index, {
          ...(extraContacts[index - 1] || {}),
          contactPaymentMethod: extraContacts[index - 1]?.contactPaymentMethod ?? extraContacts[index - 1]?.paymentMethod ?? "",
          contact:
            extraContacts[index - 1]?.contact ?? c.contacts?.[index] ?? "",
          email: extraContacts[index - 1]?.email ?? c.emails?.[index] ?? "",
          phone: extraContacts[index - 1]?.phone ?? c.phones?.[index] ?? "",
          address: extraContacts[index - 1]?.address ?? c.addresses?.[index] ?? "",
        }),
      );
    const companyFields = {
      website: field("website", "公司网址", `${input("website", c.website)}<div class="ce-helper">可通过输入的公司网址/名称自动匹配客户信息 <button type="button" data-feature="公司信息自动匹配" aria-label="公司信息自动匹配">${glyph("plus")}</button></div>`, { extra: "ce-website" }),
      name: field("name", "公司名称", input("name", c.name, "客户品牌名", { required: true }), { star: true }),
      country: field("country", "国家地区", combo("country", c.country, "可以搜索", countryOptions, isNew), { star: true }),
      source: field("source", "客户来源", combo("source", c.source, "请选择", list("source"), isNew), { star: true }),
      productType: field("productType", "主营产品.", select("productType", c.productType, "请选择", list("productType"))),
      tags: field("tags", "客户标签", input("tags", Array.isArray(c.tags) ? c.tags.join("，") : c.tags, "选填")),
      previewGroup: field("previewGroup", "客户分组", select("previewGroup", groupName, "默认未分组", groups)),
      customerStage: field("customerStage", "客户阶段", select("customerStage", originalStage, "选填", stageOptions)),
      customerStars: `<div class="ce-field ce-rating-field"><span class="ce-label">客户星级</span><div class="ce-rating" role="radiogroup" aria-label="客户星级" data-rating="${rating}"><input type="hidden" name="customerStars" value="0">${[1, 2, 3, 4, 5].map((star) => `<label class="${star <= rating ? "is-active" : ""}"><input type="radio" name="customerStars" value="${star}" aria-label="${star}星"${rating === star ? " checked" : ""}>${glyph("star")}</label>`).join("")}</div></div>`,
      customerCode: `<div class="ce-field ce-number-field"><span class="ce-label">客户编号</span><div class="ce-customer-number"><span data-customer-code-display>${E(c.customerCode || "*****")}</span><button type="button" class="ce-number-edit" data-editor-action="edit-customer-code" aria-label="编辑客户编号">${glyph("edit")}</button><input id="ce-customerCode" class="ce-number-input" name="customerCode" type="text" value="${E(c.customerCode || "")}" aria-label="客户编号" hidden></div></div>`,
      timezone: field("timezone", "时区", select("timezone", c.timezone, "不用填写", list("timezone"))),
      defaultPaymentPlan: field("defaultPaymentPlan", "默认付款计划", input("defaultPaymentPlan", c.defaultPaymentPlan, "请选择")),
      customerAccountPeriod: field("customerAccountPeriod", "客户账期", input("customerAccountPeriod", c.customerAccountPeriod, "请选择")),
      companyProducts: field("companyProducts", "主营产品", select("companyProducts", c.companyProducts ?? c.mainProducts ?? c["主营产品"], "请选择", list("companyProducts"))),
      cardStock: field("cardStock", "卡纸", select("cardStock", c.cardStock ?? c.cardPaper ?? c["卡纸"], "请选择", list("cardStock"))),
      customBox: field("customBox", "定制盒", select("customBox", c.customBox ?? c["定制盒"], "请选择", list("customBox"))),
    };
    const layout = F.normalizeCompanyDisplayLayout(state.previewCompanyDisplayLayout);
    const fieldGroup = (ids) => ids.map((id) => `<div data-company-field="${id}">${companyFields[id]}</div>`).join("");
    const company = `<section class="ce-company"><div class="ce-section-heading"><h3>公司常用信息</h3><button type="button" data-action="company-display-settings" class="ce-display-settings">${glyph("settings")}显示设置</button></div>
      <div data-company-common>${fieldGroup(layout.common)}</div>
      <details class="ce-extra ce-company-extra"><summary><span>展开全部 (选填)</span>${glyph("down")}</summary><div class="ce-extra-content"><h3>公司其它信息</h3><div data-company-other>${fieldGroup(layout.other)}</div>
        ${[["shortName","公司简称"],["landline","座机"],["companyAddress","详细地址"],["companyRemark","公司备注"],["poolGroup","公海分组"]]
          .filter(([key]) => c[key]).map(([key,label]) => field(key,label,input(key,c[key]))).join("")}
        ${field("note", "客户备注", `<textarea id="ce-note" name="note" rows="3" placeholder="请输入">${E(c.note || "")}</textarea>`)}
        ${field("permanentNote", "客户永久备注", `<textarea id="ce-permanentNote" name="permanentNote" rows="3" placeholder="请输入">${E(c.permanentNote || "")}</textarea>`)}
        <h3>来财交易偏好</h3>
        ${field("currency", "默认币种", select("currency", c.currency || "USD", "请选择", ["USD", "EUR", "GBP", "CNY", "AUD", "CAD"]))}
        ${field("paymentMethod", "客户付款方式", select("paymentMethod", c.paymentMethod, "请选择", [...(Array.isArray(state.paymentMethods) ? state.paymentMethods : []).filter((value) => typeof value === "string"), ...list("paymentMethod"), "PayPal", "T/T 银行转账"]))}
        ${field("paymentEmail", "付款邮箱", input("paymentEmail", c.paymentEmail, "paypal@example.com", { type: "email" }))}
        ${field("repurchaseCycle", "复购周期", `<div class="ce-select"><select id="ce-repurchaseCycle" name="repurchaseCycle">${option("", "不提醒", String(c.repurchaseCycle || ""))}${values(["30", "60", "90", "180"], String(c.repurchaseCycle || "")).map((cycle) => option(cycle, `${cycle} 天`, String(c.repurchaseCycle || ""))).join("")}</select>${glyph("down")}</div>`)}
        <div class="ce-existing-fields">
          ${field("owner", "跟进人", combo("owner", c.owner, "请选择", ownerOptions))}
          ${field("level", "客户等级", combo("level", c.level, "选填", [...(Array.isArray(state.customerLevels) ? state.customerLevels : []).filter((value) => typeof value === "string"), ...list("level")]))}
          ${field("nextFollow", "下次跟进", input("nextFollow", c.nextFollow, "请选择", { type: "date" }))}
        </div><button class="ce-collapse" type="button" data-editor-action="collapse">收起 ${glyph("up")}</button>
      </div></details></section>`;
    return {
      body: `<form id="customer-form" class="drawer-body ce-body" data-next-contact-id="${contacts.length}" data-old-name="${E(isNew ? "" : c.name)}" data-original-group="${E(groupName)}" data-original-stage="${E(originalStage)}"><div class="error ce-error" id="form-error" role="alert"></div><input type="hidden" name="previewFollowed" value="${c.followed === true || c.previewFollowed === true ? "true" : "false"}"><div class="ce-columns">${company}<section class="ce-contacts"><div class="ce-section-heading"><h3>联系人信息(<span data-contact-count>${contacts.length}</span>)</h3></div><div data-contact-list>${contacts.join("")}</div><button type="button" class="ce-add-contact" data-editor-action="add-contact">${glyph("plus")}添加联系人</button><template data-contact-template>${contactCard(1, {}, true)}</template><template data-method-template="social">${methodRow("social")}</template><template data-method-template="phone">${methodRow("phone")}</template></section></div></form>`,
      footer: `<div class="ce-footer"><div class="ce-footer-switches"><label>历史动态重建 <input type="checkbox" role="switch" name="rebuildHistory" form="customer-form"${c.rebuildHistory !== false ? " checked" : ""}><span class="ce-switch" aria-hidden="true"></span></label><label>同时新建商机 <input type="checkbox" role="switch" name="createOpportunity" form="customer-form"${c.createOpportunity ? " checked" : ""}><span class="ce-switch" aria-hidden="true"></span></label></div><div class="ce-footer-actions"><button type="button" data-action="close-modal">取 消</button><button type="submit" name="saveMode" value="continue" form="customer-form">确定并继续新建</button><button class="primary" type="submit" name="saveMode" value="save" form="customer-form">确 定</button></div></div>`,
    };
  }

  function bind(container) {
    const form = (container || root.document)?.querySelector(
      "#customer-form.ce-body",
    );
    if (!form || form.dataset.editorBound) return;
    form.dataset.editorBound = "true";
    for (const control of form.querySelectorAll("[data-editor-date]"))
      initialDateValues.set(control, control.value);
    const setOptionalSection = (section, open) => {
      if (!section) return;
      section.open = open;
      section.querySelector(open ? ".ce-collapse" : "summary")?.focus();
    };
    const finishCustomerCode = () => {
      const row = form.querySelector(".ce-customer-number");
      const input = row?.querySelector("[name=customerCode]");
      if (!input || input.hidden) return;
      input.value = input.value.trim();
      row.querySelector("[data-customer-code-display]").textContent = input.value || "*****";
      input.hidden = true;
      row.querySelector("[data-customer-code-display]").hidden = false;
      const edit = row.querySelector("[data-editor-action=edit-customer-code]");
      edit.hidden = false;
    };
    const updateContacts = () => {
      const cards = [...form.querySelectorAll("[data-contact-card]")];
      form.querySelector("[data-contact-count]").textContent = String(
        cards.length,
      );
      cards.forEach((card, index) => {
        card.dataset.contactCard = String(index);
        card.querySelector("[data-contact-number]").textContent = String(
          index + 1,
        );
      });
    };
    const updateMethodRows = (card, kind) => {
      const social = kind === "social";
      card.querySelectorAll(`[data-method-list="${kind}"] [data-method-row]`).forEach((row, index) => {
        const number = index + 2;
        row.querySelector("[data-method-select]").setAttribute("aria-label", `附加${social ? "社交平台" : "电话区号"} ${number}`);
        row.querySelector("[data-method-value]").setAttribute("aria-label", `附加${social ? "社交平台" : "联系电话"} ${number}`);
        row.querySelector("[data-editor-action='remove-method']").setAttribute("aria-label", `移除附加${social ? "社交平台" : "联系电话"} ${number}`);
      });
    };
    form.addEventListener("click", (event) => {
      const summary = event.target.closest(".ce-extra > summary");
      if (summary && form.contains(summary)) {
        event.preventDefault();
        setOptionalSection(summary.parentElement, !summary.parentElement.open);
        return;
      }
      const button = event.target.closest("[data-editor-action]");
      if (!button || !form.contains(button)) return;
      if (button.dataset.editorAction === "edit-customer-code") {
        const row = button.closest(".ce-customer-number");
        const input = row.querySelector("[name=customerCode]");
        row.querySelector("[data-customer-code-display]").hidden = true;
        button.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
        return;
      }
      if (button.dataset.editorAction === "add-method") {
        const kind = button.dataset.methodType;
        const card = button.closest("[data-contact-card]");
        const list = card?.querySelector(`[data-method-list="${kind}"]`);
        const template = form.querySelector(`[data-method-template="${kind}"]`);
        if (!list || !template) return;
        const fragment = template.content.cloneNode(true);
        const row = fragment.querySelector("[data-method-row]");
        row.dataset.methodId = root.crypto?.randomUUID?.() ||
          "new-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
        list.append(fragment);
        updateMethodRows(card, kind);
        if (event.detail > 0) form.closest(".drawer")?.focus();
        else list.lastElementChild.querySelector("[data-method-value]")?.focus();
        return;
      }
      if (button.dataset.editorAction === "remove-method") {
        const row = button.closest("[data-method-row]");
        const card = button.closest("[data-contact-card]");
        const kind = row?.dataset.methodRow;
        row?.remove();
        if (card && kind) {
          updateMethodRows(card, kind);
          if (event.detail > 0) form.closest(".drawer")?.focus();
          else card.querySelector(`[data-editor-action="add-method"][data-method-type="${kind}"]`)?.focus();
        }
        return;
      }
      if (button.dataset.editorAction === "collapse") {
        setOptionalSection(button.closest("details"), false);
        return;
      }
      if (button.dataset.editorAction === "remove-contact") {
        button.closest("[data-contact-card]").remove();
        updateContacts();
      }
      if (button.dataset.editorAction === "add-contact") {
        const node = form
          .querySelector("[data-contact-template]")
          .content.cloneNode(true);
        node.querySelector("[name=contactIdExtra]").value =
          root.crypto?.randomUUID?.() ||
          "new-" +
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2);
        const index = Number(
          form.dataset.nextContactId ||
            form.querySelectorAll("[data-contact-card]").length,
        );
        form.dataset.nextContactId = String(index + 1);
        node.querySelectorAll("[id]").forEach((element) => {
          element.id = element.id.replace(/-\d+$/, "-" + index);
        });
        node.querySelectorAll("label[for]").forEach((element) => {
          element.htmlFor = element.htmlFor.replace(/-\d+$/, "-" + index);
        });
        form.querySelector("[data-contact-list]").append(node);
        updateContacts();
        const added = form.querySelector(
          "[data-contact-list]",
        ).lastElementChild;
        if (event.detail > 0) added.classList.add("ce-contact-enter");
        added.querySelector("input")?.focus();
        added.scrollIntoView({
          block: "nearest",
          behavior: event.detail > 0 && !root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
            ? "smooth" : "instant",
        });
      }
    });
    form.addEventListener("keydown", (event) => {
      if (!event.target.matches(".ce-number-input")) return;
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
    });
    form.addEventListener("focusout", (event) => {
      const row = event.target.closest?.(".ce-customer-number");
      if (!row || row.contains(event.relatedTarget)) return;
      finishCustomerCode();
    });
    form.addEventListener("change", (event) => {
      if (event.target.name !== "customerStars") return;
      const rating = Number(event.target.value);
      const group = event.target.closest(".ce-rating");
      group.dataset.rating = String(rating);
      group
        .querySelectorAll("label")
        .forEach((label, index) =>
          label.classList.toggle("is-active", index < rating),
        );
    });
  }
  const api = { render, bind, isUnchangedDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LaiCustomerEditor = api;
})(typeof window !== "undefined" ? window : globalThis);
