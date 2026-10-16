(function (root) {
  'use strict';
  // Export model: turns the page's already-scoped rows into plain tables (header + data), then into
  // workbook / CSV / TSV. Pure: no DOM, no state writes. Who may export, and which rows, is decided by the caller.
  const node = typeof module !== 'undefined' && module.exports;
  const CF = node ? require('./customer-fields.js') : root.LaiCustomerFields;
  const OM = node ? require('./opportunity-model.js') : root.LaiOpportunityModel;
  const BM = node ? require('./business-model.js') : root.LaiBusinessModel;

  const MAX_ROWS = 20000;
  const MAX_ERROR = '一次最多导出 20,000 行，请先筛选';
  const trim = value => String(value ?? '').trim();
  const pad = number => String(number).padStart(2, '0');
  const isoDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  // Plain dates stay as they are; timestamps become the local calendar day.
  function localDay(value) {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? isoDay(value) : '';
    const source = trim(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
    if (!/^\d{4}-\d{2}-\d{2}/.test(source)) return '';
    const parsed = new Date(source.replace(' ', 'T'));
    return Number.isFinite(parsed.getTime()) ? isoDay(parsed) : '';
  }
  const blank = value => value === null || value === undefined || (typeof value === 'string' && !value.trim());
  const num = value => {
    if (blank(value) || typeof value === 'boolean') return '';
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : '';
  };
  const text = value => {
    if (blank(value)) return '';
    if (Array.isArray(value)) return value.filter(item => !blank(item)).map(item => trim(item)).join('、');
    if (typeof value === 'object') return '';
    return String(value);
  };
  const yesNo = value => value === true || value === 'true' ? '是' : value === false || value === 'false' ? '否' : '';
  const list = value => Array.isArray(value) ? value : [];
  const visibleFn = gate => id => !gate || typeof gate.columnVisible !== 'function' || gate.columnVisible(id) !== false;
  function cap(count) { if (count > MAX_ROWS) throw new Error(MAX_ERROR); }

  // ---- customers ----
  function cellOf(def, row) {
    const raw = def.id === 'level' ? row.displayLevel ?? row.level : row[def.id];
    if (def.type === 'number') return num(raw);
    if (def.type === 'date') return localDay(raw) || text(raw);
    if (def.type === 'boolean') return yesNo(raw);
    return text(raw);
  }
  function otherContacts(row, visible) {
    const showName = visible('contact'), showEmail = visible('email'), showPhone = visible('phone');
    return list(row.extraContacts).filter(item => item && typeof item === 'object').map(item => {
      const parts = [];
      if (showName && !blank(item.contact)) parts.push(trim(item.contact));
      if (showEmail && !blank(item.email)) parts.push(trim(item.email));
      if (showPhone && !blank(item.phone)) parts.push(trim(item.phone));
      return parts.join(' ');
    }).filter(Boolean).join('；');
  }
  // options.contactsCell: false = leave the column out; a function(row, visible) = custom text; otherwise the default cell.
  function customerRows(rows, options = {}) {
    const source = list(rows);
    cap(source.length);
    const visible = visibleFn(options.gate);
    const known = new Map(CF.catalog.map(def => [def.id, def]));
    const ids = (Array.isArray(options.columns) && options.columns.length ? options.columns : CF.catalog.map(def => def.id))
      .filter((id, i, all) => known.has(id) && all.indexOf(id) === i && visible(id));
    const defs = ids.map(id => known.get(id));
    const withContacts = options.contactsCell !== false;
    const header = defs.map(def => def.label);
    if (withContacts) header.push('其他联系人');
    const data = source.map(row => {
      const safe = row && typeof row === 'object' ? row : {};
      const cells = defs.map(def => cellOf(def, safe));
      if (withContacts) cells.push(typeof options.contactsCell === 'function' ? text(options.contactsCell(safe, visible)) : otherContacts(safe, visible));
      return cells;
    });
    return { header, data };
  }

  // ---- fixed-column sheets ----
  // Each column: [id, label, getter]. The id is what gate.columnVisible receives.
  function build(columns, items, gate) {
    const visible = visibleFn(gate);
    const used = columns.filter(([id]) => visible(id));
    return { header: used.map(([, label]) => label), data: items.map(item => used.map(([, , get]) => get(item))) };
  }
  const stageLabel = id => (BM.stages.find(stage => stage.id === id) || {}).label || text(id);
  const paidOf = order => ['shipment', 'done'].includes(order.stage) ? num(order.amount) : num(order.paidAmount);
  const ORDER_COLUMNS = [
    ['num', '订单号', o => text(o.num)], ['client', '客户', o => text(o.client)], ['country', '国家', o => text(o.country)],
    ['createdAt', '订单日期', o => localDay(o.createdAt)], ['stage', '阶段', o => stageLabel(o.stage)],
    ['currency', '币种', o => text(o.currency || 'USD').toUpperCase()], ['amount', '金额', o => num(o.amount)],
    ['paid', '已收款', paidOf], ['product', '产品', o => text(o.productType)], ['owner', '跟进人', o => text(o.owner)],
    ['tracking', '物流单号', o => text(o.trackingNumber)], ['carrier', '承运商', o => text(o.carrier)],
    ['note', '备注', o => text(o.note)], ['draft', '是否草稿', o => o.isDraft ? '是' : '否'],
  ];
  function orderRows(orders, options = {}) {
    const items = list(orders).filter(o => o && typeof o === 'object');
    cap(items.length);
    return build(ORDER_COLUMNS, items, options.gate);
  }
  function orderItemRows(orders) {
    const data = [];
    for (const order of list(orders)) {
      if (!order || typeof order !== 'object') continue;
      for (const item of list(order.items)) {
        if (!item || typeof item !== 'object') continue;
        data.push([text(order.num), text(item.code), text(item.name), text(item.model), num(item.qty), num(item.price)]);
      }
    }
    cap(data.length);
    return { header: ['订单号', '产品编号', '名称', '型号', '数量', '单价'], data };
  }

  const KIND_TEXT = { open: '进行中', won: '赢单', lost: '输单' };
  function opportunityRows(items, state, options = {}) {
    const source = list(items).filter(o => o && typeof o === 'object');
    cap(source.length);
    const stageOf = item => OM.stageOf(state, item);
    const columns = [
      ['number', '编号', o => text(o.number)], ['name', '名称', o => text(o.name)], ['client', '客户', o => text(o.client)],
      ['contact', '联系人', o => text(o.contact)], ['flow', '流程', o => text(OM.flowOf(state, o.flow).label)],
      ['stage', '阶段', o => text(stageOf(o).label)],
      ['status', '状态', o => o.archived === true ? '已归档' : KIND_TEXT[stageOf(o).kind] || ''],
      ['amount', '金额', o => num(o.amount)], ['currency', '币种', o => text(o.currency || 'USD').toUpperCase()],
      ['exchangeRate', '汇率', o => num(o.exchangeRate)], ['endDate', '结束日期', o => localDay(o.endDate)],
      ['owner', '负责人', o => text(o.owner)], ['sources', '来源', o => text(o.sources)], ['type', '类型', o => text(o.type)],
      ['tags', '标签', o => text(o.tags)], ['lostReason', '输单原因', o => stageOf(o).kind === 'lost' ? text(o.lostReason) : ''],
      ['createdAt', '创建时间', o => localDay(o.createdAt)],
      ...OM.customFields(state).map(field => ['custom:' + field.id, field.name, o => {
        const value = o.custom && typeof o.custom === 'object' ? o.custom[field.id] : undefined;
        return field.type === 'number' ? num(value) : field.type === 'date' ? localDay(value) || text(value) : text(value);
      }]),
    ];
    return build(columns, source, options.gate);
  }

  const LEAD_STATUS = { new: '新线索', following: '跟进中', converted: '已转客户', invalid: '无效' };
  function leadRows(leads, state, options = {}) {
    const source = list(leads).filter(l => l && typeof l === 'object' && (options.includeTrash || !l.trashed));
    cap(source.length);
    const columns = [
      ['name', '名称', l => text(l.name)], ['contact', '联系人', l => text(l.contact)], ['email', '邮箱', l => text(l.email)],
      ['phone', '电话', l => text(l.phone)], ['country', '国家', l => text(l.country)], ['source', '来源', l => text(l.source)],
      ['website', '网址', l => text(l.website)], ['product', '意向产品', l => text(l.product)], ['note', '备注', l => text(l.note)],
      ['status', '状态', l => l.trashed ? '回收站' : LEAD_STATUS[l.status] || LEAD_STATUS.new],
      ['owner', '跟进人', l => text(l.owner)], ['nextFollow', '下次跟进', l => localDay(l.nextFollow)],
      ['lastFollowAt', '最近跟进', l => localDay(l.lastFollowAt)], ['createdAt', '创建时间', l => localDay(l.createdAt)],
      ['invalidReason', '无效原因', l => text(l.invalidReason)], ['convertedTo', '已转客户', l => text(l.convertedTo)],
    ];
    return build(columns, source, options.gate);
  }

  // ---- output ----
  function sheetName(name, used) {
    const base = String(name || '表格').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || '表格';
    let result = base, n = 2;
    while (used.has(result.toLowerCase())) { const suffix = `(${n++})`; result = base.slice(0, 31 - suffix.length) + suffix; }
    used.add(result.toLowerCase());
    return result;
  }
  function toWorkbook(XLSX, sheets) {
    const wb = XLSX.utils.book_new(), used = new Set();
    for (const sheet of list(sheets)) {
      const ws = XLSX.utils.aoa_to_sheet([sheet.header || [], ...(sheet.data || [])]);
      XLSX.utils.book_append_sheet(wb, ws, sheetName(sheet.name, used));
    }
    return wb;
  }
  // A text cell that starts with = + - @ or a tab/CR could run as a formula in a spreadsheet: prefix an apostrophe.
  // 表格公式注入防护：=、+、-、@、制表符开头的文字前加 '。只含数字、空格、括号和连字符的电话号码（如 +44 7700 900123）不算公式，不加。
  const PHONE = /^\+[\d\s().-]+$/;
  const guard = value => typeof value === 'string' && /^[=+\-@\t\r]/.test(value) && !PHONE.test(value) ? "'" + value : value;
  function cellText(value) {
    if (value === null || value === undefined) return '';
    return typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(guard(value));
  }
  function serialise(sheet, separator, eol) {
    const needs = separator === '\t' ? /[\t\r\n"]/ : /[,\r\n"]/;
    return [sheet.header || [], ...(sheet.data || [])].map(row => row.map(value => {
      const cell = cellText(value);
      return needs.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;
    }).join(separator)).join(eol);
  }
  // CSV gets a BOM so Excel reads the Chinese text correctly (options.bom === false to leave it out).
  const toCSV = (sheet, options = {}) => (options.bom === false ? '' : '﻿') + serialise(sheet, ',', '\r\n');
  const toTSV = sheet => serialise(sheet, '\t', '\n');

  const api = { MAX_ROWS, MAX_ERROR, customerRows, orderRows, orderItemRows, opportunityRows, leadRows, toWorkbook, toCSV, toTSV, localDay, guard };
  if (node) module.exports = api; else root.LaiExportModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
