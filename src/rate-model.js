(function (root) {
  'use strict';
  // 汇率设置（纯逻辑，没有界面）。存在 state.laiSettings.rates = {list:[{code, usd100, updatedAt}]}：
  // usd100 是「每 100 外币折合多少美元」，和商机上的汇率写法一样。美元固定为 100，不存进表里。
  // 只能手动填，不自带任何汇率。表是空的时，所有金额和今天一样：外币订单不折算，客户金额显示为空、等级不自动判断。
  // 订单保存时（新订单或改了币种）记下当时的汇率 order.usdRate，以后改表里的汇率不会改已经保存的订单；
  // 没记过汇率的老订单用表里现在的汇率。
  const MAX_DECIMALS = 6;
  const trim = value => String(value ?? '').trim();
  const codeOf = value => trim(value).toUpperCase();
  const validCode = value => /^[A-Za-z]{3}$/.test(trim(value));
  const positive = value => { const n = Number(value); return typeof value !== 'boolean' && value !== null && value !== '' && Number.isFinite(n) && n > 0 ? n : null; };
  const round = (value, digits) => { const f = 10 ** digits; return Math.round(value * f) / f; };
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 表里存的汇率（不含美元），按币种代码去重，坏数据跳过。
  // 同一份表只整理一次（客户列表会对每笔订单查汇率）；调用方拿到的是副本。
  const memo = new WeakMap();
  function stored(state) {
    const raw = state?.laiSettings?.rates?.list;
    if (!Array.isArray(raw) || !raw.length) return [];
    if (!memo.has(raw)) memo.set(raw, Object.freeze(clean(raw).map(row => Object.freeze(row))));
    return memo.get(raw).map(row => ({ ...row }));
  }
  function lookup(state, code) {
    const raw = state?.laiSettings?.rates?.list;
    if (!Array.isArray(raw) || !raw.length) return null;
    if (!memo.has(raw)) stored(state);
    const row = memo.get(raw).find(item => item.code === code);
    return row ? row.usd100 : null;
  }
  function clean(raw) {
    const seen = new Set(), out = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      if (!row || typeof row !== 'object') continue;
      const code = codeOf(row.code), usd100 = positive(row.usd100);
      if (!validCode(row.code) || code === 'USD' || usd100 === null || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, usd100, updatedAt: trim(row.updatedAt) });
    }
    return out;
  }
  // 页面上的表：美元固定在第一行。
  function list(state) {
    return [{ code: 'USD', usd100: 100, updatedAt: '', fixed: true }, ...stored(state).sort((a, b) => a.code.localeCompare(b.code))];
  }
  // 某个币种现在的汇率；没设置时返回 null。美元永远是 100。
  function rateFor(state, code) {
    const c = codeOf(code || 'USD');
    if (c === 'USD') return 100;
    return lookup(state, c);
  }
  // 订单折算用的汇率：先用订单保存时记下的，没有就用表里现在的；都没有返回 null（和今天一样不折算）。
  function orderRate(state, order) {
    const c = codeOf(order?.currency || 'USD');
    if (c === 'USD') return 100;
    return positive(order?.usdRate) ?? rateFor(state, c);
  }
  // 把订单上的一笔金额（默认订单金额）折成美元；没有汇率时返回 null。
  function orderUsd(state, order, value = order?.amount) {
    const rate = orderRate(state, order);
    if (rate === null) return null;
    const n = Number(value);
    const amount = Number.isFinite(n) ? Math.max(0, n) : 0;
    return rate === 100 ? amount : round(amount * rate / 100, 2);
  }
  // 商机上的汇率：外币正好是 100 时当作没填（商机表单的默认值就是 100），美元永远是 100。
  function opportunityRate(opportunity) {
    const c = codeOf(opportunity?.currency || 'USD');
    if (c === 'USD') return 100;
    const rate = positive(opportunity?.exchangeRate);
    return rate === null || rate === 100 ? null : rate;
  }
  // 每 100 这种外币折合多少人民币：由人民币那一行算出来；没设人民币汇率时返回 null。
  function cny100(state, code) {
    const c = codeOf(code);
    if (c === 'CNY') return 100;
    const own = rateFor(state, c), cny = rateFor(state, 'CNY');
    if (own === null || cny === null) return null;
    return round(own / cny * 100, 4);
  }
  // 检查用户填的汇率：大于 0，最多 6 位小数。返回数字或抛出中文错误。
  function parseRate(text) {
    const value = trim(text).replace(/,/g, '');
    if (!value) throw new Error('请填写汇率');
    if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('汇率只能填数字');
    if ((value.split('.')[1] || '').length > MAX_DECIMALS) throw new Error(`汇率最多 ${MAX_DECIMALS} 位小数`);
    const n = Number(value);
    if (!(n > 0) || !Number.isFinite(n)) throw new Error('汇率要大于 0');
    if (n > 1e9) throw new Error('汇率太大了，请检查');
    return n;
  }
  function parseCode(text) {
    const value = trim(text);
    if (!value) throw new Error('请填写币种代码');
    if (!validCode(value)) throw new Error('币种代码是 3 个英文字母，例如 EUR');
    const code = codeOf(value);
    if (code === 'USD') throw new Error('美元固定为 100，不用设置');
    return code;
  }
  const withList = (state, rows) => ({ ...state, laiSettings: { ...(state?.laiSettings || {}), rates: { ...(state?.laiSettings?.rates || {}), list: rows } } });
  // 新增或修改一个币种的汇率。adding=true 时，表里已经有这个币种就报错。
  function setRate(state, code, rate, { now = localDate(), adding = false } = {}) {
    const c = parseCode(code), usd100 = typeof rate === 'number' && rate > 0 && Number.isFinite(rate) ? rate : parseRate(rate);
    const rows = stored(state);
    if (adding && rows.some(row => row.code === c)) throw new Error(`${c} 已经设置过了，可以直接修改`);
    const next = rows.some(row => row.code === c)
      ? rows.map(row => row.code === c ? { ...row, usd100, updatedAt: now } : row)
      : [...rows, { code: c, usd100, updatedAt: now }];
    return withList(state, next);
  }
  // 哪些地方还在用这个币种：订单（含回收站）、商机、客户的默认币种、默认录入里的默认币种。
  function usage(state, code) {
    const c = codeOf(code);
    const same = value => codeOf(value || '') === c;
    const orders = [...(state?.orders || []), ...(state?.trashOrders || [])].filter(o => o && same(o.currency || 'USD')).length;
    const opportunities = (state?.laiOpportunities || []).filter(o => o && same(o.currency || 'USD')).length;
    const customers = Object.values(state?.customers || {}).filter(c2 => c2 && same(c2.currency)).length;
    const defaults = same(state?.laiSettings?.defaultCurrency) || same(state?.orderSettings?.defaultCurrency) ? 1 : 0;
    return { orders, opportunities, customers, defaults, total: orders + opportunities + customers + defaults };
  }
  function usageText(use) {
    const parts = [];
    if (use.orders) parts.push(`${use.orders} 笔订单`);
    if (use.opportunities) parts.push(`${use.opportunities} 个商机`);
    if (use.customers) parts.push(`${use.customers} 个客户的默认币种`);
    if (use.defaults) parts.push('默认录入的默认币种');
    return parts.join('、');
  }
  // 删除一个币种的汇率；还有订单、商机或客户在用时不能删。
  function removeRate(state, code) {
    const c = codeOf(code);
    if (c === 'USD') throw new Error('美元固定为 100，不能删除');
    const rows = stored(state);
    if (!rows.some(row => row.code === c)) throw new Error('这个币种没有设置汇率');
    const use = usage(state, c);
    if (use.total) throw new Error(`还有${usageText(use)}在用 ${c}，不能删除`);
    return withList(state, rows.filter(row => row.code !== c));
  }
  // 在用、但还没设置汇率的币种（页面上显示为「未设置」）。
  function missing(state) {
    const codes = new Set();
    const add = value => { const c = codeOf(value); if (/^[A-Z]{3}$/.test(c) && c !== 'USD') codes.add(c); };
    for (const o of [...(state?.orders || []), ...(state?.trashOrders || [])]) if (o) add(o.currency || 'USD');
    for (const o of state?.laiOpportunities || []) if (o) add(o.currency || 'USD');
    for (const c of Object.values(state?.customers || {})) if (c && c.currency) add(c.currency);
    add(state?.laiSettings?.defaultCurrency);
    const have = new Set(stored(state).map(row => row.code));
    return [...codes].filter(c => !have.has(c)).sort();
  }
  // 给页面显示用：最多 6 位小数，去掉末尾的 0。
  function format(value, digits = MAX_DECIMALS) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return String(round(n, digits));
  }
  const api = { MAX_DECIMALS, list, stored, rateFor, orderRate, orderUsd, opportunityRate, cny100, parseRate, parseCode, setRate, removeRate, usage, usageText, missing, format, localDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaiRateModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
