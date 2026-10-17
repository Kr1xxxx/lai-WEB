(function (root) {
  "use strict";

  // Labels and categories transcribed from CUS-LIST-003. Missing values stay
  // missing: an order amount must never stand in for an opportunity amount.
  const groups = {
    公司信息: [
      ["name", "公司名称", "text", 230],
      ["customerCode", "客户编号"],
      ["tags", "客户标签", "text", 153],
      ["timezone", "时区"],
      ["stage", "客户阶段"],
      ["source", "客户来源"],
      ["group", "客户分组"],
      ["customerStars", "客户星级", "number"],
      ["score", "评分", "number"],
      ["website", "公司网址", "text", 230],
      ["companyProducts", "主营产品"],
      ["contactCount", "联系人数", "number"],
      ["orderCount", "成交订单数", "number"],
      ["total", "成交订单金额(USD)", "number", 170],
      ["firstOrderTotal", "首次成交订单金额(USD)", "number", 190],
      ["average", "成交订单均价(USD)", "number", 170],
      ["opportunityCount", "赢单商机数", "number"],
      ["activeOpportunityCount", "进行中的商机数", "number"],
      ["opportunityTotalCny", "赢单商机金额(CNY)", "number", 170],
      ["opportunityTotal", "赢单商机金额(USD)", "number", 136],
      ["opportunityAverageCny", "赢单商机均价(CNY)", "number", 170],
      ["opportunityAverage", "赢单商机均价(USD)", "number", 146],
      ["owner", "跟进人", "text", 73],
      ["previousOwner", "原跟进人"],
      ["customerConnectOwner", "客户通跟进人"],
      ["customerConnectPreviousOwner", "客户通原跟进人"],
      ["createdBy", "创建人"],
      ["updatedBy", "最近修改人"],
      ["poolEntryCount", "进入公海次数", "number"],
      ["creationMethod", "创建方式"],
      ["followers", "关注人"],
      ["productType", "主营产品类型"],
      ["cardStock", "卡纸"],
      ["customBox", "定制盒"],
      ["country", "国家地区", "text", 100],
      ["sourceDetail", "来源详情"],
      ["linkedLead", "关联线索"],
      ["segments", "客群"],
      ["latestActivity", "最近动态", "text", 158],
      ["latestFollowup", "最近跟进", "text", 220],
    ],
    联系人信息: [
      ["contact", "主要联系人", "text", 231],
      ["email", "邮箱", "text", 230],
      ["phone", "联系电话", "text", 180],
      ["socialPlatforms", "社交平台"],
      ["contactNote", "联系人备注", "text", 230],
      ["address", "地址", "text", 260],
      ["alibabaId", "Alibaba会员ID", "text", 150],
      ["alternativeEmail", "备用邮箱", "text", 230],
      ["contactPaymentMethod", "付款方式"],
      ["primaryContactMethod", "主要联系方式"],
    ],
    日期时间: [
      ["createdAt", "创建时间"],
      ["updated", "资料更新时间"],
      ["lastContact", "最近联系时间"],
      ["lastFollowup", "最近跟进时间", "date", 112],
      ["tipsUpdatedAt", "Tips最近更新时间"],
      ["lastPrivatePoolEntry", "最近进入私海时间"],
      ["lastPoolEntry", "最近进入公海时间"],
      ["nextPoolEntry", "下次移入公海日期"],
      ["lastWrittenFollowup", "最近「写跟进」时间"],
      ["lastEmailSent", "最近发件时间"],
      ["lastEmailReceived", "最近收件时间"],
      ["lastAlibabaMessageReceived", "最近收到阿里TM消息时间"],
      ["lastAlibabaMessageSent", "最近发送阿里TM消息时间"],
      ["lastAlibabaInquiryReceived", "最近收到阿里TM询盘时间"],
      ["lastWhatsAppContact", "最近WhatsApp沟通时间"],
      ["lastDealDate", "最近成交日期"],
      ["firstOrderDate", "首次成交订单日期"],
      ["latestOrderDate", "最近成交订单日期"],
      ["firstWonDate", "首次赢单日期"],
      ["lastWonDate", "最近赢单日期", "date", 105],
      ["lastEdmSent", "最近发EDM时间"],
      ["birthday", "生日"],
      ["lastConvertedLeadCreated", "最近转化线索创建时间"],
      ["lastWhatsAppReceived", "最近whatsApp接收时间"],
      ["lastWhatsAppSent", "最近whatsApp发送时间"],
      ["lastWhatsAppBusinessReceived", "最近WhatsApp企业版接收时间"],
      ["lastWhatsAppBusinessSent", "最近WhatsApp企业版发送时间"],
      ["lastFacebookReceived", "最近facebook接收时间"],
      ["lastFacebookSent", "最近facebook发送时间"],
      ["lastWeComContact", "最近企业微信沟通时间"],
      ["lastWeComReceived", "最近企业微信接收时间"],
      ["lastWeComSent", "最近企业微信发送时间"],
      ["lastInstagramContact", "最近Instagram Messenger沟通时间"],
      ["lastInstagramReceived", "最近Instagram Messenger接收时间"],
      ["lastInstagramSent", "最近Instagram Messenger发送时间"],
      ["customerConnectFirstSync", "关联客户通客户首次同步时间"],
      ["customerConnectLastSync", "关联客户通客户最近同步时间"],
      ["ownerUpdatedAt", "跟进人更新时间"],
      ["lastAlibabaInquiryReply", "最新回复阿里询盘消息时间"],
    ],
    // Existing Lai column preferences retain their meaning and identifiers.
    来财补充字段: [
      ["customerPaymentMethod", "客户付款方式"],
      ["level", "客户等级"],
      ["nextFollow", "下次跟进", "date"],
      ["due", "待收款 (USD)", "number", 140],
      ["followed", "是否关注", "boolean"],
      ["alibabaIdentity", "阿里买家身份"],
    ],
  };
  const defaults = [
    "name",
    "contact",
    "country",
    "tags",
    "owner",
    "lastWonDate",
    "lastFollowup",
    "latestActivity",
    "opportunityTotal",
    "opportunityAverage",
    "opportunityCount",
    "alibabaId",
    "lastContact",
    "createdAt",
    "source",
    "customerCode",
    "email",
    "phone",
  ];
  const definitions = Object.entries(groups).flatMap(([category, list]) =>
    list.map(([id, label, type, width]) =>
      Object.freeze({
        id,
        label,
        type: type || (category === "日期时间" ? "date" : "text"),
        width: width || 150,
        category,
      }),
    ),
  );
  const fields = new Map(definitions.map((field) => [field.id, field]));
  const catalog = Object.freeze(definitions);
  const globalSearchFields = Object.freeze([
    ["all", "全部"], ["nameOrShort", "客户名称/简称"],
    ["note", "公司备注"], ["shortName", "简称"],
    ["customerCode", "客户编号"], ["email", "邮箱"],
    ["contact", "联系人名称"], ["website", "主页"],
    ["phone", "联系电话"], ["social", "社交账号"],
  ].map(([id, label]) => Object.freeze({ id, label })));
  const aliases = new Map([
    ["tag", "tags"],
    ["customerGroup", "group"],
    ["customMainProduct", "productType"],
    ["cardPaper", "cardStock"],
    ["paymentMethod", "contactPaymentMethod"],
  ]);
  // The two groups and their order follow the captured OKKI display drawer.
  // These are Lai-local view preferences, separate from customer profile data.
  const companyDisplayFields = Object.freeze([
    ["website", "公司网址"], ["name", "公司名称"], ["country", "国家地区"],
    ["source", "客户来源"], ["productType", "主营产品类型"], ["tags", "客户标签"],
    ["previewGroup", "客户分组"], ["customerStage", "客户阶段"],
    ["customerStars", "客户星级"], ["customerCode", "客户编号"],
    ["timezone", "时区"], ["defaultPaymentPlan", "默认付款计划"],
    ["customerAccountPeriod", "客户账期"], ["companyProducts", "主营产品"],
    ["cardStock", "卡纸"], ["customBox", "定制盒"], ["customerType", "客户类型"],
  ].map(([id, label]) => Object.freeze({ id, label, required: ["name", "country", "source"].includes(id) })));
  const defaultCompanyCommon = Object.freeze(companyDisplayFields.slice(0, 10).map((field) => field.id));
  const defaultCompanyOther = Object.freeze(companyDisplayFields.slice(10).map((field) => field.id));
  function normalizeCompanyDisplayLayout(layout) {
    const allowed = new Set(companyDisplayFields.map((field) => field.id));
    const required = new Set(["name", "country", "source"]);
    const seen = new Set();
    const take = (values, group) => (Array.isArray(values) ? values : [])
      .filter((id) => {
        if (typeof id !== "string" || !allowed.has(id) || seen.has(id) || group === "other" && required.has(id)) return false;
        seen.add(id);
        return true;
      });
    const common = take(layout?.common, "common");
    const other = take(layout?.other, "other");
    for (const id of defaultCompanyCommon) if (!seen.has(id)) {
      common.push(id); seen.add(id);
    }
    for (const id of defaultCompanyOther) if (!seen.has(id)) {
      other.push(id); seen.add(id);
    }
    return { common, other };
  }
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  const active = (value) =>
    value !== undefined && value !== null && normalize(value) !== "";
  function sortRows(rows = [], field, direction = "asc", state) {
    const definition = registry(state).byId.get(aliases.get(field) || field);
    if (!definition) return [...rows];
    const sign = direction === "desc" ? -1 : 1;
    const emptyFirst = ["country", "lastWonDate", "lastFollowup", "opportunityTotal", "opportunityAverage"].includes(definition.id) && direction !== "desc";
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    const value = (row) => {
      let raw = definition.id === "level" ? row.displayLevel ?? row.level : row[definition.id];
      if (Array.isArray(raw)) raw = raw.filter(active).join("、");
      if (!active(raw)) return null;
      if (definition.type === "number") {
        const number = Number(raw);
        return Number.isFinite(number) ? number : null;
      }
      if (definition.type === "date") {
        const timestamp = Date.parse(String(raw));
        return Number.isFinite(timestamp) ? timestamp : null;
      }
      if (definition.type === "boolean") {
        if (raw === true || raw === "true") return 1;
        if (raw === false || raw === "false") return 0;
        return null;
      }
      return definition.id === "country"
        ? countryLabel(raw).replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "").trim()
        : String(raw).trim();
    };
    return [...rows].sort((left, right) => {
      const a = value(left), b = value(right);
      if (a === null) return b === null ? 0 : emptyFirst ? -1 : 1;
      if (b === null) return emptyFirst ? 1 : -1;
      return sign * (typeof a === "number" ? a - b : collator.compare(a, b));
    });
  }
  const values = (value) => (Array.isArray(value) ? value : [value]);
  const contains = (value, query) =>
    values(value).some(
      (item) =>
        item !== undefined &&
        item !== null &&
        normalize(item).includes(normalize(query)),
    );
  const equals = (value, target) =>
    values(value).some(
      (item) =>
        item !== undefined &&
        item !== null &&
        normalize(item) === normalize(target),
    );
  const booleanValue = (value) =>
    value === true || value === "true"
      ? true
      : value === false || value === "false"
        ? false
        : null;
  const rowValue = (row, field) =>
    field === "email"
      ? [
          row.email,
          ...(Array.isArray(row.emails) ? row.emails : []),
          ...(Array.isArray(row.extraContacts) ? row.extraContacts.map((contact) => contact?.email) : []),
        ]
      : field === "level" ? row.displayLevel ?? row.level : row[field];

  // 全局搜索能搜的自定义字段：文本、多行文本、数字、单选、多选（日期不搜）。
  const searchableCustomTypes = new Set(["text", "textarea", "number", "select", "multi"]);
  const globalSearchCustom = (state) => customColumns(state).filter((def) => searchableCustomTypes.has(def.fieldType));
  // 搜索范围菜单：固定字段在前，自定义字段（id 是 custom:<字段ID>，名称是字段名称）在后。
  const globalSearchFieldsFor = (state) => [
    ...globalSearchFields,
    ...globalSearchCustom(state).map((def) => Object.freeze({ id: def.id, label: def.label, custom: true })),
  ];
  function globalCustomerSearch(rows = [], { field = "all", query = "", hidden = null, state = null } = {}) {
    if (!active(query)) return [...rows];
    // 自定义字段的定义只在这里取一次（不是每一行取一次）；角色看不到的、已经删掉的字段都不在里面。
    const customDefs = state ? globalSearchCustom(state).filter((def) => !(hidden && hidden.has(def.id))) : [];
    const customIds = customDefs.map((def) => def.id);
    const customOnly = isCustomColumn(field);
    if (customOnly) {
      if (!customIds.includes(field)) return [];
    } else if (!globalSearchFields.some((item) => item.id === field)) return [];
    // 角色看不到的字段不能拿来搜（选了那个字段就没有结果，搜“全部”时也跳过它）。
    if (hidden && hidden.has(field)) return [];
    const customOf = (row, def) => row[def.id] ?? row.custom?.[def.customId];
    if (customOnly) {
      const def = customDefs.find((item) => item.id === field);
      return rows.filter((row) => contains(customOf(row, def), query));
    }
    const fieldValues = (row) => ({
      nameOrShort: [row.name, row.shortName, row.abbreviation],
      note: [row.companyRemark],
      shortName: [row.shortName, row.abbreviation],
      customerCode: [row.customerCode],
      email: [row.email, ...(row.emails || []), ...(row.extraContacts || []).map((contact) => contact.email)],
      contact: [row.contact, ...(row.contacts || []), ...(row.extraContacts || []).map((contact) => contact.contact)],
      website: [row.website],
      phone: [row.phone, ...(row.phones || []), ...(row.additionalPhones || []).map((item) => item.phone),
        ...(row.extraContacts || []).flatMap((contact) => [contact.phone, ...(contact.additionalPhones || []).map((item) => item.phone)])],
      social: [row.socialPlatforms, row.socialAccount, ...(row.additionalSocialAccounts || []).map((item) => item.socialAccount),
        ...(row.extraContacts || []).flatMap((contact) => [contact.socialAccount, ...(contact.additionalSocialAccounts || []).map((item) => item.socialAccount)])],
    });
    return rows.filter((row) => {
      const searchable = fieldValues(row);
      const candidates = field === "all"
        ? [...Object.entries(searchable).filter(([id]) => !(hidden && hidden.has(id))).flatMap(([, list]) => list),
          ...customDefs.map((def) => customOf(row, def))]
        : searchable[field];
      return contains(candidates, query);
    });
  }

  function filter(rows = [], options = {}, state) {
    const reg = registry(state);
    const field = aliases.get(options.field) || options.field || "name";
    const quickDef = reg.byId.get(field);
    // 单选、多选的自定义字段：快捷筛选选的是一个选项，按整个选项匹配（“ISO”不会匹配“ISO 9001”）。
    const quickChoice = quickDef?.custom && (quickDef.fieldType === "select" || quickDef.fieldType === "multi");
    const tagTerms = values(options.tag)
      .flatMap((value) => String(value ?? "").split(/[,，]/))
      .map((value) => value.trim())
      .filter(Boolean);
    const pickedCountries =
      field === "country" && Array.isArray(options.quickCountries)
        ? options.quickCountries
        : [];
    const hasQuery = active(options.query);
    // Invalid quick fields must not silently turn into an all-fields search.
    if (hasQuery && !quickDef) return [];
    return rows.filter((row) => {
      if (pickedCountries.length && !pickedCountries.includes(row.country))
        return false;
      if (hasQuery && !pickedCountries.length) {
        if (field === "followed") {
          const target = booleanValue(options.query);
          if (target === null || booleanValue(row.followed) !== target)
            return false;
        } else if (!(quickChoice ? equals : contains)(rowValue(row, field), options.query)) return false;
      }
      for (const key of [
        "country",
        "owner",
        "stage",
        "source",
        "level",
        "customerStars",
        "alibabaIdentity",
      ]) {
        if (active(options[key]) && !equals(rowValue(row, key), options[key]))
          return false;
      }
      for (const [key, rowKey] of [
        ["name", "name"],
        ["email", "email"],
        ["customerGroup", "group"],
      ]) {
        if (active(options[key]) && !contains(rowValue(row, rowKey), options[key]))
          return false;
      }
      if (tagTerms.length) {
        const matches = tagTerms.map((term) => contains(row.tags, term));
        if (options.tagMode === "包含全部" ? matches.some((matched) => !matched) : !matches.some(Boolean))
          return false;
      }
      if (active(options.followed)) {
        const target = booleanValue(options.followed);
        if (target === null || booleanValue(row.followed) !== target)
          return false;
      }
      return true;
    });
  }

  function normalizeColumns(settings = {}, state) {
    const known = registry(state).byId;
    const order = [
      ...new Set([
        "name",
        ...(Array.isArray(settings.order) ? settings.order : defaults).map(
          (id) => aliases.get(id) || id,
        ),
      ]),
    ].filter((id) => known.has(id));
    const requested = new Set(
      (Array.isArray(settings.frozen) ? settings.frozen : []).map(
        (id) => aliases.get(id) || id,
      ),
    );
    const frozen = [
      "name",
      ...order.filter((id) => id !== "name" && requested.has(id)).slice(0, 2),
    ];
    return {
      order: [...frozen, ...order.filter((id) => !frozen.includes(id))],
      frozen,
    };
  }

  let countries;
  function countryLabel(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    const flag = raw.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0] || "";
    const text = raw.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
    if (!countries) {
      countries = new Map();
      const en = new Intl.DisplayNames(["en"], { type: "region" }),
        zh = new Intl.DisplayNames(["zh-CN"], { type: "region" });
      const codes =
        "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
          " ",
        );
      for (const code of codes) {
        const emoji = [...code]
          .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
          .join("");
        const label = `${emoji} ${zh.of(code)}`;
        for (const key of [code, emoji, en.of(code), zh.of(code)])
          countries.set(normalize(key), label);
      }
      for (const [alias, code] of [
        ["USA", "US"],
        ["UK", "GB"],
        ["UAE", "AE"],
        ["South Korea", "KR"],
        ["Russia", "RU"],
        ["Vietnam", "VN"],
        ["Turkey", "TR"],
      ])
        countries.set(normalize(alias), countries.get(normalize(code)));
    }
    if (flag && countries.has(normalize(flag)))
      return countries.get(normalize(flag));
    const chinese = text
      .match(/[\u3400-\u9fff][\u3400-\u9fff\s·（）()、-]*/)?.[0]
      .trim();
    return (
      countries.get(normalize(text)) ||
      countries.get(normalize(chinese)) ||
      (chinese ? `${flag ? flag + " " : ""}${chinese}` : raw)
    );
  }

  // ---------- 角色字段权限 ----------
  // 键 = 客户档案上存的属性名（编辑页的字段名）；联系人字段加前缀 contact.，对每位联系人都生效。
  // 不在清单里（始终可编辑）：公司名称、国家地区、客户来源（新建必填）、跟进人（由“重新分配”管）、联系人昵称、下次跟进、各种时间和系统算出来的字段。
  const roleCompanyFields = [
    ["website", "公司网址"], ["tags", "客户标签"], ["previewGroup", "客户分组"], ["customerStage", "客户阶段"],
    ["customerType", "客户类型"], ["customerStars", "客户星级"], ["customerCode", "客户编号"], ["level", "客户等级"],
    ["timezone", "时区"], ["defaultPaymentPlan", "默认付款计划"], ["customerAccountPeriod", "客户账期"],
    ["productType", "主营产品."], ["companyProducts", "主营产品"], ["cardStock", "卡纸"], ["customBox", "定制盒"],
    ["shortName", "公司简称"], ["landline", "座机"], ["companyAddress", "详细地址"], ["companyRemark", "公司备注"],
    ["note", "客户备注"], ["permanentNote", "客户永久备注"],
  ];
  const roleTradeFields = [["currency", "默认币种"], ["paymentMethod", "客户付款方式"], ["paymentEmail", "付款邮箱"], ["repurchaseCycle", "复购周期"]];
  const roleContactFields = [
    ["email", "邮箱"], ["phone", "联系电话"], ["socialAccount", "社交平台"], ["primaryContactMethod", "主要联系方式"],
    ["alibabaId", "Alibaba会员ID"], ["address", "地址"], ["alternateEmail", "备用邮箱"], ["birthday", "生日"],
    ["contactPaymentMethod", "付款方式"], ["contactNote", "联系人备注"],
  ];
  // 一个联系人字段在档案里实际存了哪些属性：主联系人在档案顶层，其他联系人在 extraContacts 的每一项里。
  const contactStore = {
    email: { primary: ["email"], extra: ["email"], list: "emails" },
    phone: { primary: ["phone", "phoneCountryCode", "additionalPhones"], extra: ["phone", "phoneCountryCode", "additionalPhones"], list: "phones" },
    socialAccount: { primary: ["socialPlatform", "socialAccount", "additionalSocialAccounts"], extra: ["socialPlatform", "socialAccount", "additionalSocialAccounts"] },
    primaryContactMethod: { primary: ["primaryContactMethod"], extra: ["primaryContactMethod"] },
    alibabaId: { primary: ["alibabaId"], extra: ["alibabaId"] },
    address: { primary: ["address"], extra: ["address"], list: "addresses" },
    alternateEmail: { primary: ["alternateEmail", "alternativeEmail", "backupEmail"], extra: ["alternateEmail", "alternativeEmail", "backupEmail"] },
    birthday: { primary: ["birthday"], extra: ["birthday"] },
    contactPaymentMethod: { primary: ["contactPaymentMethod"], extra: ["contactPaymentMethod", "paymentMethod"] },
    contactNote: { primary: ["contactNote"], extra: ["contactNote"] },
  };
  const roleModel = () => {
    if (root.LaiRoleModel) return root.LaiRoleModel;
    try { return typeof require === "function" ? require("./role-model.js") : null; } catch (_) { return null; }
  };
  // 字段权限分“客户”和“公海客户”两套：档案在公海里按公海的，其余按客户的。
  const moduleOf = (target) => target === "pool" || target === "customer" ? target : target && target.laiBucket === "pool" ? "pool" : "customer";
  const fieldModel = () => {
    if (root.LaiFieldModel) return root.LaiFieldModel;
    try { return typeof require === "function" ? require("./field-model.js") : null; } catch (_) { return null; }
  };
  const customFieldsOf = (state) => { try { return fieldModel()?.get(state, "customer").customFields || []; } catch (_) { return []; } };
  // ---------- 自定义字段做成列 ----------
  // 客户设置里配置的自定义字段，每个对应一个列：id 是 custom:<字段ID>，名称是字段名称。
  // 值由 segments.js 的 enrich 放进每一行（row["custom:<字段ID>"]），所以列表、筛选、排序、客群、导出都按行上的这个键读。
  // 类型：数字、日期保持原样，其余（文本、单选、多选）按文本；单选、多选带 options。
  // 按 state.laiSettings.fieldSettings.customer 这个对象缓存：设置一改就是新对象，自动重算。
  const CUSTOM_PREFIX = "custom:";
  const isCustomColumn = (id) => typeof id === "string" && id.startsWith(CUSTOM_PREFIX);
  const customRoleKey = (id) => "custom." + String(id).slice(CUSTOM_PREFIX.length);
  const customWidth = { number: 120, date: 130, multi: 200, textarea: 200 };
  const EMPTY_REGISTRY = Object.freeze({ custom: Object.freeze([]), list: catalog, byId: fields });
  const registryCache = new WeakMap();
  function registry(state) {
    const raw = state?.laiSettings?.fieldSettings?.customer;
    if (!raw || typeof raw !== "object") return EMPTY_REGISTRY;
    let hit = registryCache.get(raw);
    if (!hit) {
      const configured = customFieldsOf(state);
      if (!configured.length) hit = EMPTY_REGISTRY;
      else {
        const custom = Object.freeze(configured.map((f) => Object.freeze({
          id: CUSTOM_PREFIX + f.id, label: f.name, category: "自定义字段", custom: true, customId: f.id,
          type: f.type === "number" ? "number" : f.type === "date" ? "date" : "text",
          fieldType: f.type, options: Object.freeze([...(f.options || [])]), width: customWidth[f.type] || 150,
        })));
        const byId = new Map(fields);
        for (const def of custom) byId.set(def.id, def);
        hit = Object.freeze({ custom, list: Object.freeze([...catalog, ...custom]), byId });
      }
      registryCache.set(raw, hit);
    }
    return hit;
  }
  // 全部列（系统列 + 这个账号数据里配置的自定义列）。
  const catalogFor = (state) => registry(state).list;
  const customColumns = (state) => registry(state).custom;
  // 按 id 取一列（不处理别名）；找不到返回 undefined。
  const fieldFor = (state, id) => registry(state).byId.get(id);

  function roleFieldList(state, module) {
    if (module !== "customer" && module !== "pool") return [];
    return [
      ...roleCompanyFields.map(([key, label]) => ({ key, label, group: "公司信息" })),
      ...roleTradeFields.map(([key, label]) => ({ key, label, group: "交易偏好" })),
      ...roleContactFields.map(([key, label]) => ({ key: "contact." + key, label, group: "联系人" })),
      // 自定义字段（客户设置 → 字段设置）：键是 custom.<字段ID>，值在档案的 custom 里。
      ...customFieldsOf(state).map((field) => ({ key: "custom." + field.id, label: field.name, group: "自定义字段" })),
    ];
  }
  // 列表列（id）→ 字段权限的键。没列出的列（公司名称、国家、跟进人、各种时间……）始终可见。
  const columnRoleKeys = {
    website: "website", tags: "tags", group: "previewGroup", stage: "customerStage", customerStars: "customerStars",
    customerCode: "customerCode", level: "level", timezone: "timezone", productType: "productType", companyProducts: "companyProducts",
    cardStock: "cardStock", customBox: "customBox", customerPaymentMethod: "paymentMethod",
    email: "contact.email", phone: "contact.phone", socialPlatforms: "contact.socialAccount",
    primaryContactMethod: "contact.primaryContactMethod", alibabaId: "contact.alibabaId", address: "contact.address",
    alternativeEmail: "contact.alternateEmail", birthday: "contact.birthday", contactPaymentMethod: "contact.contactPaymentMethod",
    contactNote: "contact.contactNote",
  };
  // 快捷筛选、筛选条件里用的字段 → 字段权限的键。
  const filterRoleKeys = { email: "contact.email", tag: "tags", group: "previewGroup", customerGroup: "previewGroup", stage: "customerStage", customerStars: "customerStars", level: "level" };
  // 全局搜索范围 → 字段权限的键。
  const searchRoleKeys = { email: "contact.email", phone: "contact.phone", social: "contact.socialAccount", website: "website", customerCode: "customerCode", note: "companyRemark", shortName: "shortName" };
  // 客户详情左侧“摘要字段”→ 字段权限的键。
  const summaryRoleKeys = { stage: "customerStage", group: "previewGroup", customerStars: "customerStars", website: "website", productType: "productType", level: "level", companyProducts: "companyProducts" };
  // 客户查重页：重复的是哪一项（邮箱、电话……）→ 字段权限的键。看不到的那一项，查重页也不列出。
  const dupTypeRoleKeys = { 邮箱: "contact.email", 电话: "contact.phone", 客户编号: "customerCode", 座机: "landline", 社交账号: "contact.socialAccount", 公司网址: "website", 简称: "shortName", 详细地址: "companyAddress", "Alibaba会员ID": "contact.alibabaId" };
  // 没有“跟进动态·查看”权限就不显示这两列（里面是动态内容）。
  const activityColumns = new Set(["latestActivity", "latestFollowup"]);
  // gate(state, "customer" | "pool" | 档案)：当前账号对客户字段的权限。系统管理员什么都能看、能改。
  function gate(state, target) {
    const R = roleModel();
    const module = moduleOf(target);
    const plain = !R || R.isAdmin(state);
    const level = (key) => plain ? "edit" : R.fieldLevel(state, module, key);
    const visible = (key) => level(key) !== "hidden";
    const editable = (key) => level(key) === "edit";
    const canActivity = plain || R.can(state, "activity.view");
    // 自定义列的权限键是 custom.<字段ID>；隐藏了的角色看不到这一列，也不能拿它筛选、排序、做客群条件、导出。
    const columnVisible = (id) => isCustomColumn(id) ? visible(customRoleKey(id))
      : (!columnRoleKeys[id] || visible(columnRoleKeys[id])) && (canActivity || !activityColumns.has(id));
    const idsHidden = (map) => new Set(Object.keys(map).filter((id) => !visible(map[id])));
    return {
      module, plain, level, visible, editable, columnVisible, canActivity,
      summaryVisible: (id) => !summaryRoleKeys[id] || visible(summaryRoleKeys[id]),
      contactVisible: (key) => visible("contact." + key),
      contactEditable: (key) => editable("contact." + key),
      hiddenColumns: () => new Set(registry(state).list.map((field) => field.id).filter((id) => !columnVisible(id))),
      hiddenFilters: () => new Set([...idsHidden(filterRoleKeys), ...registry(state).custom.map((field) => field.id).filter((id) => !columnVisible(id))]),
      hiddenSearch: () => new Set([...idsHidden(searchRoleKeys), ...registry(state).custom.map((field) => field.id).filter((id) => !columnVisible(id))]),
    };
  }
  // 筛选条件里用到看不到的字段时，去掉那一项（不然能从筛选结果猜出隐藏的内容）。
  function sanitizeFilters(state, filters = {}, module = "customer") {
    const g = gate(state, module);
    // 快捷筛选选着的自定义字段后来被删掉了：回到公司名称，免得什么都筛不出来。
    const stale = isCustomColumn(filters.field) && !registry(state).byId.has(filters.field);
    const base = stale ? { ...filters, field: "name" } : filters;
    if (g.plain) return base;
    const out = { ...base };
    const hidden = g.hiddenFilters();
    if (hidden.has(out.field)) out.query = "";
    // filters.group 是左侧客群，不是“客户分组”这个字段（它在筛选条件里叫 customerGroup）。
    for (const key of hidden) {
      if (key !== "group" && Object.hasOwn(out, key)) out[key] = "";
    }
    if (g.hiddenColumns().has(out.sortField)) { out.sortField = ""; out.sortDirection = ""; }
    return out;
  }
  // 当前账号锁住（只读或隐藏）的联系人字段（不带 contact. 前缀，只含 contactStore 里有的）。
  function lockedContactKeys(state, module) {
    const R = roleModel();
    if (!R || R.isAdmin(state)) return [];
    return R.lockedFields(state, module).filter((key) => key.startsWith("contact.")).map((key) => key.slice(8)).filter((key) => contactStore[key]);
  }
  const filled = (value) => Array.isArray(value) ? value.some(filled) : value && typeof value === "object" ? Object.values(value).some(filled) : String(value ?? "").trim() !== "";
  // 这位（非主）联系人在锁住的联系人字段里有没有内容：有的话，当前账号不能把他移除（移除会把这些内容一起删掉）。
  function contactHasLocked(state, target, record) {
    if (!record || typeof record !== "object") return false;
    return lockedContactKeys(state, moduleOf(target)).some((key) => contactStore[key].extra.some((prop) => filled(record[prop])));
  }
  // 客户档案里被锁住（只读或隐藏）的字段，保存时一律还原成原来的样子。
  // before 是保存前的档案（新建时为空），after 是要保存的档案；联系人按 id 对应。
  // 只用在“用户自己填写或修改”的保存上；合并客户、设置里改名这类搬动已有资料的操作不走这里（见 app.js 的 persist）。
  function guardProfile(state, before, after, module) {
    const R = roleModel();
    if (!R || !after || typeof after !== "object" || R.isAdmin(state)) return after;
    module = module || moduleOf(before || after);
    const locked = R.lockedFields(state, module);
    if (!locked.length) return after;
    const company = locked.filter((key) => !key.startsWith("contact.") && !key.startsWith("custom."));
    const customIds = locked.filter((key) => key.startsWith("custom.")).map((key) => key.slice(7));
    const contact = lockedContactKeys(state, module);
    let out = company.length ? R.keepLocked(state, module, before, after, company) : after;
    // 自定义字段的值在档案的 custom 里：锁住的那几项用原来的值（原来没有就去掉）。
    if (customIds.length) {
      const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
      const old = plainObject(before?.custom), now = plainObject(out.custom);
      if (old || now) {
        const custom = { ...(now || {}) };
        for (const id of customIds) {
          if (old && Object.hasOwn(old, id)) custom[id] = old[id];
          else delete custom[id];
        }
        out = { ...out, custom };
      }
    }
    if (!contact.length) return out;
    out = { ...out };
    const restore = (target, source, props) => {
      for (const prop of props) {
        if (source && Object.hasOwn(source, prop)) target[prop] = source[prop];
        else delete target[prop];
      }
    };
    for (const key of contact) restore(out, before, contactStore[key].primary);
    const oldExtras = (Array.isArray(before?.extraContacts) ? before.extraContacts : []).map((item, index) =>
      item && typeof item === "object" ? { ...item, id: String(item.id || "").trim() || "legacy-" + (index + 1) } : item);
    const hasLocked = (item) => item && typeof item === "object" && contact.some((key) => contactStore[key].extra.some((prop) => filled(item[prop])));
    if (Array.isArray(out.extraContacts) || oldExtras.some(hasLocked)) {
      const kept = (Array.isArray(out.extraContacts) ? out.extraContacts : []).map((item) => {
        const old = oldExtras.find((entry) => entry && entry.id === item?.id);
        const copy = { ...item };
        for (const key of contact) restore(copy, old, contactStore[key].extra);
        return copy;
      });
      // 被移除的联系人如果有锁住字段的内容，放回去：当前账号删不掉这些内容。
      const ids = new Set(kept.map((item) => item?.id).filter(Boolean));
      for (const old of oldExtras) if (hasLocked(old) && !ids.has(old.id)) kept.push({ ...old });
      out.extraContacts = kept;
    }
    // 邮箱、电话、地址在档案里还有一份按顺序排的清单（第一项是主联系人）。锁住时整份清单保持原样，
    // 不按联系人重新拼（老资料可能没有顶层 email，或者清单比联系人多），免得丢掉内容。
    for (const key of contact) {
      const list = contactStore[key].list;
      if (!list) continue;
      if (Array.isArray(before?.[list])) out[list] = [...before[list]];
      else if (before && Object.hasOwn(before, list)) out[list] = before[list];
      else delete out[list];
    }
    return out;
  }
  // 整份数据保存前：只看有改动的客户，把锁住的字段还原。includeNew 为真时新客户也处理（导入用，新建客户不能填锁住的字段）。
  function guardState(state, next, { includeNew = false } = {}) {
    const R = roleModel();
    if (!R || R.isAdmin(state) || !next?.customers) return next;
    const before = state?.customers || {};
    let customers = null;
    for (const [name, profile] of Object.entries(next.customers)) {
      const old = Object.hasOwn(before, name) ? before[name] : null;
      if (old === profile || (!old && !includeNew)) continue;
      const guarded = guardProfile(state, old, profile);
      if (guarded !== profile) { customers ||= { ...next.customers }; customers[name] = guarded; }
    }
    return customers ? { ...next, customers } : next;
  }

  // 团队客户里“选择部门或业务员”：部门（带层级）和成员，只列当前账号看得到的；列表里有、但不在成员里的跟进人也留着。
  // 部门的值是 dept:<部门id>，成员的值就是名字。
  function ownerFilterOptions(state, rows = []) {
    const R = roleModel();
    if (!R) return [...new Set(rows.map((row) => row.owner).filter(Boolean))].map((owner) => ({ value: owner, label: owner, level: 0, kind: "member" }));
    const settings = R.settings(state);
    const seeable = (name) => R.canSee(state, name);
    const out = [];
    const seen = new Set();
    const add = (name, level) => {
      const key = normalize(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ value: name, label: name, level, kind: "member" });
    };
    for (const dept of R.deptTree(state)) {
      const below = R.deptAndBelow(state, dept.id);
      const people = settings.members.filter((member) => below.has(member.deptId) && seeable(member.name));
      if (!people.length) continue;
      out.push({ value: "dept:" + dept.id, label: dept.name, level: dept.level, kind: "dept" });
      for (const member of settings.members.filter((item) => item.deptId === dept.id && seeable(item.name))) add(member.name, dept.level + 1);
    }
    for (const member of settings.members) if (!member.deptId && seeable(member.name)) add(member.name, 0);
    for (const owner of new Set(rows.map((row) => row.owner).filter(Boolean))) add(owner, 0);
    return out;
  }
  // 选的是部门时，返回“跟进人是否属于这个部门（含下级部门）”的判断；选的是人或没选，返回 null。
  function ownerDeptMatcher(state, value) {
    const R = roleModel();
    const text = String(value ?? "");
    if (!R || !text.startsWith("dept:")) return null;
    const ids = R.deptAndBelow(state, text.slice(5));
    const names = new Set(R.settings(state).members.filter((member) => member.deptId && ids.has(member.deptId)).map((member) => normalize(member.name)));
    return (owner) => names.has(normalize(owner));
  }

  const api = { catalog, catalogFor, customColumns, fieldFor, isCustomColumn, globalSearchFields, globalSearchFieldsFor, globalCustomerSearch, filter, sortRows, normalizeColumns, countryLabel,
    companyDisplayFields, normalizeCompanyDisplayLayout, roleFieldList, gate, sanitizeFilters, guardProfile, guardState, contactHasLocked,
    ownerFilterOptions, ownerDeptMatcher,
    columnRoleKeys, filterRoleKeys, searchRoleKeys, dupTypeRoleKeys };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerFields = api;
})(typeof window !== "undefined" ? window : globalThis);
