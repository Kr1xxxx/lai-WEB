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
      ["customsDataUpdatedAt", "海关数据更新时间"],
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
  function sortRows(rows = [], field, direction = "asc") {
    const definition = fields.get(aliases.get(field) || field);
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

  function globalCustomerSearch(rows = [], { field = "all", query = "" } = {}) {
    if (!active(query)) return [...rows];
    if (!globalSearchFields.some((item) => item.id === field)) return [];
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
        ? Object.values(searchable).flat()
        : searchable[field];
      return contains(candidates, query);
    });
  }

  function filter(rows = [], options = {}) {
    const field = aliases.get(options.field) || options.field || "name";
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
    if (hasQuery && !fields.has(field)) return [];
    return rows.filter((row) => {
      if (pickedCountries.length && !pickedCountries.includes(row.country))
        return false;
      if (hasQuery && !pickedCountries.length) {
        if (field === "followed") {
          const target = booleanValue(options.query);
          if (target === null || booleanValue(row.followed) !== target)
            return false;
        } else if (!contains(rowValue(row, field), options.query)) return false;
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

  function normalizeColumns(settings = {}) {
    const order = [
      ...new Set([
        "name",
        ...(Array.isArray(settings.order) ? settings.order : defaults).map(
          (id) => aliases.get(id) || id,
        ),
      ]),
    ].filter((id) => fields.has(id));
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

  const api = { catalog, globalSearchFields, globalCustomerSearch, filter, sortRows, normalizeColumns, countryLabel,
    companyDisplayFields, normalizeCompanyDisplayLayout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerFields = api;
})(typeof window !== "undefined" ? window : globalThis);
